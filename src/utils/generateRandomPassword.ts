import { randomBytes } from 'crypto';

export function generateRandomPassword(length = 8): string {
  return randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);
}
