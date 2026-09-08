import { readFile } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';
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
import { runJourney } from './browser';
import {
  createArtifactDirectory,
  sealArtifact,
  serializeRun,
  verifyArtifact,
  writeJsonExclusive,
} from './artifacts';
import {
  AFTER_IMAGE,
  BACKEND_ROOT,
  BEFORE_IMAGE,
  FRONTEND_ROOT,
  PROTOCOL_PATH,
  RESULTS_ROOT,
  exactSecrets,
  gitClean,
  gitRevision,
  serveFrontend,
  startBackendServices,
  stopFrontend,
} from './preflight';
import {
  E3Error,
  FRONTEND_AFTER_COMMIT,
  FRONTEND_BEFORE_COMMIT,
  InvalidReason,
  Scenario,
  ThrottleScheduler,
  WEBAUTHN_CHECKPOINT_PATH,
  classifyRun,
  frozenBackendCommit,
  protocolSha256,
} from './protocol';

type PilotPlanEntry = {
  scenario: Scenario;
  variant: MfaMethod;
  slots: readonly string[];
  image: string;
};

export const PILOT_PLAN: readonly PilotPlanEntry[] = [
  {
    scenario: 'S0_BEFORE_MFA',
    variant: MfaMethod.NONE,
    slots: ['001', '002', '003'],
    image: BEFORE_IMAGE,
  },
  {
    scenario: 'S1_NONE',
    variant: MfaMethod.NONE,
    slots: ['004', '005', '006'],
    image: AFTER_IMAGE,
  },
  {
    scenario: 'S2_EMAIL_OTP',
    variant: MfaMethod.EMAIL_OTP,
    slots: ['001', '002', '003'],
    image: AFTER_IMAGE,
  },
  {
    scenario: 'S3_TOTP',
    variant: MfaMethod.TOTP,
    slots: ['001', '002', '003'],
    image: AFTER_IMAGE,
  },
  {
    scenario: 'S4_WEBAUTHN',
    variant: MfaMethod.WEBAUTHN,
    slots: ['001', '002', '003'],
    image: AFTER_IMAGE,
  },
];

type PilotCheck = {
  name: string;
  status: 'PASS' | 'FAIL';
  error_code?: string;
};

const assertValue = (condition: unknown, code = 'PILOT_TECHNICAL_FAILURE') => {
  if (!condition) throw new Error(code);
};

const loadPreflight = async (path: string) => {
  const root = resolve(path);
  assertValue(root.startsWith(`${RESULTS_ROOT}${sep}`));
  assertValue(/^e3-preflight-/.test(basename(root)));
  await verifyArtifact(root);
  const [status, protocol, environment] = await Promise.all([
    readJson<{ status: string; checks: PilotCheck[] }>(
      resolve(root, 'status.json'),
    ),
    readJson<Record<string, unknown>>(resolve(root, 'protocol.json')),
    readJson<Record<string, unknown>>(resolve(root, 'environment.json')),
  ]);
  assertValue(
    status.status === 'PASS' &&
      status.checks.length === 26 &&
      status.checks.every(({ status: checkStatus }) => checkStatus === 'PASS'),
    'PREFLIGHT_REQUIRED',
  );
  return { root, protocol, environment };
};

const main = async () => {
  const preflightPath = process.argv[2];
  assertValue(preflightPath, 'PREFLIGHT_REQUIRED');
  const linkedPreflight = await loadPreflight(preflightPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const [protocolText, frontendCommit, backendCommit] = await Promise.all([
    readFile(PROTOCOL_PATH, 'utf8'),
    gitRevision(FRONTEND_ROOT),
    gitRevision(BACKEND_ROOT),
  ]);
  assertValue(frontendCommit === FRONTEND_AFTER_COMMIT);
  assertValue(backendCommit === frozenBackendCommit(protocolText));
  assertValue(
    linkedPreflight.protocol.protocol_sha256 ===
      (await protocolSha256(PROTOCOL_PATH)),
    'PROTOCOL_HASH_MISMATCH',
  );

  const artifact = await createArtifactDirectory(
    RESULTS_ROOT,
    `e3-pilot-${timestamp}-${frontendCommit.slice(0, 8)}-${backendCommit.slice(0, 8)}`,
  );
  const checks: PilotCheck[] = [];
  const totals = Object.fromEntries(
    PILOT_PLAN.map(({ scenario }) => [
      scenario,
      { total: 0, valid: 0, invalid: 0 },
    ]),
  ) as Record<Scenario, { total: number; valid: number; invalid: number }>;
  const secrets = await exactSecrets();
  const registerSecret = (value: string) => secrets.push(value);
  const scheduler = new ThrottleScheduler();
  let errorCode: string | null = null;

  try {
    assertValue(await gitClean(FRONTEND_ROOT));
    checks.push({ name: 'repository.frontend_clean', status: 'PASS' });
    assertValue(await gitClean(BACKEND_ROOT));
    checks.push({ name: 'repository.backend_clean', status: 'PASS' });
    checks.push({ name: 'preflight.verified', status: 'PASS' });
    await startBackendServices();
    checks.push({ name: 'services.backend_mailpit', status: 'PASS' });
    await serveFrontend(BEFORE_IMAGE);
    const dataset = await datasetPreflight(WEBAUTHN_CHECKPOINT_PATH);
    const users = await loadResearchUsers(dataset.source, dataset.expected);
    const [totpSecrets, webauthnSnapshot] = await Promise.all([
      readJson<TotpSecretStore>(TOTP_SECRETS_PATH),
      readJson<WebAuthnSnapshot>(WEBAUTHN_CHECKPOINT_PATH),
    ]);
    const password = process.env.MFA_RESEARCH_PASSWORD;
    assertValue(password);

    for (const [scenarioIndex, plan] of PILOT_PLAN.entries()) {
      await serveFrontend(plan.image);
      for (const [runIndex, slot] of plan.slots.entries()) {
        const account = users.find(
          (candidate) =>
            candidate.variant === plan.variant &&
            candidate.client_slot === slot,
        );
        assertValue(account);
        let result: Awaited<ReturnType<typeof runJourney>> | undefined;
        let failure: unknown;
        try {
          result = await runJourney({
            scenario: plan.scenario,
            account,
            password,
            scheduler,
            totpSecrets,
            webauthnSnapshot,
            registerSecret,
          });
          if (!result.cls_instrumented) {
            failure = new E3Error('UNEXPECTED_FRONTEND_STATE');
          }
        } catch (error) {
          failure = error;
        }
        const classification = classifyRun({
          error: failure,
          lcp_ms: result?.lcp_ms,
          inp_ms: result?.inp_ms,
        });
        const invalidReason =
          classification.invalid_reason as InvalidReason | null;
        const runNumber = runIndex + 1;
        const runId = `${plan.scenario}-pilot-${String(runNumber).padStart(2, '0')}`;
        const now = new Date().toISOString();
        await writeJsonExclusive(
          resolve(
            artifact,
            'pilot',
            plan.scenario,
            `run-${String(runNumber).padStart(2, '0')}.json`,
          ),
          serializeRun({
            run_id: runId,
            block: runIndex,
            position_in_block: scenarioIndex,
            scenario: plan.scenario,
            frontend_variant:
              plan.scenario === 'S0_BEFORE_MFA' ? 'before' : 'after',
            account_slot: account.identifier,
            navigation_start_ts: result?.navigation_start_ts ?? now,
            lcp_ms: result?.lcp_ms ?? null,
            lcp_element_selector: result?.lcp_element_selector ?? null,
            inp_ms: result?.inp_ms ?? null,
            inp_interaction_target: result?.inp_interaction_target ?? null,
            cls_value: result?.cls_value ?? 0,
            cls_boundary_ts: result?.cls_boundary_ts ?? 0,
            measured_window_end_ts: result?.measured_window_end_ts ?? now,
            valid: classification.valid,
            invalid_reason: invalidReason,
            chromium_pid_started_fresh:
              result?.chromium_pid_started_fresh ?? false,
            duration_total_ms: result?.duration_total_ms ?? 0,
            external_resources: result?.external_resources ?? [],
          }),
          secrets,
        );
        totals[plan.scenario].total += 1;
        totals[plan.scenario][classification.valid ? 'valid' : 'invalid'] += 1;
        checks.push({
          name: `run.${plan.scenario}.${String(runNumber).padStart(2, '0')}`,
          status: classification.valid ? 'PASS' : 'FAIL',
          ...(invalidReason ? { error_code: invalidReason } : {}),
        });
      }
    }
  } catch (error) {
    errorCode =
      error instanceof E3Error
        ? error.code
        : error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
          ? error.message
          : 'PILOT_TECHNICAL_FAILURE';
  } finally {
    try {
      await scheduler.clearWindow();
      checks.push({ name: 'throttle.clear_window', status: 'PASS' });
    } catch {
      checks.push({
        name: 'throttle.clear_window',
        status: 'FAIL',
        error_code: 'PILOT_TECHNICAL_FAILURE',
      });
      errorCode ??= 'PILOT_TECHNICAL_FAILURE';
    }
    await stopFrontend().catch(() => undefined);
    await disconnectDatabase().catch(() => undefined);
  }

  const total = Object.values(totals).reduce(
    (sum, scenario) => ({
      total: sum.total + scenario.total,
      valid: sum.valid + scenario.valid,
      invalid: sum.invalid + scenario.invalid,
    }),
    { total: 0, valid: 0, invalid: 0 },
  );
  if (total.total !== 15 || total.valid !== 15 || total.invalid !== 0) {
    errorCode ??= 'PILOT_TECHNICAL_FAILURE';
  }
  const [frontendClean, backendClean] = await Promise.all([
    gitClean(FRONTEND_ROOT),
    gitClean(BACKEND_ROOT),
  ]);
  if (!frontendClean || !backendClean) {
    errorCode ??= 'PILOT_TECHNICAL_FAILURE';
  }
  await writeJsonExclusive(
    resolve(artifact, 'protocol.json'),
    linkedPreflight.protocol,
    secrets,
  );
  await writeJsonExclusive(
    resolve(artifact, 'environment.json'),
    {
      ...linkedPreflight.environment,
      linked_preflight_artifact: basename(linkedPreflight.root),
      frontend_commit_before: FRONTEND_BEFORE_COMMIT,
      frontend_commit_after: FRONTEND_AFTER_COMMIT,
      backend_commit: backendCommit,
      frontend_worktree_clean: frontendClean,
      backend_worktree_clean: backendClean,
    },
    secrets,
  );
  await writeJsonExclusive(
    resolve(artifact, 'status.json'),
    {
      experiment: 'E3',
      phase: 'pilot',
      status: errorCode ? 'FAIL' : 'PASS',
      error_code: errorCode,
      checks,
      scenarios: totals,
      total,
      pilot_started: true,
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
      `${error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'PILOT_FATAL'}\n`,
    );
    process.exitCode = 1;
  });
}
