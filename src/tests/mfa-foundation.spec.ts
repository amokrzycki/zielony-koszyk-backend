import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import type { Response } from 'express';
import * as request from 'supertest';
import type { EntityManager, Repository } from 'typeorm';
import { AuthController } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import {
  JwtAuthGuard,
  MfaJwtAuthGuard,
  RefreshTokenAuthGuard,
} from '../auth/jwt-auth.guard';
import {
  JwtStrategy,
  MfaJwtStrategy,
  RefreshTokenStrategy,
} from '../auth/jwt.strategy';
import { MfaService } from '../auth/mfa.service';
import { MfaController } from '../auth/mfa.controller';
import type { WebAuthnService } from '../auth/webauthn.service';
import type { WebAuthnCredential } from '../entities/webauthn-credential.entity';
import {
  MFA_EMAIL_OTP_RESEND_COOLDOWN_MS,
  MFA_LOGIN_CHALLENGE_TTL_MS,
} from '../constants/constants';
import {
  MfaChallenge,
  MfaChallengePurpose,
} from '../entities/mfa-challenge.entity';
import { User } from '../entities/user.entity';
import { MfaMethod } from '../enums/MfaMethod';
import type { UserService } from '../services/user.service';
import type { MailService } from '../services/mail.service';
import type { MfaTokenPayload } from '../types/JWTPayload';

@Controller('guard-probe')
class GuardProbeController {
  @Get('access')
  @UseGuards(JwtAuthGuard)
  access() {
    return { allowed: true };
  }

  @Get('refresh')
  @UseGuards(RefreshTokenAuthGuard)
  refresh() {
    return { allowed: true };
  }

  @Get('mfa')
  @UseGuards(MfaJwtAuthGuard)
  mfa() {
    return { allowed: true };
  }
}

const responseMock = () => {
  const response = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    json: jest.fn(),
  };
  response.cookie.mockReturnValue(response);
  response.clearCookie.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response;
};

const user = (method: MfaMethod) =>
  ({
    user_id: 'c4f3a574-bfa8-4b77-ad92-5a7a771d8122',
    email: 'user@example.com',
    role: 'user',
    mfa_method: method,
  }) as unknown as User;

describe('MFA login separation', () => {
  it('keeps full login and cookies for accounts without MFA', async () => {
    const account = user(MfaMethod.NONE);
    const session = {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      user: account,
    };
    const authService = {
      validateUser: jest.fn().mockResolvedValue(account),
      login: jest.fn().mockReturnValue(session),
    } as unknown as AuthService;
    const createLoginChallenge = jest.fn();
    const mfaService = { createLoginChallenge } as unknown as MfaService;
    const response = responseMock();

    const result = await new AuthController(authService, mfaService).login(
      { email: account.email, password: 'password', rememberMe: true },
      response as unknown as Response,
    );

    expect(result).toBeUndefined();
    expect(response.cookie).toHaveBeenCalledTimes(2);
    expect(response.clearCookie).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith({
      mfa_required: false,
      access_token: 'access-token',
      user: account,
    });
    expect(createLoginChallenge).not.toHaveBeenCalled();
  });

  it('returns only pending state and clears old cookies for accounts with MFA', async () => {
    const account = user(MfaMethod.TOTP);
    const login = jest.fn();
    const authService = {
      validateUser: jest.fn().mockResolvedValue(account),
      login,
    } as unknown as AuthService;
    const createLoginChallenge = jest.fn().mockResolvedValue({
      method: MfaMethod.TOTP,
      mfa_token: 'mfa-token',
    });
    const mfaService = { createLoginChallenge } as unknown as MfaService;
    const response = responseMock();

    const result = await new AuthController(authService, mfaService).login(
      { email: account.email, password: 'password', rememberMe: false },
      response as unknown as Response,
    );

    expect(result).toBeUndefined();
    expect(response.cookie).not.toHaveBeenCalled();
    expect(response.clearCookie).toHaveBeenCalledTimes(2);
    expect(response.json).toHaveBeenCalledWith({
      mfa_required: true,
      method: MfaMethod.TOTP,
      mfa_token: 'mfa-token',
    });
    expect(login).not.toHaveBeenCalled();
  });
});

const mfaServiceFixture = (
  otpHmacKey = Buffer.alloc(32, 1).toString('base64'),
) => {
  const challenges = new Map<string, MfaChallenge>();
  const repository = {
    create: jest.fn((challenge: MfaChallenge) => challenge),
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
    findOne: jest.fn(({ where }: { where: Partial<MfaChallenge> }) =>
      [...challenges.values()].find((challenge) =>
        Object.entries(where).every(
          ([key, value]) => challenge[key as keyof MfaChallenge] === value,
        ),
      ),
    ),
    save: jest.fn((challenge: MfaChallenge) => {
      challenges.set(challenge.challenge_id, challenge);
      return challenge;
    }),
    delete: jest.fn(({ challenge_id }: { challenge_id: string }) => {
      challenges.delete(challenge_id);
    }),
  };
  const userRepository = {
    findOne: jest.fn(({ where }: { where: Partial<User> }) => ({
      user_id: where.user_id,
      mfa_method: where.mfa_method ?? MfaMethod.TOTP,
      totp_secret_encrypted: 'configured',
    })),
  };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === User ? userRepository : repository,
    query: jest.fn(),
  } as unknown as EntityManager;
  Object.assign(repository, {
    manager: {
      transaction: (
        work: (transactionManager: EntityManager) => Promise<unknown>,
      ) => work(manager),
    },
  });
  const jwtService = new JwtService({ secret: 'test-secret' });
  const configService = new ConfigService({
    MFA_OTP_HMAC_KEY: otpHmacKey,
    MFA_TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString('base64'),
  });
  const sendMfaOtp = jest.fn().mockResolvedValue(undefined);
  const mailService = { sendMfaOtp } as unknown as MailService;

  return {
    challenges,
    jwtService,
    sendMfaOtp,
    repository,
    service: new MfaService(
      repository as unknown as Repository<MfaChallenge>,
      userRepository as unknown as Repository<User>,
      jwtService,
      configService,
      mailService,
      {
        findOne: jest.fn().mockResolvedValue(null),
      } as unknown as Repository<WebAuthnCredential>,
      {} as unknown as WebAuthnService,
    ),
  };
};

describe('MFA challenge lifecycle', () => {
  it('enforces replacement, TTL, attempt limit and one-time consumption', async () => {
    const { challenges, jwtService, repository, service } = mfaServiceFixture();
    const account = user(MfaMethod.TOTP);
    const first = await service.createLoginChallenge(account, true);
    const firstPayload = jwtService.verify<
      MfaTokenPayload & { exp: number; iat: number }
    >(first.mfa_token, { algorithms: ['HS256'] });
    const replacement = await service.createLoginChallenge(account, true);
    const payload = jwtService.verify<MfaTokenPayload>(replacement.mfa_token, {
      algorithms: ['HS256'],
    });

    expect(challenges.size).toBe(1);
    expect(firstPayload.exp - firstPayload.iat).toBe(5 * 60);
    expect(firstPayload).not.toHaveProperty('email');
    expect(firstPayload).not.toHaveProperty('role');
    await expect(service.assertLoginChallenge(firstPayload)).rejects.toThrow(
      'Invalid or expired MFA challenge',
    );

    const invalid = jest.fn().mockReturnValue(false);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        service.consumeLoginChallenge(payload, invalid),
      ).rejects.toThrow('Invalid or expired MFA challenge');
    }
    expect(challenges.get(payload.jti)?.attempt_count).toBe(5);

    await expect(
      service.createLoginChallenge(account, true),
    ).rejects.toMatchObject({
      status: 429,
      message: 'Too many MFA attempts',
    });

    const valid = jest.fn().mockReturnValue(true);
    await expect(service.consumeLoginChallenge(payload, valid)).rejects.toThrow(
      'Invalid or expired MFA challenge',
    );
    expect(valid).not.toHaveBeenCalled();
    expect(challenges.size).toBe(1);

    const lockedChallenge = challenges.get(payload.jti);
    if (!lockedChallenge) throw new Error('Expected locked challenge');
    lockedChallenge.expires_at = new Date(Date.now() - 1);
    await expect(service.assertLoginChallenge(payload)).rejects.toThrow(
      'Invalid or expired MFA challenge',
    );
    expect(challenges.size).toBe(0);

    const expiring = await service.createChallenge(
      account.user_id,
      MfaMethod.TOTP,
      MfaChallengePurpose.ENROLLMENT,
      1,
    );
    expiring.expires_at = new Date(Date.now() - 1);
    await expect(
      service.assertChallenge({
        challenge_id: expiring.challenge_id,
        user_id: expiring.user_id,
        method: expiring.method,
        purpose: expiring.purpose,
      }),
    ).rejects.toThrow('Invalid or expired MFA challenge');
    expect(challenges.size).toBe(0);

    const final = await service.createLoginChallenge(account, false);
    const finalPayload = jwtService.verify<MfaTokenPayload>(final.mfa_token, {
      algorithms: ['HS256'],
    });
    await service.consumeLoginChallenge(finalPayload, valid);
    await expect(
      service.consumeLoginChallenge(finalPayload, valid),
    ).rejects.toThrow('Invalid or expired MFA challenge');
    expect(challenges.size).toBe(0);
    expect(repository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        lock: { mode: 'pessimistic_write' },
      }),
    );
  });
});

describe('Email OTP', () => {
  it('rejects a weak HMAC key before storing or sending a code', async () => {
    const fixture = mfaServiceFixture('d2Vhaw==');

    await expect(
      fixture.service.createLoginChallenge(user(MfaMethod.EMAIL_OTP)),
    ).rejects.toThrow('MFA_OTP_HMAC_KEY must contain at least 32 base64 bytes');
    expect(fixture.challenges.size).toBe(0);
    expect(fixture.sendMfaOtp).not.toHaveBeenCalled();
  });

  it('generates only a digest, rejects bad codes and consumes a valid code once', async () => {
    const { challenges, jwtService, sendMfaOtp, service } = mfaServiceFixture();
    const account = user(MfaMethod.EMAIL_OTP);
    const pending = await service.createLoginChallenge(account, true);
    const payload = jwtService.verify<MfaTokenPayload>(pending.mfa_token, {
      algorithms: ['HS256'],
    });
    const code = sendMfaOtp.mock.calls[0][1] as string;
    const challenge = challenges.get(payload.jti);

    expect(code).toMatch(/^\d{6}$/);
    expect(challenge?.otp_digest).toMatch(/^[a-f\d]{64}$/);
    expect(JSON.stringify(challenge)).not.toContain(code);

    const wrongCode = code === '000000' ? '000001' : '000000';
    await expect(
      service.verifyEmailOtp(account.user_id, payload.jti, wrongCode),
    ).rejects.toThrow('Invalid or expired MFA challenge');
    expect(challenge?.attempt_count).toBe(1);

    await service.verifyEmailOtp(account.user_id, payload.jti, code);
    await expect(
      service.verifyEmailOtp(account.user_id, payload.jti, code),
    ).rejects.toThrow('Invalid or expired MFA challenge');
    expect(challenges.size).toBe(0);
  });

  it('waits for SMTP and removes only the failed challenge', async () => {
    const fixture = mfaServiceFixture();
    const account = user(MfaMethod.EMAIL_OTP);
    let acceptMail: () => void;
    fixture.sendMfaOtp.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        acceptMail = resolve;
      }),
    );
    let settled = false;
    const pending = fixture.service
      .createLoginChallenge(account)
      .finally(() => {
        settled = true;
      });

    await new Promise(setImmediate);
    expect(fixture.sendMfaOtp).toHaveBeenCalledTimes(1);
    expect(fixture.challenges.size).toBe(1);
    expect(settled).toBe(false);
    acceptMail();
    await pending;

    const delivered = [...fixture.challenges.values()][0];
    delivered.expires_at = new Date(Date.now() - 1);
    fixture.sendMfaOtp.mockRejectedValueOnce(new Error('SMTP credentials'));
    await expect(
      fixture.service.createLoginChallenge(account),
    ).rejects.toMatchObject({
      status: 503,
      response: { message: 'Unable to send MFA code' },
    });
    expect(fixture.challenges.size).toBe(0);
  });

  it('throttles resends, refreshes expiry and rejects locked challenges', async () => {
    const { challenges, jwtService, sendMfaOtp, service } = mfaServiceFixture();
    const account = user(MfaMethod.EMAIL_OTP);
    const first = await service.createLoginChallenge(account);
    const firstPayload = jwtService.verify<MfaTokenPayload>(first.mfa_token);
    const firstCode = sendMfaOtp.mock.calls[0][1] as string;

    await expect(service.createLoginChallenge(account)).rejects.toMatchObject({
      status: 429,
      message: 'Please wait before requesting another MFA code',
    });
    expect(sendMfaOtp).toHaveBeenCalledTimes(1);

    const firstChallenge = challenges.get(firstPayload.jti);
    if (!firstChallenge) throw new Error('Expected first challenge');
    firstChallenge.expires_at = new Date(
      Date.now() +
        MFA_LOGIN_CHALLENGE_TTL_MS -
        MFA_EMAIL_OTP_RESEND_COOLDOWN_MS -
        1,
    );
    const second = await service.createLoginChallenge(account);
    const secondPayload = jwtService.verify<MfaTokenPayload>(second.mfa_token);
    const secondCode = sendMfaOtp.mock.calls[1][1] as string;

    await expect(
      service.verifyEmailOtp(account.user_id, firstPayload.jti, firstCode),
    ).rejects.toThrow('Invalid or expired MFA challenge');

    const current = challenges.get(secondPayload.jti);
    if (!current) throw new Error('Expected current challenge');
    expect(current.expires_at.getTime()).toBeGreaterThanOrEqual(
      Date.now() + MFA_LOGIN_CHALLENGE_TTL_MS - 1_000,
    );

    const wrongCode = secondCode === '000000' ? '000001' : '000000';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        service.verifyEmailOtp(account.user_id, secondPayload.jti, wrongCode),
      ).rejects.toThrow('Invalid or expired MFA challenge');
    }
    await expect(service.createLoginChallenge(account)).rejects.toMatchObject({
      status: 429,
      message: 'Too many MFA attempts',
    });
    expect(sendMfaOtp).toHaveBeenCalledTimes(2);
    expect(challenges.get(secondPayload.jti)?.attempt_count).toBe(5);
  });
});

describe('MFA token isolation', () => {
  it('accepts pending payload only through MFA strategy', async () => {
    const config = new ConfigService({ JWT_SECRET: 'test-secret' });
    const assertLoginChallenge = jest.fn().mockResolvedValue({});
    const mfaService = { assertLoginChallenge } as unknown as MfaService;
    const accessStrategy = new JwtStrategy(config);
    const refreshStrategy = new RefreshTokenStrategy(config);
    const mfaStrategy = new MfaJwtStrategy(config, mfaService);
    const payload: MfaTokenPayload = {
      sub: 'user-id',
      type: 'mfa',
      jti: 'challenge-id',
      method: MfaMethod.WEBAUTHN,
      rememberMe: true,
    };

    expect(accessStrategy.validate(payload)).toBe(false);
    expect(refreshStrategy.validate(payload)).toBe(false);
    await expect(mfaStrategy.validate(payload)).resolves.toEqual({
      user_id: 'user-id',
      challenge_id: 'challenge-id',
      method: MfaMethod.WEBAUTHN,
      rememberMe: true,
    });
    expect(assertLoginChallenge).toHaveBeenCalledWith(payload);
    await expect(
      mfaStrategy.validate({
        sub: 'user-id',
        email: 'user@example.com',
        role: 'user',
      }),
    ).resolves.toBe(false);
  });

  it('separates full and pending sessions through HTTP guards', async () => {
    const {
      challenges,
      jwtService,
      sendMfaOtp,
      service: mfaService,
    } = mfaServiceFixture();
    const account = user(MfaMethod.NONE);
    account.password = await bcrypt.hash('password', 4);
    const usersService = {
      findByEmail: jest.fn().mockResolvedValue(account),
      findById: jest.fn().mockResolvedValue(account),
    } as unknown as UserService;
    const authService = new AuthService(usersService, jwtService);
    const configService = new ConfigService({ JWT_SECRET: 'test-secret' });
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [AuthController, MfaController, GuardProbeController],
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
    await app.init();
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    try {
      const full = await request(server)
        .post('/auth/login')
        .send({ email: account.email, password: 'password', rememberMe: true })
        .expect(201);
      const fullBody = full.body as {
        mfa_required: false;
        access_token: string;
        user: { user_id: string };
      };
      const fullCookies = full.headers['set-cookie'] as unknown as string[];
      const refreshCookie = fullCookies
        .find((cookie) => cookie.startsWith('refreshToken='))
        ?.split(';')[0];

      expect(fullBody).toMatchObject({
        mfa_required: false,
        user: { user_id: account.user_id },
      });
      expect(full.body).toHaveProperty('access_token');
      expect(fullCookies).toHaveLength(2);
      await request(server)
        .get('/guard-probe/access')
        .set('Authorization', `Bearer ${fullBody.access_token}`)
        .expect(200);
      await request(server)
        .get('/guard-probe/refresh')
        .set('Cookie', refreshCookie ?? '')
        .expect(200);
      const refreshed = await request(server)
        .post('/auth/refresh')
        .set('Cookie', refreshCookie ?? '')
        .expect(201);
      expect(refreshed.body).toMatchObject({
        mfa_required: false,
        user: { user_id: account.user_id },
      });
      expect(refreshed.headers['set-cookie']).toHaveLength(2);

      account.mfa_method = MfaMethod.EMAIL_OTP;
      const staleRefreshed = await request(server)
        .post('/auth/refresh')
        .set('Cookie', refreshCookie ?? '')
        .expect(201);
      expect(
        jwtService.decode(staleRefreshed.body.access_token as string),
      ).not.toHaveProperty('method');
      const pending = await request(server)
        .post('/auth/login')
        .set('Cookie', fullCookies)
        .send({ email: account.email, password: 'password', rememberMe: false })
        .expect(201);
      const pendingBody = pending.body as {
        mfa_required: true;
        method: MfaMethod;
        mfa_token: string;
      };
      const pendingCookies = pending.headers[
        'set-cookie'
      ] as unknown as string[];

      expect(pendingBody).toEqual({
        mfa_required: true,
        method: MfaMethod.EMAIL_OTP,
        mfa_token: expect.any(String) as string,
      });
      expect(pendingCookies).toHaveLength(2);
      expect(
        pendingCookies.every((cookie) => cookie.includes('Expires=')),
      ).toBe(true);
      expect(challenges.size).toBe(1);
      await request(server)
        .get('/guard-probe/access')
        .set('Authorization', `Bearer ${pendingBody.mfa_token}`)
        .expect(401);
      await request(server)
        .post('/auth/refresh')
        .set('Cookie', `refreshToken=${pendingBody.mfa_token}`)
        .expect(401);
      await request(server)
        .get('/guard-probe/mfa')
        .set('Authorization', `Bearer ${pendingBody.mfa_token}`)
        .expect(200);
      await request(server)
        .get('/guard-probe/mfa')
        .set('Cookie', `accessToken=${pendingBody.mfa_token}`)
        .expect(401);

      const code = sendMfaOtp.mock.calls[0][1] as string;
      const verified = await request(server)
        .post('/auth/mfa/email-otp/verify')
        .set('Authorization', `Bearer ${pendingBody.mfa_token}`)
        .send({ code })
        .expect(201);
      expect(verified.body).toMatchObject({
        mfa_required: false,
        user: { user_id: account.user_id },
      });
      expect(verified.body).toHaveProperty('access_token');
      expect(
        jwtService.decode(verified.body.access_token as string),
      ).toMatchObject({ method: MfaMethod.EMAIL_OTP });
      expect(verified.headers['set-cookie']).toHaveLength(2);
      expect(challenges.size).toBe(0);
      await request(server)
        .post('/auth/mfa/email-otp/verify')
        .set('Authorization', `Bearer ${pendingBody.mfa_token}`)
        .send({ code })
        .expect(401);
    } finally {
      await app.close();
    }
  });
});
