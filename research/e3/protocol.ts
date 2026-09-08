import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const PROTOCOL_ID = 'E3';
export const FRONTEND_BEFORE_COMMIT =
  'd927c26de5b1d1dc9f0857c3da843e484a2ce841';
export const FRONTEND_AFTER_COMMIT = 'dc4b104e0bd680305fd1f9eaddfe0acf73a4081a';
export const CHROMIUM_EXECUTABLE = '/usr/bin/chromium';
export const FRONTEND_URL = 'http://localhost:5173';
export const BACKEND_URL = 'http://localhost:3000';
export const WEBAUTHN_RP_ID = 'localhost';
export const WEBAUTHN_CHECKPOINT_PATH = resolve(
  __dirname,
  '../snapshots/e2-webauthn-current.json',
);
export const VIEWPORT = { width: 1920, height: 1080 } as const;
export const DEVICE_SCALE_FACTOR = 1;
export const LOCALE = 'pl-PL';
export const TIMEZONE = 'Europe/Warsaw';
export const THROTTLE_WINDOW_MS = 61_000;
export const THROTTLE_LIMIT = 5;
export const TOTP_PERIOD_MS = 30_000;
export const TOTP_MIN_REMAINING_MS = 20_000;
export const STEP_TIMEOUT_MS = 15_000;
export const RUN_TIMEOUT_MS = 30_000;
export const MAILPIT_TIMEOUT_MS = 10_000;
export const ORDER_SEED = 20_260_908;
export const MEASURED_BLOCKS = 21;

export const BROWSER_FLAGS = [
  '--headless=new',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-sync',
  '--disable-translate',
  '--metrics-recording-only',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
] as const;

export const SCENARIOS = [
  'S0_BEFORE_MFA',
  'S1_NONE',
  'S2_EMAIL_OTP',
  'S3_TOTP',
  'S4_WEBAUTHN',
] as const;
export type Scenario = (typeof SCENARIOS)[number];

export const THROTTLED_ENDPOINT = {
  login: 'POST /auth/login',
  emailOtp: 'POST /auth/mfa/email-otp/verify',
  totp: 'POST /auth/mfa/totp/verify',
  webauthn: 'POST /auth/mfa/webauthn/verify',
} as const;

export type OrderEntry = {
  block: number;
  position_in_block: number;
  scenario: Scenario;
};

export const mulberry32 = (initialSeed: number) => {
  let seed = initialSeed;
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

export const fisherYates = <T>(values: readonly T[], random: () => number) => {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const replacement = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[replacement]] = [
      shuffled[replacement],
      shuffled[index],
    ];
  }
  return shuffled;
};

export const generateMeasuredOrder = (): OrderEntry[] =>
  Array.from({ length: MEASURED_BLOCKS }, (_, block) =>
    fisherYates(SCENARIOS, mulberry32(ORDER_SEED + block)).map(
      (scenario, position_in_block) => ({
        block,
        position_in_block,
        scenario,
      }),
    ),
  ).flat();

export const nearestRank = (values: readonly number[], quantile: number) => {
  if (!values.length || quantile <= 0 || quantile > 1) {
    throw new Error('NEAREST_RANK_INPUT');
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(quantile * sorted.length) - 1];
};

export const totpRemainingMs = (nowMs: number) => {
  const elapsed = ((nowMs % TOTP_PERIOD_MS) + TOTP_PERIOD_MS) % TOTP_PERIOD_MS;
  return TOTP_PERIOD_MS - elapsed;
};

export const totpWaitMs = (nowMs: number) => {
  const remaining = totpRemainingMs(nowMs);
  return remaining >= TOTP_MIN_REMAINING_MS ? 0 : remaining;
};

export const guardTotpStep = async (
  now: () => number = Date.now,
  sleep: (milliseconds: number) => Promise<unknown> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
) => {
  const wait = totpWaitMs(now());
  if (wait) await sleep(wait);
  return wait;
};

export class ThrottleScheduler {
  private readonly windows = new Map<string, number[]>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly sleep: (milliseconds: number) => Promise<unknown> = (
      milliseconds,
    ) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  async reserve(endpoint: string): Promise<void> {
    const now = this.now();
    const timestamps = (this.windows.get(endpoint) ?? []).filter(
      (timestamp) => timestamp + THROTTLE_WINDOW_MS > now,
    );
    if (timestamps.length >= THROTTLE_LIMIT) {
      await this.sleep(timestamps[0] + THROTTLE_WINDOW_MS - now);
      return this.reserve(endpoint);
    }
    timestamps.push(this.now());
    this.windows.set(endpoint, timestamps);
  }

  async clearWindow(endpoint?: string) {
    const timestamps = endpoint
      ? (this.windows.get(endpoint) ?? [])
      : [...this.windows.values()].flat();
    if (timestamps.length) {
      const wait = Math.max(...timestamps) + THROTTLE_WINDOW_MS - this.now();
      if (wait > 0) await this.sleep(wait);
    }
    if (endpoint) this.windows.delete(endpoint);
    else this.windows.clear();
  }
}

export const INVALID_REASONS = [
  'CHROMIUM_CRASH',
  'NAVIGATION_FAILURE',
  'UNEXPECTED_ROUTE',
  'INTERACTION_FAILURE',
  'MISSING_INP',
  'MISSING_LCP',
  'RENDER_GATE_FAILURE',
  'CRITICAL_IMAGE_FAILURE',
  'LOGIN_FAILURE',
  'MFA_FAILURE',
  'STEP_TIMEOUT',
  'RUN_TIMEOUT',
  'HTTP_429',
  'MAILPIT_FAILURE',
  'TOTP_FAILURE',
  'UNEXPECTED_FRONTEND_STATE',
  'ENVIRONMENT_MISMATCH',
  'GOOGLE_FONTS_FAILURE',
  'FROZEN_ORDER_VIOLATION',
  'PROTOCOL_HASH_MISMATCH',
  'SECRET_LEAK',
] as const;
export type InvalidReason = (typeof INVALID_REASONS)[number];

export class E3Error extends Error {
  constructor(readonly code: InvalidReason) {
    super(code);
  }
}

export const classifyRun = (input: {
  error?: unknown;
  lcp_ms?: number | null;
  inp_ms?: number | null;
}) => {
  if (input.error instanceof E3Error) {
    return { valid: false as const, invalid_reason: input.error.code };
  }
  if (input.error) {
    return {
      valid: false as const,
      invalid_reason: 'INTERACTION_FAILURE' as const,
    };
  }
  if (input.lcp_ms === null || input.lcp_ms === undefined) {
    return { valid: false as const, invalid_reason: 'MISSING_LCP' as const };
  }
  if (input.inp_ms === null || input.inp_ms === undefined) {
    return { valid: false as const, invalid_reason: 'MISSING_INP' as const };
  }
  return { valid: true as const, invalid_reason: null };
};

export const sha256 = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');

export const protocolSha256 = async (path: string) =>
  sha256(await readFile(path));

export const frozenBackendCommit = (protocol: string) => {
  const match = protocol.match(
    /\| Backend commit \| `([0-9a-f]{40})` \| Working tree backend:/,
  );
  if (!match) throw new E3Error('PROTOCOL_HASH_MISMATCH');
  return match[1];
};
