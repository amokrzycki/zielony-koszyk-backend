import { ActiveMfaMethod, MfaMethod } from '../enums/MfaMethod';

export type AccessTokenPayload = {
  sub: string;
  email: string;
  role: string;
  method?: ActiveMfaMethod;
  type?: never;
};

export type RefreshTokenPayload = {
  sub: string;
  email: string;
  role: string;
  type: 'refresh';
  rememberMe: boolean;
  method?: ActiveMfaMethod;
};

export type MfaTokenPayload = {
  sub: string;
  type: 'mfa';
  jti: string;
  method: Exclude<MfaMethod, MfaMethod.NONE>;
  rememberMe: boolean;
};

export type JWTPayload =
  | AccessTokenPayload
  | RefreshTokenPayload
  | MfaTokenPayload;
