import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { EntityManager, Repository } from 'typeorm';
import {
  MFA_EMAIL_OTP_RESEND_COOLDOWN_MS,
  MFA_LOGIN_CHALLENGE_TTL_MS,
  MFA_MAX_ATTEMPTS,
  MFA_TOKEN_TTL,
} from '../constants/constants';
import {
  MfaChallenge,
  MfaChallengePurpose,
} from '../entities/mfa-challenge.entity';
import { User } from '../entities/user.entity';
import { MfaMethod } from '../enums/MfaMethod';
import { MailService } from '../services/mail.service';
import { MfaTokenPayload } from '../types/JWTPayload';

type ChallengeIdentity = Pick<
  MfaChallenge,
  'challenge_id' | 'user_id' | 'method' | 'purpose'
>;

type ChallengeVerifier = (
  challenge: MfaChallenge,
  manager: EntityManager,
) => boolean | Promise<boolean>;

type ChallengeSecrets = Pick<MfaChallenge, 'challenge_id' | 'otp_digest'>;

@Injectable()
export class MfaService {
  constructor(
    @InjectRepository(MfaChallenge)
    private challenges: Repository<MfaChallenge>,
    private jwtService: JwtService,
    private configService: ConfigService,
    private mailService: MailService,
  ) {}

  async createChallenge(
    user_id: string,
    method: MfaMethod,
    purpose: MfaChallengePurpose,
    ttlMs: number,
    secrets?: Partial<ChallengeSecrets>,
  ) {
    if (method === MfaMethod.NONE) {
      throw new BadRequestException('MFA is not enabled');
    }

    return this.challenges.manager.transaction(async (manager) => {
      if (method === MfaMethod.EMAIL_OTP) {
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`${user_id}:${purpose}`],
        );
      }

      const challenges = manager.getRepository(MfaChallenge);
      const existing = await challenges.findOne({
        where: { user_id, purpose },
        lock: { mode: 'pessimistic_write' },
      });
      const now = Date.now();
      const withinAttemptWindow = existing?.expires_at.getTime() > now;
      if (withinAttemptWindow && existing.attempt_count >= MFA_MAX_ATTEMPTS) {
        throw new HttpException(
          'Too many MFA attempts',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (
        existing?.method === MfaMethod.EMAIL_OTP &&
        existing.expires_at.getTime() -
          ttlMs +
          MFA_EMAIL_OTP_RESEND_COOLDOWN_MS >
          now
      ) {
        throw new HttpException(
          'Please wait before requesting another MFA code',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const challenge = challenges.create({
        challenge_id: randomUUID(),
        user_id,
        method,
        purpose,
        otp_digest: null,
        webauthn_challenge: null,
        totp_secret_encrypted: null,
        attempt_count: withinAttemptWindow ? existing.attempt_count : 0,
        expires_at: new Date(now + ttlMs),
        ...secrets,
      });

      await challenges.upsert(challenge, ['user_id', 'purpose']);
      return challenge;
    });
  }

  async createLoginChallenge(
    user: Pick<User, 'user_id' | 'email' | 'mfa_method'>,
    rememberMe = false,
  ) {
    const challenge =
      user.mfa_method === MfaMethod.EMAIL_OTP
        ? await this.createEmailOtpChallenge(user)
        : await this.createChallenge(
            user.user_id,
            user.mfa_method,
            MfaChallengePurpose.LOGIN,
            MFA_LOGIN_CHALLENGE_TTL_MS,
          );
    const payload: MfaTokenPayload = {
      sub: user.user_id,
      type: 'mfa',
      jti: challenge.challenge_id,
      method: user.mfa_method as Exclude<MfaMethod, MfaMethod.NONE>,
      rememberMe,
    };

    return {
      method: payload.method,
      mfa_token: this.jwtService.sign(payload, {
        expiresIn: MFA_TOKEN_TTL,
        algorithm: 'HS256',
      }),
    };
  }

  async verifyEmailOtp(user_id: string, challenge_id: string, code: string) {
    await this.consumeChallenge(
      {
        challenge_id,
        user_id,
        method: MfaMethod.EMAIL_OTP,
        purpose: MfaChallengePurpose.LOGIN,
      },
      (challenge) => this.matchesEmailOtp(challenge, code),
    );
  }

  async assertLoginChallenge(payload: MfaTokenPayload) {
    return this.assertChallenge({
      challenge_id: payload.jti,
      user_id: payload.sub,
      method: payload.method,
      purpose: MfaChallengePurpose.LOGIN,
    });
  }

  async assertChallenge(identity: ChallengeIdentity) {
    const challenge = await this.challenges.findOne({ where: identity });

    if (!challenge || !this.isUsable(challenge)) {
      if (challenge && this.isExpired(challenge)) {
        await this.challenges.delete({ challenge_id: challenge.challenge_id });
      }
      throw new UnauthorizedException('Invalid or expired MFA challenge');
    }

    return challenge;
  }

  async consumeChallenge(
    identity: ChallengeIdentity,
    verify: ChallengeVerifier,
  ) {
    const accepted = await this.challenges.manager.transaction(
      async (manager) => {
        const challenges = manager.getRepository(MfaChallenge);
        const challenge = await challenges.findOne({
          where: identity,
          select: {
            challenge_id: true,
            user_id: true,
            method: true,
            purpose: true,
            otp_digest: true,
            webauthn_challenge: true,
            totp_secret_encrypted: true,
            attempt_count: true,
            expires_at: true,
          },
          lock: { mode: 'pessimistic_write' },
        });

        if (!challenge || !this.isUsable(challenge)) {
          if (challenge && this.isExpired(challenge)) {
            await challenges.delete({ challenge_id: challenge.challenge_id });
          }
          return false;
        }

        if (!(await verify(challenge, manager))) {
          challenge.attempt_count += 1;
          await challenges.save(challenge);
          return false;
        }

        await challenges.delete({ challenge_id: challenge.challenge_id });
        return true;
      },
    );

    if (!accepted) {
      throw new UnauthorizedException('Invalid or expired MFA challenge');
    }
  }

  async consumeLoginChallenge(
    payload: MfaTokenPayload,
    verify: ChallengeVerifier,
  ) {
    return this.consumeChallenge(
      {
        challenge_id: payload.jti,
        user_id: payload.sub,
        method: payload.method,
        purpose: MfaChallengePurpose.LOGIN,
      },
      verify,
    );
  }

  private isUsable(challenge: MfaChallenge) {
    return (
      !this.isExpired(challenge) && challenge.attempt_count < MFA_MAX_ATTEMPTS
    );
  }

  private isExpired(challenge: MfaChallenge) {
    return challenge.expires_at.getTime() <= Date.now();
  }

  private async createEmailOtpChallenge(user: Pick<User, 'user_id' | 'email'>) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const challenge_id = randomUUID();
    const challenge = await this.createChallenge(
      user.user_id,
      MfaMethod.EMAIL_OTP,
      MfaChallengePurpose.LOGIN,
      MFA_LOGIN_CHALLENGE_TTL_MS,
      {
        challenge_id,
        otp_digest: this.emailOtpDigest(challenge_id, code),
      },
    );

    try {
      await this.mailService.sendMfaOtp(user.email, code);
    } catch {
      await this.challenges.delete({ challenge_id: challenge.challenge_id });
      throw new ServiceUnavailableException('Unable to send MFA code');
    }

    return challenge;
  }

  private matchesEmailOtp(challenge: MfaChallenge, code: string) {
    if (!challenge.otp_digest) return false;

    const expected = Buffer.from(challenge.otp_digest, 'hex');
    const actual = Buffer.from(
      this.emailOtpDigest(challenge.challenge_id, code),
      'hex',
    );
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }

  private emailOtpDigest(challenge_id: string, code: string) {
    return createHmac('sha256', this.otpHmacKey())
      .update(`${challenge_id}:${code}`)
      .digest('hex');
  }

  private otpHmacKey() {
    const encoded = this.configService.get<string>('MFA_OTP_HMAC_KEY');
    const key = Buffer.from(encoded ?? '', 'base64');

    if (
      !encoded ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
      key.length < 32
    ) {
      throw new Error('MFA_OTP_HMAC_KEY must contain at least 32 base64 bytes');
    }

    return key;
  }
}
