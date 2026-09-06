import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import * as bcrypt from 'bcrypt';
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
  TotpEnrollmentController,
  WebAuthnEnrollmentController,
} from '../auth/mfa.controller';
import { MfaService } from '../auth/mfa.service';
import type { WebAuthnService } from '../auth/webauthn.service';
import { MfaChallenge } from '../entities/mfa-challenge.entity';
import { User } from '../entities/user.entity';
import { WebAuthnCredential } from '../entities/webauthn-credential.entity';
import { MfaMethod } from '../enums/MfaMethod';
import { Roles } from '../enums/Roles';
import type { MailService } from '../services/mail.service';
import type { UserService } from '../services/user.service';

const NOW = 1_800_000_015_000;
const PASSWORD = 'valid-password';
const STORED_CREDENTIAL_ID = 'stored-credential-id';

const matches = <T extends object>(value: T, where: Partial<T>) =>
  Object.entries(where).every(
    ([key, expected]) => value[key as keyof T] === expected,
  );

const registrationOptions = {
  challenge: 'registration-challenge',
  rp: { id: 'localhost', name: 'Zielony Koszyk' },
};

const authenticationOptions = {
  challenge: 'authentication-challenge',
  rpId: 'localhost',
  allowCredentials: [{ id: STORED_CREDENTIAL_ID }],
  userVerification: 'required' as const,
};

const createHarness = () => {
  const account = {
    user_id: 'c4f3a574-bfa8-4b77-ad92-5a7a771d8122',
    email: 'user@example.com',
    role: Roles.USER,
    first_name: 'Test',
    last_name: 'User',
    phone: '123456789',
    addresses: [],
    mfa_method: MfaMethod.NONE,
    totp_secret_encrypted: null,
    totp_last_used_step: null,
    created_at: new Date(),
    updated_at: new Date(),
  } as User;

  const challenges = new Map<string, MfaChallenge>();
  const credentials = new Map<string, WebAuthnCredential>();

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
    findOne: jest.fn(
      ({ where }: { where: Partial<WebAuthnCredential> }) =>
        [...credentials.values()].find((credential) =>
          matches(credential, where),
        ) ?? null,
    ),
    insert: jest.fn((data: Partial<WebAuthnCredential>) => {
      credentials.set(data.user_id, { ...data } as WebAuthnCredential);
    }),
    save: jest.fn((credential: WebAuthnCredential) => {
      credentials.set(credential.user_id, credential);
      return credential;
    }),
    delete: jest.fn(({ user_id }: Pick<WebAuthnCredential, 'user_id'>) => {
      credentials.delete(user_id);
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
    MFA_TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString('base64'),
  });
  const sendMfaOtp = jest.fn();
  const mailService = { sendMfaOtp } as unknown as MailService;
  const generateRegistrationOptions = jest
    .fn()
    .mockResolvedValue(registrationOptions);
  const generateAuthenticationOptions = jest
    .fn()
    .mockResolvedValue(authenticationOptions);
  const verifyRegistration = jest.fn();
  const verifyAuthentication = jest.fn();
  const webAuthnService = {
    generateRegistrationOptions,
    generateAuthenticationOptions,
    verifyRegistration,
    verifyAuthentication,
  } as unknown as WebAuthnService;
  const mfaService = new MfaService(
    challengeRepository as unknown as Repository<MfaChallenge>,
    userRepository as unknown as Repository<User>,
    jwtService,
    configService,
    mailService,
    credentialRepository as unknown as Repository<WebAuthnCredential>,
    webAuthnService,
  );
  const publicAccount = () => {
    const user: Partial<User> = { ...account };
    delete user.totp_secret_encrypted;
    delete user.totp_last_used_step;
    return user;
  };
  const usersService = {
    findByEmail: jest.fn((email: string) =>
      email === account.email
        ? { ...account, password: (account as { password?: string }).password }
        : null,
    ),
    findById: jest.fn((userId: string) =>
      userId === account.user_id ? publicAccount() : null,
    ),
  } as unknown as UserService;
  const authService = new AuthService(usersService, jwtService);
  const accessToken = () =>
    jwtService.sign(
      {
        sub: account.user_id,
        email: account.email,
        role: account.role,
        ...(account.mfa_method === MfaMethod.NONE
          ? {}
          : { method: account.mfa_method }),
      },
      { algorithm: 'HS256', expiresIn: '15m' },
    );

  return {
    account,
    challenges,
    credentials,
    jwtService,
    generateRegistrationOptions,
    generateAuthenticationOptions,
    verifyRegistration,
    verifyAuthentication,
    mfaService,
    authService,
    configService,
    accessToken,
  };
};

type Harness = ReturnType<typeof createHarness>;

const buildApp = async (harness: Harness) => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      PassportModule,
      ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
    ],
    controllers: [
      AuthController,
      MfaController,
      TotpEnrollmentController,
      WebAuthnEnrollmentController,
    ],
    providers: [
      JwtStrategy,
      RefreshTokenStrategy,
      MfaJwtStrategy,
      { provide: ConfigService, useValue: harness.configService },
      { provide: AuthService, useValue: harness.authService },
      { provide: MfaService, useValue: harness.mfaService },
    ],
  }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe());
  await app.init();
  return app;
};

describe('WebAuthn registration', () => {
  let harness: Harness;
  let app: INestApplication;
  let server: Parameters<typeof request>[0];

  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockImplementation(() => NOW);
    harness = createHarness();
    harness.account.password = await bcrypt.hash(PASSWORD, 4);
    app = await buildApp(harness);
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  afterEach(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  const startRegistration = () =>
    request(server)
      .post('/users/me/mfa/webauthn/registration')
      .set('Authorization', `Bearer ${harness.accessToken()}`)
      .send({ password: PASSWORD });

  it('rejects a wrong password without creating a challenge', async () => {
    await request(server)
      .post('/users/me/mfa/webauthn/registration')
      .set('Authorization', `Bearer ${harness.accessToken()}`)
      .send({ password: 'wrong-password' })
      .expect(403);

    expect(harness.challenges.size).toBe(0);
    expect(harness.generateRegistrationOptions).not.toHaveBeenCalled();
  });

  it('returns platform-only options and stores the exact challenge', async () => {
    const started = await startRegistration().expect(201);

    expect(harness.generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: harness.account.user_id }),
      undefined,
    );
    expect(started.body).toMatchObject({
      options: registrationOptions,
    });
    const challenge = [...harness.challenges.values()][0];
    expect(challenge.webauthn_challenge).toBe(registrationOptions.challenge);
    expect(challenge.purpose).toBe('ENROLLMENT');
  });

  it('excludes the existing credential when re-registering', async () => {
    harness.credentials.set(harness.account.user_id, {
      credential_id: STORED_CREDENTIAL_ID,
      user_id: harness.account.user_id,
      public_key: Buffer.from('old-key'),
      sign_count: 3,
    } as WebAuthnCredential);

    await startRegistration().expect(201);

    expect(harness.generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: harness.account.user_id }),
      expect.objectContaining({ credential_id: STORED_CREDENTIAL_ID }),
    );
  });

  it('activates only after a verified response and clears the previous TOTP secret', async () => {
    harness.account.mfa_method = MfaMethod.TOTP;
    harness.account.totp_secret_encrypted = 'v1.previous';
    harness.account.totp_last_used_step = 7;
    const started = await startRegistration().expect(201);
    const body = started.body as { challenge_id: string };

    harness.verifyRegistration.mockResolvedValueOnce({
      verified: false,
    });
    await request(server)
      .post('/users/me/mfa/webauthn/registration/verify')
      .set('Authorization', `Bearer ${harness.accessToken()}`)
      .send({
        challenge_id: body.challenge_id,
        response: { id: 'new-credential' },
      })
      .expect(400);
    expect(harness.account.mfa_method).toBe(MfaMethod.TOTP);

    harness.verifyRegistration.mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'new-credential',
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
        },
      },
    });
    await request(server)
      .post('/users/me/mfa/webauthn/registration/verify')
      .set('Authorization', `Bearer ${harness.accessToken()}`)
      .send({
        challenge_id: body.challenge_id,
        response: { id: 'new-credential' },
      })
      .expect(201, { mfa_method: MfaMethod.WEBAUTHN });

    expect(harness.account.mfa_method).toBe(MfaMethod.WEBAUTHN);
    expect(harness.account.totp_secret_encrypted).toBeNull();
    expect(harness.account.totp_last_used_step).toBeNull();
    expect(harness.credentials.get(harness.account.user_id)).toMatchObject({
      credential_id: 'new-credential',
      sign_count: 0,
    });
    expect(harness.challenges.size).toBe(0);
  });

  it('leaves the previous credential untouched when enrollment expires', async () => {
    harness.credentials.set(harness.account.user_id, {
      credential_id: STORED_CREDENTIAL_ID,
      user_id: harness.account.user_id,
      public_key: Buffer.from('old-key'),
      sign_count: 3,
    } as WebAuthnCredential);
    const started = await startRegistration().expect(201);
    const body = started.body as { challenge_id: string };
    const challenge = harness.challenges.get(body.challenge_id);
    if (!challenge) throw new Error('Expected enrollment challenge');
    challenge.expires_at = new Date(NOW - 1);

    await request(server)
      .post('/users/me/mfa/webauthn/registration/verify')
      .set('Authorization', `Bearer ${harness.accessToken()}`)
      .send({
        challenge_id: body.challenge_id,
        response: { id: 'new-credential' },
      })
      .expect(400);

    expect(harness.verifyRegistration).not.toHaveBeenCalled();
    expect(harness.credentials.get(harness.account.user_id)).toMatchObject({
      credential_id: STORED_CREDENTIAL_ID,
    });
  });
});

describe('WebAuthn login', () => {
  let harness: Harness;
  let app: INestApplication;
  let server: Parameters<typeof request>[0];

  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockImplementation(() => NOW);
    harness = createHarness();
    harness.account.password = await bcrypt.hash(PASSWORD, 4);
    harness.account.mfa_method = MfaMethod.WEBAUTHN;
    app = await buildApp(harness);
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  afterEach(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  const login = () =>
    request(server).post('/auth/login').send({
      email: harness.account.email,
      password: PASSWORD,
      rememberMe: true,
    });

  it('refuses to start a login challenge without a stored credential', async () => {
    await login().expect(401);
    expect(harness.challenges.size).toBe(0);
    expect(harness.generateAuthenticationOptions).not.toHaveBeenCalled();
  });

  it('returns authentication options scoped to the stored credential', async () => {
    harness.credentials.set(harness.account.user_id, {
      credential_id: STORED_CREDENTIAL_ID,
      user_id: harness.account.user_id,
      public_key: Buffer.from('public-key'),
      sign_count: 5,
    } as WebAuthnCredential);

    const pending = await login().expect(201);
    const body = pending.body as {
      mfa_required: true;
      method: MfaMethod;
      mfa_token: string;
      webauthn_options: typeof authenticationOptions;
    };

    expect(body).toMatchObject({
      mfa_required: true,
      method: MfaMethod.WEBAUTHN,
      webauthn_options: authenticationOptions,
    });
    expect(body).not.toHaveProperty('access_token');
    expect(body).not.toHaveProperty('user');
    expect(harness.generateAuthenticationOptions).toHaveBeenCalledWith(
      expect.objectContaining({ credential_id: STORED_CREDENTIAL_ID }),
    );
    const challenge = [...harness.challenges.values()][0];
    expect(challenge.webauthn_challenge).toBe(authenticationOptions.challenge);
  });

  it('rejects an assertion for a credential id that was never registered', async () => {
    harness.credentials.set(harness.account.user_id, {
      credential_id: STORED_CREDENTIAL_ID,
      user_id: harness.account.user_id,
      public_key: Buffer.from('public-key'),
      sign_count: 5,
    } as WebAuthnCredential);
    const pending = await login().expect(201);
    const { mfa_token } = pending.body as { mfa_token: string };

    await request(server)
      .post('/auth/mfa/webauthn/verify')
      .set('Authorization', `Bearer ${mfa_token}`)
      .send({ response: { id: 'someone-elses-credential' } })
      .expect(401);

    expect(harness.verifyAuthentication).not.toHaveBeenCalled();
    expect(harness.credentials.get(harness.account.user_id)?.sign_count).toBe(
      5,
    );
  });

  it('completes login, updates the counter and rejects challenge replay', async () => {
    harness.credentials.set(harness.account.user_id, {
      credential_id: STORED_CREDENTIAL_ID,
      user_id: harness.account.user_id,
      public_key: Buffer.from('public-key'),
      sign_count: 5,
    } as WebAuthnCredential);
    const pending = await login().expect(201);
    const { mfa_token } = pending.body as { mfa_token: string };
    harness.verifyAuthentication.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 6 },
    });

    const completed = await request(server)
      .post('/auth/mfa/webauthn/verify')
      .set('Authorization', `Bearer ${mfa_token}`)
      .send({ response: { id: STORED_CREDENTIAL_ID } })
      .expect(201);

    expect(completed.body).toMatchObject({
      mfa_required: false,
      user: { user_id: harness.account.user_id },
    });
    expect(completed.headers['set-cookie']).toHaveLength(2);
    expect(harness.credentials.get(harness.account.user_id)?.sign_count).toBe(
      6,
    );
    expect(harness.verifyAuthentication).toHaveBeenCalledWith(
      { id: STORED_CREDENTIAL_ID },
      authenticationOptions.challenge,
      expect.objectContaining({ id: STORED_CREDENTIAL_ID, counter: 5 }),
    );

    await request(server)
      .post('/auth/mfa/webauthn/verify')
      .set('Authorization', `Bearer ${mfa_token}`)
      .send({ response: { id: STORED_CREDENTIAL_ID } })
      .expect(401);
  });

  it('rejects a failed verification and enforces five attempts', async () => {
    harness.credentials.set(harness.account.user_id, {
      credential_id: STORED_CREDENTIAL_ID,
      user_id: harness.account.user_id,
      public_key: Buffer.from('public-key'),
      sign_count: 5,
    } as WebAuthnCredential);
    const pending = await login().expect(201);
    const { mfa_token } = pending.body as { mfa_token: string };
    harness.verifyAuthentication.mockResolvedValue({ verified: false });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(server)
        .post('/auth/mfa/webauthn/verify')
        .set('Authorization', `Bearer ${mfa_token}`)
        .send({ response: { id: STORED_CREDENTIAL_ID } })
        .expect(401);
    }
    expect([...harness.challenges.values()][0].attempt_count).toBe(5);

    await login().expect(429);
  });
});
