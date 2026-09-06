import { parseTotpEncryptionKey } from '../auth/totp-secret.crypto';

const REQUIRED = [
  'NODE_ENV',
  'PORT',
  'DATABASE_URL',
  'JWT_SECRET',
  'MFA_OTP_HMAC_KEY',
  'MFA_TOTP_ENCRYPTION_KEY',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_FROM_EMAIL',
  'WEBAUTHN_RP_ID',
  'WEBAUTHN_ORIGIN',
] as const;

const requireBase64Bytes = (value: string, minimum: number, key: string) => {
  const decoded = Buffer.from(value, 'base64');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || decoded.length < minimum) {
    throw new Error(`${key} must contain at least ${minimum} base64 bytes`);
  }
  return decoded;
};

export const validateEnvironment = (environment: Record<string, unknown>) => {
  const missing = REQUIRED.filter(
    (key) => typeof environment[key] !== 'string' || !environment[key],
  );
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }

  const env = environment as Record<(typeof REQUIRED)[number], string> &
    Record<string, unknown>;
  if (!['development', 'test', 'production'].includes(env.NODE_ENV)) {
    throw new Error('NODE_ENV must be development, test or production');
  }

  for (const key of ['PORT', 'SMTP_PORT'] as const) {
    const value = Number(env[key]);
    if (!Number.isInteger(value) || value < 1 || value > 65_535) {
      throw new Error(`${key} must be an integer from 1 to 65535`);
    }
  }
  if (!['true', 'false'].includes(env.SMTP_SECURE)) {
    throw new Error('SMTP_SECURE must be true or false');
  }

  if (!URL.canParse(env.DATABASE_URL)) {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }
  const database = new URL(env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) {
    throw new Error('DATABASE_URL must use PostgreSQL');
  }
  if (!URL.canParse(env.WEBAUTHN_ORIGIN)) {
    throw new Error('WEBAUTHN_ORIGIN must be an exact HTTP(S) origin');
  }
  const origin = new URL(env.WEBAUTHN_ORIGIN);
  if (
    origin.origin !== env.WEBAUTHN_ORIGIN ||
    !['http:', 'https:'].includes(origin.protocol)
  ) {
    throw new Error('WEBAUTHN_ORIGIN must be an exact HTTP(S) origin');
  }

  const otpKey = requireBase64Bytes(
    env.MFA_OTP_HMAC_KEY,
    32,
    'MFA_OTP_HMAC_KEY',
  );
  const totpKey = parseTotpEncryptionKey(env.MFA_TOTP_ENCRYPTION_KEY);
  if (
    otpKey.equals(totpKey) ||
    env.MFA_OTP_HMAC_KEY === env.JWT_SECRET ||
    env.MFA_TOTP_ENCRYPTION_KEY === env.JWT_SECRET
  ) {
    throw new Error('JWT, OTP HMAC and TOTP encryption keys must be distinct');
  }

  return environment;
};
