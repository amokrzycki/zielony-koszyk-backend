import { resolve } from 'node:path';
import * as OTPAuth from 'otpauth';
import { DataSource } from 'typeorm';
import {
  MFA_TOTP_ALGORITHM,
  MFA_TOTP_DIGITS,
  MFA_TOTP_ISSUER,
  MFA_TOTP_PERIOD_SECONDS,
  SALT_ROUNDS,
} from '../../src/constants/constants';
import { WebAuthnCredential } from '../../src/entities/webauthn-credential.entity';
import { MfaMethod } from '../../src/enums/MfaMethod';
import {
  ACCOUNTS_PATH,
  METADATA_PATH,
  RESEARCH_ROOT,
  TOTP_SECRETS_PATH,
  WEBAUTHN_SNAPSHOT_PATH,
  ResearchAccount,
  ResearchUser,
  TotpSecretStore,
  WebAuthnSnapshot,
  credentialIdKey,
  gitRevision,
  readJson,
  writeJsonPrivate,
  writePublic,
} from '../dataset';
import {
  HttpError,
  ResearchHttp,
  cleanupResearchChallenges,
  disconnectDatabase,
  loadResearchUsers,
  preflight,
} from '../runtime';
import { createDatabaseSnapshot } from './database-snapshot';
import { seedResearchUsers } from './seed-research-users';
import { validateDataset } from './validate-dataset';
import { WebAuthnBrowser } from './webauthn-browser';

type FullLogin = {
  mfa_required: false;
  access_token: string;
  user: { user_id: string; mfa_method: MfaMethod };
};

type PendingLogin = {
  mfa_required: true;
  method: MfaMethod;
  mfa_token: string;
};

const login = (http: ResearchHttp, email: string, password: string) =>
  http.request<FullLogin | PendingLogin>('/auth/login', 'POST', {
    email,
    password,
    rememberMe: false,
  });

const requireFullLogin = (
  result: FullLogin | PendingLogin,
  email: string,
): FullLogin => {
  if (!('access_token' in result))
    throw new Error(`${email} unexpectedly requires MFA`);
  return result;
};

const requirePendingLogin = (
  result: FullLogin | PendingLogin,
  method: MfaMethod,
  email: string,
): PendingLogin => {
  if (!('mfa_token' in result) || result.method !== method) {
    throw new Error(`${email} did not enter ${method} pending state`);
  }
  return result;
};

const usersByEmail = (users: ResearchUser[]) =>
  new Map(users.map((user) => [user.email, user]));

const provisionEmailOtp = async (
  http: ResearchHttp,
  accounts: ResearchAccount[],
  users: Map<string, ResearchUser>,
  password: string,
) => {
  for (const account of accounts.filter(
    ({ variant }) => variant === MfaMethod.EMAIL_OTP,
  )) {
    const user = users.get(account.email);
    if (user.mfa_method === MfaMethod.EMAIL_OTP) continue;
    if (user.mfa_method !== MfaMethod.NONE) {
      throw new Error(`${account.email} has conflicting MFA state`);
    }
    const session = requireFullLogin(
      await login(http, account.email, password),
      account.email,
    );
    await http.request(
      '/users/me/mfa',
      'PUT',
      { method: MfaMethod.EMAIL_OTP, password },
      session.access_token,
    );
    console.log(`${account.client_slot} EMAIL_OTP provisioned`);
  }
};

const provisionTotp = async (
  http: ResearchHttp,
  accounts: ResearchAccount[],
  users: Map<string, ResearchUser>,
  password: string,
) => {
  const store = await readJson<TotpSecretStore>(TOTP_SECRETS_PATH, {});
  for (const account of accounts.filter(
    ({ variant }) => variant === MfaMethod.TOTP,
  )) {
    const user = users.get(account.email);
    if (user.mfa_method === MfaMethod.TOTP) {
      if (!store[account.email]) {
        throw new Error(
          `${account.email} is enrolled but its local TOTP secret is missing`,
        );
      }
      continue;
    }
    if (user.mfa_method !== MfaMethod.NONE) {
      throw new Error(`${account.email} has conflicting MFA state`);
    }
    const session = requireFullLogin(
      await login(http, account.email, password),
      account.email,
    );
    const enrollment = await http.request<{
      challenge_id: string;
      secret: string;
    }>(
      '/users/me/mfa/totp/enrollment',
      'POST',
      { password },
      session.access_token,
    );
    const timestamp = Date.now();
    const totp = new OTPAuth.TOTP({
      issuer: MFA_TOTP_ISSUER,
      label: account.email,
      algorithm: MFA_TOTP_ALGORITHM,
      digits: MFA_TOTP_DIGITS,
      period: MFA_TOTP_PERIOD_SECONDS,
      secret: OTPAuth.Secret.fromBase32(enrollment.secret),
    });
    const first_used_step = totp.counter({ timestamp });
    store[account.email] = {
      client_slot: account.client_slot,
      secret: enrollment.secret,
      first_used_step,
    };
    await writeJsonPrivate(TOTP_SECRETS_PATH, store);
    await http.request(
      '/users/me/mfa/totp/enrollment/verify',
      'POST',
      {
        challenge_id: enrollment.challenge_id,
        code: totp.generate({ timestamp }),
      },
      session.access_token,
    );
    console.log(`${account.client_slot} TOTP provisioned`);
  }
};

const provisionWebAuthn = async (
  source: DataSource,
  accounts: ResearchAccount[],
  users: Map<string, ResearchUser>,
  password: string,
) => {
  const emptySnapshot: WebAuthnSnapshot = {
    version: 1,
    rp_id: process.env.WEBAUTHN_RP_ID,
    authenticator: {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
      credentials: [],
    },
  };
  const snapshot = await readJson<WebAuthnSnapshot>(
    WEBAUTHN_SNAPSHOT_PATH,
    emptySnapshot,
  );
  if (snapshot.rp_id !== process.env.WEBAUTHN_RP_ID) {
    throw new Error('WebAuthn snapshot RP ID does not match runtime');
  }
  const credentials = await source.getRepository(WebAuthnCredential).find();
  const snapshotIds = new Set(
    snapshot.authenticator.credentials.map(({ credentialId }) =>
      credentialIdKey(credentialId),
    ),
  );
  for (const user of users.values()) {
    if (
      user.mfa_method === MfaMethod.WEBAUTHN &&
      !credentials.some(
        ({ user_id, credential_id }) =>
          user_id === user.user_id &&
          snapshotIds.has(credentialIdKey(credential_id)),
      )
    ) {
      throw new Error(
        `${user.email} has no matching virtual credential snapshot`,
      );
    }
  }

  const browser = await WebAuthnBrowser.launch(snapshot);
  let batchStarted = Date.now();
  let enrolled = 0;
  try {
    for (const account of accounts.filter(
      ({ variant }) => variant === MfaMethod.WEBAUTHN,
    )) {
      const user = users.get(account.email);
      if (user.mfa_method === MfaMethod.WEBAUTHN) continue;
      if (user.mfa_method !== MfaMethod.NONE) {
        throw new Error(`${account.email} has conflicting MFA state`);
      }
      if (enrolled > 0 && enrolled % 5 === 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, batchStarted + 61_000 - Date.now())),
        );
        batchStarted = Date.now();
      }
      await browser.enroll(account.email, password);
      await browser.saveSnapshot();
      enrolled += 1;
      console.log(`${account.client_slot} WEBAUTHN provisioned`);
    }
    if (enrolled) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, batchStarted + 61_000 - Date.now())),
      );
    }
    return browser;
  } catch (error) {
    await browser.close();
    throw error;
  }
};

const dryRun = async (
  http: ResearchHttp,
  browser: WebAuthnBrowser,
  accounts: ResearchAccount[],
  password: string,
) => {
  const byVariant = (variant: MfaMethod) =>
    accounts.find((account) => account.variant === variant);
  requireFullLogin(
    await login(http, byVariant(MfaMethod.NONE).email, password),
    byVariant(MfaMethod.NONE).email,
  );
  requirePendingLogin(
    await login(http, byVariant(MfaMethod.EMAIL_OTP).email, password),
    MfaMethod.EMAIL_OTP,
    byVariant(MfaMethod.EMAIL_OTP).email,
  );

  const totpAccount = byVariant(MfaMethod.TOTP);
  await new Promise((resolve) =>
    setTimeout(
      resolve,
      MFA_TOTP_PERIOD_SECONDS * 1_000 -
        (Date.now() % (MFA_TOTP_PERIOD_SECONDS * 1_000)) +
        1_000,
    ),
  );
  const pending = requirePendingLogin(
    await login(http, totpAccount.email, password),
    MfaMethod.TOTP,
    totpAccount.email,
  );
  const secret = (await readJson<TotpSecretStore>(TOTP_SECRETS_PATH))[
    totpAccount.email
  ].secret;
  const totp = new OTPAuth.TOTP({
    issuer: MFA_TOTP_ISSUER,
    label: totpAccount.email,
    algorithm: MFA_TOTP_ALGORITHM,
    digits: MFA_TOTP_DIGITS,
    period: MFA_TOTP_PERIOD_SECONDS,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  const code = totp.generate();
  await http.request(
    '/auth/mfa/totp/verify',
    'POST',
    { code },
    pending.mfa_token,
  );
  try {
    await http.request(
      '/auth/mfa/totp/verify',
      'POST',
      { code },
      pending.mfa_token,
    );
    throw new Error('TOTP challenge replay unexpectedly succeeded');
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 401) throw error;
  }
  const webauthn = byVariant(MfaMethod.WEBAUTHN);
  await browser.verifyLoginAndReplay(webauthn.email, password);
  await browser.saveSnapshot();
  console.log(
    'Dry run: NONE, EMAIL_OTP pending, TOTP login/replay, WebAuthn login/replay OK',
  );
};

const generatePublicArtifacts = async (
  source: DataSource,
  accounts: ResearchAccount[],
) => {
  const users = usersByEmail(await loadResearchUsers(source, accounts));
  const csv = [
    'client_slot,variant,user_id,email',
    ...accounts.map((account) => {
      const user = users.get(account.email);
      return [
        account.client_slot,
        account.variant,
        user.user_id,
        account.email,
      ].join(',');
    }),
  ].join('\n');
  await writePublic(ACCOUNTS_PATH, `${csv}\n`);

  const [{ server_version }] = await source.query<
    Array<{ server_version: string }>
  >('SHOW server_version');
  const backendRoot = resolve(RESEARCH_ROOT, '..');
  const frontendRoot =
    process.env.RESEARCH_FRONTEND_REPO ??
    resolve(RESEARCH_ROOT, '../../zielony-koszyk');
  const metadata = {
    dataset_version: 1,
    accounts: 200,
    clients: 50,
    accounts_per_variant: 50,
    variants: Object.values(MfaMethod),
    backend_commit: await gitRevision(backendRoot),
    frontend_commit: await gitRevision(frontendRoot),
    database: { engine: 'PostgreSQL', version: server_version },
    webauthn: {
      rp_id: process.env.WEBAUTHN_RP_ID,
      origin: process.env.WEBAUTHN_ORIGIN,
      authenticator: 'Chrome CDP virtual platform authenticator',
    },
    password: { shared: true, bcrypt_cost: SALT_ROUNDS },
  };
  await writePublic(METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`);
};

const main = async () => {
  const { source, expected } = await preflight();
  const password = process.env.MFA_RESEARCH_PASSWORD;
  try {
    await seedResearchUsers(source, expected, password);
    let users = usersByEmail(await loadResearchUsers(source, expected));
    const http = new ResearchHttp();
    await provisionEmailOtp(http, expected, users, password);
    users = usersByEmail(await loadResearchUsers(source, expected));
    await provisionTotp(http, expected, users, password);
    await http.clearWindow('/auth/login', 'POST');
    users = usersByEmail(await loadResearchUsers(source, expected));
    const browser = await provisionWebAuthn(source, expected, users, password);
    try {
      await dryRun(http, browser, expected, password);
    } finally {
      await browser.close();
    }
    await cleanupResearchChallenges(
      source,
      (await loadResearchUsers(source, expected)).map(({ user_id }) => user_id),
    );
    await generatePublicArtifacts(source, expected);
    await validateDataset(source);
    await createDatabaseSnapshot();
  } finally {
    const users = await loadResearchUsers(source, expected).catch(
      (): ResearchUser[] => [],
    );
    await cleanupResearchChallenges(
      source,
      users.map(({ user_id }) => user_id),
    );
  }
};

if (require.main === module) {
  void main()
    .catch((error) => {
      console.error((error as Error).message);
      process.exitCode = 1;
    })
    .finally(disconnectDatabase);
}
