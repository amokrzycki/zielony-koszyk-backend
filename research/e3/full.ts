import { execFile as execFileCallback } from 'node:child_process';
import { chmod, readFile } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';
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
  loadCredentials,
  loadResearchUsers,
  preflight as datasetPreflight,
  researchChallengeCount,
} from '../runtime';
import { runJourney } from './browser';
import {
  RunArtifactInput,
  createArtifactDirectory,
  sealArtifact,
  serializeRun,
  verifyArtifact,
  writeExclusive,
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
  packageVersion,
  serveFrontend,
  startBackendServices,
  stopFrontend,
} from './preflight';
import {
  CHROMIUM_EXECUTABLE,
  E3Error,
  FRONTEND_AFTER_COMMIT,
  InvalidReason,
  MEASURED_BLOCKS,
  ORDER_SEED,
  PROTOCOL_ID,
  SCENARIOS,
  Scenario,
  ThrottleScheduler,
  WEBAUTHN_CHECKPOINT_PATH,
  classifyRun,
  frozenBackendCommit,
  generateMeasuredOrder,
  protocolSha256,
  sha256,
} from './protocol';

const execFile = promisify(execFileCallback);

type ArtifactStatus = {
  status: string;
  checks?: Array<{ status: string }>;
  total?: { total: number; valid: number; invalid: number };
};

type ApprovedArtifact = {
  root: string;
  protocol: Record<string, unknown>;
  environment: Record<string, unknown>;
  status: ArtifactStatus;
};

type ScenarioPlan = {
  variant: MfaMethod;
  slots: readonly string[];
  image: string;
};

const slots = (first: number) =>
  Array.from({ length: MEASURED_BLOCKS }, (_, index) =>
    String(first + index).padStart(3, '0'),
  );

export const MEASURED_PLAN: Record<Scenario, ScenarioPlan> = {
  S0_BEFORE_MFA: {
    variant: MfaMethod.NONE,
    slots: slots(7),
    image: BEFORE_IMAGE,
  },
  S1_NONE: {
    variant: MfaMethod.NONE,
    slots: slots(28),
    image: AFTER_IMAGE,
  },
  S2_EMAIL_OTP: {
    variant: MfaMethod.EMAIL_OTP,
    slots: slots(4),
    image: AFTER_IMAGE,
  },
  S3_TOTP: {
    variant: MfaMethod.TOTP,
    slots: slots(4),
    image: AFTER_IMAGE,
  },
  S4_WEBAUTHN: {
    variant: MfaMethod.WEBAUTHN,
    slots: slots(4),
    image: AFTER_IMAGE,
  },
};

const assertValue = (
  condition: unknown,
  code:
    | InvalidReason
    | 'PREFLIGHT_REQUIRED'
    | 'PILOT_REQUIRED' = 'ENVIRONMENT_MISMATCH',
) => {
  if (!condition) throw new Error(code);
};

const loadApprovedArtifact = async (
  path: string,
  phase: 'preflight' | 'pilot',
): Promise<ApprovedArtifact> => {
  const root = resolve(path);
  assertValue(root.startsWith(`${RESULTS_ROOT}${sep}`));
  assertValue(
    new RegExp(`^e3-${phase}-`).test(basename(root)),
    phase === 'preflight' ? 'PREFLIGHT_REQUIRED' : 'PILOT_REQUIRED',
  );
  await verifyArtifact(root);
  const [status, protocol, environment] = await Promise.all([
    readJson<ArtifactStatus>(resolve(root, 'status.json')),
    readJson<Record<string, unknown>>(resolve(root, 'protocol.json')),
    readJson<Record<string, unknown>>(resolve(root, 'environment.json')),
  ]);
  assertValue(
    status.status === 'PASS',
    phase === 'preflight' ? 'PREFLIGHT_REQUIRED' : 'PILOT_REQUIRED',
  );
  if (phase === 'preflight') {
    assertValue(
      status.checks?.length === 26 &&
        status.checks.every(({ status: value }) => value === 'PASS'),
      'PREFLIGHT_REQUIRED',
    );
  } else {
    assertValue(
      status.total?.total === 15 &&
        status.total.valid === 15 &&
        status.total.invalid === 0,
      'PILOT_REQUIRED',
    );
  }
  return { root, protocol, environment, status };
};

const chromiumVersion = async () =>
  (await execFile(CHROMIUM_EXECUTABLE, ['--version'])).stdout.trim();

const currentVersions = async () => ({
  chromium_version: await chromiumVersion(),
  playwright_version: await packageVersion('playwright'),
  web_vitals_version: await packageVersion('web-vitals'),
  node_version: process.version,
});

const assertVersions = (
  expected: Record<string, unknown>,
  actual: Awaited<ReturnType<typeof currentVersions>>,
) => {
  for (const [key, value] of Object.entries(actual)) {
    assertValue(expected[key] === value);
  }
};

const stateSnapshot = async (
  source: Awaited<ReturnType<typeof datasetPreflight>>['source'],
  users: Awaited<ReturnType<typeof loadResearchUsers>>,
) => {
  const selected = users.filter((user) =>
    SCENARIOS.some((scenario) => {
      const plan = MEASURED_PLAN[scenario];
      return (
        user.variant === plan.variant && plan.slots.includes(user.client_slot)
      );
    }),
  );
  const credentials = await loadCredentials(
    source,
    selected.map(({ user_id }) => user_id),
  );
  const credentialCounts = new Map<string, number>();
  const signCountTotals = new Map<string, number>();
  for (const credential of credentials) {
    credentialCounts.set(
      credential.user_id,
      (credentialCounts.get(credential.user_id) ?? 0) + 1,
    );
    signCountTotals.set(
      credential.user_id,
      (signCountTotals.get(credential.user_id) ?? 0) + credential.sign_count,
    );
  }
  return {
    captured_at: new Date().toISOString(),
    accounts: selected.map((user) => ({
      account_slot: user.identifier,
      mfa_method: user.mfa_method,
      totp_last_used_step: user.totp_last_used_step,
      webauthn_credential_count: credentialCounts.get(user.user_id) ?? 0,
      webauthn_sign_count_total: signCountTotals.get(user.user_id) ?? 0,
    })),
    active_mfa_challenges: await researchChallengeCount(
      source,
      selected.map(({ user_id }) => user_id),
    ),
  };
};

const csvCell = (value: unknown) => {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const runIndex = (runs: ReturnType<typeof serializeRun>[]) => {
  const columns = [
    'run_id',
    'block',
    'position_in_block',
    'scenario',
    'frontend_variant',
    'account_slot',
    'navigation_start_ts',
    'lcp_ms',
    'lcp_element_selector',
    'inp_ms',
    'inp_interaction_target',
    'cls_value',
    'cls_boundary_ts',
    'measured_window_end_ts',
    'valid',
    'invalid_reason',
    'chromium_pid_started_fresh',
    'duration_total_ms',
    'external_resources',
  ] as const;
  return `${[
    columns.join(','),
    ...runs.map((run) =>
      columns.map((column) => csvCell(run[column])).join(','),
    ),
  ].join('\n')}\n`;
};

const scenarioTotals = () =>
  Object.fromEntries(
    SCENARIOS.map((scenario) => [
      scenario,
      { planned: MEASURED_BLOCKS, valid: 0, invalid: 0, status: 'PENDING' },
    ]),
  ) as Record<
    Scenario,
    { planned: number; valid: number; invalid: number; status: string }
  >;

const main = async () => {
  const [preflightPath, pilotPath] = process.argv.slice(2);
  assertValue(preflightPath, 'PREFLIGHT_REQUIRED');
  assertValue(pilotPath, 'PILOT_REQUIRED');
  const [preflight, pilot, protocolText] = await Promise.all([
    loadApprovedArtifact(preflightPath, 'preflight'),
    loadApprovedArtifact(pilotPath, 'pilot'),
    readFile(PROTOCOL_PATH, 'utf8'),
  ]);
  const protocolHash = await protocolSha256(PROTOCOL_PATH);
  const [frontendCommit, backendCommit, frontendClean, backendClean, versions] =
    await Promise.all([
      gitRevision(FRONTEND_ROOT),
      gitRevision(BACKEND_ROOT),
      gitClean(FRONTEND_ROOT),
      gitClean(BACKEND_ROOT),
      currentVersions(),
    ]);
  assertValue(frontendCommit === FRONTEND_AFTER_COMMIT);
  assertValue(backendCommit === frozenBackendCommit(protocolText));
  assertValue(frontendClean && backendClean);
  assertValue(preflight.protocol.protocol_sha256 === protocolHash);
  assertValue(pilot.protocol.protocol_sha256 === protocolHash);
  assertValue(
    pilot.environment.linked_preflight_artifact === basename(preflight.root),
  );
  assertVersions(preflight.environment, versions);

  let artifact: string | undefined;
  let source:
    | Awaited<ReturnType<typeof datasetPreflight>>['source']
    | undefined;
  let campaignUsers: Awaited<ReturnType<typeof loadResearchUsers>> | undefined;
  let afterState: Awaited<ReturnType<typeof stateSnapshot>> | undefined;
  let servedImage: string | undefined;
  const scheduler = new ThrottleScheduler();
  const totals = scenarioTotals();
  const runs: ReturnType<typeof serializeRun>[] = [];
  const occurrences = Object.fromEntries(
    SCENARIOS.map((scenario) => [scenario, 0]),
  ) as Record<Scenario, number>;
  let fatalError: string | null = null;
  const startedAt = new Date().toISOString();
  const secrets = await exactSecrets();
  const registerSecret = (value: string) => secrets.push(value);

  try {
    await startBackendServices();
    await serveFrontend(BEFORE_IMAGE);
    servedImage = BEFORE_IMAGE;
    const dataset = await datasetPreflight(WEBAUTHN_CHECKPOINT_PATH);
    source = dataset.source;
    const users = await loadResearchUsers(dataset.source, dataset.expected);
    campaignUsers = users;
    const [totpSecrets, webauthnSnapshot] = await Promise.all([
      readJson<TotpSecretStore>(TOTP_SECRETS_PATH),
      readJson<WebAuthnSnapshot>(WEBAUTHN_CHECKPOINT_PATH),
    ]);
    const password = process.env.MFA_RESEARCH_PASSWORD;
    assertValue(password);

    const order = generateMeasuredOrder();
    assertValue(order.length === MEASURED_BLOCKS * SCENARIOS.length);
    for (let block = 0; block < MEASURED_BLOCKS; block += 1) {
      const blockEntries = order.filter((entry) => entry.block === block);
      assertValue(blockEntries.length === SCENARIOS.length);
      assertValue(
        new Set(blockEntries.map(({ scenario }) => scenario)).size ===
          SCENARIOS.length,
      );
    }

    const timestamp = startedAt.replace(/[:.]/g, '-');
    artifact = await createArtifactDirectory(
      RESULTS_ROOT,
      `e3-full-${timestamp}-${frontendCommit.slice(0, 8)}-${backendCommit.slice(0, 8)}`,
    );
    await writeJsonExclusive(
      resolve(artifact, 'environment.json'),
      {
        ...preflight.environment,
        linked_preflight_artifact: basename(preflight.root),
        linked_pilot_artifact: basename(pilot.root),
        measured_started_at: startedAt,
        frontend_worktree_clean: frontendClean,
        backend_worktree_clean: backendClean,
      },
      secrets,
    );
    await writeJsonExclusive(
      resolve(artifact, 'state-before.json'),
      await stateSnapshot(dataset.source, users),
      secrets,
    );
    const orderPath = resolve(artifact, 'order-manifest.json');
    await writeJsonExclusive(orderPath, order, secrets);
    const orderHash = sha256(await readFile(orderPath));
    await writeJsonExclusive(
      resolve(artifact, 'protocol.json'),
      { ...preflight.protocol, order_manifest_sha256: orderHash },
      secrets,
    );
    await Promise.all([
      chmod(orderPath, 0o444),
      chmod(resolve(artifact, 'protocol.json'), 0o444),
    ]);

    const assertFrozen = async () => {
      const [currentFrontend, currentBackend, cleanFrontend, cleanBackend] =
        await Promise.all([
          gitRevision(FRONTEND_ROOT),
          gitRevision(BACKEND_ROOT),
          gitClean(FRONTEND_ROOT),
          gitClean(BACKEND_ROOT),
        ]);
      assertValue(currentFrontend === frontendCommit);
      assertValue(currentBackend === backendCommit);
      assertValue(cleanFrontend && cleanBackend);
      assertValue((await protocolSha256(PROTOCOL_PATH)) === protocolHash);
      assertValue(
        sha256(await readFile(orderPath)) === orderHash,
        'FROZEN_ORDER_VIOLATION',
      );
      assertVersions(preflight.environment, await currentVersions());
    };

    for (const entry of order) {
      await assertFrozen();
      const plan = MEASURED_PLAN[entry.scenario];
      if (plan.image !== servedImage) {
        await serveFrontend(plan.image);
        servedImage = plan.image;
      }
      const occurrence = occurrences[entry.scenario];
      const slot = plan.slots[occurrence];
      const account = users.find(
        (candidate) =>
          candidate.variant === plan.variant && candidate.client_slot === slot,
      );
      assertValue(account);
      let result: Awaited<ReturnType<typeof runJourney>> | undefined;
      let failure: unknown;
      try {
        result = await runJourney({
          scenario: entry.scenario,
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
      const now = new Date().toISOString();
      const run = serializeRun({
        run_id: `e3-measured-${String(entry.block).padStart(2, '0')}-${String(entry.position_in_block).padStart(2, '0')}-${entry.scenario}`,
        block: entry.block,
        position_in_block: entry.position_in_block,
        scenario: entry.scenario,
        frontend_variant:
          entry.scenario === 'S0_BEFORE_MFA' ? 'before' : 'after',
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
        chromium_pid_started_fresh: result?.chromium_pid_started_fresh ?? false,
        duration_total_ms: result?.duration_total_ms ?? 0,
        external_resources: result?.external_resources ?? [],
      } satisfies RunArtifactInput);
      await writeJsonExclusive(
        resolve(
          artifact,
          'measured',
          'rounds',
          `round-${String(entry.block).padStart(2, '0')}`,
          `${entry.scenario}.json`,
        ),
        run,
        secrets,
      );
      runs.push(run);
      occurrences[entry.scenario] += 1;
      totals[entry.scenario][classification.valid ? 'valid' : 'invalid'] += 1;
      process.stdout.write(
        `${JSON.stringify({ completed: runs.length, total: order.length, scenario: entry.scenario, valid: classification.valid, invalid_reason: invalidReason })}\n`,
      );
    }
    await assertFrozen();
    assertVersions(preflight.environment, await currentVersions());
    afterState = await stateSnapshot(
      dataset.source,
      await loadResearchUsers(dataset.source, users),
    );
  } catch (error) {
    fatalError =
      error instanceof E3Error
        ? error.code
        : error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
          ? error.message
          : 'ENVIRONMENT_MISMATCH';
  } finally {
    await stopFrontend().catch(() => undefined);
  }

  if (!artifact || !source || !campaignUsers) {
    await disconnectDatabase().catch(() => undefined);
    throw new Error(fatalError ?? 'ENVIRONMENT_MISMATCH');
  }

  for (const scenario of SCENARIOS) {
    totals[scenario].status =
      totals[scenario].invalid >= 3 ||
      totals[scenario].valid + totals[scenario].invalid !== MEASURED_BLOCKS
        ? 'INVALID'
        : 'ANALYZABLE';
  }
  const completed = runs.length;
  const valid = Object.values(totals).reduce(
    (sum, scenario) => sum + scenario.valid,
    0,
  );
  const invalid = Object.values(totals).reduce(
    (sum, scenario) => sum + scenario.invalid,
    0,
  );
  const status =
    !fatalError &&
    completed === MEASURED_BLOCKS * SCENARIOS.length &&
    Object.values(totals).every(({ status: value }) => value === 'ANALYZABLE')
      ? 'PASS'
      : 'FAIL';
  await writeExclusive(
    resolve(artifact, 'measured', 'index.csv'),
    runIndex(runs),
    secrets,
  );
  await writeJsonExclusive(
    resolve(artifact, 'state-after.json'),
    afterState ?? {
      captured_at: new Date().toISOString(),
      capture_error: fatalError ?? 'ENVIRONMENT_MISMATCH',
    },
    secrets,
  );
  await disconnectDatabase().catch(() => undefined);
  const [frontendCleanAfter, backendCleanAfter] = await Promise.all([
    gitClean(FRONTEND_ROOT),
    gitClean(BACKEND_ROOT),
  ]);
  await writeJsonExclusive(
    resolve(artifact, 'status.json'),
    {
      experiment: PROTOCOL_ID,
      phase: 'measured',
      status,
      error_code: fatalError,
      scenarios: totals,
      total: {
        planned: MEASURED_BLOCKS * SCENARIOS.length,
        completed,
        valid,
        invalid,
      },
      order_seed: ORDER_SEED,
      balanced_blocks: MEASURED_BLOCKS,
      measured_started: true,
      measured_completed: completed === MEASURED_BLOCKS * SCENARIOS.length,
      selective_reruns: 0,
      harness_changed_during_campaign: false,
      frontend_worktree_clean: frontendCleanAfter,
      backend_worktree_clean: backendCleanAfter,
      measured_completed_at: new Date().toISOString(),
    },
    secrets,
  );
  const manifestHash = await sealArtifact(artifact, secrets);
  assertValue((await verifyArtifact(artifact)) === manifestHash);
  process.stdout.write(
    `${JSON.stringify({ artifact, manifest_sha256: manifestHash, status, completed, valid, invalid })}\n`,
  );
  if (status !== 'PASS') process.exitCode = 1;
};

if (require.main === module) {
  void main().catch(async (error) => {
    await stopFrontend().catch(() => undefined);
    await disconnectDatabase().catch(() => undefined);
    process.stderr.write(
      `${error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'E3_FULL_FATAL'}\n`,
    );
    process.exitCode = 1;
  });
}
