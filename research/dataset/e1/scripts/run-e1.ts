import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createConnection } from 'node:net';
import * as os from 'node:os';
import { basename, relative, resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { MfaMethod } from '../../../../src/enums/MfaMethod';
import { E1_MAIL_DIAGNOSTIC_PREFIX } from '../../../../src/services/mail.service';
import {
  ACCOUNTS_PATH,
  METADATA_PATH,
  TOTP_SECRETS_PATH,
  WEBAUTHN_SNAPSHOT_PATH,
  TotpSecretStore,
  WebAuthnSnapshot,
  parseAccountsCsv,
  readJson,
  requireEnvironment,
} from '../../../dataset';
import {
  cleanupResearchChallenges,
  connectDatabase,
  disconnectDatabase,
  loadCredentials,
  loadResearchUsers,
  researchChallengeCount,
} from '../../../runtime';
import { validateDataset } from '../../../scripts/validate-dataset';
import {
  E1_VARIANTS,
  E1Variant,
  INTER_VARIANT_IDLE_SECONDS,
  LIMITER_RESET_SECONDS,
  MEASURED_SCHEDULE,
  MEMORY_SAMPLE_INTERVAL_MS,
  MailpitInfo,
  MailpitMailbox,
  SOURCE_IP_MAPPING_ID,
  THREADS,
  WILLIAMS_BLOCK,
  assertNoSecrets,
  buildMailDiagnosticRequests,
  buildClientMapping,
  clientMappingCsv,
  createExclusiveDirectory,
  parseMailDiagnosticEvents,
  parseJtl,
  summarizeMailpitPilot,
} from '../protocol';

type Mode = 'preflight' | 'pilot' | 'full';

type GitState = {
  commit: string;
  tracked_worktree_clean: boolean;
  worktree_clean: boolean;
};

type BackendContainer = {
  id: string;
  image: string;
  imageId: string;
  pid: number;
  cgroupPath: string;
  cpuLimit: string;
  memoryLimit: string;
  cpuset: string;
};

type MailpitContainer = {
  id: string;
  image: string;
  imageId: string;
  version: string;
  baselineMessageCount: number;
};

type AuthState = {
  challenge_count: number;
  totp_last_used_steps: Array<{
    client_slot: string;
    user_id: string;
    totp_last_used_step: number | null;
  }>;
  webauthn_sign_counts: Array<{
    client_slot: string;
    user_id: string;
    sign_count: number;
  }>;
};

type BurstResult = {
  runPath: string;
  startTimestamp: string;
  samples: ReturnType<typeof parseJtl>;
  jmeterExitCode: number | null;
  resourceMonitorOk: boolean;
};

type IndexRecord = {
  round: number;
  orderPosition: number;
  variant: E1Variant;
  runPath: string;
  startTimestamp: string;
  successCount: number;
  failureCount: number;
};

const BACKEND_ROOT = resolve(__dirname, '../../../..');
const FRONTEND_ROOT =
  process.env.RESEARCH_FRONTEND_REPO ??
  resolve(BACKEND_ROOT, '../zielony-koszyk');
const E1_ROOT = resolve(BACKEND_ROOT, 'research/dataset/e1');
const RESULTS_ROOT = resolve(BACKEND_ROOT, 'research/results/e1-init');
const JMX_PATH = resolve(E1_ROOT, 'jmeter/e1-login.jmx');
const JMETER_PROPERTIES_PATH = resolve(E1_ROOT, 'jmeter/e1.properties');
const BACKEND_HOST = '127.0.0.1';
const BACKEND_PORT = Number(process.env.PORT ?? 3000);
const BACKEND_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}`;
const MAILPIT_VERSION = '1.31.1';
const MAILPIT_IMAGE = `axllent/mailpit:v${MAILPIT_VERSION}`;
const MAILPIT_HOST = 'mailpit';
const MAILPIT_SMTP_PORT = 1025;
const MAILPIT_API_PORT = 8025;
const MAILPIT_API_URL = `http://127.0.0.1:${MAILPIT_API_PORT}`;

const sleep = (seconds: number) =>
  new Promise((done) => setTimeout(done, seconds * 1_000));

const exitCode = (
  command: string,
  args: string[],
  options: { cwd?: string; quiet?: boolean } = {},
) =>
  new Promise<number>((done, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? BACKEND_ROOT,
      env: process.env,
      stdio: options.quiet ? 'ignore' : 'inherit',
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (signal) reject(new Error(`${command} terminated by ${signal}`));
      else done(code ?? 1);
    });
  });

const output = (command: string, args: string[], cwd = BACKEND_ROOT) =>
  new Promise<string>((done, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0 && !signal) done(stdout.trim());
      else
        reject(
          new Error(
            `${command} failed (${signal ?? code ?? 'unknown'}): ${stderr.trim().split('\n').at(-1) ?? ''}`,
          ),
        );
    });
  });

const writeJson = async (path: string, value: unknown, replace = false) => {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (!replace) {
    await writeFile(path, body, { flag: 'wx' });
    return;
  }
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, body);
  await rename(temporary, path);
};

const gitState = async (directory: string): Promise<GitState> => ({
  commit: await output('git', ['rev-parse', 'HEAD'], directory),
  tracked_worktree_clean:
    (await output(
      'git',
      ['status', '--porcelain=v1', '--untracked-files=no'],
      directory,
    )) === '',
  worktree_clean:
    (await output(
      'git',
      ['status', '--porcelain=v1', '--untracked-files=all'],
      directory,
    )) === '',
});

const tcpReachable = (port: number) =>
  new Promise<boolean>((done) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      done(reachable);
    };
    socket.setTimeout(1_000, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });

const mailpitJson = async <T>(path: string): Promise<T> => {
  const response = await fetch(`${MAILPIT_API_URL}${path}`, {
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok)
    throw new Error(`Mailpit API returned HTTP ${response.status}`);
  return (await response.json()) as T;
};

const readMailpit = async () => {
  const [info, mailbox] = await Promise.all([
    mailpitJson<MailpitInfo>('/api/v1/info'),
    mailpitJson<MailpitMailbox>('/api/v1/messages?start=0&limit=1000'),
  ]);
  return { info, mailbox };
};

const startMailpit = async (): Promise<MailpitContainer> => {
  const occupied = await Promise.all([
    tcpReachable(MAILPIT_SMTP_PORT),
    tcpReachable(MAILPIT_API_PORT),
  ]);
  if (occupied.some(Boolean)) {
    throw new Error('Mailpit requires free localhost ports 1025 and 8025');
  }
  const name = `green-basket-e1-mailpit-${process.pid}-${Date.now()}`;
  const id = await output('docker', [
    'run',
    '--detach',
    '--rm',
    '--network',
    'host',
    '--name',
    name,
    '--label',
    'zielony.research=e1-mailpit',
    '--env',
    'MP_DISABLE_VERSION_CHECK=true',
    '--env',
    'MP_MAX_MESSAGES=1000',
    MAILPIT_IMAGE,
  ]);
  try {
    const deadline = Date.now() + 30_000;
    let healthy = false;
    while (Date.now() < deadline) {
      const status = await output('docker', [
        'inspect',
        '--format',
        '{{.State.Health.Status}}',
        id,
      ]).catch(() => 'missing');
      if (status === 'healthy') {
        healthy = true;
        break;
      }
      if (status === 'unhealthy' || status === 'missing') {
        throw new Error(`Mailpit container is ${status}`);
      }
      await sleep(1);
    }
    if (!healthy) throw new Error('Mailpit health check timed out');
    if (!(await tcpReachable(MAILPIT_SMTP_PORT))) {
      throw new Error('Mailpit SMTP is not reachable');
    }
    const { info, mailbox } = await readMailpit();
    if (info.Version.replace(/^v/, '') !== MAILPIT_VERSION) {
      throw new Error(`Unexpected Mailpit version ${info.Version}`);
    }
    if (info.Messages !== 0 || mailbox.total !== 0) {
      throw new Error('Fresh Mailpit baseline is not empty');
    }
    return {
      id,
      image: MAILPIT_IMAGE,
      imageId: await output('docker', [
        'image',
        'inspect',
        '--format',
        '{{.Id}}',
        MAILPIT_IMAGE,
      ]),
      version: info.Version,
      baselineMessageCount: 0,
    };
  } catch (error) {
    const logs = await output('docker', ['logs', '--tail', '20', id]).catch(
      () => '',
    );
    if (logs) console.error(logs);
    await exitCode('docker', ['stop', '--time', '10', id], {
      quiet: true,
    }).catch(() => undefined);
    throw error;
  }
};

const stopMailpit = async (container?: MailpitContainer) => {
  if (!container) return;
  await exitCode('docker', ['stop', '--time', '10', container.id], {
    quiet: true,
  }).catch(() => undefined);
};

const assertPortFree = async () => {
  let occupied = false;
  try {
    await fetch(BACKEND_URL, { signal: AbortSignal.timeout(1_000) });
    occupied = true;
  } catch {
    // Connection failure means port is available for research backend.
  }
  if (occupied) throw new Error(`Port ${BACKEND_PORT} already serves HTTP`);
};

const cgroupPathForPid = async (pid: number) => {
  const line = (await readFile(`/proc/${pid}/cgroup`, 'utf8'))
    .split('\n')
    .find((entry) => entry.startsWith('0::'));
  if (!line) throw new Error('Backend container is not using cgroup v2');
  const path = resolve('/sys/fs/cgroup', `.${line.slice(3)}`);
  if (!path.startsWith('/sys/fs/cgroup/')) {
    throw new Error('Invalid backend cgroup path');
  }
  await Promise.all([
    readFile(resolve(path, 'cpu.stat'), 'utf8'),
    readFile(resolve(path, 'memory.current'), 'utf8'),
  ]);
  return path;
};

const startBackend = async (
  backendCommit: string,
  mailDiagnostics = false,
): Promise<BackendContainer> => {
  await assertPortFree();
  const image = `green-basket-e1:${backendCommit.slice(0, 12)}`;
  if (
    (await exitCode(
      'docker',
      ['build', '--tag', image, '--file', 'Dockerfile', '.'],
      { cwd: BACKEND_ROOT },
    )) !== 0
  ) {
    throw new Error('Docker image build failed');
  }
  const name = `green-basket-e1-${process.pid}-${Date.now()}`;
  const dockerArguments = [
    'run',
    '--detach',
    '--rm',
    '--network',
    'host',
    '--add-host',
    `${MAILPIT_HOST}:127.0.0.1`,
    '--name',
    name,
    '--label',
    'zielony.research=e1',
    '--env-file',
    resolve(BACKEND_ROOT, '.env'),
    '--env',
    `SMTP_HOST=${MAILPIT_HOST}`,
    '--env',
    `SMTP_PORT=${MAILPIT_SMTP_PORT}`,
    '--env',
    'SMTP_SECURE=false',
    '--env',
    'SMTP_USER=',
    '--env',
    'SMTP_PASSWORD=',
    '--volume',
    `${resolve(BACKEND_ROOT, 'uploads')}:/app/uploads:ro`,
    ...(mailDiagnostics ? ['--env', 'E1_MAIL_DIAGNOSTICS=true'] : []),
    image,
  ];
  const id = await output('docker', dockerArguments);
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(BACKEND_URL, {
          signal: AbortSignal.timeout(2_000),
        });
        if (response.status < 500) break;
      } catch {
        await sleep(1);
      }
    }
    const response = await fetch(BACKEND_URL, {
      signal: AbortSignal.timeout(2_000),
    });
    if (response.status >= 500)
      throw new Error(`Backend HTTP ${response.status}`);
    const [imageId, pidText, limits] = await Promise.all([
      output('docker', ['image', 'inspect', '--format', '{{.Id}}', image]),
      output('docker', ['inspect', '--format', '{{.State.Pid}}', id]),
      output('docker', [
        'inspect',
        '--format',
        '{{.HostConfig.NanoCpus}}|{{.HostConfig.Memory}}|{{.HostConfig.CpusetCpus}}',
        id,
      ]),
    ]);
    const [nanoCpus, memory, cpuset] = limits.split('|');
    const pid = Number(pidText);
    return {
      id,
      image,
      imageId,
      pid,
      cgroupPath: await cgroupPathForPid(pid),
      cpuLimit: nanoCpus === '0' ? 'unlimited' : `${Number(nanoCpus) / 1e9}`,
      memoryLimit: memory === '0' ? 'unlimited' : memory,
      cpuset: cpuset || 'all',
    };
  } catch (error) {
    const logs = await output('docker', ['logs', '--tail', '20', id]).catch(
      () => '',
    );
    if (logs) console.error(logs);
    await exitCode('docker', ['stop', '--time', '10', id], {
      quiet: true,
    }).catch(() => undefined);
    throw error;
  }
};

const stopBackend = async (container?: BackendContainer) => {
  if (!container) return;
  await exitCode('docker', ['stop', '--time', '10', container.id], {
    quiet: true,
  }).catch(() => undefined);
};

const readCpuUsage = (cgroupPath: string) => {
  const match = /^usage_usec\s+(\d+)$/m.exec(
    readFileSync(resolve(cgroupPath, 'cpu.stat'), 'utf8'),
  );
  if (!match) throw new Error('cgroup cpu.stat has no usage_usec');
  return Number(match[1]);
};

const readMemoryCurrent = (cgroupPath: string) =>
  Number(readFileSync(resolve(cgroupPath, 'memory.current'), 'utf8').trim());

const sameIpLogin = (email: string, password: string) =>
  new Promise<number>((done, reject) => {
    const body = Buffer.from(
      JSON.stringify({ email, password, rememberMe: false }),
    );
    const request = httpRequest(
      {
        hostname: BACKEND_HOST,
        port: BACKEND_PORT,
        path: '/auth/login',
        method: 'POST',
        localAddress: '127.0.0.2',
        agent: false,
        headers: {
          'content-type': 'application/json',
          'content-length': body.length,
        },
      },
      (response) => {
        response.resume();
        response.once('end', () => done(response.statusCode ?? 0));
      },
    );
    request.setTimeout(60_000, () =>
      request.destroy(new Error('Login timed out')),
    );
    request.once('error', reject);
    request.end(body);
  });

const runBurst = async (
  experimentRoot: string,
  runPath: string,
  round: number | string,
  orderPosition: number,
  variant: E1Variant,
  accounts: ReturnType<typeof parseAccountsCsv>,
  container: BackendContainer,
  context: {
    backendCommit: string;
    datasetVersion: number;
    jmeterVersion: string;
  },
): Promise<BurstResult> => {
  const directory = resolve(experimentRoot, runPath);
  await mkdir(resolve(directory, '..'), { recursive: true });
  await createExclusiveDirectory(directory);
  const mapping = buildClientMapping(accounts, variant);
  const clientsPath = resolve(directory, 'clients.csv');
  const jtlPath = resolve(directory, 'jmeter.jtl');
  const resourcesPath = resolve(directory, 'resources.csv');
  const logPath = resolve(directory, 'jmeter.log');
  await writeFile(clientsPath, clientMappingCsv(mapping), { flag: 'wx' });

  const memorySamples: Array<{ timestamp: string; bytes: number }> = [];
  let resourceError: Error | undefined;
  const sampleMemory = () => {
    try {
      memorySamples.push({
        timestamp: new Date().toISOString(),
        bytes: readMemoryCurrent(container.cgroupPath),
      });
    } catch (error) {
      resourceError ??= error as Error;
    }
  };
  const cpuBefore = readCpuUsage(container.cgroupPath);
  sampleMemory();
  const memoryBaseline = memorySamples[0]?.bytes ?? 0;
  const startTimestamp = new Date().toISOString();
  const timer = setInterval(sampleMemory, MEMORY_SAMPLE_INTERVAL_MS);
  let jmeterExitCode: number | null = null;
  let runError: Error | undefined;
  let samples: ReturnType<typeof parseJtl> = [];
  try {
    jmeterExitCode = await exitCode('jmeter', [
      '-n',
      '-t',
      JMX_PATH,
      '-q',
      JMETER_PROPERTIES_PATH,
      '-l',
      jtlPath,
      '-j',
      logPath,
      `-Jvariant=${variant}`,
      `-Jaccounts_csv=${clientsPath}`,
      `-Jbackend_host=${BACKEND_HOST}`,
      `-Jbackend_port=${BACKEND_PORT}`,
    ]);
    if (jmeterExitCode !== 0) {
      runError = new Error(`JMeter exited with code ${jmeterExitCode}`);
    } else {
      samples = parseJtl(await readFile(jtlPath, 'utf8'));
    }
  } catch (error) {
    runError = error as Error;
  } finally {
    clearInterval(timer);
    sampleMemory();
  }
  let cpuAfter = cpuBefore;
  try {
    cpuAfter = readCpuUsage(container.cgroupPath);
  } catch (error) {
    resourceError ??= error as Error;
  }
  const endTimestamp = new Date().toISOString();
  await writeFile(
    resourcesPath,
    [
      'timestamp_utc,memory_current_bytes',
      ...memorySamples.map(({ timestamp, bytes }) => `${timestamp},${bytes}`),
      '',
    ].join('\n'),
    { flag: 'wx' },
  );
  const memoryPeak = Math.max(
    memoryBaseline,
    ...memorySamples.map(({ bytes }) => bytes),
  );
  const responseCodes = Object.fromEntries(
    [...new Set(samples.map(({ responseCode }) => responseCode))]
      .sort()
      .map((code) => [
        code,
        samples.filter(({ responseCode }) => responseCode === code).length,
      ]),
  );
  const successCount = samples.filter(({ success }) => success).length;
  const resourceMonitorOk = !resourceError && memorySamples.length > 1;
  await writeJson(resolve(directory, 'run.json'), {
    experiment: 'E1',
    metric: 'T_init',
    round,
    order_position: orderPosition,
    variant,
    request_count: THREADS,
    expected_clients: THREADS,
    sample_count: samples.length,
    start_timestamp_utc: startTimestamp,
    end_timestamp_utc: endTimestamp,
    backend_commit: context.backendCommit,
    dataset_version: context.datasetVersion,
    jmeter_version: context.jmeterVersion,
    backend_container_id: container.id,
    source_ip_mapping: SOURCE_IP_MAPPING_ID,
    success_count: successCount,
    failure_count: samples.length - successCount,
    missing_count: Math.max(0, THREADS - samples.length),
    http_response_code_counts: responseCodes,
    cpu_usage_before_usec: cpuBefore,
    cpu_usage_after_usec: cpuAfter,
    cpu_usage_delta_usec: cpuAfter - cpuBefore,
    cpu_usage_delta_usec_per_request: (cpuAfter - cpuBefore) / THREADS,
    memory_monitoring_method: 'cgroup_v2_memory.current_sampling',
    memory_sample_interval_ms: MEMORY_SAMPLE_INTERVAL_MS,
    memory_baseline_bytes: memoryBaseline,
    memory_peak_bytes: memoryPeak,
    memory_peak_delta_bytes: memoryPeak - memoryBaseline,
    resource_monitor_ok: resourceMonitorOk,
    jmeter_exit_code: jmeterExitCode,
    harness_error: runError?.message ?? resourceError?.message ?? null,
  });
  if (runError) throw runError;
  if (resourceError) throw resourceError;
  return {
    runPath,
    startTimestamp,
    samples,
    jmeterExitCode,
    resourceMonitorOk,
  };
};

const assertBurst = (
  result: BurstResult,
  variant: E1Variant,
  allowSmtpSystemFailure = false,
) => {
  if (result.jmeterExitCode !== 0) throw new Error('JMeter burst failed');
  if (!result.resourceMonitorOk) throw new Error('Resource monitor failed');
  if (result.samples.length !== THREADS) {
    throw new Error(
      `Burst produced ${result.samples.length}/${THREADS} samples`,
    );
  }
  if (new Set(result.samples.map(({ label }) => label)).size !== THREADS) {
    throw new Error('Burst does not contain 50 unique client labels');
  }
  const rateLimited = result.samples.filter(
    ({ responseCode }) => responseCode === '429',
  );
  if (rateLimited.length)
    throw new Error('ABORT E1: source-IP collapse produced 429');
  const failures = result.samples.filter(({ success }) => !success);
  if (
    failures.length &&
    !(
      allowSmtpSystemFailure &&
      variant === MfaMethod.EMAIL_OTP &&
      failures.every(({ responseCode }) => responseCode === '503')
    )
  ) {
    throw new Error(
      `${variant} burst has ${failures.length} harness/protocol failures`,
    );
  }
};

const captureMailDiagnostics = async (
  experimentRoot: string,
  result: BurstResult,
  accounts: ReturnType<typeof parseAccountsCsv>,
  container: BackendContainer,
) => {
  const events = parseMailDiagnosticEvents(
    await output('docker', ['logs', container.id]),
    E1_MAIL_DIAGNOSTIC_PREFIX,
  );
  const requests = buildMailDiagnosticRequests(
    buildClientMapping(accounts, MfaMethod.EMAIL_OTP),
    result.samples,
    events,
  );
  await writeJson(
    resolve(experimentRoot, result.runPath, 'mail-diagnostics.json'),
    {
      captured_at_utc: new Date().toISOString(),
      request_count: requests.length,
      status_counts: Object.fromEntries(
        ['queued', 'smtp_started', 'smtp_accepted', 'smtp_failed'].map(
          (status) => [
            status,
            requests.filter(({ status_history }) =>
              status_history.some((entry) => entry.status === status),
            ).length,
          ],
        ),
      ),
      requests,
    },
  );
};

const captureMailpitPilot = async (
  experimentRoot: string,
  result: BurstResult,
  accounts: ReturnType<typeof parseAccountsCsv>,
  mailpit: MailpitContainer,
) => {
  const deadline = Date.now() + 5_000;
  let state = await readMailpit();
  while (state.info.Messages < THREADS && Date.now() < deadline) {
    await sleep(0.1);
    state = await readMailpit();
  }
  const summary = summarizeMailpitPilot(
    state.info,
    state.mailbox,
    buildClientMapping(accounts, MfaMethod.EMAIL_OTP).map(({ email }) => email),
  );
  await writeJson(resolve(experimentRoot, result.runPath, 'mailpit.json'), {
    experiment_id: basename(experimentRoot),
    run_path: result.runPath,
    run_started_at_utc: result.startTimestamp,
    captured_at_utc: new Date().toISOString(),
    mailpit_image: mailpit.image,
    mailpit_image_id: mailpit.imageId,
    mailpit_version: state.info.Version,
    clean_baseline_message_count: mailpit.baselineMessageCount,
    smtp_host: MAILPIT_HOST,
    smtp_port: MAILPIT_SMTP_PORT,
    ...summary,
  });
  if (summary.validation !== 'PASSED') {
    throw new Error(
      `Mailpit pilot validation failed: ${summary.failures.join(', ')}`,
    );
  }
};

const runtimeAccounts = (accounts: ReturnType<typeof parseAccountsCsv>) =>
  accounts.map(({ client_slot, variant, email }) => ({
    client_slot,
    variant,
    email,
    identifier: email.slice(0, email.indexOf('@')),
  }));

const captureAuthState = async (
  source: DataSource,
  accounts: ReturnType<typeof parseAccountsCsv>,
): Promise<AuthState> => {
  const users = await loadResearchUsers(source, runtimeAccounts(accounts));
  const userIds = users.map(({ user_id }) => user_id);
  const credentials = await loadCredentials(source, userIds);
  const slotsByUser = new Map(
    users.map(({ user_id, client_slot }) => [user_id, client_slot]),
  );
  return {
    challenge_count: await researchChallengeCount(source, userIds),
    totp_last_used_steps: users
      .filter(({ variant }) => variant === MfaMethod.TOTP)
      .map(({ client_slot, user_id, totp_last_used_step }) => ({
        client_slot,
        user_id,
        totp_last_used_step,
      }))
      .sort((left, right) => left.client_slot.localeCompare(right.client_slot)),
    webauthn_sign_counts: credentials
      .map(({ user_id, sign_count }) => ({
        client_slot: slotsByUser.get(user_id) ?? '',
        user_id,
        sign_count,
      }))
      .sort((left, right) => left.client_slot.localeCompare(right.client_slot)),
  };
};

const assertAuthStatePreserved = (before: AuthState, after: AuthState) => {
  if (after.challenge_count !== 0)
    throw new Error('Research challenge cleanup failed');
  if (
    JSON.stringify(before.totp_last_used_steps) !==
    JSON.stringify(after.totp_last_used_steps)
  ) {
    throw new Error('TOTP last-used state changed during E1');
  }
  if (
    JSON.stringify(before.webauthn_sign_counts) !==
    JSON.stringify(after.webauthn_sign_counts)
  ) {
    throw new Error('WebAuthn counters changed during E1');
  }
};

const parseOsRelease = async () => {
  const entries = Object.fromEntries(
    (await readFile('/etc/os-release', 'utf8'))
      .trim()
      .split('\n')
      .map((line) => {
        const separator = line.indexOf('=');
        return [
          line.slice(0, separator),
          line.slice(separator + 1).replace(/^"|"$/g, ''),
        ];
      }),
  );
  return entries.PRETTY_NAME ?? os.type();
};

const physicalCpuCount = async () => {
  const blocks = (await readFile('/proc/cpuinfo', 'utf8')).split(/\n\n+/);
  const cores = new Set<string>();
  for (const block of blocks) {
    const physical = /^physical id\s*:\s*(.+)$/m.exec(block)?.[1];
    const core = /^core id\s*:\s*(.+)$/m.exec(block)?.[1];
    if (physical && core) cores.add(`${physical}:${core}`);
  }
  return cores.size || null;
};

const jmeterVersion = async () => {
  const text = await new Promise<string>((done, reject) => {
    const child = spawn('jmeter', ['--version'], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let content = '';
    child.stdout.on('data', (chunk: Buffer) => (content += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (content += chunk.toString()));
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0
        ? done(content)
        : reject(new Error('JMeter version check failed')),
    );
  });
  const versions = text.match(/\b\d+\.\d+\.\d+\b/g);
  if (!versions?.length) throw new Error('Unable to determine JMeter version');
  return versions.at(-1);
};

const collectEnvironment = async (
  experimentId: string,
  backendGit: GitState,
  frontendGit: GitState,
  container: BackendContainer,
  mailpit: MailpitContainer,
  source: DataSource,
  version: string,
  datasetVersion: number,
) => {
  const database = new URL(process.env.DATABASE_URL);
  const [{ server_version: postgresVersion }] = await source.query<
    Array<{ server_version: string }>
  >('SHOW server_version');
  const cpu = os.cpus();
  return {
    experiment: 'E1',
    experiment_id: experimentId,
    timestamp_utc: new Date().toISOString(),
    host: {
      os: await parseOsRelease(),
      kernel: os.release(),
      architecture: os.arch(),
      cpu_model: cpu[0]?.model ?? 'unknown',
      physical_cpu_cores: await physicalCpuCount(),
      logical_cpu_cores: cpu.length,
      ram_bytes: os.totalmem(),
    },
    docker: {
      version: await output('docker', [
        'version',
        '--format',
        '{{.Server.Version}}',
      ]),
      image: container.image,
      image_id: container.imageId,
      container_id: container.id,
      cpu_limit: container.cpuLimit,
      memory_limit: container.memoryLimit,
      cpuset: container.cpuset,
    },
    mailpit: {
      version: mailpit.version,
      image: mailpit.image,
      image_id: mailpit.imageId,
      container_id: mailpit.id,
      api_url: MAILPIT_API_URL,
      clean_baseline_message_count: mailpit.baselineMessageCount,
    },
    node_version: await output('docker', [
      'exec',
      container.id,
      'node',
      '--version',
    ]),
    postgresql_version: postgresVersion,
    jmeter_version: version,
    backend_commit: backendGit.commit,
    frontend_commit: frontendGit.commit,
    backend_tracked_worktree_clean: backendGit.tracked_worktree_clean,
    frontend_tracked_worktree_clean: frontendGit.tracked_worktree_clean,
    backend_worktree_clean: backendGit.worktree_clean,
    frontend_worktree_clean: frontendGit.worktree_clean,
    dataset_version: datasetVersion,
    database: {
      type: database.protocol.replace(':', ''),
      host: database.hostname,
      port: database.port || '5432',
      name: database.pathname.slice(1),
    },
    backend_url: BACKEND_URL,
    smtp: {
      host: MAILPIT_HOST,
      port: MAILPIT_SMTP_PORT,
      secure: false,
      authentication: false,
      transport: 'nodemailer_smtp_non_pooled',
    },
    webauthn_rp_id: process.env.WEBAUTHN_RP_ID,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    cgroup_version: 2,
    ram_monitoring_method: 'cgroup_v2_memory.current_sampling',
    ram_sample_interval_ms: MEMORY_SAMPLE_INTERVAL_MS,
    source_ip_strategy:
      'JMeter HTTPSampler.ipSource 127.0.0.2-127.0.0.51 with Docker host networking',
  };
};

const protocol = (experimentId: string) => ({
  experiment: 'E1',
  experiment_id: experimentId,
  metric: 'T_init',
  threads: THREADS,
  requests_per_thread: 1,
  synchronizing_timer: THREADS,
  synchronizing_timer_timeout_ms: 15_000,
  connect_timeout_ms: 5_000,
  response_timeout_ms: 60_000,
  measured_rounds: 12,
  warmup_rounds: 1,
  inter_variant_idle_seconds: INTER_VARIANT_IDLE_SECONDS,
  round_cooldown_seconds: LIMITER_RESET_SECONDS,
  variant_order: MEASURED_SCHEDULE,
  retries: false,
  redirects: false,
  keep_alive: true,
  T_init_source: 'JMeter elapsed',
  response_body_saved: false,
  source_ip_mapping: SOURCE_IP_MAPPING_ID,
  backend_network: 'host',
  ram_monitoring_method: 'cgroup_v2_memory.current_sampling',
  ram_sample_interval_ms: MEMORY_SAMPLE_INTERVAL_MS,
  email_otp_messages: { warmup: 50, measured: 600, total: 650 },
  email_otp_transport: {
    server: 'Mailpit',
    smtp_submission_waited: true,
    pool: false,
    retries: false,
    pacing: false,
  },
});

const variantSlug = (variant: E1Variant) =>
  variant.toLowerCase().replace('_', '-');

const writeIndex = async (experimentRoot: string, rows: IndexRecord[]) => {
  const path = resolve(experimentRoot, 'index.csv');
  const text = [
    'round,order_position,variant,run_path,start_timestamp,success_count,failure_count',
    ...rows.map((row) =>
      [
        row.round,
        row.orderPosition,
        row.variant,
        row.runPath,
        row.startTimestamp,
        row.successCount,
        row.failureCount,
      ].join(','),
    ),
    '',
  ].join('\n');
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, text);
  await rename(temporary, path);
};

const filesUnder = async (directory: string): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
};

const assertResultArtifactsSafe = async (experimentRoot: string) => {
  const [totpSecrets, snapshot, files] = await Promise.all([
    readJson<TotpSecretStore>(TOTP_SECRETS_PATH),
    readJson<WebAuthnSnapshot>(WEBAUTHN_SNAPSHOT_PATH),
    filesUnder(experimentRoot),
  ]);
  const texts = await Promise.all(files.map((path) => readFile(path, 'utf8')));
  assertNoSecrets(texts, [
    process.env.MFA_RESEARCH_PASSWORD,
    process.env.DATABASE_URL,
    process.env.JWT_SECRET,
    process.env.MFA_OTP_HMAC_KEY,
    process.env.MFA_TOTP_ENCRYPTION_KEY,
    process.env.SMTP_USER,
    process.env.SMTP_PASSWORD,
    process.env.SMTP_FROM_EMAIL,
    process.env.MAILGUN_API_KEY,
    ...Object.values(totpSecrets).map(({ secret }) => secret),
    ...snapshot.authenticator.credentials.map(({ privateKey }) => privateKey),
  ]);
};

const writeSha256Manifest = async (experimentRoot: string) => {
  const requiredNames = new Set([
    'jmeter.jtl',
    'resources.csv',
    'run.json',
    'protocol.json',
    'environment.json',
    'index.csv',
  ]);
  const paths = (await filesUnder(experimentRoot))
    .filter((path) => requiredNames.has(basename(path)))
    .sort((left, right) =>
      relative(experimentRoot, left).localeCompare(
        relative(experimentRoot, right),
      ),
    );
  const lines = await Promise.all(
    paths.map(async (path) => {
      const hash = createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
      return `${hash}  ${relative(experimentRoot, path)}`;
    }),
  );
  await writeFile(
    resolve(experimentRoot, 'SHA256SUMS'),
    `${lines.join('\n')}\n`,
    {
      flag: 'wx',
    },
  );
};

const finalizeDataset = async (
  source: DataSource,
  accounts: ReturnType<typeof parseAccountsCsv>,
  stateBefore: AuthState,
  experimentRoot: string,
) => {
  const users = await loadResearchUsers(source, runtimeAccounts(accounts));
  await cleanupResearchChallenges(
    source,
    users.map(({ user_id }) => user_id),
  );
  const stateAfter = await captureAuthState(source, accounts);
  await writeJson(resolve(experimentRoot, 'state-after.json'), stateAfter);
  assertAuthStatePreserved(stateBefore, stateAfter);
  await validateDataset(source);
};

const runPreflight = async (
  experimentRoot: string,
  accounts: ReturnType<typeof parseAccountsCsv>,
  container: BackendContainer,
  mailpit: MailpitContainer,
  context: {
    backendCommit: string;
    datasetVersion: number;
    jmeterVersion: string;
  },
) => {
  await mkdir(resolve(experimentRoot, 'preflight'), { recursive: true });
  await writeJson(resolve(experimentRoot, 'preflight/mailpit.json'), {
    verified_at_utc: new Date().toISOString(),
    image: mailpit.image,
    image_id: mailpit.imageId,
    version: mailpit.version,
    api_reachable: true,
    smtp_reachable: true,
    clean_baseline_message_count: mailpit.baselineMessageCount,
    test_message_sent: false,
  });
  console.log('EMAIL_OTP full E1: warm-up 50 + measured 600 = 650 messages');
  const none = buildClientMapping(accounts, MfaMethod.NONE)[0];
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    statuses.push(
      await sameIpLogin(none.email, process.env.MFA_RESEARCH_PASSWORD),
    );
  }
  await writeJson(resolve(experimentRoot, 'preflight/limiter-same-ip.json'), {
    source_ip: '127.0.0.2',
    expected: [201, 201, 201, 201, 201, 429],
    observed: statuses,
  });
  if (
    JSON.stringify(statuses) !== JSON.stringify([201, 201, 201, 201, 201, 429])
  ) {
    throw new Error(`Limiter test failed: ${statuses.join(',')}`);
  }
  console.log(`Limiter same-IP OK; waiting ${LIMITER_RESET_SECONDS}s`);
  await sleep(LIMITER_RESET_SECONDS);
  const canary = await runBurst(
    experimentRoot,
    'preflight/source-ip-canary',
    'preflight',
    1,
    MfaMethod.NONE,
    accounts,
    container,
    context,
  );
  assertBurst(canary, MfaMethod.NONE);
  const count429 = canary.samples.filter(
    ({ responseCode }) => responseCode === '429',
  ).length;
  await writeJson(resolve(experimentRoot, 'preflight/summary.json'), {
    dataset_validation: 'DATASET VALID',
    limiter_same_ip_statuses: statuses,
    unique_ip_clients: THREADS,
    unique_ip_success_count: canary.samples.filter(({ success }) => success)
      .length,
    http_429_count: count429,
    source_ip_mapping: SOURCE_IP_MAPPING_ID,
    expected_email_otp_messages_full_e1: 650,
    mailpit_version: mailpit.version,
    mailpit_clean_baseline_message_count: mailpit.baselineMessageCount,
  });
  console.log(
    `Source-IP canary 50/50, 429=${count429}; waiting ${LIMITER_RESET_SECONDS}s`,
  );
  await sleep(LIMITER_RESET_SECONDS);
};

const runPilot = async (
  experimentRoot: string,
  accounts: ReturnType<typeof parseAccountsCsv>,
  container: BackendContainer,
  mailpit: MailpitContainer,
  context: {
    backendCommit: string;
    datasetVersion: number;
    jmeterVersion: string;
  },
) => {
  for (const [index, variant] of E1_VARIANTS.entries()) {
    await sleep(INTER_VARIANT_IDLE_SECONDS);
    const runPath = `pilot/${String(index + 1).padStart(2, '0')}-${variantSlug(variant)}`;
    const result = await runBurst(
      experimentRoot,
      runPath,
      'pilot',
      index + 1,
      variant,
      accounts,
      container,
      context,
    );
    if (variant === MfaMethod.EMAIL_OTP) {
      await captureMailDiagnostics(experimentRoot, result, accounts, container);
      await captureMailpitPilot(experimentRoot, result, accounts, mailpit);
    }
    assertBurst(result, variant);
    console.log(`${variant} pilot: 50/50, 429=0, resources=OK`);
  }
  console.log(`Pilot complete; waiting ${LIMITER_RESET_SECONDS}s`);
  await sleep(LIMITER_RESET_SECONDS);
};

const runCampaign = async (
  experimentRoot: string,
  accounts: ReturnType<typeof parseAccountsCsv>,
  container: BackendContainer,
  context: {
    backendCommit: string;
    datasetVersion: number;
    jmeterVersion: string;
  },
) => {
  for (const [index, variant] of WILLIAMS_BLOCK[0].entries()) {
    await sleep(INTER_VARIANT_IDLE_SECONDS);
    const result = await runBurst(
      experimentRoot,
      `warmup/${String(index + 1).padStart(2, '0')}-${variantSlug(variant)}`,
      'warmup',
      index + 1,
      variant,
      accounts,
      container,
      context,
    );
    assertBurst(result, variant);
  }
  console.log(`Warm-up complete; waiting ${LIMITER_RESET_SECONDS}s`);
  await sleep(LIMITER_RESET_SECONDS);

  const index: IndexRecord[] = [];
  await writeIndex(experimentRoot, index);
  for (const [roundIndex, variants] of MEASURED_SCHEDULE.entries()) {
    const round = roundIndex + 1;
    for (const [variantIndex, variant] of variants.entries()) {
      await sleep(INTER_VARIANT_IDLE_SECONDS);
      const orderPosition = variantIndex + 1;
      const runPath = `rounds/round-${String(round).padStart(2, '0')}/${String(orderPosition).padStart(2, '0')}-${variantSlug(variant)}`;
      const result = await runBurst(
        experimentRoot,
        runPath,
        round,
        orderPosition,
        variant,
        accounts,
        container,
        context,
      );
      assertBurst(result, variant, true);
      const successCount = result.samples.filter(
        ({ success }) => success,
      ).length;
      index.push({
        round,
        orderPosition,
        variant,
        runPath,
        startTimestamp: result.startTimestamp,
        successCount,
        failureCount: result.samples.length - successCount,
      });
      await writeIndex(experimentRoot, index);
    }
    console.log(
      `Round ${String(round).padStart(2, '0')}/12 complete; waiting ${LIMITER_RESET_SECONDS}s`,
    );
    await sleep(LIMITER_RESET_SECONDS);
  }
  return index;
};

const main = async () => {
  const mode = (process.argv[2] ?? 'full') as Mode;
  if (!['preflight', 'pilot', 'full'].includes(mode)) {
    throw new Error('Mode must be preflight, pilot or full');
  }
  requireEnvironment(
    'DATABASE_URL',
    'MFA_RESEARCH_PASSWORD',
    'RESEARCH_MAIL_DOMAIN',
    'SMTP_FROM_EMAIL',
    'WEBAUTHN_RP_ID',
    'WEBAUTHN_ORIGIN',
  );
  if (
    !Number.isInteger(BACKEND_PORT) ||
    BACKEND_PORT < 1 ||
    BACKEND_PORT > 65_535
  ) {
    throw new Error('PORT must be a valid TCP port');
  }
  await readFile('/sys/fs/cgroup/cgroup.controllers', 'utf8').catch(() => {
    throw new Error('E1 requires cgroup v2');
  });
  const [backendGit, frontendGit, metadata, accountsText, version] =
    await Promise.all([
      gitState(BACKEND_ROOT),
      gitState(FRONTEND_ROOT),
      readJson<{ dataset_version: number }>(METADATA_PATH),
      readFile(ACCOUNTS_PATH, 'utf8'),
      jmeterVersion(),
    ]);
  const accounts = parseAccountsCsv(accountsText);
  for (const variant of E1_VARIANTS) buildClientMapping(accounts, variant);
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const experimentId = `e1-${mode}-${timestamp}-${backendGit.commit.slice(0, 12)}`;
  await mkdir(RESULTS_ROOT, { recursive: true });
  const experimentRoot = resolve(RESULTS_ROOT, experimentId);
  await createExclusiveDirectory(experimentRoot);
  await writeJson(
    resolve(experimentRoot, 'protocol.json'),
    protocol(experimentId),
  );

  let container: BackendContainer | undefined;
  let mailpit: MailpitContainer | undefined;
  let source: DataSource | undefined;
  let stateBefore: AuthState | undefined;
  let challengeProducingRunsStarted = false;
  let finalized = false;
  try {
    mailpit = await startMailpit();
    container = await startBackend(backendGit.commit, mode === 'pilot');
    source = await connectDatabase();
    const users = await loadResearchUsers(source, runtimeAccounts(accounts));
    const userIds = users.map(({ user_id }) => user_id);
    const staleChallenges = await researchChallengeCount(source, userIds);
    if (staleChallenges) {
      await cleanupResearchChallenges(source, userIds);
      console.log(`Cleaned ${staleChallenges} stale research MFA challenges`);
    }
    await validateDataset(source);
    stateBefore = await captureAuthState(source, accounts);
    await writeJson(resolve(experimentRoot, 'state-before.json'), stateBefore);
    await writeJson(
      resolve(experimentRoot, 'environment.json'),
      await collectEnvironment(
        experimentId,
        backendGit,
        frontendGit,
        container,
        mailpit,
        source,
        version,
        metadata.dataset_version,
      ),
    );
    const context = {
      backendCommit: backendGit.commit,
      datasetVersion: metadata.dataset_version,
      jmeterVersion: version,
    };
    await runPreflight(experimentRoot, accounts, container, mailpit, context);
    if (mode === 'preflight') {
      await assertResultArtifactsSafe(experimentRoot);
      console.log(`E1 preflight complete: ${experimentRoot}`);
      return;
    }
    if (
      mode === 'full' &&
      (!backendGit.worktree_clean || !frontendGit.worktree_clean)
    ) {
      throw new Error(
        'E1 HARNESS READY — MEASURED RUN BLOCKED BY UNCOMMITTED TRACKED CHANGES',
      );
    }
    challengeProducingRunsStarted = true;
    if (mode === 'pilot') {
      await runPilot(experimentRoot, accounts, container, mailpit, context);
    } else {
      const index = await runCampaign(
        experimentRoot,
        accounts,
        container,
        context,
      );
      const allSamples = index.reduce(
        (total, row) => total + row.successCount + row.failureCount,
        0,
      );
      if (
        index.length !== 48 ||
        allSamples !== 2_400 ||
        E1_VARIANTS.some(
          (variant) =>
            index
              .filter((row) => row.variant === variant)
              .reduce(
                (total, row) => total + row.successCount + row.failureCount,
                0,
              ) !== 600,
        )
      ) {
        throw new Error('Measured campaign sample counts are incomplete');
      }
    }
    await finalizeDataset(source, accounts, stateBefore, experimentRoot);
    finalized = true;
    await assertResultArtifactsSafe(experimentRoot);
    if (mode === 'full') await writeSha256Manifest(experimentRoot);
    console.log(`E1 ${mode} complete: ${experimentRoot}`);
  } finally {
    if (source && stateBefore && challengeProducingRunsStarted && !finalized) {
      await finalizeDataset(
        source,
        accounts,
        stateBefore,
        experimentRoot,
      ).catch((error) =>
        console.error(`Final cleanup failed: ${(error as Error).message}`),
      );
    }
    await disconnectDatabase();
    await stopBackend(container);
    await stopMailpit(mailpit);
  }
};

void main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
