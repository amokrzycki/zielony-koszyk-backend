import { readFile } from 'node:fs/promises';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { SALT_ROUNDS } from '../../src/constants/constants';
import { MfaMethod } from '../../src/enums/MfaMethod';
import {
  ACCOUNTS_PATH,
  METADATA_PATH,
  TOTP_SECRETS_PATH,
  WEBAUTHN_SNAPSHOT_PATH,
  TotpSecretStore,
  WebAuthnSnapshot,
  assertPublicArtifactsExcludeSecrets,
  buildAccounts,
  parseAccountsCsv,
  readJson,
  requireEnvironment,
  researchDomain,
  validateDatasetState,
} from '../dataset';
import {
  connectDatabase,
  disconnectDatabase,
  loadAllBenchEmails,
  loadCredentials,
  loadResearchUsers,
  researchChallengeCount,
} from '../runtime';

type DatasetMetadata = {
  dataset_version: number;
  accounts: number;
  clients: number;
  accounts_per_variant: number;
  variants: string[];
  backend_commit: string;
  frontend_commit: string;
  database: { engine: string; version: string };
  webauthn: { rp_id: string; origin: string; authenticator: string };
  password: { shared: boolean; bcrypt_cost: number };
};

export const validateDataset = async (source: DataSource) => {
  const { MFA_RESEARCH_PASSWORD: password } = requireEnvironment(
    'MFA_RESEARCH_PASSWORD',
    'RESEARCH_MAIL_DOMAIN',
    'WEBAUTHN_RP_ID',
    'WEBAUTHN_ORIGIN',
  );
  const expected = buildAccounts(researchDomain());
  const users = await loadResearchUsers(source, expected);
  const userIds = users.map(({ user_id }) => user_id);
  const [
    allBenchEmails,
    credentials,
    challengeCount,
    totpSecrets,
    webauthnSnapshot,
    accountsText,
    metadataText,
  ] = await Promise.all([
    loadAllBenchEmails(source),
    loadCredentials(source, userIds),
    researchChallengeCount(source, userIds),
    readJson<TotpSecretStore>(TOTP_SECRETS_PATH),
    readJson<WebAuthnSnapshot>(WEBAUTHN_SNAPSHOT_PATH),
    readFile(ACCOUNTS_PATH, 'utf8'),
    readFile(METADATA_PATH, 'utf8'),
  ]);
  const metadata = JSON.parse(metadataText) as DatasetMetadata;
  const errors = validateDatasetState({
    expected,
    users,
    allBenchEmails,
    credentials: credentials.map(({ user_id, credential_id, sign_count }) => ({
      user_id,
      credential_id,
      sign_count,
    })),
    challengeCount,
    totpSecrets,
    webauthnSnapshot,
    csvRows: parseAccountsCsv(accountsText),
  });
  if (
    (
      await Promise.all(
        users.map(({ password_hash }) =>
          bcrypt.compare(password, password_hash),
        ),
      )
    ).some((matches) => !matches)
  ) {
    errors.push(
      'research account password hashes do not match shared password',
    );
  }
  if (
    metadata.dataset_version !== 1 ||
    metadata.accounts !== 200 ||
    metadata.clients !== 50 ||
    metadata.accounts_per_variant !== 50 ||
    JSON.stringify(metadata.variants) !==
      JSON.stringify(Object.values(MfaMethod)) ||
    !/^[0-9a-f]{40}$/.test(metadata.backend_commit) ||
    !/^[0-9a-f]{40}$/.test(metadata.frontend_commit) ||
    metadata.database.engine !== 'PostgreSQL' ||
    !metadata.database.version ||
    metadata.webauthn.rp_id !== process.env.WEBAUTHN_RP_ID ||
    metadata.webauthn.origin !== process.env.WEBAUTHN_ORIGIN ||
    metadata.webauthn.authenticator !==
      'Chrome CDP virtual platform authenticator' ||
    metadata.password.shared !== true ||
    metadata.password.bcrypt_cost !== SALT_ROUNDS
  ) {
    errors.push('dataset.json metadata is invalid');
  }
  try {
    assertPublicArtifactsExcludeSecrets(
      accountsText + metadataText,
      password,
      totpSecrets,
      webauthnSnapshot,
    );
  } catch (error) {
    errors.push((error as Error).message);
  }
  if (errors.length) throw new Error(errors.join('\n'));

  console.log(`Research dataset validation
---------------------------
Users:              200/200 OK
NONE:                50/50 OK
EMAIL_OTP:           50/50 OK
TOTP:                50/50 OK
WEBAUTHN:            50/50 OK
TOTP secret store:   50/50 OK
WebAuthn creds:      50/50 OK
MFA challenges:        0/0 OK

DATASET VALID`);
};

const main = async () => {
  requireEnvironment(
    'DATABASE_URL',
    'MFA_RESEARCH_PASSWORD',
    'RESEARCH_MAIL_DOMAIN',
    'WEBAUTHN_RP_ID',
    'WEBAUTHN_ORIGIN',
  );
  return validateDataset(await connectDatabase());
};

if (require.main === module) {
  void main()
    .catch((error) => {
      console.error((error as Error).message);
      process.exitCode = 1;
    })
    .finally(disconnectDatabase);
}
