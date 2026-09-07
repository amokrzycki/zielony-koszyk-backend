import { readdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { In } from 'typeorm';
import { MfaChallenge } from '../../src/entities/mfa-challenge.entity';
import { User } from '../../src/entities/user.entity';
import { WebAuthnCredential } from '../../src/entities/webauthn-credential.entity';
import {
  ACCOUNTS_PATH,
  METADATA_PATH,
  SECRETS_DIR,
  SNAPSHOTS_DIR,
  buildAccounts,
  researchDomain,
} from '../dataset';
import { connectDatabase, disconnectDatabase } from '../runtime';

export const resetDataset = async () => {
  const emails = buildAccounts(researchDomain()).map(({ email }) => email);
  const source = await connectDatabase();
  const users = await source.getRepository(User).find({
    select: { user_id: true },
    where: { email: In(emails) },
    loadEagerRelations: false,
  });
  const userIds = users.map(({ user_id }) => user_id);
  await source.transaction(async (manager) => {
    if (userIds.length) {
      await manager
        .getRepository(MfaChallenge)
        .delete({ user_id: In(userIds) });
      await manager
        .getRepository(WebAuthnCredential)
        .delete({ user_id: In(userIds) });
      await manager.getRepository(User).delete({ user_id: In(userIds) });
    }
  });
  for (const directory of [SECRETS_DIR, SNAPSHOTS_DIR]) {
    for (const name of await readdir(directory)) {
      if (name !== '.gitkeep') await unlink(resolve(directory, name));
    }
  }
  for (const path of [ACCOUNTS_PATH, METADATA_PATH]) {
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  return userIds.length;
};

const main = async () => {
  if (
    !process.argv.includes('--yes') &&
    process.env.MFA_RESEARCH_ALLOW_RESET !== '1'
  ) {
    throw new Error('Reset refused; pass --yes or MFA_RESEARCH_ALLOW_RESET=1');
  }
  const count = await resetDataset();
  console.log(`Research dataset reset: ${count} users removed`);
};

if (require.main === module) {
  void main()
    .catch((error) => {
      console.error((error as Error).message);
      process.exitCode = 1;
    })
    .finally(disconnectDatabase);
}
