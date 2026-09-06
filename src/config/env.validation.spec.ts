import { validateEnvironment } from './env.validation';

const validEnvironment = () => ({
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/database',
  JWT_SECRET: 'jwt-secret',
  MFA_OTP_HMAC_KEY: Buffer.alloc(32, 1).toString('base64'),
  MFA_TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString('base64'),
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_SECURE: 'false',
  SMTP_USER: 'smtp-user',
  SMTP_PASSWORD: 'smtp-password',
  SMTP_FROM_EMAIL: 'sender@example.com',
  WEBAUTHN_RP_ID: 'localhost',
  WEBAUTHN_ORIGIN: 'http://localhost:5173',
});

describe('environment validation', () => {
  it('accepts the research configuration and rejects missing or unsafe values', () => {
    expect(validateEnvironment(validEnvironment())).toEqual(validEnvironment());

    for (const invalid of [
      { ...validEnvironment(), JWT_SECRET: '' },
      { ...validEnvironment(), SMTP_SECURE: 'yes' },
      { ...validEnvironment(), DATABASE_URL: 'contains-a-password' },
      { ...validEnvironment(), WEBAUTHN_ORIGIN: 'http://localhost:5173/path' },
      {
        ...validEnvironment(),
        MFA_OTP_HMAC_KEY: Buffer.alloc(31).toString('base64'),
      },
      {
        ...validEnvironment(),
        MFA_TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 1)
          .toString('base64')
          .replace(/=+$/, ''),
      },
    ]) {
      expect(() => validateEnvironment(invalid)).toThrow();
    }
  });
});
