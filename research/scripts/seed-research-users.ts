import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { SALT_ROUNDS } from '../../src/constants/constants';
import { User } from '../../src/entities/user.entity';
import { MfaMethod } from '../../src/enums/MfaMethod';
import { Roles } from '../../src/enums/Roles';
import {
  ResearchAccount,
  buildAccounts,
  planMissingAccounts,
  requireEnvironment,
  researchDomain,
} from '../dataset';
import {
  connectDatabase,
  disconnectDatabase,
  loadAllBenchEmails,
  loadResearchUsers,
} from '../runtime';

export const seedResearchUsers = async (
  source: DataSource,
  expected: ResearchAccount[],
  password: string,
) => {
  const allBenchEmails = await loadAllBenchEmails(source);
  const missing = planMissingAccounts(expected, allBenchEmails);
  const existingUsers = await loadResearchUsers(source, expected);
  if (existingUsers.some(({ role }) => role !== Roles.USER)) {
    throw new Error('Existing research account has invalid role');
  }
  if (
    (
      await Promise.all(
        existingUsers.map(({ password_hash }) =>
          bcrypt.compare(password, password_hash),
        ),
      )
    ).some((matches) => !matches)
  ) {
    throw new Error('Existing research accounts use a different password');
  }

  for (const batchStart of Array.from(
    { length: Math.ceil(missing.length / 10) },
    (_, i) => i * 10,
  )) {
    const batch = missing.slice(batchStart, batchStart + 10);
    const users = await Promise.all(
      batch.map(async (account) =>
        source.getRepository(User).create({
          role: Roles.USER,
          password: await bcrypt.hash(password, SALT_ROUNDS),
          email: account.email,
          first_name: 'Research',
          last_name: account.identifier,
          phone: `000000${account.client_slot}`,
          mfa_method: MfaMethod.NONE,
          totp_secret_encrypted: null,
          totp_last_used_step: null,
          addresses: [],
        }),
      ),
    );
    await source.getRepository(User).save(users);
  }

  const saved = await loadResearchUsers(source, expected);
  if (
    saved.length !== expected.length ||
    saved.some(({ role }) => role !== Roles.USER)
  ) {
    throw new Error('Research users are incomplete or have invalid roles');
  }
  return { created: missing.length, existing: saved.length - missing.length };
};

const main = async () => {
  const { MFA_RESEARCH_PASSWORD: password } = requireEnvironment(
    'DATABASE_URL',
    'MFA_RESEARCH_PASSWORD',
    'RESEARCH_MAIL_DOMAIN',
  );
  const result = await seedResearchUsers(
    await connectDatabase(),
    buildAccounts(researchDomain()),
    password,
  );
  console.log(
    `Research users: ${result.created} created, ${result.existing} existing`,
  );
};

if (require.main === module) {
  void main()
    .catch((error) => {
      console.error((error as Error).message);
      process.exitCode = 1;
    })
    .finally(disconnectDatabase);
}
