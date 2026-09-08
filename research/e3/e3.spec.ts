import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  FRONTEND_AFTER_COMMIT,
  E3Error,
  MEASURED_BLOCKS,
  SCENARIOS,
  THROTTLE_WINDOW_MS,
  ThrottleScheduler,
  WEBAUTHN_CHECKPOINT_PATH,
  classifyRun,
  fisherYates,
  frozenBackendCommit,
  generateMeasuredOrder,
  guardTotpStep,
  mulberry32,
  nearestRank,
  protocolSha256,
  sha256,
  totpRemainingMs,
  totpWaitMs,
} from './protocol';
import {
  assertSecretSafe,
  sealArtifact,
  serializeRun,
  verifyArtifact,
  writeJsonExclusive,
} from './artifacts';
import { PILOT_PLAN } from './pilot';
import { mergeExternalResources } from './browser';

describe('E3 frozen algorithms', () => {
  it('plans exactly three pilot runs for every frozen scenario', () => {
    expect(PILOT_PLAN.map(({ scenario }) => scenario)).toEqual(SCENARIOS);
    expect(PILOT_PLAN.flatMap(({ slots }) => slots)).toHaveLength(15);
    expect(PILOT_PLAN.every(({ slots }) => slots.length === 3)).toBe(true);
  });

  it('generates the exact deterministic balanced 21-block order', () => {
    expect(mulberry32(20_260_908)()).toBeCloseTo(0.5866398327052593, 15);
    expect(fisherYates(SCENARIOS, mulberry32(20_260_908))).toEqual([
      'S0_BEFORE_MFA',
      'S3_TOTP',
      'S1_NONE',
      'S4_WEBAUTHN',
      'S2_EMAIL_OTP',
    ]);
    const first = generateMeasuredOrder();
    expect(generateMeasuredOrder()).toEqual(first);
    expect(first).toHaveLength(MEASURED_BLOCKS * SCENARIOS.length);
    for (let block = 0; block < MEASURED_BLOCKS; block += 1) {
      const entries = first.filter((entry) => entry.block === block);
      expect(entries.map(({ position_in_block }) => position_in_block)).toEqual(
        [0, 1, 2, 3, 4],
      );
      expect(new Set(entries.map(({ scenario }) => scenario))).toEqual(
        new Set(SCENARIOS),
      );
    }
  });

  it('uses nearest-rank without interpolation', () => {
    expect(
      nearestRank(
        Array.from({ length: 21 }, (_, index) => index + 1),
        0.75,
      ),
    ).toBe(16);
    expect(nearestRank([4, 1, 2, 3], 0.5)).toBe(2);
    expect(() => nearestRank([], 0.75)).toThrow('NEAREST_RANK_INPUT');
  });
});

describe('E3 preparation guards', () => {
  it('uses the canonical post-E2 WebAuthn checkpoint', () => {
    expect(WEBAUTHN_CHECKPOINT_PATH).toMatch(
      /research\/snapshots\/e2-webauthn-current\.json$/,
    );
  });

  it('paces each throttled endpoint in an independent rolling window', async () => {
    let now = 1_000;
    const waits: number[] = [];
    const scheduler = new ThrottleScheduler(
      () => now,
      (milliseconds) => {
        waits.push(milliseconds);
        now += milliseconds;
        return Promise.resolve();
      },
    );
    for (let index = 0; index < 5; index += 1) await scheduler.reserve('login');
    await scheduler.reserve('verify');
    expect(waits).toEqual([]);
    await scheduler.reserve('login');
    expect(waits).toEqual([THROTTLE_WINDOW_MS]);
    await scheduler.clearWindow('verify');
    expect(waits).toEqual([THROTTLE_WINDOW_MS]);
  });

  it('waits before navigation only when less than 20 seconds remain', async () => {
    expect(totpRemainingMs(30_000)).toBe(30_000);
    expect(totpWaitMs(39_999)).toBe(0);
    expect(totpWaitMs(40_001)).toBe(19_999);
    let now = 40_001;
    const waited = await guardTotpStep(
      () => now,
      (milliseconds) => {
        now += milliseconds;
        return Promise.resolve();
      },
    );
    expect(waited).toBe(19_999);
    expect(totpRemainingMs(now)).toBe(30_000);
  });
});

describe('E3 validation and immutable artifacts', () => {
  it('uses network events even without cross-origin resource timing', () => {
    expect(
      mergeExternalResources(
        new Map([
          [
            'https://fonts.gstatic.com/font.woff2',
            { initiator_type: 'font', success: true },
          ],
        ]),
        [],
      ),
    ).toEqual([
      {
        origin: 'https://fonts.gstatic.com',
        host: 'fonts.gstatic.com',
        initiator_type: 'font',
        duration: null,
        transfer_size: null,
        success: true,
      },
    ]);
  });

  it('maps missing metrics and preserves explicit invalid reasons', () => {
    expect(classifyRun({ lcp_ms: null, inp_ms: 12 })).toEqual({
      valid: false,
      invalid_reason: 'MISSING_LCP',
    });
    expect(classifyRun({ lcp_ms: 123, inp_ms: null })).toEqual({
      valid: false,
      invalid_reason: 'MISSING_INP',
    });
    expect(classifyRun({ lcp_ms: 123, inp_ms: 12 })).toEqual({
      valid: true,
      invalid_reason: null,
    });
    expect(classifyRun({ error: new E3Error('HTTP_429') })).toEqual({
      valid: false,
      invalid_reason: 'HTTP_429',
    });
  });

  it('serializes only the run allowlist and rejects secrets', () => {
    const output = serializeRun({
      run_id: 'run-1',
      block: 0,
      position_in_block: 0,
      scenario: 'S1_NONE',
      frontend_variant: 'after',
      account_slot: 'bench-none-001',
      navigation_start_ts: new Date(0).toISOString(),
      lcp_ms: 1,
      lcp_element_selector: 'img',
      inp_ms: 2,
      inp_interaction_target: 'login-submit',
      cls_value: 0,
      cls_boundary_ts: 3,
      measured_window_end_ts: new Date(1).toISOString(),
      valid: true,
      invalid_reason: null,
      chromium_pid_started_fresh: true,
      duration_total_ms: 4,
      external_resources: [],
      password: 'must-not-survive',
    });
    expect(output).not.toHaveProperty('password');
    expect(() => assertSecretSafe('{"password":"secret"}')).toThrow(
      'SECRET_LEAK',
    );
    expect(() => assertSecretSafe('safe', ['secret'])).not.toThrow();
    expect(() => assertSecretSafe('contains secret', ['secret'])).toThrow(
      'SECRET_LEAK',
    );
  });

  it('hashes the accepted protocol and seals checksums immutably', async () => {
    const root = await mkdtemp(join(tmpdir(), 'e3-artifact-test-'));
    try {
      await writeJsonExclusive(resolve(root, 'status.json'), {
        status: 'PASS',
      });
      const manifestHash = await sealArtifact(root);
      expect(await verifyArtifact(root)).toBe(manifestHash);
    } finally {
      await chmod(root, 0o700).catch(() => undefined);
      await Promise.all(
        ['status.json', 'SHA256SUMS'].map((name) =>
          chmod(resolve(root, name), 0o600).catch(() => undefined),
        ),
      );
      await rm(root, { recursive: true, force: true });
    }
    const protocolPath = resolve(__dirname, '../../../E3.md');
    const protocol = await readFile(protocolPath, 'utf8');
    expect(await protocolSha256(protocolPath)).toBe(sha256(protocol));
    expect(frozenBackendCommit(protocol)).toMatch(/^[0-9a-f]{40}$/);
    expect(() => frozenBackendCommit('not a protocol')).toThrow(
      'PROTOCOL_HASH_MISMATCH',
    );
    expect(FRONTEND_AFTER_COMMIT).toHaveLength(40);
  });
});
