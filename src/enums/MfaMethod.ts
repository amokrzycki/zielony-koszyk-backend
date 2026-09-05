export enum MfaMethod {
  NONE = 'NONE',
  EMAIL_OTP = 'EMAIL_OTP',
  TOTP = 'TOTP',
  WEBAUTHN = 'WEBAUTHN',
}

export type ActiveMfaMethod = Exclude<MfaMethod, MfaMethod.NONE>;

export const ACTIVE_MFA_METHODS = [
  MfaMethod.EMAIL_OTP,
  MfaMethod.TOTP,
  MfaMethod.WEBAUTHN,
];
