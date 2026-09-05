import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { EntityManager, Repository } from 'typeorm';
import {
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
import { MfaTokenPayload } from '../types/JWTPayload';

type ChallengeIdentity = Pick<
  MfaChallenge,
  'challenge_id' | 'user_id' | 'method' | 'purpose'
>;

type ChallengeVerifier = (
  challenge: MfaChallenge,
  manager: EntityManager,
) => boolean | Promise<boolean>;

@Injectable()
export class MfaService {
  constructor(
    @InjectRepository(MfaChallenge)
    private challenges: Repository<MfaChallenge>,
    private jwtService: JwtService,
  ) {}

  async createChallenge(
    user_id: string,
    method: MfaMethod,
    purpose: MfaChallengePurpose,
    ttlMs: number,
  ) {
    if (method === MfaMethod.NONE) {
      throw new BadRequestException('MFA is not enabled');
    }

    const challenge = this.challenges.create({
      challenge_id: randomUUID(),
      user_id,
      method,
      purpose,
      otp_digest: null,
      webauthn_challenge: null,
      totp_secret_encrypted: null,
      attempt_count: 0,
      expires_at: new Date(Date.now() + ttlMs),
    });

    await this.challenges.upsert(challenge, ['user_id', 'purpose']);
    return challenge;
  }

  async createLoginChallenge(
    user: Pick<User, 'user_id' | 'mfa_method'>,
    rememberMe = false,
  ) {
    const challenge = await this.createChallenge(
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
      if (challenge) {
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
          if (challenge) {
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
      challenge.expires_at.getTime() > Date.now() &&
      challenge.attempt_count < MFA_MAX_ATTEMPTS
    );
  }
}
