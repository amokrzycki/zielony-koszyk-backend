import {
  decryptTotpSecret,
  encryptTotpSecret,
  parseTotpEncryptionKey,
} from './totp-secret.crypto';

describe('TOTP secret encryption', () => {
  const key = Buffer.alloc(32, 7);
  const userId = 'c4f3a574-bfa8-4b77-ad92-5a7a771d8122';
  const secret = 'JBSWY3DPEHPK3PXP';

  it('round-trips an authenticated, randomized envelope', () => {
    const first = encryptTotpSecret(secret, userId, key);
    const second = encryptTotpSecret(secret, userId, key);

    expect(first).toMatch(
      /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );
    expect(first).not.toContain(secret);
    expect(second).not.toBe(first);
    expect(decryptTotpSecret(first, userId, key)).toBe(secret);
  });

  it('rejects tampering, another user and another key', () => {
    const envelope = encryptTotpSecret(secret, userId, key);
    const parts = envelope.split('.');
    parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
    const tampered = parts.join('.');

    expect(() => decryptTotpSecret(tampered, userId, key)).toThrow(
      'Invalid encrypted TOTP secret',
    );
    expect(() => decryptTotpSecret(envelope, 'another-user', key)).toThrow(
      'Invalid encrypted TOTP secret',
    );
    expect(() =>
      decryptTotpSecret(envelope, userId, Buffer.alloc(32, 8)),
    ).toThrow('Invalid encrypted TOTP secret');
  });

  it('requires exactly 32 base64-encoded key bytes', () => {
    expect(
      parseTotpEncryptionKey(Buffer.alloc(32, 1).toString('base64')),
    ).toHaveLength(32);
    expect(() => parseTotpEncryptionKey(undefined)).toThrow();
    expect(() =>
      parseTotpEncryptionKey(Buffer.alloc(31, 1).toString('base64')),
    ).toThrow();
  });
});
