import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import * as bcrypt from 'bcrypt';
import { DataSource, In, Like } from 'typeorm';
import dataSource from '../src/data-source';
import { MfaChallenge } from '../src/entities/mfa-challenge.entity';
import { User } from '../src/entities/user.entity';
import { WebAuthnCredential } from '../src/entities/webauthn-credential.entity';
import { validateEnvironment } from '../src/config/env.validation';
import { MfaMethod } from '../src/enums/MfaMethod';
import { Roles } from '../src/enums/Roles';
import {
  ResearchAccount,
  ResearchUser,
  TOTP_SECRETS_PATH,
  WEBAUTHN_SNAPSHOT_PATH,
  TotpSecretStore,
  WebAuthnSnapshot,
  buildAccounts,
  credentialIdKey,
  executable,
  parseResearchEmail,
  readJson,
  requireEnvironment,
  researchDomain,
} from './dataset';

const execFile = promisify(execFileCallback);
const WINDOW_MS = 61_000;
const REQUESTS_PER_WINDOW = 5;

export const backendUrl = () =>
  (
    process.env.RESEARCH_BACKEND_URL ?? `http://localhost:${process.env.PORT}`
  ).replace(/\/$/, '');

export const frontendUrl = () =>
  (process.env.RESEARCH_FRONTEND_URL ?? process.env.WEBAUTHN_ORIGIN).replace(
    /\/$/,
    '',
  );

export const chromiumPath = () =>
  process.env.RESEARCH_CHROMIUM_PATH ?? '/usr/bin/chromium';

export const connectDatabase = async (): Promise<DataSource> => {
  requireEnvironment('DATABASE_URL');
  if (!dataSource.isInitialized) await dataSource.initialize();
  if (await dataSource.showMigrations()) {
    throw new Error('Pending database migrations; run npm run migration:run');
  }
  const runner = dataSource.createQueryRunner();
  try {
    for (const table of ['users', 'mfa_challenges', 'webauthn_credentials']) {
      if (!(await runner.hasTable(table))) {
        throw new Error(`Required database table is missing: ${table}`);
      }
    }
  } finally {
    await runner.release();
  }
  return dataSource;
};

export const disconnectDatabase = async () => {
  if (dataSource.isInitialized) await dataSource.destroy();
};

export const loadResearchUsers = async (
  source: DataSource,
  expected: ResearchAccount[],
): Promise<ResearchUser[]> => {
  const accounts = new Map(expected.map((account) => [account.email, account]));
  const rows = await source
    .getRepository(User)
    .createQueryBuilder('user')
    .addSelect(['user.totp_secret_encrypted', 'user.totp_last_used_step'])
    .where({ email: In(expected.map(({ email }) => email)) })
    .getMany();
  return rows.map((user) => ({
    ...accounts.get(user.email),
    user_id: user.user_id,
    role: user.role,
    password_hash: user.password,
    first_name: user.first_name,
    last_name: user.last_name,
    phone: user.phone,
    mfa_method: user.mfa_method,
    totp_secret_encrypted: user.totp_secret_encrypted,
    totp_last_used_step: user.totp_last_used_step,
  }));
};

export const loadAllBenchEmails = async (source: DataSource) =>
  (
    await source.getRepository(User).find({
      select: { email: true },
      where: { email: Like('bench-%') },
      loadEagerRelations: false,
    })
  ).map(({ email }) => email);

export const loadCredentials = async (
  source: DataSource,
  userIds: string[],
): Promise<WebAuthnCredential[]> =>
  userIds.length
    ? await source.getRepository(WebAuthnCredential).find({
        where: { user_id: In(userIds) },
      })
    : [];

export const researchChallengeCount = async (
  source: DataSource,
  userIds: string[],
): Promise<number> =>
  userIds.length
    ? await source.getRepository(MfaChallenge).count({
        where: { user_id: In(userIds) },
      })
    : 0;

export const cleanupResearchChallenges = async (
  source: DataSource,
  userIds: string[],
) => {
  if (userIds.length) {
    await source.getRepository(MfaChallenge).delete({ user_id: In(userIds) });
  }
};

export const preflight = async () => {
  requireEnvironment('MFA_RESEARCH_PASSWORD', 'RESEARCH_MAIL_DOMAIN');
  validateEnvironment(process.env);
  const domain = researchDomain();
  const expected = buildAccounts(domain);
  const origin = new URL(frontendUrl());
  if (origin.origin !== frontendUrl()) {
    throw new Error('RESEARCH_FRONTEND_URL must be an exact origin');
  }
  if (frontendUrl() !== process.env.WEBAUTHN_ORIGIN) {
    throw new Error('RESEARCH_FRONTEND_URL must equal WEBAUTHN_ORIGIN');
  }
  if (
    origin.hostname !== process.env.WEBAUTHN_RP_ID &&
    !origin.hostname.endsWith(`.${process.env.WEBAUTHN_RP_ID}`)
  ) {
    throw new Error('WEBAUTHN_RP_ID does not match frontend origin');
  }
  await executable(chromiumPath());
  await Promise.all([
    execFile(chromiumPath(), ['--version']),
    execFile('pg_dump', ['--version']),
    execFile('pg_restore', ['--version']),
  ]);
  await Promise.all([
    requireHttp(backendUrl(), 'backend'),
    requireHttp(frontendUrl(), 'frontend'),
  ]);
  const source = await connectDatabase();
  await source.query('SELECT version()');
  const benchEmails = await loadAllBenchEmails(source);
  for (const email of benchEmails) {
    if (!parseResearchEmail(email, domain)) {
      throw new Error(`Conflicting bench-* account: ${email}`);
    }
  }
  const [users, totpSecrets, snapshot] = await Promise.all([
    loadResearchUsers(source, expected),
    readJson<TotpSecretStore>(TOTP_SECRETS_PATH, {}),
    readJson<WebAuthnSnapshot | null>(WEBAUTHN_SNAPSHOT_PATH, null),
  ]);
  const userIds = users.map(({ user_id }) => user_id);
  const [credentials, challengeCount] = await Promise.all([
    loadCredentials(source, userIds),
    researchChallengeCount(source, userIds),
  ]);
  if (challengeCount) {
    throw new Error('Research accounts contain MFA challenges');
  }
  const expectedByEmail = new Map(
    expected.map((account) => [account.email, account]),
  );
  const usersById = new Map(users.map((user) => [user.user_id, user]));
  if (
    (
      await Promise.all(
        users.map(({ password_hash }) =>
          bcrypt.compare(process.env.MFA_RESEARCH_PASSWORD, password_hash),
        ),
      )
    ).some((matches) => !matches)
  ) {
    throw new Error('Existing research accounts use a different password');
  }
  for (const user of users) {
    const account = expectedByEmail.get(user.email);
    if (
      user.role !== Roles.USER ||
      (user.mfa_method !== MfaMethod.NONE &&
        user.mfa_method !== account.variant) ||
      (account.variant === MfaMethod.NONE && user.mfa_method !== MfaMethod.NONE)
    ) {
      throw new Error(`Conflicting research account state: ${user.email}`);
    }
    if (user.mfa_method === MfaMethod.TOTP && !totpSecrets[user.email]) {
      throw new Error(`${user.email} has no local TOTP secret`);
    }
    if (
      (user.mfa_method === MfaMethod.TOTP) !==
        Boolean(user.totp_secret_encrypted) ||
      (user.mfa_method !== MfaMethod.TOTP && user.totp_last_used_step !== null)
    ) {
      throw new Error(`Conflicting TOTP state: ${user.email}`);
    }
    if (
      user.mfa_method === MfaMethod.WEBAUTHN &&
      credentials.filter(({ user_id }) => user_id === user.user_id).length !== 1
    ) {
      throw new Error(`${user.email} has invalid WebAuthn credential count`);
    }
  }
  for (const email of Object.keys(totpSecrets)) {
    if (expectedByEmail.get(email)?.variant !== MfaMethod.TOTP) {
      throw new Error('TOTP secret store contains an unexpected account');
    }
  }
  const snapshotIds = new Set(
    snapshot?.authenticator.credentials.map(({ credentialId }) =>
      credentialIdKey(credentialId),
    ) ?? [],
  );
  if (snapshot && snapshot.rp_id !== process.env.WEBAUTHN_RP_ID) {
    throw new Error('Authenticator snapshot RP ID does not match runtime');
  }
  const snapshotById = new Map(
    snapshot?.authenticator.credentials.map((credential) => [
      credentialIdKey(credential.credentialId),
      credential,
    ]) ?? [],
  );
  for (const credential of credentials) {
    const user = usersById.get(credential.user_id);
    const local = snapshotById.get(credentialIdKey(credential.credential_id));
    if (
      user?.mfa_method !== MfaMethod.WEBAUTHN ||
      !local ||
      !local.privateKey ||
      Buffer.from(local.userHandle, 'base64url').toString() !== user.user_id ||
      local.signCount !== credential.sign_count
    ) {
      throw new Error(
        'Database credential has no matching authenticator state',
      );
    }
  }
  if (snapshotIds.size !== credentials.length) {
    throw new Error('Authenticator state has no matching database credential');
  }
  return { source, domain, expected };
};

const requireHttp = async (url: string, name: string) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    throw new Error(
      `${name} is unavailable at ${url}: ${(error as Error).message}`,
      { cause: error },
    );
  }
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class ResearchHttp {
  private windows = new Map<string, number[]>();

  async request<T>(
    path: string,
    method: 'GET' | 'POST' | 'PUT' = 'GET',
    body?: unknown,
    token?: string,
  ): Promise<T> {
    const key = `${method} ${path}`;
    await this.pace(key);
    for (;;) {
      const response = await fetch(`${backendUrl()}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 429) {
        const seconds = Number(response.headers.get('retry-after'));
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Number.isFinite(seconds) ? seconds * 1_000 : WINDOW_MS,
          ),
        );
        continue;
      }
      const text = await response.text();
      let result: unknown = undefined;
      if (text) {
        try {
          result = JSON.parse(text);
        } catch {
          result = text;
        }
      }
      if (!response.ok) {
        const rawMessage =
          result && typeof result === 'object' && 'message' in result
            ? result.message
            : undefined;
        const message =
          typeof rawMessage === 'string'
            ? rawMessage
            : Array.isArray(rawMessage)
              ? rawMessage.join(', ')
              : `HTTP ${response.status}`;
        throw new HttpError(response.status, `${method} ${path}: ${message}`);
      }
      return result as T;
    }
  }

  async clearWindow(path: string, method: 'GET' | 'POST' | 'PUT' = 'GET') {
    const timestamps = this.windows.get(`${method} ${path}`) ?? [];
    if (timestamps.length) {
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.max(0, timestamps.at(-1) + WINDOW_MS - Date.now()),
        ),
      );
    }
  }

  private async pace(key: string): Promise<void> {
    const now = Date.now();
    const timestamps = (this.windows.get(key) ?? []).filter(
      (timestamp) => timestamp + WINDOW_MS > now,
    );
    if (timestamps.length >= REQUESTS_PER_WINDOW) {
      await new Promise((resolve) =>
        setTimeout(resolve, timestamps[0] + WINDOW_MS - now),
      );
      await this.pace(key);
      return;
    }
    timestamps.push(Date.now());
    this.windows.set(key, timestamps);
  }
}
