import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { MfaMethod } from '../src/enums/MfaMethod';
import { Roles } from '../src/enums/Roles';
import { SALT_ROUNDS } from '../src/constants/constants';

export const CLIENTS = 50;
export const RESEARCH_ROOT = resolve(__dirname);
export const DATASET_DIR = resolve(RESEARCH_ROOT, 'dataset');
export const SECRETS_DIR = resolve(RESEARCH_ROOT, 'secrets');
export const SNAPSHOTS_DIR = resolve(RESEARCH_ROOT, 'snapshots');
export const ACCOUNTS_PATH = resolve(DATASET_DIR, 'accounts.csv');
export const METADATA_PATH = resolve(DATASET_DIR, 'dataset.json');
export const TOTP_SECRETS_PATH = resolve(SECRETS_DIR, 'totp-secrets.json');
export const WEBAUTHN_SNAPSHOT_PATH = resolve(
  SNAPSHOTS_DIR,
  'webauthn-authenticator.json',
);
export const DATABASE_SNAPSHOT_PATH = resolve(
  SNAPSHOTS_DIR,
  'research-db.dump',
);

export const VARIANTS = [
  { variant: MfaMethod.NONE, slug: 'none' },
  { variant: MfaMethod.EMAIL_OTP, slug: 'mail' },
  { variant: MfaMethod.TOTP, slug: 'totp' },
  { variant: MfaMethod.WEBAUTHN, slug: 'waut' },
] as const;

export type ResearchAccount = {
  client_slot: string;
  identifier: string;
  variant: MfaMethod;
  email: string;
};

export type ResearchUser = ResearchAccount & {
  user_id: string;
  role: Roles;
  password_hash: string;
  first_name: string;
  last_name: string;
  phone: string;
  mfa_method: MfaMethod;
  totp_secret_encrypted: string | null;
  totp_last_used_step: number | null;
};

export type TotpSecretStore = Record<
  string,
  { client_slot: string; secret: string; first_used_step: number }
>;

export type VirtualCredential = {
  credentialId: string;
  rpId: string;
  privateKey: string;
  userHandle: string;
  signCount: number;
  isResidentCredential: boolean;
  [key: string]: unknown;
};

export type WebAuthnSnapshot = {
  version: 1;
  rp_id: string;
  authenticator: {
    options: {
      protocol: 'ctap2';
      transport: 'internal';
      hasResidentKey: boolean;
      hasUserVerification: true;
      isUserVerified: true;
      automaticPresenceSimulation: true;
    };
    credentials: VirtualCredential[];
  };
};

export type DatasetState = {
  expected: ResearchAccount[];
  users: ResearchUser[];
  allBenchEmails: string[];
  credentials: Array<{
    user_id: string;
    credential_id: string;
    sign_count: number;
  }>;
  challengeCount: number;
  totpSecrets: TotpSecretStore;
  webauthnSnapshot: WebAuthnSnapshot;
  csvRows: Array<
    Pick<ResearchUser, 'client_slot' | 'variant' | 'user_id' | 'email'>
  >;
};

const execFile = promisify(execFileCallback);
const RESEARCH_EMAIL = /^bench-(none|mail|totp|waut)-(\d{3})@(.+)$/;
const variantBySlug = new Map<string, MfaMethod>(
  VARIANTS.map(({ slug, variant }) => [slug, variant]),
);

export const requireEnvironment = (...names: string[]) => {
  const missing = names.filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
  return Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  ) as Record<string, string>;
};

export const researchDomain = () => {
  const { RESEARCH_MAIL_DOMAIN: domain } = requireEnvironment(
    'RESEARCH_MAIL_DOMAIN',
  );
  const normalized = domain.toLowerCase();
  if (
    domain !== normalized ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) ||
    domain.includes('..')
  ) {
    throw new Error('RESEARCH_MAIL_DOMAIN must be a lowercase mail domain');
  }
  return domain;
};

export const buildAccounts = (domain: string): ResearchAccount[] =>
  Array.from({ length: CLIENTS }, (_, index) =>
    VARIANTS.map(({ variant, slug }) => {
      const client_slot = String(index + 1).padStart(3, '0');
      const identifier = `bench-${slug}-${client_slot}`;
      return {
        client_slot,
        identifier,
        variant,
        email: `${identifier}@${domain}`,
      };
    }),
  ).flat();

export const parseResearchEmail = (
  email: string,
  domain?: string,
): Omit<ResearchAccount, 'email'> | null => {
  const match = RESEARCH_EMAIL.exec(email);
  if (!match || (domain && match[3] !== domain)) return null;
  const variant = variantBySlug.get(match[1]);
  const slot = Number(match[2]);
  if (!variant || slot < 1 || slot > CLIENTS) return null;
  return {
    client_slot: match[2],
    identifier: email.slice(0, email.indexOf('@')),
    variant,
  };
};

export const planMissingAccounts = (
  expected: ResearchAccount[],
  existingEmails: string[],
) => {
  const wanted = new Set(expected.map(({ email }) => email));
  const duplicates = existingEmails.filter(
    (email, index) => existingEmails.indexOf(email) !== index,
  );
  const conflicts = existingEmails.filter(
    (email) => email.startsWith('bench-') && !wanted.has(email),
  );
  if (duplicates.length || conflicts.length) {
    throw new Error('Conflicting bench-* accounts already exist');
  }
  const existing = new Set(existingEmails);
  return expected.filter(({ email }) => !existing.has(email));
};

export const readJson = async <T>(path: string, fallback?: T): Promise<T> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === 'ENOENT' &&
      fallback !== undefined
    ) {
      return fallback;
    }
    throw error;
  }
};

export const credentialIdKey = (credentialId: string) =>
  Buffer.from(credentialId, 'base64').toString('base64url');

export const writeJsonPrivate = async (path: string, value: unknown) => {
  await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
};

export const writePublic = async (path: string, value: string) => {
  await mkdir(resolve(path, '..'), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, value);
  await rename(temporary, path);
};

export const gitRevision = async (directory: string) =>
  (
    await execFile('git', ['rev-parse', 'HEAD'], { cwd: directory })
  ).stdout.trim();

export const executable = async (path: string) => {
  await access(path, fsConstants.X_OK);
  return path;
};

export const parseAccountsCsv = (csv: string): DatasetState['csvRows'] => {
  const lines = csv.trim().split('\n');
  if (lines.shift() !== 'client_slot,variant,user_id,email') {
    throw new Error('accounts.csv has invalid header');
  }
  return lines.map((line) => {
    const [client_slot, variant, user_id, email, extra] = line.split(',');
    if (extra || !Object.values(MfaMethod).includes(variant as MfaMethod)) {
      throw new Error('accounts.csv has invalid row');
    }
    return { client_slot, variant: variant as MfaMethod, user_id, email };
  });
};

export const validateDatasetState = (state: DatasetState) => {
  const errors: string[] = [];
  const expectedByEmail = new Map(
    state.expected.map((account) => [account.email, account]),
  );
  const usersByEmail = new Map(state.users.map((user) => [user.email, user]));
  const credentialCounts = new Map<string, number>();
  for (const credential of state.credentials) {
    credentialCounts.set(
      credential.user_id,
      (credentialCounts.get(credential.user_id) ?? 0) + 1,
    );
  }

  if (state.users.length !== 200)
    errors.push(`users ${state.users.length}/200`);
  if (new Set(state.users.map(({ email }) => email)).size !== 200) {
    errors.push('research emails are not unique');
  }
  if (
    new Set(state.users.map(({ password_hash }) => password_hash)).size !==
      200 ||
    state.users.some(
      ({ password_hash }) =>
        !['2a', '2b', '2y'].some((version) =>
          password_hash.startsWith(
            `$${version}$${String(SALT_ROUNDS).padStart(2, '0')}$`,
          ),
        ),
    )
  ) {
    errors.push(`bcrypt hashes are not unique with cost ${SALT_ROUNDS}`);
  }
  if (
    state.allBenchEmails.length !== 200 ||
    state.allBenchEmails.some((email) => !expectedByEmail.has(email))
  ) {
    errors.push('unexpected bench-* accounts exist');
  }
  for (const expected of state.expected) {
    const user = usersByEmail.get(expected.email);
    if (!user) {
      errors.push(`missing ${expected.email}`);
      continue;
    }
    if (
      user.client_slot !== expected.client_slot ||
      user.variant !== expected.variant ||
      user.mfa_method !== expected.variant
    ) {
      errors.push(`wrong mapping or MFA method for ${expected.email}`);
    }
    if (user.role !== Roles.USER)
      errors.push(`wrong role for ${expected.email}`);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        user.user_id,
      ) ||
      !user.first_name ||
      !user.last_name ||
      !user.phone
    ) {
      errors.push(`invalid required user fields for ${expected.email}`);
    }
    const hasTotp = Boolean(user.totp_secret_encrypted);
    if (hasTotp !== (expected.variant === MfaMethod.TOTP)) {
      errors.push(`wrong TOTP state for ${expected.email}`);
    }
    if (
      expected.variant !== MfaMethod.TOTP &&
      user.totp_last_used_step !== null
    ) {
      errors.push(`wrong TOTP replay state for ${expected.email}`);
    }
    if (
      expected.variant === MfaMethod.TOTP &&
      user.totp_last_used_step === null
    ) {
      errors.push(`missing TOTP replay state for ${expected.email}`);
    }
    const credentialCount = credentialCounts.get(user.user_id) ?? 0;
    if (credentialCount !== (expected.variant === MfaMethod.WEBAUTHN ? 1 : 0)) {
      errors.push(`wrong WebAuthn credential count for ${expected.email}`);
    }
  }

  const variants = Object.values(MfaMethod);
  for (const variant of variants) {
    const count = state.users.filter(
      ({ mfa_method }) => mfa_method === variant,
    ).length;
    if (count !== 50) errors.push(`${variant} ${count}/50`);
  }
  const totpUsers = state.users.filter(
    ({ variant }) => variant === MfaMethod.TOTP,
  );
  if (
    new Set(totpUsers.map(({ totp_secret_encrypted }) => totp_secret_encrypted))
      .size !== 50
  ) {
    errors.push('encrypted TOTP secrets are not unique');
  }
  if (state.challengeCount !== 0)
    errors.push(`MFA challenges ${state.challengeCount}/0`);

  const totpEntries = Object.entries(state.totpSecrets);
  if (totpEntries.length !== 50)
    errors.push(`TOTP secret store ${totpEntries.length}/50`);
  if (new Set(totpEntries.map(([, value]) => value.secret)).size !== 50) {
    errors.push('local TOTP secrets are not unique');
  }
  for (const user of totpUsers) {
    const secret = state.totpSecrets[user.email];
    if (
      !secret ||
      secret.client_slot !== user.client_slot ||
      !secret.first_used_step ||
      user.totp_last_used_step < secret.first_used_step
    ) {
      errors.push(`wrong local TOTP entry for ${user.email}`);
    }
  }

  const snapshotCredentials = state.webauthnSnapshot.authenticator.credentials;
  if (snapshotCredentials.length !== 50) {
    errors.push(
      `virtual authenticator credentials ${snapshotCredentials.length}/50`,
    );
  }
  const credentialsById = new Map(
    state.credentials.map((credential) => [
      credentialIdKey(credential.credential_id),
      credential,
    ]),
  );
  if (
    new Set(snapshotCredentials.map(({ credentialId }) => credentialId))
      .size !== 50
  ) {
    errors.push('virtual authenticator credential IDs are not unique');
  }
  for (const credential of snapshotCredentials) {
    const databaseCredential = credentialsById.get(
      credentialIdKey(credential.credentialId),
    );
    if (
      credential.rpId !== state.webauthnSnapshot.rp_id ||
      !credential.privateKey ||
      !databaseCredential ||
      Buffer.from(credential.userHandle, 'base64url').toString() !==
        databaseCredential.user_id ||
      credential.signCount !== databaseCredential.sign_count
    ) {
      errors.push('virtual authenticator snapshot does not match database');
      break;
    }
  }

  if (state.csvRows.length !== 200)
    errors.push(`accounts.csv ${state.csvRows.length}/200`);
  const csvKeys = new Set<string>();
  for (const row of state.csvRows) {
    const key = `${row.client_slot}:${row.variant}`;
    if (csvKeys.has(key)) errors.push(`duplicate CSV mapping ${key}`);
    csvKeys.add(key);
    const user = usersByEmail.get(row.email);
    if (
      !user ||
      user.user_id !== row.user_id ||
      user.client_slot !== row.client_slot ||
      user.variant !== row.variant
    ) {
      errors.push(`accounts.csv does not match database for ${row.email}`);
    }
  }
  for (let slot = 1; slot <= CLIENTS; slot += 1) {
    const name = String(slot).padStart(3, '0');
    for (const variant of variants) {
      if (!csvKeys.has(`${name}:${variant}`))
        errors.push(`missing CSV mapping ${name}:${variant}`);
    }
  }
  return errors;
};

export const assertPublicArtifactsExcludeSecrets = (
  publicText: string,
  password: string,
  totpSecrets: TotpSecretStore,
  snapshot: WebAuthnSnapshot,
) => {
  const forbidden = [
    password,
    ...Object.values(totpSecrets).map(({ secret }) => secret),
    ...snapshot.authenticator.credentials.map(({ privateKey }) => privateKey),
  ].filter(Boolean);
  if (forbidden.some((value) => publicText.includes(value))) {
    throw new Error('Public dataset artifact contains secret material');
  }
};
