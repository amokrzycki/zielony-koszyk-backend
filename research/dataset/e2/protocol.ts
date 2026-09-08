import { MfaMethod } from '../../../src/enums/MfaMethod';
import {
  MFA_LOGIN_CHALLENGE_TTL_MS,
  MFA_TOKEN_TTL,
  MFA_TOTP_PERIOD_SECONDS,
} from '../../../src/constants/constants';

export const PROTOCOL_ID = 'E2-VERIFY-v1';
export const APPROVED_PROTOCOL_SHA256 =
  'c6036e672d92c5b01b00335b8a5d52a7002db9fa832320ca4961ffd426473cfd';
export const BASE_BACKEND_COMMIT = 'eae105070960a7957662a411e366889d49f33ddd';
export const BASE_BACKEND_TREE = 'f59ef71053855fc0d3f877a97edfc46b4f68e1d3';
export const FROZEN_FRONTEND_COMMIT =
  'dc4b104e0bd680305fd1f9eaddfe0acf73a4081a';

export const CLIENTS = 50;
export const VERIFY_PER_CLIENT = 1;
export const WARMUP_BURSTS_PER_VARIANT = 1;
export const MEASURED_ROUNDS = 12;
export const MEASURED_BURSTS = 36;
export const MEASURED_SAMPLES_PER_VARIANT = 600;
export const MEASURED_SAMPLES = 1_800;
export const INTER_VARIANT_QUIESCENCE_MS = 10_000;
export const ROUND_COOLDOWN_MS = 65_000;
export const MEMORY_SAMPLE_INTERVAL_MS = 20;
export const MAX_MEMORY_SAMPLE_GAP_MS = 40;
export const MAX_PREPARATION_AGE_MS = 180_000;
export const MIN_PREPARATION_TTL_MS = 120_000;
export const LOGIN_CHALLENGE_TTL_MS = 300_000;
export const TOTP_PERIOD_MS = 30_000;
export const TOTP_GENERATION_PHASE_MIN_MS = 2_000;
export const TOTP_GENERATION_PHASE_MAX_MS = 5_000;
export const TOTP_RELEASE_PHASE_MAX_MS = 10_000;
export const HTTP_CONNECT_TIMEOUT_MS = 5_000;
export const HTTP_RESPONSE_TIMEOUT_MS = 60_000;
export const EXPECTED_HTTP_STATUS = 201;
export const LOGIN_RATE_LIMIT = 5;
export const VERIFY_RATE_LIMIT = 10;
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const MAILPIT_VERSION = '1.31.1';
export const MAILPIT_IMAGE =
  'axllent/mailpit:v1.31.1@sha256:98b916bd3c8d61f7633a52d3ea2f58d00620cb01ca57ab59edde68c347a95365';
export const MAILPIT_MAX_MESSAGES = 1_000;

export const E2_VARIANTS = [
  MfaMethod.EMAIL_OTP,
  MfaMethod.TOTP,
  MfaMethod.WEBAUTHN,
] as const;
export type E2Variant = (typeof E2_VARIANTS)[number];

export const VARIANT_SYMBOL: Record<E2Variant, 'A' | 'B' | 'C'> = {
  [MfaMethod.EMAIL_OTP]: 'A',
  [MfaMethod.TOTP]: 'B',
  [MfaMethod.WEBAUTHN]: 'C',
};

export const VERIFY_ENDPOINT: Record<E2Variant, string> = {
  [MfaMethod.EMAIL_OTP]: '/auth/mfa/email-otp/verify',
  [MfaMethod.TOTP]: '/auth/mfa/totp/verify',
  [MfaMethod.WEBAUTHN]: '/auth/mfa/webauthn/verify',
};

export const MEASURED_SCHEDULE: readonly (readonly E2Variant[])[] = [
  [MfaMethod.EMAIL_OTP, MfaMethod.TOTP, MfaMethod.WEBAUTHN],
  [MfaMethod.TOTP, MfaMethod.WEBAUTHN, MfaMethod.EMAIL_OTP],
  [MfaMethod.WEBAUTHN, MfaMethod.EMAIL_OTP, MfaMethod.TOTP],
  [MfaMethod.EMAIL_OTP, MfaMethod.WEBAUTHN, MfaMethod.TOTP],
  [MfaMethod.WEBAUTHN, MfaMethod.TOTP, MfaMethod.EMAIL_OTP],
  [MfaMethod.TOTP, MfaMethod.EMAIL_OTP, MfaMethod.WEBAUTHN],
  [MfaMethod.EMAIL_OTP, MfaMethod.TOTP, MfaMethod.WEBAUTHN],
  [MfaMethod.TOTP, MfaMethod.WEBAUTHN, MfaMethod.EMAIL_OTP],
  [MfaMethod.WEBAUTHN, MfaMethod.EMAIL_OTP, MfaMethod.TOTP],
  [MfaMethod.EMAIL_OTP, MfaMethod.WEBAUTHN, MfaMethod.TOTP],
  [MfaMethod.WEBAUTHN, MfaMethod.TOTP, MfaMethod.EMAIL_OTP],
  [MfaMethod.TOTP, MfaMethod.EMAIL_OTP, MfaMethod.WEBAUTHN],
] as const;

export const CLIENT_SLOTS = Array.from({ length: CLIENTS }, (_, index) =>
  String(index + 1).padStart(3, '0'),
);

export type HarnessDiagnostic = Readonly<
  Record<string, string | number | boolean>
>;

export class HarnessError extends Error {
  constructor(
    readonly code: string,
    readonly diagnostic?: HarnessDiagnostic,
  ) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(code)) {
      throw new Error('INVALID_SAFE_ERROR_CODE');
    }
    super(code);
    this.name = 'HarnessError';
  }
}

const fail = (code: string): never => {
  throw new HarnessError(code);
};

export const sourceIpForSlot = (slot: string) => {
  if (!CLIENT_SLOTS.includes(slot)) fail('INVALID_CLIENT_SLOT');
  return `127.0.0.${Number(slot) + 1}`;
};

export type PublicClient = {
  client_slot: string;
  variant: E2Variant;
  expected_source_ip: string;
};

export const buildPublicClients = (variant: E2Variant): PublicClient[] =>
  CLIENT_SLOTS.map((client_slot) => ({
    client_slot,
    variant,
    expected_source_ip: sourceIpForSlot(client_slot),
  }));

export const publicClientsCsv = (variant: E2Variant) =>
  [
    'client_slot,variant,expected_source_ip',
    ...buildPublicClients(variant).map((client) =>
      [client.client_slot, client.variant, client.expected_source_ip].join(','),
    ),
    '',
  ].join('\n');

export const assertFrozenProtocol = () => {
  if (
    MFA_LOGIN_CHALLENGE_TTL_MS !== LOGIN_CHALLENGE_TTL_MS ||
    MFA_TOKEN_TTL !== '5m'
  ) {
    fail('PROTOCOL_CHALLENGE_TTL');
  }
  if (MFA_TOTP_PERIOD_SECONDS * 1_000 !== TOTP_PERIOD_MS) {
    fail('PROTOCOL_TOTP_PERIOD');
  }
  if (MEASURED_SCHEDULE.length !== MEASURED_ROUNDS) {
    fail('PROTOCOL_ROUND_COUNT');
  }
  if (
    MEASURED_SCHEDULE.map((round) =>
      round.map((variant) => VARIANT_SYMBOL[variant]).join(''),
    ).join(',') !== 'ABC,BCA,CAB,ACB,CBA,BAC,ABC,BCA,CAB,ACB,CBA,BAC'
  ) {
    fail('PROTOCOL_ROUND_ORDER');
  }
  for (const round of MEASURED_SCHEDULE) {
    if (
      round.length !== E2_VARIANTS.length ||
      new Set(round).size !== E2_VARIANTS.length ||
      E2_VARIANTS.some((variant) => !round.includes(variant))
    ) {
      fail('PROTOCOL_ROUND_CONTENT');
    }
  }
  for (const variant of E2_VARIANTS) {
    for (let position = 0; position < E2_VARIANTS.length; position += 1) {
      if (
        MEASURED_SCHEDULE.filter((round) => round[position] === variant)
          .length !== 4
      ) {
        fail('PROTOCOL_POSITION_BALANCE');
      }
    }
  }
  const transitions = new Map<string, number>();
  for (const round of MEASURED_SCHEDULE) {
    for (let index = 0; index < round.length - 1; index += 1) {
      const key = `${VARIANT_SYMBOL[round[index]]}->${VARIANT_SYMBOL[round[index + 1]]}`;
      transitions.set(key, (transitions.get(key) ?? 0) + 1);
    }
  }
  const expectedTransitions = ['A->B', 'A->C', 'B->A', 'B->C', 'C->A', 'C->B'];
  if (
    transitions.size !== expectedTransitions.length ||
    expectedTransitions.some((transition) => transitions.get(transition) !== 4)
  ) {
    fail('PROTOCOL_TRANSITION_BALANCE');
  }
  if (
    MEASURED_ROUNDS * E2_VARIANTS.length !== MEASURED_BURSTS ||
    MEASURED_ROUNDS * CLIENTS !== MEASURED_SAMPLES_PER_VARIANT ||
    MEASURED_BURSTS * CLIENTS !== MEASURED_SAMPLES
  ) {
    fail('PROTOCOL_SAMPLE_COUNT');
  }
};

assertFrozenProtocol();

export const JTL_FIELDS = [
  'timeStamp',
  'elapsed',
  'label',
  'responseCode',
  'success',
] as const;

export type JtlSample = {
  timeStamp: number;
  elapsed: number;
  label: string;
  responseCode: string;
  success: boolean;
};

export const parseJtl = (text: string): JtlSample[] => {
  const lines = text.trimEnd().split(/\r?\n/);
  if (lines.length === 1 && !lines[0]) fail('JTL_EMPTY');
  if (lines.shift() !== JTL_FIELDS.join(',')) fail('JTL_FIELDS');
  return lines.filter(Boolean).map((line) => {
    const row = line.split(',');
    if (row.length !== JTL_FIELDS.length) fail('JTL_ROW');
    const timeStamp = Number(row[0]);
    const elapsed = Number(row[1]);
    if (
      !Number.isSafeInteger(timeStamp) ||
      timeStamp < 0 ||
      !Number.isFinite(elapsed) ||
      elapsed < 0
    ) {
      fail('JTL_NUMBER');
    }
    if (row[4] !== 'true' && row[4] !== 'false') fail('JTL_SUCCESS');
    return {
      timeStamp,
      elapsed,
      label: row[2],
      responseCode: row[3],
      success: row[4] === 'true',
    };
  });
};

export const validateJtl = (samples: JtlSample[], variant: E2Variant) => {
  if (samples.length !== CLIENTS) fail('JTL_SAMPLE_COUNT');
  const labels = samples.map(({ label }) => label);
  if (new Set(labels).size !== CLIENTS) fail('JTL_DUPLICATE_SLOT');
  const expected = new Set(CLIENT_SLOTS.map((slot) => `${variant}:${slot}`));
  if (labels.some((label) => !expected.delete(label)) || expected.size) {
    fail('JTL_SLOT_SET');
  }
  if (samples.some(({ responseCode }) => responseCode === '429')) {
    fail('JTL_RATE_LIMITED');
  }
  if (
    samples.some(
      ({ responseCode }) => responseCode !== String(EXPECTED_HTTP_STATUS),
    )
  ) {
    fail('JTL_HTTP_STATUS');
  }
  if (samples.some(({ success }) => !success)) fail('JTL_SEMANTIC_FAILURE');
};

export type PreparedLifetime = {
  issuedAtMs: number;
  challengeCreatedAtMs: number;
  tokenExpiresAtMs: number;
  challengeExpiresAtMs: number;
};

export const assertPreparationLifetime = (
  entries: PreparedLifetime[],
  nowMs: number,
) => {
  if (entries.length !== CLIENTS) fail('PREPARATION_COUNT');
  for (const entry of entries) {
    if (
      ![
        entry.issuedAtMs,
        entry.challengeCreatedAtMs,
        entry.tokenExpiresAtMs,
        entry.challengeExpiresAtMs,
      ].every(Number.isFinite) ||
      entry.issuedAtMs > nowMs ||
      entry.challengeCreatedAtMs > nowMs ||
      nowMs - entry.issuedAtMs > MAX_PREPARATION_AGE_MS ||
      nowMs - entry.challengeCreatedAtMs > MAX_PREPARATION_AGE_MS ||
      Math.min(entry.tokenExpiresAtMs, entry.challengeExpiresAtMs) - nowMs <
        MIN_PREPARATION_TTL_MS
    ) {
      fail('PREPARATION_TTL_GUARD');
    }
  }
};

export const totpStep = (epochMs: number) =>
  Math.floor(epochMs / TOTP_PERIOD_MS);
export const totpPhase = (epochMs: number) => epochMs % TOTP_PERIOD_MS;

export const nextTotpGenerationTime = (
  nowMs: number,
  previousSteps: Array<number | null>,
) => {
  const minimumStep = Math.max(
    totpStep(nowMs),
    ...previousSteps.map((step) => (step ?? -1) + 1),
  );
  const currentPhase = totpPhase(nowMs);
  if (
    minimumStep === totpStep(nowMs) &&
    currentPhase <= TOTP_GENERATION_PHASE_MAX_MS
  ) {
    return Math.max(
      nowMs,
      minimumStep * TOTP_PERIOD_MS + TOTP_GENERATION_PHASE_MIN_MS,
    );
  }
  return (
    Math.max(minimumStep, totpStep(nowMs) + 1) * TOTP_PERIOD_MS +
    TOTP_GENERATION_PHASE_MIN_MS
  );
};

export const assertTotpGenerationWindow = (
  nowMs: number,
  previousSteps: Array<number | null>,
) => {
  const phase = totpPhase(nowMs);
  const expectedStep = totpStep(nowMs);
  if (
    phase < TOTP_GENERATION_PHASE_MIN_MS ||
    phase > TOTP_GENERATION_PHASE_MAX_MS ||
    previousSteps.some(
      (previous) => previous !== null && expectedStep <= previous,
    )
  ) {
    fail('TOTP_GENERATION_WINDOW');
  }
  return expectedStep;
};

export const assertTotpReleaseWindow = (
  nowMs: number,
  expectedStep: number,
) => {
  if (
    totpStep(nowMs) !== expectedStep ||
    totpPhase(nowMs) > TOTP_RELEASE_PHASE_MAX_MS
  ) {
    fail('TOTP_RELEASE_WINDOW');
  }
};

export const assertTotpProgression = (
  before: number | null,
  acceptedSteps: number[],
  after: number | null,
  expectedCount: number,
) => {
  if (
    acceptedSteps.length !== expectedCount ||
    after === null ||
    acceptedSteps.at(-1) !== after
  ) {
    fail('TOTP_PROGRESSION');
  }
  let previous = before ?? -1;
  for (const step of acceptedSteps) {
    if (!Number.isSafeInteger(step) || step <= previous) {
      fail('TOTP_PROGRESSION');
    }
    previous = step;
  }
};

export type CounterState = { client_slot: string; count: number };

export const assertWebAuthnCounterProgression = (
  before: CounterState[],
  databaseAfter: CounterState[],
  authenticatorAfter: CounterState[],
  increment: number,
) => {
  if (
    before.length !== CLIENTS ||
    databaseAfter.length !== CLIENTS ||
    authenticatorAfter.length !== CLIENTS
  ) {
    fail('WEBAUTHN_COUNTER_COUNT');
  }
  const database = new Map(
    databaseAfter.map(({ client_slot, count }) => [client_slot, count]),
  );
  const authenticator = new Map(
    authenticatorAfter.map(({ client_slot, count }) => [client_slot, count]),
  );
  if (
    new Set(before.map(({ client_slot }) => client_slot)).size !== CLIENTS ||
    before.some(
      ({ client_slot, count }) =>
        database.get(client_slot) !== count + increment ||
        authenticator.get(client_slot) !== count + increment,
    )
  ) {
    fail('WEBAUTHN_COUNTER_DIVERGENCE');
  }
};

export type BurstPhase =
  | 'PREPARATION'
  | 'READY'
  | 'MONITORING'
  | 'RELEASED'
  | 'RESPONSES_COMPLETE'
  | 'VALIDATING'
  | 'VALID'
  | 'INVALID';

export class BurstStateMachine {
  phase: BurstPhase = 'PREPARATION';
  invalidCode?: string;

  assertPreparationAllowed() {
    if (this.phase !== 'PREPARATION') fail('PREPARATION_AFTER_BASELINE');
  }

  ready(count: number) {
    if (this.phase !== 'PREPARATION' || count !== CLIENTS) {
      fail('BURST_READY_ORDER');
    }
    this.phase = 'READY';
  }

  startMonitor() {
    if (this.phase !== 'READY') fail('MONITOR_START_ORDER');
    this.phase = 'MONITORING';
  }

  release() {
    if (this.phase !== 'MONITORING') fail('RELEASE_ORDER');
    this.phase = 'RELEASED';
  }

  responsesComplete(count: number) {
    if (this.phase !== 'RELEASED' || count !== CLIENTS) {
      fail('SAMPLE_END_ORDER');
    }
    this.phase = 'RESPONSES_COMPLETE';
  }

  beginValidation() {
    if (this.phase !== 'RESPONSES_COMPLETE') fail('VALIDATION_ORDER');
    this.phase = 'VALIDATING';
  }

  complete() {
    if (this.phase !== 'VALIDATING') fail('BURST_COMPLETE_ORDER');
    this.phase = 'VALID';
  }

  invalidate(code: string) {
    if (this.phase === 'VALID' || this.phase === 'INVALID') {
      fail('BURST_TERMINAL');
    }
    if (!/^[A-Z][A-Z0-9_]*$/.test(code)) fail('INVALID_SAFE_ERROR_CODE');
    this.phase = 'INVALID';
    this.invalidCode = code;
  }

  assertCanStartAnotherAttempt() {
    if (this.phase !== 'PREPARATION') fail('BURST_RERUN_FORBIDDEN');
  }
}
