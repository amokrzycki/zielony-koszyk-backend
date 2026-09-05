import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import {
  accessTokenFromCookie,
  JwtStrategy,
  refreshTokenFromCookie,
  RefreshTokenStrategy,
} from '../auth/jwt.strategy';
import {
  accessCookieOptions,
  refreshCookieOptions,
} from '../auth/refresh-cookie-options';

describe('refresh token authentication', () => {
  it('accepts only refresh tokens from the cookie', () => {
    const request = {
      headers: {
        cookie:
          'other=value; accessToken=access.jwt.token; refreshToken=refresh.jwt.token',
      },
    } as Request;
    const config = new ConfigService({ JWT_SECRET: 'test-secret' });
    const accessStrategy = new JwtStrategy(config);
    const refreshStrategy = new RefreshTokenStrategy(config);
    const payload = { sub: 'user-id', email: 'user@example.com', role: 'user' };

    expect(refreshTokenFromCookie(request)).toBe('refresh.jwt.token');
    expect(accessTokenFromCookie(request)).toBe('access.jwt.token');
    expect(
      refreshStrategy.validate({
        ...payload,
        type: 'refresh',
        rememberMe: true,
      }),
    ).toEqual({
      user_id: 'user-id',
      email: 'user@example.com',
      role: 'user',
      rememberMe: true,
    });
    expect(refreshStrategy.validate(payload)).toBe(false);
    expect(
      accessStrategy.validate({
        ...payload,
        type: 'refresh',
        rememberMe: false,
      }),
    ).toBe(false);
  });

  it('persists only remembered sessions', () => {
    expect(accessCookieOptions().maxAge).toBe(15 * 60 * 1000);
    expect(refreshCookieOptions(true).maxAge).toBe(7 * 24 * 60 * 60 * 1000);
    expect(refreshCookieOptions(false)).not.toHaveProperty('maxAge');
  });
});
