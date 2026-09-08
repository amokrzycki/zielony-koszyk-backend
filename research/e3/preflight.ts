import { execFile as execFileCallback, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { cpus, hostname, platform, release, tmpdir, totalmem } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { MfaMethod } from '../../src/enums/MfaMethod';
import {
  TOTP_SECRETS_PATH,
  TotpSecretStore,
  WebAuthnSnapshot,
  readJson,
} from '../dataset';
import {
  disconnectDatabase,
  loadResearchUsers,
  preflight as datasetPreflight,
} from '../runtime';
import { JourneyResult, runJourney } from './browser';
import {
  BACKEND_URL,
  BROWSER_FLAGS,
  CHROMIUM_EXECUTABLE,
  DEVICE_SCALE_FACTOR,
  E3Error,
  FRONTEND_AFTER_COMMIT,
  FRONTEND_BEFORE_COMMIT,
  FRONTEND_URL,
  LOCALE,
  PROTOCOL_ID,
  SCENARIOS,
  THROTTLE_LIMIT,
  THROTTLE_WINDOW_MS,
  TIMEZONE,
  TOTP_MIN_REMAINING_MS,
  TOTP_PERIOD_MS,
  ThrottleScheduler,
  VIEWPORT,
  WEBAUTHN_CHECKPOINT_PATH,
  WEBAUTHN_RP_ID,
  frozenBackendCommit,
  protocolSha256,
} from './protocol';
import {
  createArtifactDirectory,
  sealArtifact,
  verifyArtifact,
  writeJsonExclusive,
} from './artifacts';

const execFile = promisify(execFileCallback);
const BACKEND_ROOT = resolve(__dirname, '../..');
const WORKSPACE_ROOT = resolve(BACKEND_ROOT, '..');
const FRONTEND_ROOT = resolve(WORKSPACE_ROOT, 'zielony-koszyk');
const PROTOCOL_PATH = resolve(WORKSPACE_ROOT, 'E3.md');
const RESULTS_ROOT = resolve(BACKEND_ROOT, 'research/results/e3-frontend');
const FRONTEND_CONTAINER = 'green-basket-e3-frontend';
const BEFORE_IMAGE = 'green-basket-frontend:e3-before';
const AFTER_IMAGE = 'green-basket-frontend:e3-after';

type Check = { name: string; status: 'PASS' | 'FAIL' };

const command = async (file: string, args: string[], cwd = BACKEND_ROOT) =>
  (
    await execFile(file, args, {
      cwd,
      maxBuffer: 32 * 1024 * 1024,
    })
  ).stdout.trim();

const check = async <T>(
  checks: Check[],
  name: string,
  action: () => Promise<T> | T,
) => {
  try {
    const result = await action();
    checks.push({ name, status: 'PASS' });
    return result;
  } catch (error) {
    checks.push({ name, status: 'FAIL' });
    throw error;
  }
};

const assertValue = (condition: unknown) => {
  if (!condition) throw new E3Error('ENVIRONMENT_MISMATCH');
};

const gitRevision = (directory: string) =>
  command('git', ['rev-parse', 'HEAD'], directory);

const gitClean = async (directory: string) =>
  (await command('git', ['status', '--porcelain'], directory)) === '';

const waitForHttp = async (url: string) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.status < 500) return;
    } catch {
      // Service is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new E3Error('ENVIRONMENT_MISMATCH');
};

const hashDist = async (image: string) => {
  const extraction = await mkdtemp(join(tmpdir(), 'zielony-e3-dist-'));
  const container = await command('docker', ['create', image]);
  try {
    await command('docker', ['cp', `${container}:/app/dist`, extraction]);
    return await new Promise<string>((resolveHash, reject) => {
      const hash = createHash('sha256');
      const tar = spawn(
        'tar',
        [
          '--sort=name',
          '--mtime=@0',
          '--owner=0',
          '--group=0',
          '--numeric-owner',
          '-cf',
          '-',
          'dist',
        ],
        { cwd: extraction, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stderr = '';
      tar.stdout.on('data', (chunk: Buffer) => hash.update(chunk));
      tar.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      tar.once('error', reject);
      tar.once('exit', (code) => {
        if (code === 0) resolveHash(hash.digest('hex'));
        else reject(new Error(stderr || 'DIST_HASH'));
      });
    });
  } finally {
    await command('docker', ['rm', '-f', container]).catch(() => undefined);
    await rm(extraction, { recursive: true, force: true });
  }
};

const buildCurrentFrontend = async () => {
  await command(
    'docker',
    [
      'build',
      '--target',
      'frontend',
      '--tag',
      AFTER_IMAGE,
      '--file',
      resolve(WORKSPACE_ROOT, 'Dockerfile'),
      WORKSPACE_ROOT,
    ],
    WORKSPACE_ROOT,
  );
  return hashDist(AFTER_IMAGE);
};

const buildHistoricalFrontend = async () => {
  const context = await mkdtemp(join(tmpdir(), 'zielony-e3-before-'));
  const worktree = resolve(context, 'zielony-koszyk');
  try {
    await command(
      'git',
      ['worktree', 'add', '--detach', worktree, FRONTEND_BEFORE_COMMIT],
      FRONTEND_ROOT,
    );
    await copyFile(
      resolve(WORKSPACE_ROOT, 'Dockerfile'),
      resolve(context, 'Dockerfile'),
    );
    await command(
      'docker',
      [
        'build',
        '--target',
        'frontend',
        '--tag',
        BEFORE_IMAGE,
        '--file',
        resolve(context, 'Dockerfile'),
        context,
      ],
      context,
    );
    return await hashDist(BEFORE_IMAGE);
  } finally {
    await command(
      'git',
      ['worktree', 'remove', '--force', worktree],
      FRONTEND_ROOT,
    ).catch(() => undefined);
    await rm(context, { recursive: true, force: true });
  }
};

const stopFrontend = async () => {
  const existing = await command('docker', [
    'ps',
    '--all',
    '--quiet',
    '--filter',
    `name=^/${FRONTEND_CONTAINER}$`,
  ]);
  if (existing) await command('docker', ['rm', '-f', FRONTEND_CONTAINER]);
};

const serveFrontend = async (image: string) => {
  await stopFrontend();
  await command('docker', [
    'run',
    '--detach',
    '--rm',
    '--name',
    FRONTEND_CONTAINER,
    '--publish',
    '5173:5173',
    image,
  ]);
  await waitForHttp(FRONTEND_URL);
};

const startBackendServices = async () => {
  await command(
    'docker',
    ['compose', 'up', '--detach', '--build', 'mailpit', 'backend'],
    WORKSPACE_ROOT,
  );
  await Promise.all([
    waitForHttp(BACKEND_URL),
    waitForHttp('http://127.0.0.1:8025/api/v1/info'),
  ]);
};

const packageVersion = async (name: string) => {
  const contents = JSON.parse(
    await readFile(
      resolve(BACKEND_ROOT, 'node_modules', name, 'package.json'),
      'utf8',
    ),
  ) as { version?: string };
  assertValue(/^\d+\.\d+\.\d+$/.test(contents.version ?? ''));
  return contents.version;
};

const exactSecrets = async () => {
  const [totp, snapshot] = await Promise.all([
    readJson<TotpSecretStore>(TOTP_SECRETS_PATH),
    readJson<WebAuthnSnapshot>(WEBAUTHN_CHECKPOINT_PATH),
  ]);
  return [
    process.env.MFA_RESEARCH_PASSWORD,
    ...Object.values(totp).map(({ secret }) => secret),
    ...snapshot.authenticator.credentials.flatMap((credential) => [
      credential.privateKey,
      credential.credentialId,
    ]),
  ].filter((value): value is string => Boolean(value));
};

const main = async () => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const [protocolText, frontendCommit, backendCommit] = await Promise.all([
    readFile(PROTOCOL_PATH, 'utf8'),
    gitRevision(FRONTEND_ROOT),
    gitRevision(BACKEND_ROOT),
  ]);
  const artifact = await createArtifactDirectory(
    RESULTS_ROOT,
    `e3-preflight-${timestamp}-${frontendCommit.slice(0, 8)}-${backendCommit.slice(0, 8)}`,
  );
  const checks: Check[] = [];
  const secrets = await exactSecrets().catch(() => []);
  const registerSecret = (value: string) => secrets.push(value);
  const environment: Record<string, unknown> = {
    frontend_commit_before: FRONTEND_BEFORE_COMMIT,
    frontend_commit_after: FRONTEND_AFTER_COMMIT,
    frontend_commit_used_this_phase: ['before', 'after'],
    backend_commit: backendCommit,
    frontend_worktree_clean: false,
    backend_worktree_clean: false,
    frontend_build_hash: { before: null, after: null },
    chromium_executable: CHROMIUM_EXECUTABLE,
    chromium_version: null,
    playwright_version: null,
    web_vitals_version: null,
    node_version: process.version,
    viewport: VIEWPORT,
    device_scale_factor: DEVICE_SCALE_FACTOR,
    locale: LOCALE,
    timezone: TIMEZONE,
    browser_flags: BROWSER_FLAGS,
    chromium_no_sandbox: false,
    cache_policy: 'cold',
    network_policy: 'native',
    cpu_policy: 'native',
    service_worker_present: false,
    webauthn_rp_id: WEBAUTHN_RP_ID,
    webauthn_origin: FRONTEND_URL,
    webauthn_checkpoint: basename(WEBAUTHN_CHECKPOINT_PATH),
    backend_url: BACKEND_URL,
    frontend_url: FRONTEND_URL,
    throttle_scheduler_window_ms: THROTTLE_WINDOW_MS,
    throttle_scheduler_limit: THROTTLE_LIMIT,
    totp_period_ms: TOTP_PERIOD_MS,
    totp_min_remaining_ms: TOTP_MIN_REMAINING_MS,
    host: {
      hostname: hostname(),
      platform: platform(),
      release: release(),
      cpu_model: cpus()[0]?.model ?? null,
      cpu_logical_count: cpus().length,
      total_memory_bytes: totalmem(),
    },
    environment_deviation_codes: [],
  };
  let errorCode: string | null = null;
  const scheduler = new ThrottleScheduler();
  try {
    await check(checks, 'repository.frontend_commit', () =>
      assertValue(frontendCommit === FRONTEND_AFTER_COMMIT),
    );
    await check(checks, 'repository.backend_commit', () =>
      assertValue(backendCommit === frozenBackendCommit(protocolText)),
    );
    environment.frontend_worktree_clean = await check(
      checks,
      'repository.frontend_clean',
      async () => {
        const clean = await gitClean(FRONTEND_ROOT);
        assertValue(clean);
        return clean;
      },
    );
    environment.backend_worktree_clean = await check(
      checks,
      'repository.backend_clean',
      async () => {
        const clean = await gitClean(BACKEND_ROOT);
        assertValue(clean);
        return clean;
      },
    );
    await check(checks, 'repository.historical_frontend', async () => {
      await command(
        'git',
        ['cat-file', '-e', `${FRONTEND_BEFORE_COMMIT}^{commit}`],
        FRONTEND_ROOT,
      );
      assertValue(
        (await command(
          'git',
          [
            'ls-tree',
            '--name-only',
            FRONTEND_BEFORE_COMMIT,
            'package-lock.json',
          ],
          FRONTEND_ROOT,
        )) === 'package-lock.json',
      );
    });
    await check(checks, 'repository.research_secrets', () => {
      assertValue(secrets.length >= 101 && process.env.MFA_RESEARCH_PASSWORD);
    });
    environment.chromium_version = await check(checks, 'tools.chromium', () =>
      command(CHROMIUM_EXECUTABLE, ['--version']),
    );
    environment.playwright_version = await check(
      checks,
      'tools.playwright',
      () => packageVersion('playwright'),
    );
    environment.web_vitals_version = await check(
      checks,
      'tools.web_vitals',
      () => packageVersion('web-vitals'),
    );

    const beforeHash = await check(
      checks,
      'build.before_mfa',
      buildHistoricalFrontend,
    );
    const afterHash = await check(
      checks,
      'build.after_mfa',
      buildCurrentFrontend,
    );
    environment.frontend_build_hash = { before: beforeHash, after: afterHash };

    await check(checks, 'services.backend_mailpit', startBackendServices);
    await check(checks, 'serve.before_mfa', () => serveFrontend(BEFORE_IMAGE));
    const dataset = await check(
      checks,
      'dataset.webauthn_post_e2_checkpoint_contract',
      () => datasetPreflight(WEBAUTHN_CHECKPOINT_PATH),
    );
    const users = await loadResearchUsers(dataset.source, dataset.expected);
    const [totpSecrets, webauthnSnapshot] = await Promise.all([
      readJson<TotpSecretStore>(TOTP_SECRETS_PATH),
      readJson<WebAuthnSnapshot>(WEBAUTHN_CHECKPOINT_PATH),
    ]);
    const account = (variant: MfaMethod, slot: string) => {
      const user = users.find(
        (candidate) =>
          candidate.variant === variant && candidate.client_slot === slot,
      );
      if (!user) throw new E3Error('ENVIRONMENT_MISMATCH');
      return user;
    };
    const password = process.env.MFA_RESEARCH_PASSWORD;
    assertValue(password);
    const results: JourneyResult[] = [];
    results.push(
      await check(checks, 'journey.S0_BEFORE_MFA', () =>
        runJourney({
          scenario: 'S0_BEFORE_MFA',
          account: account(MfaMethod.NONE, '001'),
          password,
          scheduler,
          totpSecrets,
          webauthnSnapshot,
          registerSecret,
        }),
      ),
    );

    await check(checks, 'serve.after_mfa', () => serveFrontend(AFTER_IMAGE));
    const journeys = [
      ['S1_NONE', MfaMethod.NONE, '002'],
      ['S2_EMAIL_OTP', MfaMethod.EMAIL_OTP, '001'],
      ['S3_TOTP', MfaMethod.TOTP, '001'],
      ['S4_WEBAUTHN', MfaMethod.WEBAUTHN, '001'],
    ] as const;
    for (const [scenario, variant, slot] of journeys) {
      results.push(
        await check(checks, `journey.${scenario}`, () =>
          runJourney({
            scenario,
            account: account(variant, slot),
            password,
            scheduler,
            totpSecrets,
            webauthnSnapshot,
            registerSecret,
          }),
        ),
      );
    }
    await check(checks, 'browser.trusted_input', () =>
      assertValue(results.every(({ trusted_input }) => trusted_input)),
    );
    await check(checks, 'browser.render_gate', () =>
      assertValue(results.every(({ render_gate }) => render_gate)),
    );
    await check(checks, 'browser.lcp_inp_cls', () =>
      assertValue(
        results.every(
          ({ lcp_ms, inp_ms, cls_instrumented }) =>
            lcp_ms !== null && inp_ms !== null && cls_instrumented,
        ),
      ),
    );
    await check(checks, 'browser.google_fonts', () =>
      assertValue(
        results.every(
          ({ external_resources }) =>
            external_resources.length > 0 &&
            external_resources.every(({ success }) => success),
        ),
      ),
    );
    await check(checks, 'throttle.scheduler', () => undefined);
    await check(checks, 'throttle.clear_window', () => scheduler.clearWindow());
  } catch (error) {
    errorCode =
      error instanceof E3Error
        ? error.code
        : error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
          ? error.message
          : 'PREFLIGHT_TECHNICAL_FAILURE';
  } finally {
    await stopFrontend().catch(() => undefined);
    await disconnectDatabase().catch(() => undefined);
  }

  const protocolHash = await protocolSha256(PROTOCOL_PATH);
  await writeJsonExclusive(
    resolve(artifact, 'protocol.json'),
    {
      protocol_id: PROTOCOL_ID,
      protocol_path: basename(PROTOCOL_PATH),
      protocol_sha256: protocolHash,
      frontend_commit_before: FRONTEND_BEFORE_COMMIT,
      frontend_commit_after: FRONTEND_AFTER_COMMIT,
      backend_commit: backendCommit,
      frozen_constants: {
        scenarios: SCENARIOS,
        measured_blocks: 21,
        measured_runs_per_scenario: 21,
        measured_runs_total: 105,
        order_seed_base: 20_260_908,
        throttle_window_ms: THROTTLE_WINDOW_MS,
        throttle_limit: THROTTLE_LIMIT,
        totp_min_remaining_ms: TOTP_MIN_REMAINING_MS,
        webauthn_checkpoint: basename(WEBAUTHN_CHECKPOINT_PATH),
      },
      h4_policy: 'threshold-only; E3.md section 18',
      order_manifest_sha256: null,
    },
    secrets,
  );
  await writeJsonExclusive(
    resolve(artifact, 'environment.json'),
    environment,
    secrets,
  );
  await writeJsonExclusive(
    resolve(artifact, 'status.json'),
    {
      experiment: PROTOCOL_ID,
      phase: 'preflight',
      status: errorCode ? 'FAIL' : 'PASS',
      error_code: errorCode,
      checks,
      pilot_started: false,
      measured_campaign_started: false,
    },
    secrets,
  );
  const manifestHash = await sealArtifact(artifact, secrets);
  assertValue((await verifyArtifact(artifact)) === manifestHash);
  process.stdout.write(
    `${JSON.stringify({ artifact, manifest_sha256: manifestHash, status: errorCode ? 'FAIL' : 'PASS' })}\n`,
  );
  if (errorCode) process.exitCode = 1;
};

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'PREFLIGHT_FATAL'}\n`,
    );
    process.exitCode = 1;
  });
}
