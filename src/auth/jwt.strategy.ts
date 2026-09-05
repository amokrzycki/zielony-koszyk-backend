import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { JWTPayload } from '../types/JWTPayload';
import { MfaMethod } from '../enums/MfaMethod';
import { MfaService } from './mfa.service';

const tokenFromCookie = (request: Request, name: string) =>
  request.headers.cookie
    ?.split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.slice(name.length + 1) ?? null;

export const accessTokenFromCookie = (request: Request) =>
  tokenFromCookie(request, 'accessToken');

export const refreshTokenFromCookie = (request: Request) =>
  tokenFromCookie(request, 'refreshToken');

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        accessTokenFromCookie,
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
      algorithms: ['HS256'],
    });
  }

  validate(payload: JWTPayload) {
    if (payload.type || !('email' in payload) || !('role' in payload)) {
      return false;
    }

    return { user_id: payload.sub, email: payload.email, role: payload.role };
  }
}

@Injectable()
export class RefreshTokenStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([refreshTokenFromCookie]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
      algorithms: ['HS256'],
    });
  }

  validate(payload: JWTPayload) {
    if (payload.type !== 'refresh') return false;

    return {
      user_id: payload.sub,
      email: payload.email,
      role: payload.role,
      rememberMe: payload.rememberMe,
    };
  }
}

@Injectable()
export class MfaJwtStrategy extends PassportStrategy(Strategy, 'jwt-mfa') {
  constructor(
    configService: ConfigService,
    private mfaService: MfaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: JWTPayload) {
    if (
      payload.type !== 'mfa' ||
      !payload.sub ||
      !payload.jti ||
      typeof payload.rememberMe !== 'boolean' ||
      ![MfaMethod.EMAIL_OTP, MfaMethod.TOTP, MfaMethod.WEBAUTHN].includes(
        payload.method,
      )
    ) {
      return false;
    }

    await this.mfaService.assertLoginChallenge(payload);

    return {
      user_id: payload.sub,
      challenge_id: payload.jti,
      method: payload.method,
      rememberMe: payload.rememberMe,
    };
  }
}
