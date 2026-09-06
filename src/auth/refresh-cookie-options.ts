import type { CookieOptions } from 'express';

const baseCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
});

export const accessCookieOptions = (): CookieOptions => ({
  ...baseCookieOptions(),
  maxAge: 15 * 60 * 1000,
});

export const clearCookieOptions = (): CookieOptions => ({
  ...baseCookieOptions(),
});

export const refreshCookieOptions = (rememberMe = false): CookieOptions => ({
  ...baseCookieOptions(),
  ...(rememberMe && { maxAge: 7 * 24 * 60 * 60 * 1000 }),
});
