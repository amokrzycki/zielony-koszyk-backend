import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { JWTPayload } from '../types/JWTPayload';

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
    });
  }

  validate(payload: JWTPayload) {
    if (payload.type) return false;

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
