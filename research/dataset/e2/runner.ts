import 'reflect-metadata';
import { ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { open, readFile, stat, unlink } from 'node:fs/promises';
import * as os from 'node:os';
import { basename, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import * as OTPAuth from 'otpauth';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server';
import { DataSource, In } from 'typeorm';
import {
  MFA_TOTP_ALGORITHM,
  MFA_TOTP_DIGITS,
  MFA_TOTP_ISSUER,
  MFA_TOTP_PERIOD_SECONDS,
} from '../../../src/constants/constants';
import {
  MfaChallenge,
  MfaChallengePurpose,
} from '../../../src/entities/mfa-challenge.entity';
import { MfaMethod } from '../../../src/enums/MfaMethod';
import {
  ACCOUNTS_PATH,
  METADATA_PATH,
  TOTP_SECRETS_PATH,
  WEBAUTHN_SNAPSHOT_PATH,
  TotpSecretStore,
  parseAccountsCsv,
  readJson,
} from '../../dataset';
import {
  chromiumPath,
  connectDatabase,
  disconnectDatabase,
  loadCredentials,
  loadResearchUsers,
} from '../../runtime';
import {
  atomicJson,
  atomicReplacePrivate,
  atomicWrite,
  assertApprovedProtocol,
  burstPath,
  createExclusiveDirectory,
  createTopLevelArtifact,
  scanArtifacts,
  sealDirectory,
  verifySha256Manifest,
} from './artifacts';
import {
  InMemoryRequestBroker,
  LoopbackBrokerServer,
  RequestPackage,
} from './broker';
import { runAnalysis } from './analysis';
import { ResourceMonitorProcess, ResourceSummary } from './monitor';
import {
  DockerInspect,
  MailpitClient,
  NoRetryHttpClient,
  assertMailpitContainerInspect,
} from './preparation';
import {
  APPROVED_PROTOCOL_SHA256,
  BASE_BACKEND_COMMIT,
  BASE_BACKEND_TREE,
  BurstStateMachine,
  CLIENTS,
  CLIENT_SLOTS,
  E2_VARIANTS,
  E2Variant,
  FROZEN_FRONTEND_COMMIT,
  HarnessError,
  INTER_VARIANT_QUIESCENCE_MS,
  LOGIN_CHALLENGE_TTL_MS,
  LOGIN_RATE_LIMIT,
  MAILPIT_IMAGE,
  MAILPIT_MAX_MESSAGES,
  MAILPIT_VERSION,
  MEASURED_BURSTS,
  MEASURED_ROUNDS,
  MEASURED_SAMPLES,
  MEASURED_SAMPLES_PER_VARIANT,
  MEASURED_SCHEDULE,
  ROUND_COOLDOWN_MS,
  VERIFY_ENDPOINT,
  VERIFY_RATE_LIMIT,
  assertPreparationLifetime,
  assertTotpGenerationWindow,
  assertTotpProgression,
  assertTotpReleaseWindow,
  assertWebAuthnCounterProgression,
  nextTotpGenerationTime,
  parseJtl,
  publicClientsCsv,
  sourceIpForSlot,
  validateJtl,
} from './protocol';
import {
  SecretRegistry,
  SemanticExpectation,
  validatePendingLogin,
  validateSemanticResponse,
} from './security';
import {
  E2WebAuthnSession,
  WebAuthnDatabaseCredential,
  generateAssertions,
} from './webauthn';

export type E2Mode = 'preflight' | 'pilot' | 'full' | 'analysis';

export type CliOptions = {
  mode: E2Mode;
  protocolSha: string;
  confirmLive: boolean;
  confirmPilot: boolean;
  confirmFull: boolean;
  approvedPreflightId?: string;
  approvedPilotId?: string;
  fullExperimentId?: string;
};

const flagValue = (argument: string, name: string) =>
  argument.startsWith(`${name}=`) ? argument.slice(name.length + 1) : undefined;

const approvedId = (value: string | undefined, prefix: string) =>
  Boolean(value?.startsWith(prefix) && /^[a-z0-9._-]+$/i.test(value));

export const parseCliArguments = (arguments_: string[]): CliOptions => {
  const [mode, ...flags] = arguments_;
  if (!['preflight', 'pilot', 'full', 'analysis'].includes(mode)) {
    throw new HarnessError('CLI_MODE');
  }
  const known = new Set([
    '--confirm-live-e2',
    '--confirm-pilot',
    '--confirm-full',
  ]);
  const valueNames = [
    '--protocol-sha',
    '--approved-preflight-id',
    '--approved-pilot-id',
    '--full-experiment-id',
  ];
  const values = new Map<string, string>();
  for (const flag of flags) {
    if (known.has(flag)) {
      if (values.has(flag)) throw new HarnessError('CLI_DUPLICATE_FLAG');
      values.set(flag, 'true');
      continue;
    }
    const name = valueNames.find(
      (candidate) => flagValue(flag, candidate) !== undefined,
    );
    const value = name ? flagValue(flag, name) : undefined;
    if (!name || !value || values.has(name)) throw new HarnessError('CLI_FLAG');
    values.set(name, value);
  }
  const options: CliOptions = {
    mode: mode as E2Mode,
    protocolSha: values.get('--protocol-sha') ?? '',
    confirmLive: values.has('--confirm-live-e2'),
    confirmPilot: values.has('--confirm-pilot'),
    confirmFull: values.has('--confirm-full'),
    approvedPreflightId: values.get('--approved-preflight-id'),
    approvedPilotId: values.get('--approved-pilot-id'),
    fullExperimentId: values.get('--full-experiment-id'),
  };
  assertCliAuthorization(options);
  return options;
};

export const assertCliAuthorization = (options: CliOptions) => {
  if (options.protocolSha !== APPROVED_PROTOCOL_SHA256) {
    throw new HarnessError('CLI_PROTOCOL_SHA');
  }
  if (options.mode !== 'analysis' && !options.confirmLive) {
    throw new HarnessError('CLI_LIVE_CONFIRMATION');
  }
  if (
    options.mode === 'pilot' &&
    (!options.confirmPilot ||
      !approvedId(options.approvedPreflightId, 'e2-preflight-'))
  ) {
    throw new HarnessError('CLI_PILOT_APPROVAL');
  }
  if (
    options.mode === 'full' &&
    (!options.confirmFull || !approvedId(options.approvedPilotId, 'e2-pilot-'))
  ) {
    throw new HarnessError('CLI_FULL_APPROVAL');
  }
  if (
    options.mode === 'analysis' &&
    !approvedId(options.fullExperimentId, 'e2-full-')
  ) {
    throw new HarnessError('CLI_ANALYSIS_INPUT');
  }
};

const BACKEND_ROOT = resolve(__dirname, '../../..');
const WORKSPACE_ROOT = resolve(BACKEND_ROOT, '..');
const FRONTEND_ROOT = resolve(WORKSPACE_ROOT, 'zielony-koszyk');
const PROTOCOL_PATH = resolve(WORKSPACE_ROOT, 'E2.md');
const E2_ROOT = resolve(BACKEND_ROOT, 'research/dataset/e2');
const RESULTS_ROOT = resolve(BACKEND_ROOT, 'research/results/e2-verify');
const ACTIVE_WEBAUTHN_SNAPSHOT_PATH = resolve(
  BACKEND_ROOT,
  'research/snapshots/e2-webauthn-current.json',
);
const LIVE_LOCK_PATH = resolve(BACKEND_ROOT, 'research/snapshots/e2-live.lock');
const JMX_PATH = resolve(E2_ROOT, 'jmeter/e2-verify.jmx');
const JMETER_PROPERTIES_PATH = resolve(E2_ROOT, 'jmeter/e2.properties');
const MAILPIT_API_URL = 'http://127.0.0.1:8025';
const BACKEND_PORT = Number(process.env.PORT ?? 3000);
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

type RuntimeAccount = {
  client_slot: string;
  variant: E2Variant;
  user_id: string;
  email: string;
};

type BackendContainer = {
  id: string;
  commit: string;
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
  imageId: string;
};

type RunningCommand = {
  child: ChildProcess;
  done: Promise<number>;
};

const safeEnvironment = () => {
  const names = [
    'PATH',
    'JAVA_HOME',
    'JMETER_HOME',
    'LANG',
    'LC_ALL',
    'TMPDIR',
  ];
  return Object.fromEntries(
    names
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]]),
  );
};

const runCommand = (
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): RunningCommand => {
  const child = spawn(command, args, {
    cwd: options.cwd ?? BACKEND_ROOT,
    env: options.env ?? process.env,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const done = new Promise<number>((resolve, reject) => {
    child.once('error', () => reject(new HarnessError('PROCESS_START')));
    child.once('close', (code, signal) => {
      if (signal) reject(new HarnessError('PROCESS_SIGNAL'));
      else resolve(code ?? 1);
    });
  });
  return { child, done };
};

const commandOutput = (command: string, args: string[], cwd = BACKEND_ROOT) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.once('error', () => reject(new HarnessError('PROCESS_START')));
    child.once('close', (code, signal) => {
      if (code === 0 && !signal) resolve(output.trim());
      else reject(new HarnessError('PROCESS_EXIT'));
    });
  });

const commandStatus = (command: string, args: string[], cwd = BACKEND_ROOT) =>
  new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: 'ignore',
    });
    child.once('error', () => reject(new HarnessError('PROCESS_START')));
    child.once('close', (code) => resolve(code ?? 1));
  });

const requireEnvironment = (...names: string[]) => {
  if (names.some((name) => !process.env[name]?.trim())) {
    throw new HarnessError('ENVIRONMENT_MISSING');
  }
};

const gitState = async () => {
  const baseTree = await commandOutput(
    'git',
    ['rev-parse', `${BASE_BACKEND_COMMIT}^{tree}`],
    BACKEND_ROOT,
  );
  if (baseTree !== BASE_BACKEND_TREE)
    throw new HarnessError('BACKEND_BASE_TREE');
  const protectedPaths = [
    'src',
    'migrations',
    'package-lock.json',
    'research/dataset/accounts.csv',
    'research/dataset/dataset.json',
    'research/dataset/e1',
  ];
  if (
    (await commandStatus(
      'git',
      ['diff', '--quiet', BASE_BACKEND_COMMIT, '--', ...protectedPaths],
      BACKEND_ROOT,
    )) !== 0
  ) {
    throw new HarnessError('PROTECTED_APPLICATION_DIFF');
  }
  const allowedHarnessPath = (path: string) =>
    path === 'package.json' ||
    path === 'research/scripts/webauthn-browser.ts' ||
    path.startsWith('research/dataset/e2/');
  const committedChanges = (
    await commandOutput(
      'git',
      ['diff', '--name-only', BASE_BACKEND_COMMIT, 'HEAD'],
      BACKEND_ROOT,
    )
  )
    .split('\n')
    .filter(Boolean);
  if (!committedChanges.every(allowedHarnessPath)) {
    throw new HarnessError('HARNESS_COMMITTED_DIFF_SCOPE');
  }
  const changed = (
    await commandOutput(
      'git',
      ['status', '--porcelain=v1', '--untracked-files=all'],
      BACKEND_ROOT,
    )
  )
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3));
  const allowed = changed.every(allowedHarnessPath);
  if (!allowed) throw new HarnessError('HARNESS_DIFF_SCOPE');
  const frontendCommit = await commandOutput(
    'git',
    ['rev-parse', 'HEAD'],
    FRONTEND_ROOT,
  );
  const frontendStatus = await commandOutput(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    FRONTEND_ROOT,
  );
  if (frontendCommit !== FROZEN_FRONTEND_COMMIT || frontendStatus) {
    throw new HarnessError('FRONTEND_STATE');
  }
  const backendCommit = await commandOutput(
    'git',
    ['rev-parse', 'HEAD'],
    BACKEND_ROOT,
  );
  const [backendSourceTree, baseSourceTree] = await Promise.all([
    commandOutput('git', ['rev-parse', 'HEAD:src'], BACKEND_ROOT),
    commandOutput(
      'git',
      ['rev-parse', `${BASE_BACKEND_COMMIT}:src`],
      BACKEND_ROOT,
    ),
  ]);
  if (backendSourceTree !== baseSourceTree) {
    throw new HarnessError('BACKEND_SOURCE_TREE');
  }
  return {
    backendCommit,
    backendSourceTree,
    frontendCommit,
    changed,
    committedChanges,
  };
};

const ensureActiveSnapshot = async (allowInitialization: boolean) => {
  try {
    await readFile(ACTIVE_WEBAUTHN_SNAPSHOT_PATH);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new HarnessError('WEBAUTHN_ACTIVE_SNAPSHOT');
    }
    if (!allowInitialization) {
      throw new HarnessError('WEBAUTHN_ACTIVE_SNAPSHOT_MISSING');
    }
    await atomicReplacePrivate(
      ACTIVE_WEBAUTHN_SNAPSHOT_PATH,
      await readFile(WEBAUTHN_SNAPSHOT_PATH),
    );
  }
  const metadata = await stat(ACTIVE_WEBAUTHN_SNAPSHOT_PATH);
  if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
    throw new HarnessError('WEBAUTHN_ACTIVE_SNAPSHOT_MODE');
  }
};

const cgroupPathForPid = async (pid: number) => {
  const line = (await readFile(`/proc/${pid}/cgroup`, 'utf8'))
    .split('\n')
    .find((entry) => entry.startsWith('0::'));
  if (!line) throw new HarnessError('CGROUP_V2');
  const path = resolve('/sys/fs/cgroup', `.${line.slice(3)}`);
  if (!path.startsWith('/sys/fs/cgroup/'))
    throw new HarnessError('CGROUP_PATH');
  await Promise.all([
    readFile(resolve(path, 'cpu.stat')),
    readFile(resolve(path, 'memory.current')),
  ]);
  return path;
};

const startMailpit = async () => {
  const id = await commandOutput('docker', [
    'run',
    '--detach',
    '--rm',
    '--network',
    'host',
    '--log-driver',
    'none',
    '--tmpfs',
    '/mailpit-data:rw,noexec,nosuid,nodev,size=64m,mode=0700',
    '--label',
    'zielony.research=e2-mailpit',
    '--env',
    'MP_DATABASE=/mailpit-data/mailpit.db',
    '--env',
    `MP_MAX_MESSAGES=${MAILPIT_MAX_MESSAGES}`,
    '--env',
    'MP_DISABLE_VERSION_CHECK=true',
    '--env',
    'MP_UI_BIND_ADDR=127.0.0.1:8025',
    '--env',
    'MP_SMTP_BIND_ADDR=127.0.0.1:1025',
    MAILPIT_IMAGE,
  ]);
  const inspect = JSON.parse(
    await commandOutput('docker', ['inspect', id]),
  ) as DockerInspect[];
  assertMailpitContainerInspect(inspect[0]);
  const client = new NoRetryHttpClient();
  const mailpit = new MailpitClient(MAILPIT_API_URL, client);
  try {
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        await mailpit.assertVersion();
        break;
      } catch {
        if (Date.now() >= deadline) throw new HarnessError('MAILPIT_STARTUP');
        await delay(250);
      }
    }
    await mailpit.purge();
    return {
      container: {
        id,
        imageId: await commandOutput('docker', [
          'image',
          'inspect',
          '--format',
          '{{.Id}}',
          MAILPIT_IMAGE,
        ]),
      } satisfies MailpitContainer,
      client,
      mailpit,
    };
  } catch (error) {
    client.close();
    await commandStatus('docker', ['stop', '--time', '10', id]).catch(() => 1);
    throw error;
  }
};

const startBackend = async (commit: string): Promise<BackendContainer> => {
  if (
    !Number.isInteger(BACKEND_PORT) ||
    BACKEND_PORT < 1 ||
    BACKEND_PORT > 65_535
  ) {
    throw new HarnessError('BACKEND_PORT');
  }
  const image = `green-basket-e2:${commit.slice(0, 12)}`;
  if (
    (await commandStatus(
      'docker',
      ['build', '--tag', image, '--file', 'Dockerfile', '.'],
      BACKEND_ROOT,
    )) !== 0
  ) {
    throw new HarnessError('BACKEND_IMAGE_BUILD');
  }
  const id = await commandOutput('docker', [
    'run',
    '--detach',
    '--rm',
    '--network',
    'host',
    '--log-driver',
    'none',
    '--add-host',
    'mailpit:127.0.0.1',
    '--label',
    'zielony.research=e2-verify',
    '--env-file',
    resolve(BACKEND_ROOT, '.env'),
    '--env',
    'SMTP_HOST=mailpit',
    '--env',
    'SMTP_PORT=1025',
    '--env',
    'SMTP_SECURE=false',
    '--env',
    'SMTP_USER=',
    '--env',
    'SMTP_PASSWORD=',
    '--volume',
    `${resolve(BACKEND_ROOT, 'uploads')}:/app/uploads:ro`,
    image,
  ]);
  try {
    const client = new NoRetryHttpClient();
    const deadline = Date.now() + 60_000;
    let reachable = false;
    while (Date.now() < deadline) {
      try {
        const response = await client.request({
          url: BACKEND_URL,
          method: 'GET',
        });
        if (response.statusCode < 500) {
          reachable = true;
          break;
        }
      } catch {
        // Startup polling never retries a state-changing request.
      }
      await delay(250);
    }
    client.close();
    if (!reachable) throw new HarnessError('BACKEND_STARTUP');
    const inspect = JSON.parse(
      await commandOutput('docker', ['inspect', id]),
    ) as Array<{
      State: { Pid: number };
      Image: string;
      Config: { Env: string[] };
      HostConfig: {
        AutoRemove: boolean;
        NetworkMode: string;
        LogConfig: { Type: string };
        NanoCpus: number;
        Memory: number;
        CpusetCpus: string;
      };
    }>;
    const state = inspect[0];
    if (
      !state?.State.Pid ||
      state.HostConfig.AutoRemove !== true ||
      state.HostConfig.NetworkMode !== 'host' ||
      state.HostConfig.LogConfig.Type !== 'none'
    ) {
      throw new HarnessError('BACKEND_INSPECT');
    }
    const environment = new Map(
      (state.Config.Env ?? []).map((entry) => {
        const separator = entry.indexOf('=');
        return [entry.slice(0, separator), entry.slice(separator + 1)];
      }),
    );
    if (
      [
        'DATABASE_URL',
        'JWT_SECRET',
        'MFA_OTP_HMAC_KEY',
        'MFA_TOTP_ENCRYPTION_KEY',
        'NODE_ENV',
        'PORT',
        'SMTP_FROM_EMAIL',
        'WEBAUTHN_ORIGIN',
        'WEBAUTHN_RP_ID',
      ].some(
        (name) =>
          (environment.get(name) || undefined) !==
          (process.env[name] || undefined),
      )
    ) {
      throw new HarnessError('BACKEND_ENVIRONMENT_MISMATCH');
    }
    return {
      id,
      commit,
      image,
      imageId: state.Image,
      pid: state.State.Pid,
      cgroupPath: await cgroupPathForPid(state.State.Pid),
      cpuLimit: state.HostConfig.NanoCpus
        ? String(state.HostConfig.NanoCpus / 1e9)
        : 'unlimited',
      memoryLimit: state.HostConfig.Memory
        ? String(state.HostConfig.Memory)
        : 'unlimited',
      cpuset: state.HostConfig.CpusetCpus || 'all',
    };
  } catch (error) {
    await commandStatus('docker', ['stop', '--time', '10', id]).catch(() => 1);
    throw error;
  }
};

const stopContainer = async (id?: string) => {
  if (!id) return true;
  return (
    (await commandStatus('docker', ['stop', '--time', '10', id]).catch(
      () => 1,
    )) === 0
  );
};

const jmeterVersion = async () => {
  const output = await commandOutput('jmeter', ['--version']);
  const versions = output.match(/\b\d+\.\d+\.\d+\b/g);
  if (versions?.at(-1) !== '5.6.3') throw new HarnessError('JMETER_VERSION');
  return versions.at(-1);
};

const timestamp = () =>
  new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');

const loadAccounts = async (source: DataSource): Promise<RuntimeAccount[]> => {
  const [accountsCsv, metadata] = await Promise.all([
    readFile(ACCOUNTS_PATH, 'utf8'),
    readJson<{
      dataset_version: number;
      accounts: number;
      clients: number;
      accounts_per_variant: number;
      frontend_commit: string;
    }>(METADATA_PATH),
  ]);
  const allRows = parseAccountsCsv(accountsCsv);
  if (
    metadata.dataset_version !== 1 ||
    metadata.accounts !== 200 ||
    metadata.clients !== CLIENTS ||
    metadata.accounts_per_variant !== CLIENTS ||
    metadata.frontend_commit !== FROZEN_FRONTEND_COMMIT ||
    allRows.length !== 200 ||
    Object.values(MfaMethod).some(
      (variant) =>
        allRows.filter((row) => row.variant === variant).length !== CLIENTS,
    )
  ) {
    throw new HarnessError('DATASET_METADATA');
  }
  const rows = allRows.filter((row) =>
    E2_VARIANTS.includes(row.variant as E2Variant),
  );
  if (
    rows.length !== CLIENTS * E2_VARIANTS.length ||
    E2_VARIANTS.some(
      (variant) =>
        rows.filter((row) => row.variant === variant).length !== CLIENTS,
    )
  ) {
    throw new HarnessError('DATASET_ACCOUNT_COUNT');
  }
  const expected = rows.map((row) => ({
    ...row,
    identifier: row.email.slice(0, row.email.indexOf('@')),
  }));
  const users = await loadResearchUsers(source, expected);
  const usersByEmail = new Map(users.map((user) => [user.email, user]));
  if (
    users.length !== rows.length ||
    rows.some((row) => {
      const user = usersByEmail.get(row.email);
      return (
        !user ||
        user.user_id !== row.user_id ||
        user.mfa_method !== row.variant ||
        user.client_slot !== row.client_slot
      );
    })
  ) {
    throw new HarnessError('DATASET_ACCOUNT_STATE');
  }
  return rows
    .map((row) => ({ ...row, variant: row.variant as E2Variant }))
    .sort(
      (left, right) =>
        E2_VARIANTS.indexOf(left.variant) -
          E2_VARIANTS.indexOf(right.variant) ||
        left.client_slot.localeCompare(right.client_slot),
    );
};

const variantAccounts = (accounts: RuntimeAccount[], variant: E2Variant) => {
  const selected = accounts
    .filter((account) => account.variant === variant)
    .sort((left, right) => left.client_slot.localeCompare(right.client_slot));
  if (
    selected.length !== CLIENTS ||
    selected.some(
      ({ client_slot }, index) => client_slot !== CLIENT_SLOTS[index],
    )
  ) {
    throw new HarnessError('DATASET_VARIANT_MAPPING');
  }
  return selected;
};

const loginChallenges = async (
  source: DataSource,
  accounts: RuntimeAccount[],
) =>
  source.getRepository(MfaChallenge).find({
    where: {
      user_id: In(accounts.map(({ user_id }) => user_id)),
      purpose: MfaChallengePurpose.LOGIN,
    },
    loadEagerRelations: false,
  });

const assertNoLoginChallenges = async (
  source: DataSource,
  accounts: RuntimeAccount[],
) => {
  if ((await loginChallenges(source, accounts)).length !== 0) {
    throw new HarnessError('ACTIVE_LOGIN_CHALLENGE');
  }
};

type PreparedLogin = RuntimeAccount & {
  token: string;
  jti: string;
  issuedAtMs: number;
  tokenExpiresAtMs: number;
  challengeExpiresAtMs: number;
  challengeCreatedAtMs: number;
  webauthnOptions?: Record<string, unknown>;
};

const seedRegistry = (registry: SecretRegistry, accounts: RuntimeAccount[]) => {
  for (const [name, value] of Object.entries(process.env)) {
    if (/(?:PASSWORD|SECRET|TOKEN|KEY|COOKIE|DATABASE_URL)/i.test(name)) {
      registry.add(value);
    }
  }
  for (const account of accounts) {
    registry.add(account.email);
    registry.add(account.user_id);
  }
};

const prepareLogins = async (
  source: DataSource,
  http: NoRetryHttpClient,
  accounts: RuntimeAccount[],
  variant: E2Variant,
  registry: SecretRegistry,
) => {
  const selected = variantAccounts(accounts, variant);
  await assertNoLoginChallenges(source, selected);
  const password = process.env.MFA_RESEARCH_PASSWORD;
  const jwtSecret = process.env.JWT_SECRET;
  const attempts = await Promise.allSettled(
    selected.map(async (account) => {
      const requestBody = JSON.stringify({
        email: account.email,
        password,
        rememberMe: false,
      });
      registry.add(requestBody);
      const response = await http.request({
        url: `${BACKEND_URL}/auth/login`,
        method: 'POST',
        localAddress: sourceIpForSlot(account.client_slot),
        body: requestBody,
        headers: { 'content-type': 'application/json' },
      });
      registry.add(response.body);
      const login = validatePendingLogin(response.statusCode, response.body, {
        variant,
        userId: account.user_id,
        jwtSecret,
      });
      registry.add(login.token);
      return { account, login };
    }),
  );
  const failures = attempts.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failures.length) {
    throw new HarnessError(
      failures.some(
        ({ reason }) =>
          reason instanceof HarnessError &&
          reason.code === 'PREPARATION_RATE_LIMITED',
      )
        ? 'PREPARATION_RATE_LIMITED'
        : 'PREPARATION_LOGIN_FAILURE',
    );
  }
  const pending = attempts.map((result) => {
    if (result.status !== 'fulfilled') {
      throw new HarnessError('PREPARATION_LOGIN_FAILURE');
    }
    return result.value;
  });
  const challenges = await loginChallenges(source, selected);
  if (challenges.length !== CLIENTS) {
    throw new HarnessError('PREPARATION_CHALLENGE_COUNT');
  }
  const byUser = new Map(
    challenges.map((challenge) => [challenge.user_id, challenge]),
  );
  return pending.map(({ account, login }): PreparedLogin => {
    const challenge = byUser.get(account.user_id);
    if (
      !challenge ||
      challenge.challenge_id !== login.jti ||
      challenge.method !== variant ||
      challenge.purpose !== MfaChallengePurpose.LOGIN ||
      challenge.attempt_count !== 0 ||
      !(challenge.expires_at instanceof Date)
    ) {
      throw new HarnessError('PREPARATION_CHALLENGE_MISMATCH');
    }
    return {
      ...account,
      ...login,
      challengeCreatedAtMs:
        challenge.expires_at.getTime() - LOGIN_CHALLENGE_TTL_MS,
      challengeExpiresAtMs: challenge.expires_at.getTime(),
    };
  });
};

type PreparedBurst = {
  packages: RequestPackage[];
  logins: PreparedLogin[];
  expectedStep?: number;
  postcondition: () => Promise<void>;
};

const packageSecrets = (
  packages: RequestPackage[],
  registry: SecretRegistry,
) => {
  for (const packet of packages) {
    registry.add(packet.authorization);
    registry.add(packet.body);
  }
  return packages;
};

const prepareEmail = async (
  source: DataSource,
  http: NoRetryHttpClient,
  mailpit: MailpitClient,
  accounts: RuntimeAccount[],
  registry: SecretRegistry,
): Promise<PreparedBurst> => {
  const selected = variantAccounts(accounts, MfaMethod.EMAIL_OTP);
  await mailpit.purge();
  const logins = await prepareLogins(
    source,
    http,
    accounts,
    MfaMethod.EMAIL_OTP,
    registry,
  );
  const codes = await mailpit.waitForCodes(selected, 30_000, (value) =>
    registry.add(value),
  );
  const packages = packageSecrets(
    logins.map((login) => {
      const code = codes.get(login.client_slot);
      if (!code) throw new HarnessError('MAILPIT_CODE_COUNT');
      registry.add(code);
      return {
        client_slot: login.client_slot,
        variant: MfaMethod.EMAIL_OTP,
        endpoint: VERIFY_ENDPOINT[MfaMethod.EMAIL_OTP],
        authorization: `Bearer ${login.token}`,
        body: JSON.stringify({ code }),
      };
    }),
    registry,
  );
  await mailpit.purge();
  return {
    packages,
    logins,
    postcondition: async () => {
      await assertNoLoginChallenges(source, selected);
    },
  };
};

const loadTotpSecrets = async (
  selected: RuntimeAccount[],
  registry: SecretRegistry,
) => {
  const secrets = await readJson<TotpSecretStore>(TOTP_SECRETS_PATH);
  if (
    Object.keys(secrets).length !== CLIENTS ||
    selected.some((account) => {
      const stored = secrets[account.email];
      return (
        !stored ||
        stored.client_slot !== account.client_slot ||
        typeof stored.secret !== 'string' ||
        !stored.secret
      );
    })
  ) {
    throw new HarnessError('TOTP_SECRET_STORE');
  }
  for (const account of selected) registry.add(secrets[account.email].secret);
  return secrets;
};

const prepareTotp = async (
  source: DataSource,
  http: NoRetryHttpClient,
  accounts: RuntimeAccount[],
  registry: SecretRegistry,
): Promise<PreparedBurst> => {
  const selected = variantAccounts(accounts, MfaMethod.TOTP);
  const expectedUsers = selected.map((row) => ({
    ...row,
    identifier: row.email.slice(0, row.email.indexOf('@')),
  }));
  const [usersBefore, secrets] = await Promise.all([
    loadResearchUsers(source, expectedUsers),
    loadTotpSecrets(selected, registry),
  ]);
  if (usersBefore.length !== CLIENTS)
    throw new HarnessError('TOTP_STATE_COUNT');
  const beforeBySlot = new Map(
    usersBefore.map((user) => [user.client_slot, user.totp_last_used_step]),
  );
  const logins = await prepareLogins(
    source,
    http,
    accounts,
    MfaMethod.TOTP,
    registry,
  );
  const previousSteps = selected.map(
    ({ client_slot }) => beforeBySlot.get(client_slot) ?? null,
  );
  const generationAt = nextTotpGenerationTime(Date.now(), previousSteps);
  assertPreparationLifetime(logins, generationAt);
  if (generationAt > Date.now()) await delay(generationAt - Date.now());
  const generatedAt = Date.now();
  const expectedStep = assertTotpGenerationWindow(generatedAt, previousSteps);
  const packages = packageSecrets(
    logins.map((login) => {
      const secret = secrets[login.email].secret;
      const code = new OTPAuth.TOTP({
        issuer: MFA_TOTP_ISSUER,
        label: login.email,
        algorithm: MFA_TOTP_ALGORITHM,
        digits: MFA_TOTP_DIGITS,
        period: MFA_TOTP_PERIOD_SECONDS,
        secret: OTPAuth.Secret.fromBase32(secret),
      }).generate({ timestamp: generatedAt });
      registry.add(code);
      return {
        client_slot: login.client_slot,
        variant: MfaMethod.TOTP,
        endpoint: VERIFY_ENDPOINT[MfaMethod.TOTP],
        authorization: `Bearer ${login.token}`,
        body: JSON.stringify({ code }),
        expected_step: expectedStep,
      };
    }),
    registry,
  );
  assertTotpGenerationWindow(Date.now(), previousSteps);
  return {
    packages,
    logins,
    expectedStep,
    postcondition: async () => {
      await assertNoLoginChallenges(source, selected);
      const usersAfter = await loadResearchUsers(source, expectedUsers);
      if (
        usersAfter.length !== CLIENTS ||
        usersAfter.some((user) => user.totp_last_used_step !== expectedStep)
      ) {
        throw new HarnessError('TOTP_POSTCONDITION');
      }
    },
  };
};

const databaseWebAuthnCredentials = async (
  source: DataSource,
  accounts: RuntimeAccount[],
): Promise<WebAuthnDatabaseCredential[]> => {
  const selected = variantAccounts(accounts, MfaMethod.WEBAUTHN);
  const credentials = await loadCredentials(
    source,
    selected.map(({ user_id }) => user_id),
  );
  const slotByUser = new Map(
    selected.map(({ user_id, client_slot }) => [user_id, client_slot]),
  );
  if (credentials.length !== CLIENTS) {
    throw new HarnessError('WEBAUTHN_CREDENTIAL_COUNT');
  }
  return credentials
    .map((credential) => ({
      client_slot: slotByUser.get(credential.user_id) ?? '',
      credential_id: credential.credential_id,
      sign_count: credential.sign_count,
    }))
    .sort((left, right) => left.client_slot.localeCompare(right.client_slot));
};

const prepareWebAuthn = async (
  source: DataSource,
  http: NoRetryHttpClient,
  accounts: RuntimeAccount[],
  registry: SecretRegistry,
  session: E2WebAuthnSession,
): Promise<PreparedBurst> => {
  const selected = variantAccounts(accounts, MfaMethod.WEBAUTHN);
  const databaseBefore = await databaseWebAuthnCredentials(source, accounts);
  const authenticatorBefore = await session.counters(databaseBefore);
  assertWebAuthnCounterProgression(
    databaseBefore.map(({ client_slot, sign_count }) => ({
      client_slot,
      count: sign_count,
    })),
    databaseBefore.map(({ client_slot, sign_count }) => ({
      client_slot,
      count: sign_count,
    })),
    authenticatorBefore,
    0,
  );
  const logins = await prepareLogins(
    source,
    http,
    accounts,
    MfaMethod.WEBAUTHN,
    registry,
  );
  const credentialBySlot = new Map(
    databaseBefore.map((credential) => [credential.client_slot, credential]),
  );
  let generated: Awaited<ReturnType<typeof generateAssertions>>;
  try {
    generated = await generateAssertions(
      session.browser,
      logins.map((login) => {
        const credential = credentialBySlot.get(login.client_slot);
        if (!credential || !login.webauthnOptions) {
          throw new HarnessError('WEBAUTHN_PREPARATION_MISMATCH');
        }
        return {
          ...credential,
          token: login.token,
          options:
            login.webauthnOptions as unknown as PublicKeyCredentialRequestOptionsJSON,
        };
      }),
      registry,
    );
  } catch (error) {
    await session.checkpoint().catch(() => undefined);
    throw error;
  }
  packageSecrets(generated.packages, registry);
  const webauthnBefore = generated.before;
  return {
    packages: generated.packages,
    logins,
    postcondition: async () => {
      await assertNoLoginChallenges(source, selected);
      const databaseAfter = await databaseWebAuthnCredentials(source, accounts);
      const authenticatorAfter = await session.counters(databaseAfter);
      assertWebAuthnCounterProgression(
        webauthnBefore,
        databaseAfter.map(({ client_slot, sign_count }) => ({
          client_slot,
          count: sign_count,
        })),
        authenticatorAfter,
        1,
      );
      await session.checkpoint();
    },
  };
};

type SafeState = {
  experiment_id: string;
  protocol_sha256: string;
  timestamp_utc: string;
  backend_container_id: string;
  backend_image_id: string;
  backend_commit: string;
  dataset_version: number;
  account_counts: Record<E2Variant, number>;
  active_login_challenges_count: number;
  mailpit_message_count: number;
  totp: Array<{ client_slot: string; totp_last_used_step: number | null }>;
  webauthn: Array<{
    client_slot: string;
    db_sign_count: number;
    authenticator_sign_count: number;
  }>;
  webauthn_matching_count: number;
};

const captureState = async (
  experimentId: string,
  source: DataSource,
  accounts: RuntimeAccount[],
  container: BackendContainer,
  mailpit: MailpitClient,
  webauthn: E2WebAuthnSession,
): Promise<SafeState> => {
  const metadata = await readJson<{ dataset_version: number }>(METADATA_PATH);
  const totpAccounts = variantAccounts(accounts, MfaMethod.TOTP);
  const users = await loadResearchUsers(
    source,
    totpAccounts.map((row) => ({
      ...row,
      identifier: row.email.slice(0, row.email.indexOf('@')),
    })),
  );
  const database = await databaseWebAuthnCredentials(source, accounts);
  const authenticator = new Map(
    (await webauthn.counters(database)).map(({ client_slot, count }) => [
      client_slot,
      count,
    ]),
  );
  const allChallenges = await loginChallenges(source, accounts);
  const webauthnState = database.map(({ client_slot, sign_count }) => ({
    client_slot,
    db_sign_count: sign_count,
    authenticator_sign_count: authenticator.get(client_slot) ?? -1,
  }));
  return {
    experiment_id: experimentId,
    protocol_sha256: APPROVED_PROTOCOL_SHA256,
    timestamp_utc: new Date().toISOString(),
    backend_container_id: container.id,
    backend_image_id: container.imageId,
    backend_commit: container.commit,
    dataset_version: metadata.dataset_version,
    account_counts: Object.fromEntries(
      E2_VARIANTS.map((variant) => [
        variant,
        accounts.filter((account) => account.variant === variant).length,
      ]),
    ) as Record<E2Variant, number>,
    active_login_challenges_count: allChallenges.length,
    mailpit_message_count: await mailpit.count(),
    totp: users
      .map(({ client_slot, totp_last_used_step }) => ({
        client_slot,
        totp_last_used_step,
      }))
      .sort((left, right) => left.client_slot.localeCompare(right.client_slot)),
    webauthn: webauthnState,
    webauthn_matching_count: webauthnState.filter(
      (entry) => entry.db_sign_count === entry.authenticator_sign_count,
    ).length,
  };
};

const assertCleanState = (state: SafeState) => {
  if (
    E2_VARIANTS.some((variant) => state.account_counts[variant] !== CLIENTS) ||
    state.active_login_challenges_count !== 0 ||
    state.mailpit_message_count !== 0 ||
    state.totp.length !== CLIENTS ||
    new Set(state.totp.map(({ client_slot }) => client_slot)).size !==
      CLIENTS ||
    state.webauthn.length !== CLIENTS ||
    new Set(state.webauthn.map(({ client_slot }) => client_slot)).size !==
      CLIENTS ||
    state.webauthn_matching_count !== CLIENTS
  ) {
    throw new HarnessError('CAMPAIGN_STATE_NOT_CLEAN');
  }
};

type IndexRecord = {
  round: number | string;
  order_position: number;
  variant: E2Variant;
  run_path: string;
};

const indexCsv = (rows: IndexRecord[], measured: boolean) =>
  [
    measured
      ? 'round,order_position,variant,run_path'
      : 'stage,order_position,variant,run_path',
    ...rows.map((row) =>
      [row.round, row.order_position, row.variant, row.run_path].join(','),
    ),
    '',
  ].join('\n');

const startJmeter = (
  variant: E2Variant,
  brokerPort: number,
  jtlPath: string,
  logPath: string,
) => {
  const backend = new URL(BACKEND_URL);
  return runCommand(
    'jmeter',
    [
      '-n',
      '-t',
      JMX_PATH,
      '-q',
      JMETER_PROPERTIES_PATH,
      '-Jsample_variables',
      '-l',
      jtlPath,
      '-j',
      logPath,
      `-Jvariant=${variant}`,
      `-Jbroker_port=${brokerPort}`,
      `-Jbackend_protocol=${backend.protocol.slice(0, -1)}`,
      `-Jbackend_host=${backend.hostname}`,
      `-Jbackend_port=${backend.port}`,
    ],
    { env: safeEnvironment() },
  );
};

const waitWithProcess = async <T>(
  operation: Promise<T>,
  processDone: Promise<number>,
) =>
  Promise.race([
    operation,
    processDone.then(() => {
      throw new HarnessError('JMETER_EARLY_EXIT');
    }),
  ]);

const responseSecrets = (
  response: ReturnType<InMemoryRequestBroker['responses']> extends Map<
    string,
    infer T
  >
    ? T
    : never,
  registry: SecretRegistry,
) => {
  registry.add(response.bodyText);
  for (const cookie of response.setCookie) {
    registry.add(cookie);
    registry.add(cookie.slice(cookie.indexOf('=') + 1).split(';')[0]);
  }
  try {
    const body = JSON.parse(response.bodyText) as Record<string, unknown>;
    registry.add(body.access_token);
  } catch {
    // Semantic validation returns the safe JSON category.
  }
};

const prepareVariant = (
  variant: E2Variant,
  source: DataSource,
  http: NoRetryHttpClient,
  mailpit: MailpitClient,
  accounts: RuntimeAccount[],
  registry: SecretRegistry,
  webauthn: E2WebAuthnSession,
) => {
  if (variant === MfaMethod.EMAIL_OTP) {
    return prepareEmail(source, http, mailpit, accounts, registry);
  }
  if (variant === MfaMethod.TOTP) {
    return prepareTotp(source, http, accounts, registry);
  }
  return prepareWebAuthn(source, http, accounts, registry, webauthn);
};

const runBurst = async (input: {
  experimentRoot: string;
  experimentId: string;
  stage: 'pilot' | 'warmup' | 'measured';
  round: number | string;
  orderPosition: number;
  variant: E2Variant;
  source: DataSource;
  http: NoRetryHttpClient;
  mailpit: MailpitClient;
  accounts: RuntimeAccount[];
  webauthn: E2WebAuthnSession;
  container: BackendContainer;
}) => {
  const state = new BurstStateMachine();
  const registry = new SecretRegistry();
  seedRegistry(registry, input.accounts);
  input.webauthn.registerSecrets(registry);
  const relativePath = burstPath(
    input.stage,
    input.variant,
    input.orderPosition,
    typeof input.round === 'number' ? input.round : undefined,
  );
  const directory = resolve(input.experimentRoot, relativePath);
  await createExclusiveDirectory(directory);
  await atomicWrite(
    resolve(directory, 'clients.csv'),
    publicClientsCsv(input.variant),
  );
  const startedAt = new Date().toISOString();
  let brokerServer: LoopbackBrokerServer | undefined;
  let monitor: ResourceMonitorProcess | undefined;
  let jmeter: RunningCommand | undefined;
  let runWritten = false;
  let preparationCompletedAt: string | undefined;
  let resources: ResourceSummary | undefined;
  let memoryWritten = false;
  let resourcesWritten = false;
  const persistResources = async () => {
    if (!resources) return;
    if (!memoryWritten) {
      await atomicWrite(
        resolve(directory, 'memory.csv'),
        [
          'timestamp_utc,memory_current_bytes',
          ...resources.samples.map(
            ({ timestamp_utc, memory_current_bytes }) =>
              `${timestamp_utc},${memory_current_bytes}`,
          ),
          '',
        ].join('\n'),
      );
      memoryWritten = true;
    }
    if (!resourcesWritten) {
      await atomicJson(
        resolve(directory, 'resources.json'),
        Object.fromEntries(
          Object.entries(resources).filter(([name]) => name !== 'samples'),
        ),
      );
      resourcesWritten = true;
    }
  };
  try {
    state.assertPreparationAllowed();
    const prepared = await prepareVariant(
      input.variant,
      input.source,
      input.http,
      input.mailpit,
      input.accounts,
      registry,
      input.webauthn,
    );
    assertPreparationLifetime(prepared.logins, Date.now());
    const expectedBySlot = new Map(
      prepared.logins.map(({ client_slot, user_id }) => [
        client_slot,
        {
          variant: input.variant,
          userId: user_id,
          jwtSecret: process.env.JWT_SECRET,
          nodeEnv: process.env.NODE_ENV ?? 'development',
        } satisfies SemanticExpectation,
      ]),
    );
    const broker = new InMemoryRequestBroker(prepared.packages);
    brokerServer = new LoopbackBrokerServer(broker);
    const brokerPort = await brokerServer.start();
    const jtlPath = resolve(directory, 'jmeter.jtl');
    const logPath = resolve(directory, 'jmeter.log');
    jmeter = startJmeter(input.variant, brokerPort, jtlPath, logPath);
    const ready = await waitWithProcess(
      broker.waitUntilReady(60_000),
      jmeter.done,
    );
    state.ready(ready);
    prepared.packages.length = 0;
    assertPreparationLifetime(prepared.logins, Date.now());
    if (prepared.expectedStep !== undefined) {
      assertTotpReleaseWindow(Date.now(), prepared.expectedStep);
    }
    preparationCompletedAt = new Date().toISOString();
    monitor = new ResourceMonitorProcess();
    await monitor.start(input.container.cgroupPath, input.container.id, ready);
    state.startMonitor();
    if (prepared.expectedStep !== undefined) {
      assertTotpReleaseWindow(Date.now(), prepared.expectedStep);
    }
    broker.release();
    state.release();
    const completed = await waitWithProcess(
      broker.waitUntilSampleEnds(75_000),
      jmeter.done,
    );
    state.responsesComplete(completed);
    resources = await monitor.stop(completed);
    monitor = undefined;
    state.beginValidation();
    const codes = new Map<string, string>();
    for (const [slot, response] of broker.responses()) {
      responseSecrets(response, registry);
      const expectation = expectedBySlot.get(slot);
      if (!expectation) throw new HarnessError('SEMANTIC_SLOT');
      codes.set(slot, validateSemanticResponse(response, expectation));
    }
    const semanticFailure = [...codes.values()].some((code) => code !== 'OK');
    broker.resolveSemantics(codes);
    const jmeterExit = await jmeter.done;
    const samples = parseJtl(await readFile(jtlPath, 'utf8'));
    if (semanticFailure) {
      throw new HarnessError('SEMANTIC_FAILURE');
    }
    if (jmeterExit !== 0) throw new HarnessError('JMETER_EXIT');
    validateJtl(samples, input.variant);
    await prepared.postcondition();
    await assertNoLoginChallenges(input.source, input.accounts);
    if ((await input.mailpit.count()) !== 0) {
      throw new HarnessError('MAILPIT_NOT_EMPTY');
    }
    await brokerServer.close();
    brokerServer = undefined;
    await persistResources();
    await scanArtifacts(directory, registry.all());
    await atomicJson(resolve(directory, 'run.json'), {
      experiment: 'E2',
      metric: 'T_verify',
      experiment_id: input.experimentId,
      stage: input.stage,
      round: input.round,
      order_position: input.orderPosition,
      variant: input.variant,
      preparation_completed_before_monitor: true,
      ready_count: CLIENTS,
      release_count: 1,
      request_count: CLIENTS,
      sample_end_count: CLIENTS,
      sample_count: samples.length,
      success_count: samples.filter(({ success }) => success).length,
      http_429_count: samples.filter(
        ({ responseCode }) => responseCode === '429',
      ).length,
      monitor_status: 'VALID',
      status: 'VALID',
      started_at_utc: startedAt,
      preparation_completed_at_utc: preparationCompletedAt,
      monitor_started_at_utc: resources.monitor_started_at_utc,
      monitor_stopped_at_utc: resources.monitor_stopped_at_utc,
      ended_at_utc: new Date().toISOString(),
    });
    await scanArtifacts(directory, registry.all());
    runWritten = true;
    await sealDirectory(directory);
    state.complete();
    registry.clear();
    return {
      index: {
        round: input.round,
        order_position: input.orderPosition,
        variant: input.variant,
        run_path: relativePath,
      } satisfies IndexRecord,
      expectedStep: prepared.expectedStep,
      resources,
    };
  } catch (error) {
    let code = error instanceof HarnessError ? error.code : 'BURST_INVALID';
    let diagnostic =
      error instanceof HarnessError ? error.diagnostic : undefined;
    try {
      state.invalidate(code);
    } catch {
      // The top-level campaign is still marked INVALID on terminal failures.
    }
    if (
      jmeter &&
      jmeter.child.exitCode === null &&
      jmeter.child.signalCode === null
    ) {
      jmeter.child.kill('SIGTERM');
      await jmeter.done.catch(() => 1);
    }
    await monitor?.close().catch(() => undefined);
    await brokerServer?.close().catch(() => undefined);
    await persistResources().catch(() => undefined);
    try {
      await scanArtifacts(directory, registry.all());
    } catch {
      code = 'ARTIFACT_SECRET_SCAN';
      diagnostic = undefined;
    }
    if (!runWritten) {
      await atomicJson(resolve(directory, 'run.json'), {
        experiment: 'E2',
        metric: 'T_verify',
        experiment_id: input.experimentId,
        stage: input.stage,
        round: input.round,
        order_position: input.orderPosition,
        variant: input.variant,
        status: 'INVALID',
        code,
        diagnostic,
        started_at_utc: startedAt,
        ended_at_utc: new Date().toISOString(),
      }).catch(() => undefined);
    }
    await sealDirectory(directory, registry.all()).catch(() => undefined);
    registry.clear();
    throw new HarnessError(code, diagnostic);
  }
};

const collectEnvironment = async (
  experimentId: string,
  source: DataSource,
  git: Awaited<ReturnType<typeof gitState>>,
  container: BackendContainer,
  mailpit: MailpitContainer,
  jmeter: string,
) => {
  const database = new URL(process.env.DATABASE_URL);
  const [{ server_version: postgresVersion }] = await source.query<
    Array<{ server_version: string }>
  >('SHOW server_version');
  const before = Date.now();
  const containerTime = Number(
    await commandOutput('docker', [
      'exec',
      container.id,
      'node',
      '-e',
      'process.stdout.write(String(Date.now()))',
    ]),
  );
  const after = Date.now();
  const clockSkewMs = Math.abs(containerTime - (before + after) / 2);
  if (!Number.isFinite(clockSkewMs) || clockSkewMs > 250) {
    throw new HarnessError('CLOCK_SKEW');
  }
  const dockerVersion = await commandOutput('docker', [
    'version',
    '--format',
    '{{.Server.Version}}',
  ]);
  const nodeVersion = await commandOutput('docker', [
    'exec',
    container.id,
    'node',
    '--version',
  ]);
  const chromiumVersion = await commandOutput(chromiumPath(), ['--version']);
  const cpu = os.cpus();
  const deviations = [
    ...(jmeter === '5.6.3' ? [] : ['JMETER_VERSION']),
    ...(String(postgresVersion) === '17.6' ? [] : ['POSTGRES_VERSION']),
    ...(nodeVersion === 'v26.8.1' ? [] : ['NODE_VERSION']),
    ...(dockerVersion === '29.7.2' ? [] : ['DOCKER_VERSION']),
    ...(cpu[0]?.model.includes('AMD Ryzen 7 5800X3D') ? [] : ['CPU_MODEL']),
  ];
  return {
    experiment: 'E2',
    experiment_id: experimentId,
    protocol_sha256: APPROVED_PROTOCOL_SHA256,
    captured_at_utc: new Date().toISOString(),
    backend_runtime_commit: git.backendCommit,
    backend_base_application_commit: BASE_BACKEND_COMMIT,
    backend_base_application_tree: BASE_BACKEND_TREE,
    backend_src_tree: git.backendSourceTree,
    allowed_diff_scope: true,
    frontend_commit: git.frontendCommit,
    dataset_version: (
      await readJson<{ dataset_version: number }>(METADATA_PATH)
    ).dataset_version,
    host: {
      platform: os.platform(),
      release: os.release(),
      architecture: os.arch(),
      cpu_model: cpu[0]?.model ?? 'unknown',
      logical_cpu_count: cpu.length,
      ram_bytes: os.totalmem(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    docker: {
      version: dockerVersion,
      backend_image: container.image,
      backend_image_id: container.imageId,
      backend_container_id: container.id,
      cpu_limit: container.cpuLimit,
      memory_limit: container.memoryLimit,
      cpuset: container.cpuset,
      backend_log_driver: 'none',
      mailpit_image: MAILPIT_IMAGE,
      mailpit_image_id: mailpit.imageId,
      mailpit_container_id: mailpit.id,
      mailpit_ram_only: true,
      mailpit_log_driver: 'none',
    },
    node_version: nodeVersion,
    chromium_version: chromiumVersion,
    mailpit_version: MAILPIT_VERSION,
    postgresql_version: String(postgresVersion),
    jmeter_version: jmeter,
    cgroup_version: 2,
    cgroup_path: container.cgroupPath,
    backend_url: BACKEND_URL,
    database: {
      engine: database.protocol.replace(':', ''),
      host: database.hostname,
      port: database.port || '5432',
      name: database.pathname.slice(1),
    },
    webauthn_rp_id: process.env.WEBAUTHN_RP_ID,
    webauthn_origin: process.env.WEBAUTHN_ORIGIN,
    host_backend_clock_skew_ms: clockSkewMs,
    source_ip_range: '127.0.0.2-127.0.0.51',
    reference_environment_match: deviations.length === 0,
    environment_deviation_codes: deviations,
  };
};

const validateApprovedRun = async (
  experimentId: string,
  kind: 'preflight' | 'pilot',
  backendCommit: string,
) => {
  if (
    !experimentId.startsWith(`e2-${kind}-`) ||
    !/^[a-z0-9._-]+$/i.test(experimentId)
  ) {
    throw new HarnessError('APPROVED_RUN_ID');
  }
  const path = resolve(RESULTS_ROOT, experimentId);
  if (!path.startsWith(`${RESULTS_ROOT}${sep}`)) {
    throw new HarnessError('APPROVED_RUN_PATH');
  }
  await assertApprovedProtocol(resolve(path, 'E2.md'));
  const status = JSON.parse(
    await readFile(resolve(path, 'status.json'), 'utf8'),
  ) as {
    status?: string;
    mode?: string;
    experiment_id?: string;
  };
  const environment = JSON.parse(
    await readFile(resolve(path, 'environment.json'), 'utf8'),
  ) as {
    protocol_sha256?: string;
    backend_runtime_commit?: string;
    frontend_commit?: string;
    allowed_diff_scope?: boolean;
  };
  if (
    status.status !== 'VALID' ||
    status.mode !== kind ||
    status.experiment_id !== experimentId ||
    environment.protocol_sha256 !== APPROVED_PROTOCOL_SHA256 ||
    environment.backend_runtime_commit !== backendCommit ||
    environment.frontend_commit !== FROZEN_FRONTEND_COMMIT ||
    environment.allowed_diff_scope !== true
  ) {
    throw new HarnessError('APPROVED_RUN_INVALID');
  }
  await verifySha256Manifest(path);
};

const runOfflineGates = async () => {
  const commands: Array<[string, string[]]> = [
    ['npm', ['run', 'test:e2']],
    ['npm', ['run', 'test:research']],
    ['npm', ['run', 'test:mfa']],
    ['npm', ['run', 'build']],
    ['git', ['diff', '--check']],
  ];
  for (const [command, args] of commands) {
    if ((await commandStatus(command, args, BACKEND_ROOT)) !== 0) {
      throw new HarnessError('PREFLIGHT_OFFLINE_GATE');
    }
  }
  return commands.map(([command, args]) => ({
    command: [command, ...args].join(' '),
    status: 'PASSED',
  }));
};

const postJson = (
  http: NoRetryHttpClient,
  path: string,
  body: unknown,
  localAddress: string,
  token?: string,
) => {
  const serialized = JSON.stringify(body);
  return http.request({
    url: `${BACKEND_URL}${path}`,
    method: 'POST',
    localAddress,
    body: serialized,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
};

const runLiveLimiterChecks = async (
  root: string,
  source: DataSource,
  http: NoRetryHttpClient,
  accounts: RuntimeAccount[],
  registry: SecretRegistry,
) => {
  const totp = variantAccounts(accounts, MfaMethod.TOTP);
  const invalidPassword = randomBytes(32).toString('base64url');
  registry.add(invalidPassword);
  const canary = await Promise.all(
    totp.map((account) =>
      postJson(
        http,
        '/auth/login',
        { email: account.email, password: invalidPassword, rememberMe: false },
        sourceIpForSlot(account.client_slot),
      ),
    ),
  );
  const canaryStatuses = canary.map(({ statusCode }) => statusCode);
  if (
    canaryStatuses.some((status) => status !== 401) ||
    canaryStatuses.some((status) => status === 429)
  ) {
    throw new HarnessError('PREFLIGHT_SOURCE_IP_CANARY');
  }
  await atomicJson(resolve(root, 'checks/source-ip-canary.json'), {
    expected_clients: CLIENTS,
    expected_status: 401,
    observed_401: canaryStatuses.filter((status) => status === 401).length,
    observed_429: canaryStatuses.filter((status) => status === 429).length,
    mapping: '127.0.0.2-127.0.0.51',
    status: 'PASSED',
  });
  await delay(ROUND_COOLDOWN_MS);

  const limiterAccount = totp[0];
  await assertNoLoginChallenges(source, [limiterAccount]);
  const loginStatuses: number[] = [];
  for (let attempt = 0; attempt <= LOGIN_RATE_LIMIT; attempt += 1) {
    const body = JSON.stringify({
      email: limiterAccount.email,
      password: process.env.MFA_RESEARCH_PASSWORD,
      rememberMe: false,
    });
    registry.add(body);
    const response = await http.request({
      url: `${BACKEND_URL}/auth/login`,
      method: 'POST',
      localAddress: '127.0.0.250',
      body,
      headers: { 'content-type': 'application/json' },
    });
    registry.add(response.body);
    loginStatuses.push(response.statusCode);
    if (attempt < LOGIN_RATE_LIMIT) {
      const pending = validatePendingLogin(response.statusCode, response.body, {
        variant: MfaMethod.TOTP,
        userId: limiterAccount.user_id,
        jwtSecret: process.env.JWT_SECRET,
      });
      registry.add(pending.token);
    }
  }
  const expectedLoginStatuses = [
    ...Array<number>(LOGIN_RATE_LIMIT).fill(201),
    429,
  ];
  if (loginStatuses.join(',') !== expectedLoginStatuses.join(',')) {
    throw new HarnessError('PREFLIGHT_LOGIN_LIMITER');
  }
  const created = await loginChallenges(source, [limiterAccount]);
  if (created.length !== 1)
    throw new HarnessError('PREFLIGHT_CHALLENGE_CLEANUP');
  await source.getRepository(MfaChallenge).delete({
    challenge_id: created[0].challenge_id,
    user_id: limiterAccount.user_id,
    purpose: MfaChallengePurpose.LOGIN,
  });
  await assertNoLoginChallenges(source, [limiterAccount]);
  await atomicJson(resolve(root, 'checks/login-limiter.json'), {
    source_ip: '127.0.0.250',
    expected: expectedLoginStatuses,
    observed: loginStatuses,
    created_challenge_removed: true,
    status: 'PASSED',
  });
  await delay(ROUND_COOLDOWN_MS);

  const invalidBearer = `e2-invalid-${randomBytes(32).toString('base64url')}`;
  registry.add(invalidBearer);
  const verifyChecks: Record<string, number[]> = {};
  for (const variant of E2_VARIANTS) {
    const statuses: number[] = [];
    for (let attempt = 0; attempt <= VERIFY_RATE_LIMIT; attempt += 1) {
      const body =
        variant === MfaMethod.WEBAUTHN ? { response: {} } : { code: '000000' };
      const response = await postJson(
        http,
        VERIFY_ENDPOINT[variant],
        body,
        '127.0.0.250',
        invalidBearer,
      );
      statuses.push(response.statusCode);
    }
    if (
      statuses.slice(0, VERIFY_RATE_LIMIT).some((status) => status !== 401) ||
      statuses[VERIFY_RATE_LIMIT] !== 429
    ) {
      throw new HarnessError('PREFLIGHT_VERIFY_LIMITER');
    }
    verifyChecks[variant] = statuses;
  }
  await atomicJson(resolve(root, 'checks/verify-limiters.json'), {
    source_ip: '127.0.0.250',
    expected_each: [...Array<number>(VERIFY_RATE_LIMIT).fill(401), 429],
    observed: verifyChecks,
    status: 'PASSED',
  });
  await delay(ROUND_COOLDOWN_MS);
};

const runPreflight = async (input: {
  root: string;
  experimentId: string;
  source: DataSource;
  http: NoRetryHttpClient;
  mailpit: MailpitClient;
  accounts: RuntimeAccount[];
  webauthn: E2WebAuthnSession;
  container: BackendContainer;
  registry: SecretRegistry;
}) => {
  await input.mailpit.assertOpenApi();
  const initial = await captureState(
    input.experimentId,
    input.source,
    input.accounts,
    input.container,
    input.mailpit,
    input.webauthn,
  );
  assertCleanState(initial);
  const totpSecrets = await loadTotpSecrets(
    variantAccounts(input.accounts, MfaMethod.TOTP),
    input.registry,
  );
  const syntheticPackages = CLIENT_SLOTS.map((client_slot) => ({
    client_slot,
    variant: MfaMethod.TOTP as const,
    endpoint: VERIFY_ENDPOINT[MfaMethod.TOTP],
    authorization: 'Bearer synthetic-only',
    body: '{"code":"synthetic-only"}',
  }));
  const barrier = new InMemoryRequestBroker(syntheticPackages);
  for (const slot of CLIENT_SLOTS) {
    barrier.takePackage(slot);
    barrier.markReady(slot);
  }
  if ((await barrier.waitUntilReady(1_000)) !== CLIENTS) {
    throw new HarnessError('PREFLIGHT_BARRIER');
  }
  barrier.release();
  barrier.clear();
  await atomicJson(resolve(input.root, 'checks/readiness-barrier.json'), {
    packages_fetched_once: CLIENTS,
    ready_before_release: CLIENTS,
    verification_requests_sent: 0,
    status: 'PASSED',
  });
  const monitor = new ResourceMonitorProcess();
  await monitor.start(input.container.cgroupPath, input.container.id, CLIENTS);
  await delay(60);
  const monitorCheck = await monitor.stop(CLIENTS);
  await atomicJson(resolve(input.root, 'checks/resource-monitor.json'), {
    memory_sample_interval_ms: monitorCheck.memory_sample_interval_ms,
    memory_sample_count: monitorCheck.memory_sample_count,
    final_sample_present: monitorCheck.final_sample_present,
    status: 'PASSED',
  });
  await runLiveLimiterChecks(
    input.root,
    input.source,
    input.http,
    input.accounts,
    input.registry,
  );
  const finalState = await captureState(
    input.experimentId,
    input.source,
    input.accounts,
    input.container,
    input.mailpit,
    input.webauthn,
  );
  assertCleanState(finalState);
  await atomicJson(resolve(input.root, 'checks/dataset-state.json'), {
    account_counts: finalState.account_counts,
    active_login_challenges_count: finalState.active_login_challenges_count,
    mailpit_message_count: finalState.mailpit_message_count,
    totp_secret_count: Object.keys(totpSecrets).length,
    webauthn_matching_count: finalState.webauthn_matching_count,
    none_in_plan: false,
    status: 'PASSED',
  });
};

const progression = (
  before: SafeState,
  after: SafeState,
  totpSteps: number[],
  expectedCount: number,
) => {
  const beforeTotp = new Map(
    before.totp.map(({ client_slot, totp_last_used_step }) => [
      client_slot,
      totp_last_used_step,
    ]),
  );
  const afterTotp = new Map(
    after.totp.map(({ client_slot, totp_last_used_step }) => [
      client_slot,
      totp_last_used_step,
    ]),
  );
  const totp = CLIENT_SLOTS.map((client_slot) => {
    assertTotpProgression(
      beforeTotp.get(client_slot) ?? null,
      totpSteps,
      afterTotp.get(client_slot) ?? null,
      expectedCount,
    );
    return {
      client_slot,
      before_step: beforeTotp.get(client_slot) ?? null,
      accepted_steps: totpSteps,
      after_step: afterTotp.get(client_slot) ?? null,
      accepted_count: totpSteps.length,
      status: 'VALID',
    };
  });
  const beforeWebAuthn = before.webauthn.map(
    ({ client_slot, db_sign_count }) => ({
      client_slot,
      count: db_sign_count,
    }),
  );
  const afterDatabase = after.webauthn.map(
    ({ client_slot, db_sign_count }) => ({
      client_slot,
      count: db_sign_count,
    }),
  );
  const afterAuthenticator = after.webauthn.map(
    ({ client_slot, authenticator_sign_count }) => ({
      client_slot,
      count: authenticator_sign_count,
    }),
  );
  assertWebAuthnCounterProgression(
    beforeWebAuthn,
    afterDatabase,
    afterAuthenticator,
    expectedCount,
  );
  return {
    status: 'VALID',
    totp,
    webauthn: CLIENT_SLOTS.map((client_slot) => ({
      client_slot,
      before_sign_count: beforeWebAuthn.find(
        (entry) => entry.client_slot === client_slot,
      ).count,
      after_sign_count: afterDatabase.find(
        (entry) => entry.client_slot === client_slot,
      ).count,
      accepted_count: expectedCount,
      status: 'VALID',
    })),
  };
};

const runPilotCampaign = async (input: {
  root: string;
  experimentId: string;
  source: DataSource;
  http: NoRetryHttpClient;
  mailpit: MailpitClient;
  accounts: RuntimeAccount[];
  webauthn: E2WebAuthnSession;
  container: BackendContainer;
}) => {
  const before = await captureState(
    input.experimentId,
    input.source,
    input.accounts,
    input.container,
    input.mailpit,
    input.webauthn,
  );
  assertCleanState(before);
  await atomicJson(resolve(input.root, 'state-before.json'), before);
  const index: IndexRecord[] = [];
  const totpSteps: number[] = [];
  for (const [position, variant] of E2_VARIANTS.entries()) {
    if (position) await delay(INTER_VARIANT_QUIESCENCE_MS);
    const result = await runBurst({
      experimentRoot: input.root,
      experimentId: input.experimentId,
      stage: 'pilot',
      round: 'pilot',
      orderPosition: position + 1,
      variant,
      source: input.source,
      http: input.http,
      mailpit: input.mailpit,
      accounts: input.accounts,
      webauthn: input.webauthn,
      container: input.container,
    });
    index.push({
      round: 'pilot',
      order_position: position + 1,
      variant,
      run_path: result.index.run_path,
    });
    if (result.expectedStep !== undefined) totpSteps.push(result.expectedStep);
  }
  await atomicWrite(
    resolve(input.root, 'pilot/index.csv'),
    indexCsv(index, false),
  );
  await sealDirectory(resolve(input.root, 'pilot'));
  const after = await captureState(
    input.experimentId,
    input.source,
    input.accounts,
    input.container,
    input.mailpit,
    input.webauthn,
  );
  assertCleanState(after);
  if (index.length !== 3 || totpSteps.length !== 1) {
    throw new HarnessError('PILOT_SAMPLE_PLAN');
  }
  await atomicJson(resolve(input.root, 'state-after.json'), after);
  await atomicJson(
    resolve(input.root, 'progression.json'),
    progression(before, after, totpSteps, 1),
  );
};

const runFullCampaign = async (input: {
  root: string;
  experimentId: string;
  source: DataSource;
  http: NoRetryHttpClient;
  mailpit: MailpitClient;
  accounts: RuntimeAccount[];
  webauthn: E2WebAuthnSession;
  container: BackendContainer;
}) => {
  const warmupIndex: IndexRecord[] = [];
  for (const [position, variant] of E2_VARIANTS.entries()) {
    if (position) await delay(INTER_VARIANT_QUIESCENCE_MS);
    const result = await runBurst({
      experimentRoot: input.root,
      experimentId: input.experimentId,
      stage: 'warmup',
      round: 'warmup',
      orderPosition: position + 1,
      variant,
      source: input.source,
      http: input.http,
      mailpit: input.mailpit,
      accounts: input.accounts,
      webauthn: input.webauthn,
      container: input.container,
    });
    warmupIndex.push({
      round: 'warmup',
      order_position: position + 1,
      variant,
      run_path: result.index.run_path,
    });
  }
  await atomicWrite(
    resolve(input.root, 'warmup/index.csv'),
    indexCsv(warmupIndex, false),
  );
  const cleanWarmup = await captureState(
    input.experimentId,
    input.source,
    input.accounts,
    input.container,
    input.mailpit,
    input.webauthn,
  );
  assertCleanState(cleanWarmup);
  await sealDirectory(resolve(input.root, 'warmup'));
  await delay(ROUND_COOLDOWN_MS);
  const before = await captureState(
    input.experimentId,
    input.source,
    input.accounts,
    input.container,
    input.mailpit,
    input.webauthn,
  );
  assertCleanState(before);
  await atomicJson(resolve(input.root, 'state-before.json'), before);

  const measuredIndex: IndexRecord[] = [];
  const totpSteps: number[] = [];
  for (const [roundIndex, variants] of MEASURED_SCHEDULE.entries()) {
    const round = roundIndex + 1;
    for (const [position, variant] of variants.entries()) {
      if (position) await delay(INTER_VARIANT_QUIESCENCE_MS);
      const result = await runBurst({
        experimentRoot: input.root,
        experimentId: input.experimentId,
        stage: 'measured',
        round,
        orderPosition: position + 1,
        variant,
        source: input.source,
        http: input.http,
        mailpit: input.mailpit,
        accounts: input.accounts,
        webauthn: input.webauthn,
        container: input.container,
      });
      measuredIndex.push({
        round,
        order_position: position + 1,
        variant,
        run_path: result.index.run_path,
      });
      if (result.expectedStep !== undefined)
        totpSteps.push(result.expectedStep);
    }
    assertCleanState(
      await captureState(
        input.experimentId,
        input.source,
        input.accounts,
        input.container,
        input.mailpit,
        input.webauthn,
      ),
    );
    if (round < MEASURED_ROUNDS) await delay(ROUND_COOLDOWN_MS);
  }
  if (
    measuredIndex.length !== MEASURED_BURSTS ||
    measuredIndex.length * CLIENTS !== MEASURED_SAMPLES ||
    E2_VARIANTS.some(
      (variant) =>
        measuredIndex.filter((row) => row.variant === variant).length *
          CLIENTS !==
        MEASURED_SAMPLES_PER_VARIANT,
    ) ||
    totpSteps.length !== MEASURED_ROUNDS
  ) {
    throw new HarnessError('MEASURED_SAMPLE_PLAN');
  }
  const after = await captureState(
    input.experimentId,
    input.source,
    input.accounts,
    input.container,
    input.mailpit,
    input.webauthn,
  );
  assertCleanState(after);
  await atomicJson(resolve(input.root, 'state-after.json'), after);
  await atomicJson(
    resolve(input.root, 'progression.json'),
    progression(before, after, totpSteps, MEASURED_ROUNDS),
  );
  await atomicWrite(
    resolve(input.root, 'measured/index.csv'),
    indexCsv(measuredIndex, true),
  );
  await sealDirectory(resolve(input.root, 'measured'));
};

const closeRuntime = async (input: {
  source?: DataSource;
  http?: NoRetryHttpClient;
  mailpitHttp?: NoRetryHttpClient;
  mailpit?: MailpitClient;
  webauthn?: E2WebAuthnSession;
  backend?: BackendContainer;
  mailpitContainer?: MailpitContainer;
  checkpoint: boolean;
}) => {
  const succeeds = async (operation: Promise<unknown> | undefined) => {
    if (operation === undefined) return true;
    try {
      await operation;
      return true;
    } catch {
      return false;
    }
  };
  const checkpointed =
    !input.checkpoint || (await succeeds(input.webauthn?.checkpoint()));
  const mailpitPurged = await succeeds(input.mailpit?.purge());
  const chromiumStopped = await succeeds(input.webauthn?.close());
  input.http?.close();
  input.mailpitHttp?.close();
  const databaseDisconnected = await succeeds(
    input.source ? disconnectDatabase() : undefined,
  );
  const backendStopped = await stopContainer(input.backend?.id);
  const mailpitStopped = await stopContainer(input.mailpitContainer?.id);
  return {
    checkpointed,
    mailpitPurged,
    chromiumStopped,
    databaseDisconnected,
    backendStopped,
    mailpitStopped,
    complete:
      checkpointed &&
      mailpitPurged &&
      chromiumStopped &&
      databaseDisconnected &&
      backendStopped &&
      mailpitStopped,
  };
};

const executeLive = async (options: CliOptions) => {
  requireEnvironment(
    'NODE_ENV',
    'PORT',
    'DATABASE_URL',
    'MFA_RESEARCH_PASSWORD',
    'JWT_SECRET',
    'MFA_OTP_HMAC_KEY',
    'MFA_TOTP_ENCRYPTION_KEY',
    'RESEARCH_MAIL_DOMAIN',
    'SMTP_FROM_EMAIL',
    'WEBAUTHN_RP_ID',
    'WEBAUTHN_ORIGIN',
  );
  await assertApprovedProtocol(PROTOCOL_PATH);
  const git = await gitState();
  if (git.changed.length) throw new HarnessError('RUNTIME_WORKTREE_DIRTY');
  if (options.mode === 'pilot') {
    await validateApprovedRun(
      options.approvedPreflightId,
      'preflight',
      git.backendCommit,
    );
  }
  if (options.mode === 'full') {
    await validateApprovedRun(
      options.approvedPilotId,
      'pilot',
      git.backendCommit,
    );
  }
  const offlineGates =
    options.mode === 'preflight' ? await runOfflineGates() : [];
  const version = await jmeterVersion();
  const experimentId = `e2-${options.mode}-${timestamp()}-${git.backendCommit.slice(0, 12)}`;
  const root = await createTopLevelArtifact({
    resultsRoot: RESULTS_ROOT,
    kind: options.mode,
    experimentId,
    protocolPath: PROTOCOL_PATH,
  });
  const registry = new SecretRegistry();
  let mailpitRuntime: Awaited<ReturnType<typeof startMailpit>> | undefined;
  let backend: BackendContainer | undefined;
  let source: DataSource | undefined;
  let accounts: RuntimeAccount[] = [];
  let http: NoRetryHttpClient | undefined;
  let webauthn: E2WebAuthnSession | undefined;
  let failure: HarnessError | undefined;
  let valid = false;
  try {
    await ensureActiveSnapshot(options.mode === 'preflight');
    mailpitRuntime = await startMailpit();
    backend = await startBackend(git.backendCommit);
    source = await connectDatabase();
    accounts = await loadAccounts(source);
    seedRegistry(registry, accounts);
    http = new NoRetryHttpClient();
    webauthn = await E2WebAuthnSession.launch(ACTIVE_WEBAUTHN_SNAPSHOT_PATH);
    webauthn.registerSecrets(registry);
    await atomicJson(
      resolve(root, 'environment.json'),
      await collectEnvironment(
        experimentId,
        source,
        git,
        backend,
        mailpitRuntime.container,
        version,
      ),
    );
    if (options.mode === 'preflight') {
      await atomicJson(resolve(root, 'checks/offline-gates.json'), {
        checks: offlineGates,
        status: 'PASSED',
      });
      await runPreflight({
        root,
        experimentId,
        source,
        http,
        mailpit: mailpitRuntime.mailpit,
        accounts,
        webauthn,
        container: backend,
        registry,
      });
    } else if (options.mode === 'pilot') {
      await runPilotCampaign({
        root,
        experimentId,
        source,
        http,
        mailpit: mailpitRuntime.mailpit,
        accounts,
        webauthn,
        container: backend,
      });
    } else {
      await runFullCampaign({
        root,
        experimentId,
        source,
        http,
        mailpit: mailpitRuntime.mailpit,
        accounts,
        webauthn,
        container: backend,
      });
    }
    valid = true;
  } catch (error) {
    failure =
      error instanceof HarnessError
        ? error
        : new HarnessError('CAMPAIGN_UNEXPECTED_FAILURE');
    if (source && backend && mailpitRuntime && webauthn && accounts.length) {
      await webauthn.checkpoint().catch(() => undefined);
      try {
        await atomicJson(
          resolve(root, 'state-at-abort.json'),
          await captureState(
            experimentId,
            source,
            accounts,
            backend,
            mailpitRuntime.mailpit,
            webauthn,
          ),
        );
      } catch {
        // A failed read never permits campaign continuation.
      }
    }
  }
  const campaignCompleted = valid;
  const cleanup = await closeRuntime({
    source,
    http,
    mailpitHttp: mailpitRuntime?.client,
    mailpit: mailpitRuntime?.mailpit,
    webauthn,
    backend,
    mailpitContainer: mailpitRuntime?.container,
    checkpoint: options.mode !== 'preflight',
  });
  if (valid && !cleanup.complete) {
    valid = false;
    failure = new HarnessError('RUNTIME_CLEANUP');
  }
  if (campaignCompleted && options.mode === 'full') {
    await atomicJson(resolve(root, 'cleanup.json'), {
      status: cleanup.complete ? 'COMPLETE' : 'INCOMPLETE',
      private_snapshot_checkpointed: cleanup.checkpointed,
      mailpit_purged: cleanup.mailpitPurged,
      broker_stopped: true,
      jmeter_stopped: true,
      chromium_stopped: cleanup.chromiumStopped,
      database_disconnected: cleanup.databaseDisconnected,
      backend_stopped: cleanup.backendStopped,
      mailpit_stopped: cleanup.mailpitStopped,
      user_state_reset: false,
      completed_at_utc: new Date().toISOString(),
    });
  }
  try {
    await scanArtifacts(root, registry.all());
  } catch (error) {
    valid = false;
    failure =
      error instanceof HarnessError
        ? error
        : new HarnessError('ARTIFACT_SECRET_SCAN');
  }
  await atomicJson(resolve(root, 'status.json'), {
    status: valid ? 'VALID' : 'INVALID',
    code: valid ? 'OK' : (failure?.code ?? 'CAMPAIGN_INVALID'),
    diagnostic: valid ? undefined : failure?.diagnostic,
    mode: options.mode,
    experiment_id: experimentId,
    completed_at_utc: new Date().toISOString(),
    automatic_rerun: false,
    approved_preflight_id:
      options.mode === 'pilot' ? options.approvedPreflightId : undefined,
    approved_pilot_id:
      options.mode === 'full' ? options.approvedPilotId : undefined,
  });
  await sealDirectory(root, registry.all());
  registry.clear();
  if (!valid) throw failure ?? new HarnessError('CAMPAIGN_INVALID');
  return root;
};

export const main = async (arguments_ = process.argv.slice(2)) => {
  const options = parseCliArguments(arguments_);
  await assertApprovedProtocol(PROTOCOL_PATH);
  if (options.mode === 'analysis') {
    return runAnalysis({
      fullRoot: resolve(RESULTS_ROOT, options.fullExperimentId),
      resultsRoot: RESULTS_ROOT,
      protocolPath: PROTOCOL_PATH,
    });
  }
  let lock: Awaited<ReturnType<typeof open>>;
  try {
    lock = await open(LIVE_LOCK_PATH, 'wx', 0o600);
  } catch {
    throw new HarnessError('LIVE_RUN_LOCKED');
  }
  try {
    return await executeLive(options);
  } finally {
    await lock.close().catch(() => undefined);
    await unlink(LIVE_LOCK_PATH).catch(() => undefined);
  }
};

if (require.main === module) {
  void main()
    .then((path) => console.log(`E2_RESULT=${basename(path)}`))
    .catch((error) => {
      console.error(
        error instanceof HarnessError
          ? error.code
          : 'CAMPAIGN_UNEXPECTED_FAILURE',
      );
      process.exitCode = 1;
    });
}
