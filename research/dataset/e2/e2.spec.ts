import { createHmac } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { chmod, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MfaMethod } from '../../../src/enums/MfaMethod';
import type { WebAuthnSnapshot } from '../../dataset';
import {
  APPROVED_PROTOCOL_SHA256,
  BurstStateMachine,
  CLIENTS,
  CLIENT_SLOTS,
  E2_VARIANTS,
  HarnessError,
  JTL_FIELDS,
  MEASURED_BURSTS,
  MEASURED_SAMPLES,
  MEASURED_SAMPLES_PER_VARIANT,
  MEASURED_SCHEDULE,
  assertFrozenProtocol,
  assertPreparationLifetime,
  assertTotpGenerationWindow,
  assertTotpProgression,
  assertTotpReleaseWindow,
  assertWebAuthnCounterProgression,
  buildPublicClients,
  nextTotpGenerationTime,
  parseJtl,
  sourceIpForSlot,
  validateJtl,
} from './protocol';
import { InMemoryRequestBroker, RequestPackage } from './broker';
import {
  CgroupMonitor,
  calculateResourceMetrics,
  parseCpuUsageUsec,
  parseMemoryCurrent,
} from './monitor';
import {
  SecretRegistry,
  scanTextForSecrets,
  validatePendingLogin,
  validateSemanticResponse,
} from './security';
import {
  atomicWrite,
  burstPath,
  createExclusiveDirectory,
  createTopLevelArtifact,
  scanArtifacts,
  sealDirectory,
  verifySha256Manifest,
} from './artifacts';
import {
  analyzeBursts,
  describe as describeSamples,
  exactPairedSignTest,
  holmStepDown,
  quantileHf7,
  sampleStandardDeviation,
} from './analysis';
import { parseCliArguments } from './runner';
import { assertWebAuthnInitialState, generateAssertions } from './webauthn';
import { assertMailpitContainerInspect } from './preparation';

const jtl = (
  variant: (typeof E2_VARIANTS)[number],
  change: (row: string[], index: number) => void = () => undefined,
) =>
  [
    JTL_FIELDS.join(','),
    ...CLIENT_SLOTS.map((slot, index) => {
      const row = [
        String(1_800_000_000_000 + index),
        String(10 + index),
        `${variant}:${slot}`,
        '201',
        'true',
      ];
      change(row, index);
      return row.join(',');
    }),
    '',
  ].join('\n');

const jwt = (payload: Record<string, unknown>, secret: string) => {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
};

const makeWritable = async (path: string) => {
  await chmod(path, 0o700).catch(() => undefined);
  let entries: Dirent[];
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) await makeWritable(child);
    else await chmod(child, 0o600).catch(() => undefined);
  }
};

describe('E2 frozen protocol', () => {
  it('uses the exact schedule, position balance, transitions and sample counts', () => {
    expect(assertFrozenProtocol).not.toThrow();
    expect(
      MEASURED_SCHEDULE.map((round) =>
        round
          .map(
            (variant) =>
              ({ EMAIL_OTP: 'A', TOTP: 'B', WEBAUTHN: 'C' })[variant],
          )
          .join(''),
      ).join(','),
    ).toBe('ABC,BCA,CAB,ACB,CBA,BAC,ABC,BCA,CAB,ACB,CBA,BAC');
    expect(MEASURED_SCHEDULE).toHaveLength(12);
    for (const round of MEASURED_SCHEDULE) {
      expect(round).toHaveLength(3);
      expect(new Set(round)).toEqual(new Set(E2_VARIANTS));
    }
    for (const variant of E2_VARIANTS) {
      for (let position = 0; position < 3; position += 1) {
        expect(
          MEASURED_SCHEDULE.filter((round) => round[position] === variant),
        ).toHaveLength(4);
      }
    }
    const transitions = MEASURED_SCHEDULE.flatMap((round) => [
      `${round[0]}->${round[1]}`,
      `${round[1]}->${round[2]}`,
    ]);
    for (const from of E2_VARIANTS) {
      for (const to of E2_VARIANTS.filter((variant) => variant !== from)) {
        expect(
          transitions.filter((value) => value === `${from}->${to}`),
        ).toHaveLength(4);
      }
    }
    expect(MEASURED_SCHEDULE.length * E2_VARIANTS.length).toBe(MEASURED_BURSTS);
    expect(MEASURED_SCHEDULE.length * CLIENTS).toBe(
      MEASURED_SAMPLES_PER_VARIANT,
    );
    expect(MEASURED_BURSTS * CLIENTS).toBe(MEASURED_SAMPLES);
  });

  it('maps slots 001-050 onto 50 unique loopback source IPs', () => {
    const clients = buildPublicClients(MfaMethod.TOTP);
    expect(clients).toHaveLength(50);
    expect(clients[0]).toMatchObject({
      client_slot: '001',
      expected_source_ip: '127.0.0.2',
    });
    expect(clients[49]).toMatchObject({
      client_slot: '050',
      expected_source_ip: '127.0.0.51',
    });
    expect(
      new Set(clients.map(({ expected_source_ip }) => expected_source_ip)),
    ).toHaveProperty('size', 50);
    expect(() => sourceIpForSlot('000')).toThrow('INVALID_CLIENT_SLOT');
  });
});

describe('E2 JTL and JMeter contract', () => {
  it('accepts exactly 50 slots and rejects missing, duplicate, error and 429 samples', () => {
    const valid = parseJtl(jtl(MfaMethod.EMAIL_OTP));
    expect(() => validateJtl(valid, MfaMethod.EMAIL_OTP)).not.toThrow();
    expect(() => validateJtl(valid.slice(1), MfaMethod.EMAIL_OTP)).toThrow(
      'JTL_SAMPLE_COUNT',
    );
    expect(() =>
      validateJtl(
        parseJtl(
          jtl(MfaMethod.EMAIL_OTP, (row, index) => {
            if (index === 49) row[2] = `${MfaMethod.EMAIL_OTP}:001`;
          }),
        ),
        MfaMethod.EMAIL_OTP,
      ),
    ).toThrow('JTL_DUPLICATE_SLOT');
    expect(() =>
      validateJtl(
        parseJtl(
          jtl(MfaMethod.EMAIL_OTP, (row, index) => {
            if (index === 10) row[3] = '500';
          }),
        ),
        MfaMethod.EMAIL_OTP,
      ),
    ).toThrow('JTL_HTTP_STATUS');
    expect(() =>
      validateJtl(
        parseJtl(
          jtl(MfaMethod.EMAIL_OTP, (row, index) => {
            if (index === 10) row[3] = '429';
          }),
        ),
        MfaMethod.EMAIL_OTP,
      ),
    ).toThrow('JTL_RATE_LIMITED');
    expect(() =>
      validateJtl(
        parseJtl(
          jtl(MfaMethod.EMAIL_OTP, (row, index) => {
            if (index === 10) row[4] = 'false';
          }),
        ),
        MfaMethod.EMAIL_OTP,
      ),
    ).toThrow('JTL_SEMANTIC_FAILURE');
  });

  it('has one generic verification sampler and only five persisted JTL fields', async () => {
    const [properties, plan] = await Promise.all([
      readFile(resolve(__dirname, 'jmeter/e2.properties'), 'utf8'),
      readFile(resolve(__dirname, 'jmeter/e2-verify.jmx'), 'utf8'),
    ]);
    expect(plan.match(/<HTTPSamplerProxy /g)).toHaveLength(1);
    expect(plan).toContain(
      '<stringProp name="ThreadGroup.num_threads">50</stringProp>',
    );
    expect(plan).toContain(
      '<stringProp name="LoopController.loops">1</stringProp>',
    );
    expect(plan).toContain('<intProp name="groupSize">50</intProp>');
    expect(plan).toContain('testclass="JSR223Timer"');
    expect(
      plan.indexOf('Final synchronization of 50 released clients'),
    ).toBeLessThan(plan.indexOf('TOTP guard immediately before verification'));
    expect(plan).toContain(
      '<stringProp name="HTTPSampler.ipSource">${source_ip}</stringProp>',
    );
    expect(plan).toContain(
      '<boolProp name="HTTPSampler.use_keepalive">true</boolProp>',
    );
    expect(plan).toContain(
      '<stringProp name="HTTPSampler.connect_timeout">5000</stringProp>',
    );
    expect(plan).toContain(
      '<stringProp name="HTTPSampler.response_timeout">60000</stringProp>',
    );
    expect(plan).toContain('${__P(variant)}:${client_slot}');
    expect(plan).toContain('/sample-end/');
    for (const header of [
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
    ]) {
      expect(plan).toContain(`headerValue('${header}')`);
    }
    expect(plan).not.toContain('/auth/login');
    expect(plan).not.toContain('CookieManager');
    expect(plan).not.toContain('CSVDataSet');
    for (const setting of [
      'response_data=false',
      'response_data.on_error=false',
      'samplerData=false',
      'responseHeaders=false',
      'requestHeaders=false',
      'cookies=false',
      'url=false',
      'thread_name=false',
      'latency=false',
      'connect_time=false',
      'httpclient4.retrycount=0',
      'httpclient4.request_sent_retry_enabled=false',
    ]) {
      expect(properties).toContain(setting);
    }
    expect(
      properties
        .split('\n')
        .filter((line) =>
          [
            'jmeter.save.saveservice.time=true',
            'jmeter.save.saveservice.label=true',
            'jmeter.save.saveservice.response_code=true',
            'jmeter.save.saveservice.successful=true',
          ].includes(line),
        ),
    ).toHaveLength(4);
    expect(JTL_FIELDS).toEqual([
      'timeStamp',
      'elapsed',
      'label',
      'responseCode',
      'success',
    ]);
  });
});

describe('E2 two-phase barrier and state machine', () => {
  const packets = (): RequestPackage[] =>
    CLIENT_SLOTS.map((client_slot) => ({
      client_slot,
      variant: MfaMethod.TOTP,
      endpoint: '/auth/mfa/totp/verify',
      authorization: 'Bearer synthetic',
      body: '{"code":"000000"}',
    }));

  it('requires 50 READY, deletes packages on first take and resolves after sample end', async () => {
    expect(
      () =>
        new InMemoryRequestBroker([...packets().slice(0, -1), packets()[0]]),
    ).toThrow('BROKER_DUPLICATE_SLOT');
    const broker = new InMemoryRequestBroker(packets());
    expect(() => broker.release()).toThrow('BROKER_EARLY_RELEASE');
    expect(broker.takePackage('001').client_slot).toBe('001');
    expect(() => broker.takePackage('001')).toThrow(
      'BROKER_PACKAGE_ALREADY_TAKEN',
    );
    expect(() => broker.takePackage('999')).toThrow('BROKER_UNKNOWN_SLOT');
    broker.markReady('001');
    expect(() => broker.markReady('001')).toThrow('BROKER_DUPLICATE_READY');
    for (const slot of CLIENT_SLOTS.slice(1)) {
      broker.takePackage(slot);
      broker.markReady(slot);
    }
    await expect(broker.waitUntilReady(100)).resolves.toBe(50);
    broker.release();
    await expect(broker.waitForRelease()).resolves.toBeUndefined();
    const semantic = CLIENT_SLOTS.map((slot) =>
      broker.submitSampleEnd(slot, {
        statusCode: 201,
        contentType: 'application/json',
        rateLimitLimit: '10',
        rateLimitRemaining: '9',
        rateLimitReset: '60',
        bodyText: '{}',
        setCookie: [],
        requestCount: 1,
        redirectCount: 0,
        retryCount: 0,
      }),
    );
    await expect(broker.waitUntilSampleEnds(100)).resolves.toBe(50);
    broker.resolveSemantics(new Map(CLIENT_SLOTS.map((slot) => [slot, 'OK'])));
    await expect(Promise.all(semantic)).resolves.toEqual(
      Array.from({ length: 50 }, () => 'OK'),
    );
  });

  it('forbids preparation after baseline and any automatic rerun after invalid', () => {
    const state = new BurstStateMachine();
    state.assertPreparationAllowed();
    state.ready(50);
    state.startMonitor();
    expect(() => state.assertPreparationAllowed()).toThrow(
      'PREPARATION_AFTER_BASELINE',
    );
    state.invalidate('SYNTHETIC_INVALID');
    expect(() => state.release()).toThrow('RELEASE_ORDER');
    expect(() => state.assertCanStartAnotherAttempt()).toThrow(
      'BURST_RERUN_FORBIDDEN',
    );
  });
});

describe('E2 timing and progression guards', () => {
  it('enforces the 180 second age and 120 second remaining TTL guard', () => {
    const now = 1_800_000_000_000;
    const entries = Array.from({ length: 50 }, () => ({
      issuedAtMs: now - 180_000,
      challengeCreatedAtMs: now - 180_000,
      tokenExpiresAtMs: now + 120_000,
      challengeExpiresAtMs: now + 120_000,
    }));
    expect(() => assertPreparationLifetime(entries, now)).not.toThrow();
    expect(() =>
      assertPreparationLifetime(
        entries.map((entry, index) =>
          index ? entry : { ...entry, issuedAtMs: now - 180_001 },
        ),
        now,
      ),
    ).toThrow('PREPARATION_TTL_GUARD');
    expect(() =>
      assertPreparationLifetime(
        entries.map((entry, index) =>
          index ? entry : { ...entry, challengeCreatedAtMs: now - 180_001 },
        ),
        now,
      ),
    ).toThrow('PREPARATION_TTL_GUARD');
    expect(() =>
      assertPreparationLifetime(
        entries.map((entry, index) =>
          index ? entry : { ...entry, tokenExpiresAtMs: now + 119_999 },
        ),
        now,
      ),
    ).toThrow('PREPARATION_TTL_GUARD');
  });

  it('uses one fresh TOTP step in phases 2-5s and releases by 10s', () => {
    const step = 60_000_000;
    const start = step * 30_000;
    expect(nextTotpGenerationTime(start + 1_000, [step - 1])).toBe(
      start + 2_000,
    );
    expect(assertTotpGenerationWindow(start + 2_000, [step - 1])).toBe(step);
    expect(assertTotpGenerationWindow(start + 5_000, [step - 1])).toBe(step);
    expect(() => assertTotpGenerationWindow(start + 5_001, [step - 1])).toThrow(
      'TOTP_GENERATION_WINDOW',
    );
    expect(() => assertTotpGenerationWindow(start + 2_000, [step])).toThrow(
      'TOTP_GENERATION_WINDOW',
    );
    expect(() => assertTotpReleaseWindow(start + 10_000, step)).not.toThrow();
    expect(() => assertTotpReleaseWindow(start + 10_001, step)).toThrow(
      'TOTP_RELEASE_WINDOW',
    );
    expect(() =>
      assertTotpProgression(step - 5, [step, step + 2], step + 2, 2),
    ).not.toThrow();
    expect(() => assertTotpProgression(step, [step], step, 1)).toThrow(
      'TOTP_PROGRESSION',
    );
  });
});

describe('E2 WebAuthn counter handling', () => {
  const credentials = Array.from({ length: CLIENTS }, (_, index) => {
    const slot = String(index + 1).padStart(3, '0');
    return {
      client_slot: slot,
      credential_id: Buffer.from(`credential-${slot}`).toString('base64url'),
      sign_count: 10 + index,
    };
  });

  const snapshot = (counts: Map<string, number>): WebAuthnSnapshot => ({
    version: 1,
    rp_id: 'localhost',
    authenticator: {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
      credentials: credentials.map((credential) => ({
        credentialId: credential.credential_id,
        rpId: 'localhost',
        privateKey: 'synthetic-private-material',
        userHandle: Buffer.from(`user-${credential.client_slot}`).toString(
          'base64',
        ),
        signCount: counts.get(credential.credential_id),
        isResidentCredential: true,
      })),
    },
  });

  it('requires DB and authenticator equality and exact +1 progression', () => {
    const before = credentials.map(({ client_slot, sign_count }) => ({
      client_slot,
      count: sign_count,
    }));
    const after = before.map(({ client_slot, count }) => ({
      client_slot,
      count: count + 1,
    }));
    expect(() =>
      assertWebAuthnCounterProgression(before, after, after, 1),
    ).not.toThrow();
    expect(() =>
      assertWebAuthnCounterProgression(
        before,
        after.map((entry, index) =>
          index ? entry : { ...entry, count: entry.count + 1 },
        ),
        after,
        1,
      ),
    ).toThrow('WEBAUTHN_COUNTER_DIVERGENCE');
  });

  it('generates real-shape assertions before baseline and aborts on fake CDP divergence', async () => {
    const previousRpId = process.env.WEBAUTHN_RP_ID;
    process.env.WEBAUTHN_RP_ID = 'localhost';
    try {
      const counts = new Map(
        credentials.map(({ credential_id, sign_count }) => [
          credential_id,
          sign_count,
        ]),
      );
      const browser = {
        generateAssertionOnly: jest.fn(
          (options: { allowCredentials: Array<{ id: string }> }) => {
            const id = options.allowCredentials[0].id;
            counts.set(id, counts.get(id) + 1);
            return Promise.resolve({
              id,
              rawId: id,
              response: {
                authenticatorData: 'synthetic-authenticator-data',
                clientDataJSON: 'synthetic-client-data',
                signature: 'synthetic-signature',
                userHandle: 'synthetic-user-handle',
              },
              type: 'public-key' as const,
              clientExtensionResults: {},
            });
          },
        ),
        snapshot: jest.fn(() => Promise.resolve(snapshot(counts))),
      };
      const preparations = credentials.map((credential) => ({
        ...credential,
        token: 'synthetic-mfa-token',
        options: {
          challenge: 'synthetic-challenge',
          rpId: 'localhost',
          allowCredentials: [
            { id: credential.credential_id, type: 'public-key' as const },
          ],
          userVerification: 'required' as const,
        },
      }));
      expect(
        assertWebAuthnInitialState(await browser.snapshot(), credentials),
      ).toHaveLength(50);
      const generated = await generateAssertions(
        browser as never,
        preparations,
        new SecretRegistry(),
      );
      expect(generated.packages).toHaveLength(50);
      expect(browser.generateAssertionOnly).toHaveBeenCalledTimes(50);

      const divergentCounts = new Map(
        credentials.map(({ credential_id, sign_count }) => [
          credential_id,
          sign_count,
        ]),
      );
      const divergent = {
        generateAssertionOnly: jest.fn(
          (options: { allowCredentials: Array<{ id: string }> }) => {
            const id = options.allowCredentials[0].id;
            divergentCounts.set(id, divergentCounts.get(id) + 2);
            return Promise.resolve({
              id,
              rawId: id,
              response: {
                authenticatorData: 'synthetic-authenticator-data',
                clientDataJSON: 'synthetic-client-data',
                signature: 'synthetic-signature',
              },
              type: 'public-key' as const,
              clientExtensionResults: {},
            });
          },
        ),
        snapshot: jest.fn(() => Promise.resolve(snapshot(divergentCounts))),
      };
      await expect(
        generateAssertions(
          divergent as never,
          preparations,
          new SecretRegistry(),
        ),
      ).rejects.toThrow('WEBAUTHN_ASSERTION_COUNTER');
      expect(divergent.generateAssertionOnly).toHaveBeenCalledTimes(1);
    } finally {
      if (previousRpId === undefined) delete process.env.WEBAUTHN_RP_ID;
      else process.env.WEBAUTHN_RP_ID = previousRpId;
    }
  });
});

describe('E2 semantic validation', () => {
  const secret = 'synthetic-jwt-signing-key';
  const userId = '00000000-0000-4000-8000-000000000001';
  const now = 1_800_000_000;
  const access = jwt(
    {
      sub: userId,
      email: 'synthetic@example.test',
      role: 'user',
      method: MfaMethod.TOTP,
      iat: now,
      exp: now + 900,
    },
    secret,
  );
  const refresh = jwt(
    {
      sub: userId,
      email: 'synthetic@example.test',
      role: 'user',
      method: MfaMethod.TOTP,
      type: 'refresh',
      rememberMe: false,
      iat: now,
      exp: now + 7 * 24 * 60 * 60,
    },
    secret,
  );
  const response = () => ({
    statusCode: 201,
    contentType: 'application/json; charset=utf-8',
    rateLimitLimit: '10',
    rateLimitRemaining: '9',
    rateLimitReset: '60',
    bodyText: JSON.stringify({
      mfa_required: false,
      access_token: access,
      user: { user_id: userId, mfa_method: MfaMethod.TOTP },
    }),
    setCookie: [
      `refreshToken=${refresh}; Path=/; HttpOnly; SameSite=Strict`,
      `accessToken=${access}; Max-Age=900; Path=/; HttpOnly; SameSite=Strict`,
    ],
    requestCount: 1,
    redirectCount: 0,
    retryCount: 0,
  });
  const expected = {
    variant: MfaMethod.TOTP as const,
    userId,
    jwtSecret: secret,
    nodeEnv: 'test',
    nowSeconds: now,
  };

  it('validates the full session contract and returns only safe categories', () => {
    expect(validateSemanticResponse(response(), expected)).toBe('OK');
    expect(
      validateSemanticResponse({ ...response(), statusCode: 200 }, expected),
    ).toBe('SEMANTIC_HTTP_STATUS');
    expect(
      validateSemanticResponse({ ...response(), redirectCount: 1 }, expected),
    ).toBe('SEMANTIC_REDIRECT');
    expect(
      validateSemanticResponse(
        { ...response(), rateLimitRemaining: '8' },
        expected,
      ),
    ).toBe('SEMANTIC_RATE_LIMIT_HEADERS');
    expect(
      validateSemanticResponse(
        {
          ...response(),
          bodyText: JSON.stringify({
            mfa_required: false,
            access_token: access,
            user: {
              user_id: userId,
              mfa_method: MfaMethod.TOTP,
              password: 'synthetic',
            },
          }),
        },
        expected,
      ),
    ).toBe('SEMANTIC_PROTECTED_FIELD');
    const code = validateSemanticResponse(
      { ...response(), setCookie: response().setCookie.slice(1) },
      expected,
    );
    expect(code).toBe('SEMANTIC_COOKIE_COUNT');
    expect(code).not.toContain(access);
  });

  it('validates pending login JWT, method and rememberMe=false in memory', () => {
    const token = jwt(
      {
        sub: userId,
        type: 'mfa',
        jti: 'synthetic-challenge-id',
        method: MfaMethod.TOTP,
        rememberMe: false,
        iat: now,
        exp: now + 300,
      },
      secret,
    );
    expect(
      validatePendingLogin(
        201,
        JSON.stringify({
          mfa_required: true,
          method: MfaMethod.TOTP,
          mfa_token: token,
        }),
        {
          variant: MfaMethod.TOTP,
          userId,
          jwtSecret: secret,
          nowSeconds: now,
        },
      ),
    ).toMatchObject({
      token,
      jti: 'synthetic-challenge-id',
      issuedAtMs: now * 1_000,
    });
    expect(() =>
      validatePendingLogin(429, '{}', {
        variant: MfaMethod.TOTP,
        userId,
        jwtSecret: secret,
      }),
    ).toThrow('PREPARATION_RATE_LIMITED');
  });
});

describe('E2 cgroup monitoring', () => {
  it('parses cgroup v2 values and keeps memory peak as a burst metric', () => {
    expect(
      parseCpuUsageUsec('user_usec 4\nsystem_usec 6\nusage_usec 123\n'),
    ).toBe(123);
    expect(parseMemoryCurrent('456\n')).toBe(456);
    expect(() => parseCpuUsageUsec('usage_usec nope')).toThrow(
      'CGROUP_CPU_PARSE',
    );
    expect(
      calculateResourceMetrics(100, 350, [1_000, 1_300, 1_100], 50),
    ).toEqual({
      cpu_usage_before_usec: 100,
      cpu_usage_after_usec: 350,
      cpu_delta_usec: 250,
      cpu_per_request_usec: 5,
      memory_baseline_bytes: 1_000,
      memory_peak_bytes: 1_300,
      memory_peak_delta_bytes: 300,
    });
    expect(() => calculateResourceMetrics(200, 100, [1, 2], 50)).toThrow(
      'RESOURCE_METRICS_INVALID',
    );
  });

  it('starts only at 50 READY, takes a final sample and blocks later preparation', () => {
    let cpu = 100;
    let memory = 1_000;
    let monotonic = 0;
    let identity = '1:2';
    const monitor = new CgroupMonitor('/synthetic', 'container', {
      cpu: () => cpu,
      memory: () => memory,
      identity: () => identity,
      monotonic: () => monotonic,
      utc: () => new Date(1_800_000_000_000 + monotonic).toISOString(),
    });
    expect(() => monitor.start(49)).toThrow('MONITOR_START_BEFORE_READY');

    const valid = new CgroupMonitor('/synthetic', 'container', {
      cpu: () => cpu,
      memory: () => memory,
      identity: () => identity,
      monotonic: () => monotonic,
      utc: () => new Date(1_800_000_000_000 + monotonic).toISOString(),
    });
    valid.start(50);
    expect(() => valid.assertPreparationAllowed()).toThrow(
      'PREPARATION_AFTER_BASELINE',
    );
    monotonic = 20;
    memory = 1_250;
    valid.sampleNow();
    monotonic = 30;
    memory = 1_100;
    cpu = 200;
    const result = valid.stop(50);
    expect(result).toMatchObject({
      cpu_delta_usec: 100,
      cpu_per_request_usec: 2,
      memory_peak_delta_bytes: 250,
      final_sample_present: true,
      memory_sample_count: 3,
    });

    let secondCpu = 10;
    const changed = new CgroupMonitor('/synthetic', 'container', {
      cpu: () => secondCpu,
      memory: () => 1,
      identity: () => identity,
      monotonic: () => 0,
      utc: () => '2026-09-07T00:00:00.000Z',
    });
    changed.start(50);
    secondCpu = 20;
    identity = 'different';
    expect(() => changed.stop(50)).toThrow('RESOURCE_MONITOR_INVALID');
  });
});

describe('E2 artifact security and immutability', () => {
  it('detects exact values, JWTs, headers, bodies, private keys and assertions', () => {
    expect(scanTextForSecrets('safe EMAIL_OTP status', [])).toEqual([]);
    expect(
      scanTextForSecrets('synthetic-known-value', ['synthetic-known-value']),
    ).toContain('KNOWN_SECRET');
    for (const value of [
      '123456',
      'synthetic-access-token',
      'synthetic-cookie-value',
      'synthetic-assertion-value',
      'synthetic-private-key-value',
    ]) {
      expect(scanTextForSecrets(`prefix:${value}:suffix`, [value])).toContain(
        'KNOWN_SECRET',
      );
    }
    expect(
      scanTextForSecrets(
        'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
        [],
      ),
    ).toEqual(expect.arrayContaining(['JWT', 'SENSITIVE_HEADER']));
    expect(scanTextForSecrets('Set-Cookie: accessToken=value', [])).toEqual(
      expect.arrayContaining(['COOKIE_VALUE', 'SENSITIVE_HEADER']),
    );
    expect(scanTextForSecrets('{"request_body":"value"}', [])).toContain(
      'BODY_FIELD',
    );
    expect(scanTextForSecrets('{"mfa_token":"redacted"}', [])).toContain(
      'SESSION_FIELD',
    );
    expect(scanTextForSecrets('{"privateKey":"value"}', [])).toContain(
      'PRIVATE_SECRET',
    );
    expect(scanTextForSecrets('{"authenticatorData":"value"}', [])).toContain(
      'WEBAUTHN_MATERIAL',
    );
  });

  it('uses exclusive paths, atomic no-overwrite writes and verifiable manifests', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'e2-artifacts-'));
    const protocolPath = resolve(__dirname, '../../../../E2.md');
    const experimentId = 'e2-preflight-20260907T000000Z-synthetic';
    try {
      const root = await createTopLevelArtifact({
        resultsRoot: temporary,
        kind: 'preflight',
        experimentId,
        protocolPath,
      });
      expect(burstPath('measured', MfaMethod.TOTP, 2, 7)).toBe(
        'measured/rounds/round-07/02-totp',
      );
      await atomicWrite(resolve(root, 'safe.txt'), 'safe\n');
      await expect(
        atomicWrite(resolve(root, 'safe.txt'), 'overwrite'),
      ).rejects.toMatchObject({
        code: 'EEXIST',
      });
      await expect(
        createExclusiveDirectory(resolve(temporary, experimentId)),
      ).rejects.toMatchObject({ code: 'EEXIST' });
      await sealDirectory(root);
      await expect(verifySha256Manifest(root)).resolves.toMatch(
        /^[0-9a-f]{64}$/,
      );

      const leakRoot = resolve(temporary, 'leak');
      await createExclusiveDirectory(leakRoot);
      await atomicWrite(
        resolve(leakRoot, 'unsafe.txt'),
        'synthetic-leak-value',
      );
      await expect(
        scanArtifacts(leakRoot, ['synthetic-leak-value']),
      ).rejects.toThrow('ARTIFACT_SECRET_SCAN');
      await expect(
        readFile(resolve(leakRoot, 'unsafe.txt')),
      ).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(
        JSON.parse(await readFile(resolve(leakRoot, 'incident.json'), 'utf8')),
      ).toMatchObject({ status: 'INVALID', code: 'ARTIFACT_SECRET_SCAN' });
    } finally {
      await makeWritable(temporary);
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it('requires the pinned RAM-only Mailpit mount and disabled container logs', () => {
    expect(() =>
      assertMailpitContainerInspect({
        Config: {
          Image:
            'axllent/mailpit:v1.31.1@sha256:98b916bd3c8d61f7633a52d3ea2f58d00620cb01ca57ab59edde68c347a95365',
          Env: [
            'MP_DATABASE=/mailpit-data/mailpit.db',
            'MP_MAX_MESSAGES=1000',
            'MP_UI_BIND_ADDR=127.0.0.1:8025',
            'MP_SMTP_BIND_ADDR=127.0.0.1:1025',
          ],
        },
        HostConfig: {
          AutoRemove: true,
          Binds: null,
          LogConfig: { Type: 'none' },
          Tmpfs: {
            '/mailpit-data': 'rw,noexec,nosuid,nodev,size=64m,mode=0700',
          },
        },
        Mounts: [],
      }),
    ).not.toThrow();
    expect(() =>
      assertMailpitContainerInspect({
        Config: { Image: 'axllent/mailpit:v1.31.1', Env: [] },
        HostConfig: { AutoRemove: false, Binds: ['/host:/data'] },
        Mounts: [{ Type: 'bind', Destination: '/data', RW: true }],
      }),
    ).toThrow('MAILPIT_RAM_ONLY_MOUNT');
  });
});

describe('E2 frozen analysis', () => {
  it('implements HF7, sample SD, exact sign test with ties and Holm step-down', () => {
    expect(quantileHf7([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(quantileHf7([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantileHf7([1, 2, 3, 4], 0.75)).toBe(3.25);
    expect(sampleStandardDeviation([1, 2, 3, 4])).toBeCloseTo(Math.sqrt(5 / 3));
    expect(describeSamples([1, 2, 3, 4])).toMatchObject({
      n: 4,
      min: 1,
      max: 4,
      median: 2.5,
      q1: 1.75,
      q3: 3.25,
      iqr: 1.5,
    });
    expect(exactPairedSignTest([-2, -1, 0, 1])).toEqual({
      negative: 2,
      positive: 1,
      ties: 1,
      n_eff: 3,
      p: 0.5,
    });
    expect(exactPairedSignTest([0, 0])).toMatchObject({ n_eff: 0, p: 1 });
    expect(
      holmStepDown([
        { name: 'a', p: 0.01 },
        { name: 'b', p: 0.02 },
        { name: 'c', p: 0.03 },
        { name: 'd', p: 0.2 },
      ]),
    ).toEqual([
      { name: 'a', p: 0.01, threshold: 0.0125, adjusted_p: 0.04, reject: true },
      {
        name: 'b',
        p: 0.02,
        threshold: 0.05 / 3,
        adjusted_p: 0.06,
        reject: false,
      },
      { name: 'c', p: 0.03, threshold: 0.025, adjusted_p: 0.06, reject: false },
      { name: 'd', p: 0.2, threshold: 0.05, adjusted_p: 0.2, reject: false },
    ]);
  });

  it('builds exactly 36 round records and uses rounds, not 600 requests, for H2', () => {
    const baseline = {
      [MfaMethod.EMAIL_OTP]: 30,
      [MfaMethod.TOTP]: 20,
      [MfaMethod.WEBAUTHN]: 10,
    };
    const bursts = MEASURED_SCHEDULE.flatMap((variants, roundIndex) =>
      variants.map((variant, position) => ({
        round: roundIndex + 1,
        order_position: position + 1,
        variant,
        elapsed: Array.from(
          { length: 50 },
          (_, index) => baseline[variant] + index,
        ),
        labels: CLIENT_SLOTS.map((slot) => `${variant}:${slot}`),
        cpu_per_request_usec: 100 + position,
        memory_peak_delta_bytes: 1_000 + roundIndex,
      })),
    );
    const result = analyzeBursts(bursts);
    expect(result.variantRound).toHaveLength(36);
    expect(result.descriptive).toHaveLength(3);
    expect(result.descriptive.every(({ n }) => n === 600)).toBe(true);
    expect(result.comparisons).toHaveLength(4);
    expect(result.comparisons.every(({ n_eff }) => n_eff === 12)).toBe(true);
    expect(result.comparisons.every(({ p }) => p === 1 / 4096)).toBe(true);
    expect(result.h2_supported).toBe(true);
  });
});

describe('E2 CLI authorization gates', () => {
  const protocol = `--protocol-sha=${APPROVED_PROTOCOL_SHA256}`;

  it('blocks every live mode without explicit authority and never auto-promotes', () => {
    expect(() => parseCliArguments(['preflight', protocol])).toThrow(
      'CLI_LIVE_CONFIRMATION',
    );
    expect(() =>
      parseCliArguments([
        'preflight',
        '--protocol-sha=wrong',
        '--confirm-live-e2',
      ]),
    ).toThrow('CLI_PROTOCOL_SHA');
    expect(() =>
      parseCliArguments(['pilot', protocol, '--confirm-live-e2']),
    ).toThrow('CLI_PILOT_APPROVAL');
    expect(() =>
      parseCliArguments([
        'full',
        protocol,
        '--confirm-live-e2',
        '--approved-pilot-id=e2-pilot-approved',
      ]),
    ).toThrow('CLI_FULL_APPROVAL');
    expect(() =>
      parseCliArguments([
        'analysis',
        protocol,
        '--full-experiment-id=e2-full-safe/../../e2-full-escaped',
      ]),
    ).toThrow('CLI_ANALYSIS_INPUT');
    expect(
      parseCliArguments(['preflight', protocol, '--confirm-live-e2']),
    ).toMatchObject({ mode: 'preflight', confirmLive: true });
    expect(
      parseCliArguments([
        'pilot',
        protocol,
        '--confirm-live-e2',
        '--confirm-pilot',
        '--approved-preflight-id=e2-preflight-approved',
      ]),
    ).toMatchObject({ mode: 'pilot', confirmPilot: true });
    expect(
      parseCliArguments([
        'full',
        protocol,
        '--confirm-live-e2',
        '--confirm-full',
        '--approved-pilot-id=e2-pilot-approved',
      ]),
    ).toMatchObject({ mode: 'full', confirmFull: true });
    expect(
      parseCliArguments([
        'analysis',
        protocol,
        '--full-experiment-id=e2-full-approved',
      ]),
    ).toMatchObject({ mode: 'analysis', confirmLive: false });
  });
});

it('uses only safe category errors', () => {
  expect(() => new HarnessError('not-safe')).toThrow('INVALID_SAFE_ERROR_CODE');
});
