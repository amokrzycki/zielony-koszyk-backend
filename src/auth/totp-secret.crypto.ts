import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const ENVELOPE_VERSION = 'v1';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export const parseTotpEncryptionKey = (encoded: string | undefined) => {
  const key = Buffer.from(encoded ?? '', 'base64');

  if (
    !encoded ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
    key.length !== 32
  ) {
    throw new Error('MFA_TOTP_ENCRYPTION_KEY must contain 32 base64 bytes');
  }

  return key;
};

export const encryptTotpSecret = (
  secret: string,
  userId: string,
  key: Buffer,
) => {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  });
  cipher.setAAD(Buffer.from(userId));
  const ciphertext = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final(),
  ]);

  return [
    ENVELOPE_VERSION,
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join('.');
};

export const decryptTotpSecret = (
  envelope: string,
  userId: string,
  key: Buffer,
) => {
  const [version, encodedIv, encodedCiphertext, encodedTag, extra] =
    envelope.split('.');
  const isBase64Url = (value: string | undefined) =>
    Boolean(value && /^[A-Za-z0-9_-]+$/.test(value));

  if (
    version !== ENVELOPE_VERSION ||
    extra !== undefined ||
    !isBase64Url(encodedIv) ||
    !isBase64Url(encodedCiphertext) ||
    !isBase64Url(encodedTag)
  ) {
    throw new Error('Invalid encrypted TOTP secret');
  }

  const iv = Buffer.from(encodedIv, 'base64url');
  const ciphertext = Buffer.from(encodedCiphertext, 'base64url');
  const tag = Buffer.from(encodedTag, 'base64url');
  if (
    iv.length !== IV_LENGTH ||
    ciphertext.length === 0 ||
    tag.length !== TAG_LENGTH
  ) {
    throw new Error('Invalid encrypted TOTP secret');
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: TAG_LENGTH,
    });
    decipher.setAAD(Buffer.from(userId));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Invalid encrypted TOTP secret');
  }
};
