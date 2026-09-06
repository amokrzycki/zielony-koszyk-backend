import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as OTPAuth from 'otpauth';
import * as request from 'supertest';
import type { EntityManager, Repository } from 'typeorm';
import { AuthController } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import {
  JwtStrategy,
  MfaJwtStrategy,
  RefreshTokenStrategy,
} from '../auth/jwt.strategy';
import {
  MfaController,
  MfaSettingsController,
  TotpEnrollmentController,
} from '../auth/mfa.controller';
import { MfaService } from '../auth/mfa.service';
import {
  decryptTotpSecret,
  encryptTotpSecret,
} from '../auth/totp-secret.crypto';
import type { WebAuthnService } from '../auth/webauthn.service';
import {
  MFA_TOTP_ALGORITHM,
  MFA_TOTP_DIGITS,
  MFA_TOTP_ISSUER,
  MFA_TOTP_PERIOD_SECONDS,
} from '../constants/constants';
import {
  MfaChallenge,
  MfaChallengePurpose,
} from '../entities/mfa-challenge.entity';
import { User } from '../entities/user.entity';
import { WebAuthnCredential } from '../entities/webauthn-credential.entity';
import { MfaMethod } from '../enums/MfaMethod';
import { Roles } from '../enums/Roles';
import type { MailService } from '../services/mail.service';
import type { UserService } from '../services/user.service';

const NOW = 1_800_000_015_000;
const PASSWORD = 'valid-password';
const ENCRYPTION_KEY = Buffer.alloc(32, 4);

const matches = <T extends object>(value: T, where: Partial<T>) =>
  Object.entries(where).every(
    ([key, expected]) => value[key as keyof T] === expected,
  );

const createHarness = async () => {
  const account = {
    user_id: 'c4f3a574-bfa8-4b77-ad92-5a7a771d8122',
    email: 'user@example.com',
    password: await bcrypt.hash(PASSWORD, 4),
    role: Roles.USER,
    first_name: 'Test',
    last_name: 'User',
    phone: '123456789',
    addresses: [],
    mfa_method: MfaMethod.EMAIL_OTP,
    totp_secret_encrypted: null,
    totp_last_used_step: null,
    created_at: new Date(),
    updated_at: new Date(),
  } as User;
  const challenges = new Map<string, MfaChallenge>();
  const credentialUserIds = new Set([account.user_id]);

  const challengeRepository = {
    create: jest.fn((challenge: MfaChallenge) => challenge),
    findOne: jest.fn(
      ({ where }: { where: Partial<MfaChallenge> }) =>
        [...challenges.values()].find((challenge) =>
          matches(challenge, where),
        ) ?? null,
    ),
    upsert: jest.fn((challenge: MfaChallenge) => {
      for (const [id, current] of challenges) {
        if (
          current.user_id === challenge.user_id &&
          current.purpose === challenge.purpose
        ) {
          challenges.delete(id);
        }
      }
      challenges.set(challenge.challenge_id, challenge);
    }),
    save: jest.fn((challenge: MfaChallenge) => {
      challenges.set(challenge.challenge_id, challenge);
      return challenge;
    }),
    delete: jest.fn((where: Partial<MfaChallenge>) => {
      for (const [id, challenge] of challenges) {
        if (matches(challenge, where)) challenges.delete(id);
      }
    }),
  };
  const userRepository = {
    findOne: jest.fn(({ where }: { where: Partial<User> }) =>
      matches(account, where) ? account : null,
    ),
    save: jest.fn((user: User) => {
      Object.assign(account, user);
      return account;
    }),
  };
  const credentialRepository = {
    findOne: jest.fn(() => null),
    delete: jest.fn(({ user_id }: Pick<WebAuthnCredential, 'user_id'>) => {
      credentialUserIds.delete(user_id);
    }),
  };
  const manager = {
    query: jest.fn(),
    getRepository: jest.fn((entity: unknown) => {
      if (entity === MfaChallenge) return challengeRepository;
      if (entity === User) return userRepository;
      if (entity === WebAuthnCredential) return credentialRepository;
      throw new Error('Unexpected repository');
    }),
  } as unknown as EntityManager;
  Object.assign(challengeRepository, {
    manager: {
      transaction: (
        work: (transactionManager: EntityManager) => Promise<unknown>,
      ) => work(manager),
    },
  });

  const jwtService = new JwtService({ secret: 'test-secret' });
  const configService = new ConfigService({
    JWT_SECRET: 'test-secret',
    MFA_OTP_HMAC_KEY: Buffer.alloc(32, 3).toString('base64'),
    MFA_TOTP_ENCRYPTION_KEY: ENCRYPTION_KEY.toString('base64'),
  });
  const sendMfaOtp = jest.fn<Promise<void>, [string, string]>();
  const mailService = { sendMfaOtp } as unknown as MailService;
  const mfaService = new MfaService(
    challengeRepository as unknown as Repository<MfaChallenge>,
    userRepository as unknown as Repository<User>,
    jwtService,
    configService,
    mailService,
    credentialRepository as unknown as Repository<WebAuthnCredential>,
    {} as unknown as WebAuthnService,
  );
  const publicAccount = () => {
    const user: Partial<User> = { ...account };
    delete user.password;
    delete user.totp_secret_encrypted;
    delete user.totp_last_used_step;
    return user;
  };
  const usersService = {
    findByEmail: jest.fn((email: string) =>
      email === account.email ? account : null,
    ),
    findById: jest.fn((userId: string) =>
      userId === account.user_id ? publicAccount() : null,
    ),
  } as unknown as UserService;
  const authService = new AuthService(usersService, jwtService);
  const moduleRef = await Test.createTestingModule({
    imports: [PassportModule],
    controllers: [
      AuthController,
      MfaController,
      MfaSettingsController,
      TotpEnrollmentController,
    ],
    providers: [
      JwtStrategy,
      RefreshTokenStrategy,
      MfaJwtStrategy,
      { provide: ConfigService, useValue: configService },
      { provide: AuthService, useValue: authService },
      { provide: MfaService, useValue: mfaService },
    ],
  }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe());
  await app.init();
  const accessTokenFor = (method: MfaMethod) =>
    jwtService.sign(
      {
        sub: account.user_id,
        email: account.email,
        role: account.role,
        ...(method === MfaMethod.NONE ? {} : { method }),
      },
      { algorithm: 'HS256', expiresIn: '15m' },
    );

  return {
    account,
    app,
    server: app.getHttpServer() as Parameters<typeof request>[0],
    challenges,
    credentialUserIds,
    jwtService,
    sendMfaOtp,
    challengeRepository,
    userRepository,
    accessTokenFor,
    accessToken: accessTokenFor(account.mfa_method),
  };
};

type Harness = Awaited<ReturnType<typeof createHarness>>;

const totpFor = (secret: string) =>
  new OTPAuth.TOTP({
    issuer: MFA_TOTP_ISSUER,
    label: 'user@example.com',
    algorithm: MFA_TOTP_ALGORITHM,
    digits: MFA_TOTP_DIGITS,
    period: MFA_TOTP_PERIOD_SECONDS,
    secret: OTPAuth.Secret.fromBase32(secret),
  });

const invalidCodeFor = (totp: OTPAuth.TOTP, timestamp: number) => {
  const acceptedCodes = new Set(
    [-1, 0, 1].map((offset) =>
      totp.generate({
        timestamp: timestamp + offset * MFA_TOTP_PERIOD_SECONDS * 1000,
      }),
    ),
  );
  let code = '000000';
  while (acceptedCodes.has(code)) {
    code = String(Number(code) + 1).padStart(6, '0');
  }
  return code;
};

const startEnrollment = (harness: Harness) =>
  request(harness.server)
    .post('/users/me/mfa/totp/enrollment')
    .set('Authorization', `Bearer ${harness.accessToken}`)
    .send({ password: PASSWORD });

const enroll = async (harness: Harness) => {
  const started = await startEnrollment(harness).expect(201);
  const body = started.body as {
    challenge_id: string;
    otpauth_uri: string;
    secret: string;
  };
  const code = totpFor(body.secret).generate({
    timestamp: NOW - MFA_TOTP_PERIOD_SECONDS * 1000,
  });
  await request(harness.server)
    .post('/users/me/mfa/totp/enrollment/verify')
    .set('Authorization', `Bearer ${harness.accessToken}`)
    .send({ challenge_id: body.challenge_id, code })
    .expect(201);
  return body;
};

const login = (harness: Harness) =>
  request(harness.server).post('/auth/login').send({
    email: harness.account.email,
    password: PASSWORD,
    rememberMe: true,
  });

describe('TOTP end-to-end', () => {
  let harness: Harness;
  let now: number;

  beforeEach(async () => {
    now = NOW;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.app.close();
    jest.restoreAllMocks();
  });

  it('does not start a TOTP login without an encrypted secret', async () => {
    harness.account.mfa_method = MfaMethod.TOTP;

    await login(harness).expect(401);
    expect(harness.challenges.size).toBe(0);
  });

  it('activates only after a valid first code and stores encrypted secret', async () => {
    await request(harness.server)
      .post('/users/me/mfa/totp/enrollment')
      .set('Authorization', `Bearer ${harness.accessToken}`)
      .send({ password: 'wrong-password' })
      .expect(403);
    expect(harness.challenges.size).toBe(0);

    const started = await startEnrollment(harness).expect(201);
    const body = started.body as {
      challenge_id: string;
      otpauth_uri: string;
      secret: string;
    };
    const parsed = OTPAuth.URI.parse(body.otpauth_uri) as OTPAuth.TOTP;
    const pendingSecret = harness.challenges.get(
      body.challenge_id,
    )?.totp_secret_encrypted;

    expect(parsed).toBeInstanceOf(OTPAuth.TOTP);
    expect(parsed).toMatchObject({
      issuer: MFA_TOTP_ISSUER,
      label: harness.account.email,
      algorithm: MFA_TOTP_ALGORITHM,
      digits: MFA_TOTP_DIGITS,
      period: MFA_TOTP_PERIOD_SECONDS,
    });
    expect(parsed.secret.base32).toBe(body.secret);
    expect(pendingSecret).toMatch(/^v1\./);
    expect(JSON.stringify([...harness.challenges.values()])).not.toContain(
      body.secret,
    );
    expect(harness.account.mfa_method).toBe(MfaMethod.EMAIL_OTP);
    expect(harness.credentialUserIds.has(harness.account.user_id)).toBe(true);

    await request(harness.server)
      .post('/users/me/mfa/totp/enrollment/verify')
      .set('Authorization', `Bearer ${harness.accessToken}`)
      .send({
        challenge_id: body.challenge_id,
        code: invalidCodeFor(parsed, NOW),
      })
      .expect(400);
    expect(harness.account.mfa_method).toBe(MfaMethod.EMAIL_OTP);

    const firstCode = parsed.generate({
      timestamp: NOW - MFA_TOTP_PERIOD_SECONDS * 1000,
    });
    await request(harness.server)
      .post('/users/me/mfa/totp/enrollment/verify')
      .set('Authorization', `Bearer ${harness.accessToken}`)
      .send({ challenge_id: body.challenge_id, code: firstCode })
      .expect(201, { mfa_method: MfaMethod.TOTP });

    expect(harness.account.mfa_method).toBe(MfaMethod.TOTP);
    expect(harness.account.totp_secret_encrypted).toMatch(/^v1\./);
    expect(harness.account.totp_secret_encrypted).not.toBe(pendingSecret);
    expect(
      decryptTotpSecret(
        harness.account.totp_secret_encrypted,
        harness.account.user_id,
        ENCRYPTION_KEY,
      ),
    ).toBe(body.secret);
    expect(harness.account.totp_last_used_step).toBe(
      parsed.counter({
        timestamp: NOW - MFA_TOTP_PERIOD_SECONDS * 1000,
      }),
    );
    expect(harness.challenges.size).toBe(0);
    expect(harness.credentialUserIds.size).toBe(0);
  });

  it('leaves current method untouched when enrollment expires', async () => {
    const previousSecret = encryptTotpSecret(
      new OTPAuth.Secret({ size: 20 }).base32,
      harness.account.user_id,
      ENCRYPTION_KEY,
    );
    harness.account.totp_secret_encrypted = previousSecret;
    const started = await startEnrollment(harness).expect(201);
    const body = started.body as { challenge_id: string; secret: string };
    const challenge = harness.challenges.get(body.challenge_id);
    if (!challenge) throw new Error('Expected enrollment challenge');
    challenge.expires_at = new Date(NOW - 1);
    const code = totpFor(body.secret).generate({ timestamp: NOW });

    await request(harness.server)
      .post('/users/me/mfa/totp/enrollment/verify')
      .set('Authorization', `Bearer ${harness.accessToken}`)
      .send({ challenge_id: body.challenge_id, code })
      .expect(400);

    expect(harness.account.mfa_method).toBe(MfaMethod.EMAIL_OTP);
    expect(harness.account.totp_secret_encrypted).toBe(previousSecret);
    expect(harness.credentialUserIds.has(harness.account.user_id)).toBe(true);
  });

  it('rejects an email challenge after TOTP activation', async () => {
    const pending = await login(harness).expect(201);
    const pendingBody = pending.body as { mfa_token: string };
    const code = harness.sendMfaOtp.mock.calls[0][1];

    await enroll(harness);

    await request(harness.server)
      .post('/auth/mfa/email-otp/verify')
      .set('Authorization', `Bearer ${pendingBody.mfa_token}`)
      .send({ code })
      .expect(401);
  });

  it('completes login and rejects an accepted or older TOTP step', async () => {
    const enrollment = await enroll(harness);
    const totp = totpFor(enrollment.secret);
    const currentCode = totp.generate({ timestamp: NOW });
    const olderCode = totp.generate({
      timestamp: NOW - MFA_TOTP_PERIOD_SECONDS * 1000,
    });
    const pending = await login(harness).expect(201);
    const pendingBody = pending.body as {
      mfa_required: true;
      method: MfaMethod;
      mfa_token: string;
    };

    expect(pendingBody).toMatchObject({
      mfa_required: true,
      method: MfaMethod.TOTP,
    });
    expect(typeof pendingBody.mfa_token).toBe('string');
    expect(pendingBody).not.toHaveProperty('access_token');
    expect(pendingBody).not.toHaveProperty('user');

    const completed = await request(harness.server)
      .post('/auth/mfa/totp/verify')
      .set('Authorization', `Bearer ${pendingBody.mfa_token}`)
      .send({ code: currentCode })
      .expect(201);
    const completedBody = completed.body as {
      user: { user_id: string; mfa_method: MfaMethod };
    };
    expect(completedBody).toMatchObject({
      mfa_required: false,
      user: {
        user_id: harness.account.user_id,
        mfa_method: MfaMethod.TOTP,
      },
    });
    expect(completedBody.user).not.toHaveProperty('totp_secret_encrypted');
    expect(completedBody.user).not.toHaveProperty('totp_last_used_step');
    expect(completed.headers['set-cookie']).toHaveLength(2);

    const replay = await login(harness).expect(201);
    const replayBody = replay.body as { mfa_token: string };
    await request(harness.server)
      .post('/auth/mfa/totp/verify')
      .set('Authorization', `Bearer ${replayBody.mfa_token}`)
      .send({ code: currentCode })
      .expect(401);
    await request(harness.server)
      .post('/auth/mfa/totp/verify')
      .set('Authorization', `Bearer ${replayBody.mfa_token}`)
      .send({ code: olderCode })
      .expect(401);

    now += MFA_TOTP_PERIOD_SECONDS * 1000;
    const nextCode = totp.generate({ timestamp: now });
    await request(harness.server)
      .post('/auth/mfa/totp/verify')
      .set('Authorization', `Bearer ${replayBody.mfa_token}`)
      .send({ code: nextCode })
      .expect(201);
  });

  it('rejects expired login challenges and enforces five attempts', async () => {
    const enrollment = await enroll(harness);
    const totp = totpFor(enrollment.secret);
    const currentCode = totp.generate({ timestamp: NOW });
    const pending = await login(harness).expect(201);
    const pendingBody = pending.body as { mfa_token: string };
    const challenge = [...harness.challenges.values()][0];
    challenge.expires_at = new Date(NOW - 1);

    await request(harness.server)
      .post('/auth/mfa/totp/verify')
      .set('Authorization', `Bearer ${pendingBody.mfa_token}`)
      .send({ code: currentCode })
      .expect(401);
    expect(harness.challenges.size).toBe(0);

    const limited = await login(harness).expect(201);
    const limitedBody = limited.body as { mfa_token: string };
    const wrongCode = invalidCodeFor(totp, NOW);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(harness.server)
        .post('/auth/mfa/totp/verify')
        .set('Authorization', `Bearer ${limitedBody.mfa_token}`)
        .send({ code: wrongCode })
        .expect(401);
    }
    expect([...harness.challenges.values()][0].attempt_count).toBe(5);

    await request(harness.server)
      .post('/auth/mfa/totp/verify')
      .set('Authorization', `Bearer ${limitedBody.mfa_token}`)
      .send({ code: currentCode })
      .expect(401);
    expect([...harness.challenges.values()][0].attempt_count).toBe(5);
    await login(harness).expect(429);
  });
});

describe('MFA method management', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.app.close();
  });

  const updateMethod = (
    method: MfaMethod,
    password: string,
    token = harness.accessToken,
  ) =>
    request(harness.server)
      .put('/users/me/mfa')
      .set('Authorization', `Bearer ${token}`)
      .send({ method, password });

  it('requires a full session and current password', async () => {
    await request(harness.server)
      .put('/users/me/mfa')
      .send({ method: MfaMethod.NONE, password: PASSWORD })
      .expect(401);

    const pending = await login(harness).expect(201);
    const pendingBody = pending.body as { mfa_token: string };
    await updateMethod(MfaMethod.NONE, PASSWORD, pendingBody.mfa_token).expect(
      401,
    );
    await updateMethod(
      MfaMethod.NONE,
      PASSWORD,
      harness.accessTokenFor(MfaMethod.NONE),
    ).expect(403);
    await updateMethod(MfaMethod.NONE, 'wrong-password').expect(403);
    await updateMethod(MfaMethod.TOTP, PASSWORD).expect(400);

    expect(harness.account.mfa_method).toBe(MfaMethod.EMAIL_OTP);
    expect(harness.credentialUserIds.has(harness.account.user_id)).toBe(true);
  });

  it('enables email OTP and disables MFA with transactional cleanup', async () => {
    const pendingChallenge = {
      challenge_id: '4df5bb30-a038-4ff0-a76e-0b6c1ef92fd8',
      user_id: harness.account.user_id,
      method: MfaMethod.TOTP,
      purpose: MfaChallengePurpose.ENROLLMENT,
      otp_digest: null,
      webauthn_challenge: null,
      totp_secret_encrypted: 'pending-secret',
      attempt_count: 0,
      expires_at: new Date(Date.now() + 60_000),
    } as MfaChallenge;
    harness.account.mfa_method = MfaMethod.TOTP;
    harness.account.totp_secret_encrypted = 'active-secret';
    harness.account.totp_last_used_step = 7;
    harness.challenges.set(pendingChallenge.challenge_id, pendingChallenge);

    await updateMethod(
      MfaMethod.EMAIL_OTP,
      PASSWORD,
      harness.accessTokenFor(MfaMethod.TOTP),
    ).expect(200, { mfa_method: MfaMethod.EMAIL_OTP });

    expect(harness.account).toMatchObject({
      mfa_method: MfaMethod.EMAIL_OTP,
      totp_secret_encrypted: null,
      totp_last_used_step: null,
    });
    expect(harness.credentialUserIds.size).toBe(0);
    expect(harness.challenges.size).toBe(0);
    expect(
      harness.challengeRepository.delete.mock.invocationCallOrder[0],
    ).toBeLessThan(harness.userRepository.findOne.mock.invocationCallOrder[0]);

    harness.account.mfa_method = MfaMethod.WEBAUTHN;
    harness.account.totp_secret_encrypted = 'stale-secret';
    harness.account.totp_last_used_step = 8;
    harness.credentialUserIds.add(harness.account.user_id);

    await updateMethod(
      MfaMethod.NONE,
      PASSWORD,
      harness.accessTokenFor(MfaMethod.WEBAUTHN),
    ).expect(200, { mfa_method: MfaMethod.NONE });

    expect(harness.account).toMatchObject({
      mfa_method: MfaMethod.NONE,
      totp_secret_encrypted: null,
      totp_last_used_step: null,
    });
    expect(harness.credentialUserIds.size).toBe(0);
  });
});
