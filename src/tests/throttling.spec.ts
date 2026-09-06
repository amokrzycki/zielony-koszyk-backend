import {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import * as request from 'supertest';
import { AuthController } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard, MfaJwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  MfaController,
  MfaSettingsController,
  TotpEnrollmentController,
} from '../auth/mfa.controller';
import { MfaService } from '../auth/mfa.service';
import { MfaMethod } from '../enums/MfaMethod';

const userId = 'c4f3a574-bfa8-4b77-ad92-5a7a771d8122';

class UserGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    context
      .switchToHttp()
      .getRequest<{ user: Record<string, unknown> }>().user = {
      user_id: userId,
    };
    return true;
  }
}

class PendingGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    context
      .switchToHttp()
      .getRequest<{ user: Record<string, unknown> }>().user = {
      user_id: userId,
      challenge_id: 'challenge-id',
      rememberMe: false,
      method: MfaMethod.EMAIL_OTP,
    };
    return true;
  }
}

describe('auth and MFA IP throttling', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const account = {
      user_id: userId,
      email: 'user@example.com',
      role: 'user',
      mfa_method: MfaMethod.NONE,
    };
    const session = {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      user: account,
    };
    const authService = {
      validateUser: jest.fn().mockResolvedValue(account),
      login: jest.fn().mockReturnValue(session),
      completeMfa: jest.fn().mockResolvedValue(session),
    };
    const mfaService = {
      verifyEmailOtp: jest.fn().mockResolvedValue(undefined),
      updateMethod: jest.fn().mockResolvedValue({ mfa_method: MfaMethod.NONE }),
      startTotpEnrollment: jest.fn().mockResolvedValue({
        challenge_id: 'challenge-id',
        otpauth_uri: 'otpauth://totp/example',
        secret: 'secret',
      }),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }])],
      controllers: [
        AuthController,
        MfaController,
        MfaSettingsController,
        TotpEnrollmentController,
      ],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: MfaService, useValue: mfaService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(UserGuard)
      .overrideGuard(MfaJwtAuthGuard)
      .useClass(PendingGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  it('limits login and enrollment to 5/min/IP and verification to 10/min/IP', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const statuses = async (
      count: number,
      send: () => PromiseLike<{ status: number }>,
    ) => {
      const responses: number[] = [];
      for (let requestNumber = 0; requestNumber < count; requestNumber += 1) {
        responses.push((await send()).status);
      }
      return responses;
    };

    expect(
      await statuses(6, () =>
        request(server).post('/auth/login').send({
          email: 'user@example.com',
          password: 'password',
        }),
      ),
    ).toEqual([201, 201, 201, 201, 201, 429]);

    expect(
      await statuses(11, () =>
        request(server)
          .post('/auth/mfa/email-otp/verify')
          .send({ code: '123456' }),
      ),
    ).toEqual([201, 201, 201, 201, 201, 201, 201, 201, 201, 201, 429]);

    expect(
      await statuses(6, () =>
        request(server)
          .post('/users/me/mfa/totp/enrollment')
          .send({ password: 'password' }),
      ),
    ).toEqual([201, 201, 201, 201, 201, 429]);

    expect(
      await statuses(6, () =>
        request(server).put('/users/me/mfa').send({
          method: MfaMethod.NONE,
          password: 'password',
        }),
      ),
    ).toEqual([200, 200, 200, 200, 200, 429]);
  });
});
