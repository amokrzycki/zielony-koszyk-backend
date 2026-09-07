import {
  BadRequestException,
  ForbiddenException,
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
import * as bcrypt from 'bcrypt';
import * as OTPAuth from 'otpauth';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  VerifiedAuthenticationResponse,
  VerifiedRegistrationResponse,
} from '@simplewebauthn/server';
import { EntityManager, Repository } from 'typeorm';
import {
  MFA_EMAIL_OTP_RESEND_COOLDOWN_MS,
  MFA_ENROLLMENT_CHALLENGE_TTL_MS,
  MFA_LOGIN_CHALLENGE_TTL_MS,
  MFA_MAX_ATTEMPTS,
  MFA_TOKEN_TTL,
  MFA_TOTP_ALGORITHM,
  MFA_TOTP_DIGITS,
  MFA_TOTP_ISSUER,
  MFA_TOTP_PERIOD_SECONDS,
  MFA_TOTP_SECRET_BYTES,
  MFA_TOTP_WINDOW,
} from '../constants/constants';
import {
  MfaChallenge,
  MfaChallengePurpose,
} from '../entities/mfa-challenge.entity';
import { User } from '../entities/user.entity';
import { WebAuthnCredential } from '../entities/webauthn-credential.entity';
import { MfaMethod } from '../enums/MfaMethod';
import type { ActiveMfaMethod } from '../enums/MfaMethod';
import { MailService } from '../services/mail.service';
import { MfaTokenPayload } from '../types/JWTPayload';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  parseTotpEncryptionKey,
} from './totp-secret.crypto';
import { WebAuthnService } from './webauthn.service';

type ChallengeIdentity = Pick<
  MfaChallenge,
  'challenge_id' | 'user_id' | 'method' | 'purpose'
>;

type ChallengeVerifier = (
  challenge: MfaChallenge,
  manager: EntityManager,
) => boolean | Promise<boolean>;

type ChallengeSecrets = Pick<
  MfaChallenge,
  'challenge_id' | 'otp_digest' | 'webauthn_challenge' | 'totp_secret_encrypted'
>;

@Injectable()
export class MfaService {
  private readonly totpEncryptionKey: Buffer;

  constructor(
    @InjectRepository(MfaChallenge)
    private challenges: Repository<MfaChallenge>,
    @InjectRepository(User)
    private users: Repository<User>,
    private jwtService: JwtService,
    private configService: ConfigService,
    private mailService: MailService,
    @InjectRepository(WebAuthnCredential)
    private credentials: Repository<WebAuthnCredential>,
    private webAuthnService: WebAuthnService,
  ) {
    this.totpEncryptionKey = parseTotpEncryptionKey(
      configService.get<string>('MFA_TOTP_ENCRYPTION_KEY'),
    );
  }

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
    if (user.mfa_method === MfaMethod.TOTP) {
      await this.assertTotpConfigured(user.user_id);
    }

    const webauthnOptions =
      user.mfa_method === MfaMethod.WEBAUTHN
        ? await this.webAuthnService.generateAuthenticationOptions(
            await this.requireCredential(user.user_id),
          )
        : undefined;

    const challenge =
      user.mfa_method === MfaMethod.EMAIL_OTP
        ? await this.createEmailOtpChallenge(user)
        : await this.createChallenge(
            user.user_id,
            user.mfa_method,
            MfaChallengePurpose.LOGIN,
            MFA_LOGIN_CHALLENGE_TTL_MS,
            webauthnOptions
              ? { webauthn_challenge: webauthnOptions.challenge }
              : undefined,
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
      ...(webauthnOptions ? { webauthn_options: webauthnOptions } : {}),
    };
  }

  async updateMethod(
    user_id: string,
    password: string,
    method: MfaMethod.NONE | MfaMethod.EMAIL_OTP,
    verifiedMethod?: ActiveMfaMethod,
  ) {
    return this.challenges.manager.transaction(async (manager) => {
      await manager.getRepository(MfaChallenge).delete({ user_id });
      const users = manager.getRepository(User);
      const account = await users.findOne({
        where: { user_id },
        select: {
          user_id: true,
          password: true,
          mfa_method: true,
          totp_secret_encrypted: true,
          totp_last_used_step: true,
        },
        loadEagerRelations: false,
        lock: { mode: 'pessimistic_write' },
      });
      if (!account || !(await bcrypt.compare(password, account.password))) {
        throw new ForbiddenException('Invalid credentials');
      }
      this.assertCurrentMfaVerified(account.mfa_method, verifiedMethod);

      account.mfa_method = method;
      account.totp_secret_encrypted = null;
      account.totp_last_used_step = null;
      await users.save(account);
      await manager.getRepository(WebAuthnCredential).delete({ user_id });

      return { mfa_method: method };
    });
  }

  async startTotpEnrollment(
    user_id: string,
    password: string,
    verifiedMethod?: ActiveMfaMethod,
  ) {
    const account = await this.users.findOne({
      where: { user_id },
      select: {
        user_id: true,
        email: true,
        password: true,
        mfa_method: true,
      },
    });
    if (!account || !(await bcrypt.compare(password, account.password))) {
      throw new ForbiddenException('Invalid credentials');
    }
    this.assertCurrentMfaVerified(account.mfa_method, verifiedMethod);

    const secret = new OTPAuth.Secret({ size: MFA_TOTP_SECRET_BYTES });
    const totp = this.totp(secret.base32, account.email);
    const challenge = await this.createChallenge(
      user_id,
      MfaMethod.TOTP,
      MfaChallengePurpose.ENROLLMENT,
      MFA_ENROLLMENT_CHALLENGE_TTL_MS,
      {
        totp_secret_encrypted: encryptTotpSecret(
          secret.base32,
          user_id,
          this.totpEncryptionKey,
        ),
      },
    );

    return {
      challenge_id: challenge.challenge_id,
      otpauth_uri: totp.toString(),
      secret: secret.base32,
    };
  }

  async verifyTotpEnrollment(
    user_id: string,
    challenge_id: string,
    code: string,
    verifiedMethod?: ActiveMfaMethod,
  ) {
    try {
      await this.consumeChallenge(
        {
          challenge_id,
          user_id,
          method: MfaMethod.TOTP,
          purpose: MfaChallengePurpose.ENROLLMENT,
        },
        async (challenge, manager) => {
          if (!challenge.totp_secret_encrypted) return false;

          const users = manager.getRepository(User);
          const account = await users.findOne({
            where: { user_id },
            select: { user_id: true, email: true, mfa_method: true },
            loadEagerRelations: false,
            lock: { mode: 'pessimistic_write' },
          });
          if (!account) return false;
          this.assertCurrentMfaVerified(account.mfa_method, verifiedMethod);

          const secret = decryptTotpSecret(
            challenge.totp_secret_encrypted,
            user_id,
            this.totpEncryptionKey,
          );
          const acceptedStep = this.acceptedTotpStep(
            secret,
            account.email,
            code,
          );
          if (acceptedStep === null) return false;

          account.mfa_method = MfaMethod.TOTP;
          account.totp_secret_encrypted = encryptTotpSecret(
            secret,
            user_id,
            this.totpEncryptionKey,
          );
          account.totp_last_used_step = acceptedStep;
          await users.save(account);
          await manager.getRepository(WebAuthnCredential).delete({ user_id });
          return true;
        },
      );
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw new BadRequestException('Invalid or expired MFA challenge');
      }
      throw error;
    }
  }

  async verifyEmailOtp(user_id: string, challenge_id: string, code: string) {
    await this.consumeChallenge(
      {
        challenge_id,
        user_id,
        method: MfaMethod.EMAIL_OTP,
        purpose: MfaChallengePurpose.LOGIN,
      },
      async (challenge, manager) => {
        const account = await manager.getRepository(User).findOne({
          where: { user_id, mfa_method: MfaMethod.EMAIL_OTP },
          select: { user_id: true },
          loadEagerRelations: false,
          lock: { mode: 'pessimistic_write' },
        });

        return Boolean(account) && this.matchesEmailOtp(challenge, code);
      },
    );
  }

  async verifyTotp(user_id: string, challenge_id: string, code: string) {
    await this.consumeChallenge(
      {
        challenge_id,
        user_id,
        method: MfaMethod.TOTP,
        purpose: MfaChallengePurpose.LOGIN,
      },
      async (_challenge, manager) => {
        const users = manager.getRepository(User);
        const account = await users.findOne({
          where: { user_id },
          select: {
            user_id: true,
            email: true,
            mfa_method: true,
            totp_secret_encrypted: true,
            totp_last_used_step: true,
          },
          loadEagerRelations: false,
          lock: { mode: 'pessimistic_write' },
        });
        if (
          !account ||
          account.mfa_method !== MfaMethod.TOTP ||
          !account.totp_secret_encrypted
        ) {
          return false;
        }

        const secret = decryptTotpSecret(
          account.totp_secret_encrypted,
          user_id,
          this.totpEncryptionKey,
        );
        const acceptedStep = this.acceptedTotpStep(secret, account.email, code);
        if (
          acceptedStep === null ||
          (account.totp_last_used_step !== null &&
            acceptedStep <= account.totp_last_used_step)
        ) {
          return false;
        }

        account.totp_last_used_step = acceptedStep;
        await users.save(account);
        return true;
      },
    );
  }

  async startWebAuthnRegistration(
    user_id: string,
    password: string,
    verifiedMethod?: ActiveMfaMethod,
  ) {
    const account = await this.users.findOne({
      where: { user_id },
      select: {
        user_id: true,
        email: true,
        password: true,
        mfa_method: true,
      },
    });
    if (!account || !(await bcrypt.compare(password, account.password))) {
      throw new ForbiddenException('Invalid credentials');
    }
    this.assertCurrentMfaVerified(account.mfa_method, verifiedMethod);

    const existingCredential = await this.loadCredential(user_id);
    const options = await this.webAuthnService.generateRegistrationOptions(
      account,
      existingCredential ?? undefined,
    );
    const challenge = await this.createChallenge(
      user_id,
      MfaMethod.WEBAUTHN,
      MfaChallengePurpose.ENROLLMENT,
      MFA_ENROLLMENT_CHALLENGE_TTL_MS,
      { webauthn_challenge: options.challenge },
    );

    return { challenge_id: challenge.challenge_id, options };
  }

  async verifyWebAuthnRegistration(
    user_id: string,
    challenge_id: string,
    response: RegistrationResponseJSON,
    verifiedMethod?: ActiveMfaMethod,
  ) {
    try {
      await this.consumeChallenge(
        {
          challenge_id,
          user_id,
          method: MfaMethod.WEBAUTHN,
          purpose: MfaChallengePurpose.ENROLLMENT,
        },
        async (challenge, manager) => {
          if (!challenge.webauthn_challenge) return false;

          let verification: VerifiedRegistrationResponse | null;
          try {
            verification = await this.webAuthnService.verifyRegistration(
              response,
              challenge.webauthn_challenge,
            );
          } catch {
            verification = null;
          }
          if (!verification?.verified || !verification.registrationInfo) {
            return false;
          }

          const users = manager.getRepository(User);
          const account = await users.findOne({
            where: { user_id },
            loadEagerRelations: false,
            lock: { mode: 'pessimistic_write' },
          });
          if (!account) return false;
          this.assertCurrentMfaVerified(account.mfa_method, verifiedMethod);

          const { credential } = verification.registrationInfo;
          const credentials = manager.getRepository(WebAuthnCredential);
          await credentials.delete({ user_id });
          await credentials.insert({
            credential_id: credential.id,
            user_id,
            public_key: Buffer.from(credential.publicKey),
            sign_count: credential.counter,
          });

          account.mfa_method = MfaMethod.WEBAUTHN;
          account.totp_secret_encrypted = null;
          account.totp_last_used_step = null;
          await users.save(account);
          return true;
        },
      );
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw new BadRequestException('Invalid or expired MFA challenge');
      }
      throw error;
    }
  }

  async verifyWebAuthnAuthentication(
    user_id: string,
    challenge_id: string,
    response: AuthenticationResponseJSON,
  ) {
    await this.consumeChallenge(
      {
        challenge_id,
        user_id,
        method: MfaMethod.WEBAUTHN,
        purpose: MfaChallengePurpose.LOGIN,
      },
      async (challenge, manager) => {
        if (!challenge.webauthn_challenge) return false;

        const credentials = manager.getRepository(WebAuthnCredential);
        const credential = await credentials.findOne({
          where: { user_id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!credential || credential.credential_id !== response.id) {
          return false;
        }

        let verification: VerifiedAuthenticationResponse | null;
        try {
          verification = await this.webAuthnService.verifyAuthentication(
            response,
            challenge.webauthn_challenge,
            {
              id: credential.credential_id,
              publicKey: credential.public_key,
              counter: credential.sign_count,
            },
          );
        } catch {
          verification = null;
        }
        if (!verification?.verified) return false;

        credential.sign_count = verification.authenticationInfo.newCounter;
        await credentials.save(credential);
        return true;
      },
    );
  }

  private async loadCredential(user_id: string) {
    return this.credentials.findOne({ where: { user_id } });
  }

  private assertCurrentMfaVerified(
    currentMethod: MfaMethod,
    verifiedMethod?: ActiveMfaMethod,
  ) {
    if (currentMethod !== MfaMethod.NONE && currentMethod !== verifiedMethod) {
      throw new ForbiddenException('Current MFA verification required');
    }
  }

  private async requireCredential(user_id: string) {
    const credential = await this.loadCredential(user_id);
    if (!credential) {
      throw new UnauthorizedException('Invalid MFA configuration');
    }
    return credential;
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

  private async assertTotpConfigured(user_id: string) {
    const account = await this.users.findOne({
      where: { user_id },
      select: {
        user_id: true,
        mfa_method: true,
        totp_secret_encrypted: true,
      },
    });
    if (
      account?.mfa_method !== MfaMethod.TOTP ||
      !account.totp_secret_encrypted
    ) {
      throw new UnauthorizedException('Invalid MFA configuration');
    }
  }

  private totp(secret: string, email: string) {
    return new OTPAuth.TOTP({
      issuer: MFA_TOTP_ISSUER,
      label: email,
      algorithm: MFA_TOTP_ALGORITHM,
      digits: MFA_TOTP_DIGITS,
      period: MFA_TOTP_PERIOD_SECONDS,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
  }

  private acceptedTotpStep(secret: string, email: string, code: string) {
    const timestamp = Date.now();
    const totp = this.totp(secret, email);
    const delta = totp.validate({
      token: code,
      timestamp,
      window: MFA_TOTP_WINDOW,
    });

    return delta === null ? null : totp.counter({ timestamp }) + delta;
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
    } catch (error) {
      await this.challenges.delete({ challenge_id: challenge.challenge_id });
      throw new ServiceUnavailableException('Unable to send MFA code', {
        cause: error,
      });
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
