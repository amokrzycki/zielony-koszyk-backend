import { MfaMethod } from '../enums/MfaMethod';
import { Roles } from '../enums/Roles';
import {
  DatasetState,
  ResearchUser,
  assertPublicArtifactsExcludeSecrets,
  buildAccounts,
  parseResearchEmail,
  planMissingAccounts,
  validateDatasetState,
} from '../../research/dataset';

const validState = (): DatasetState => {
  const expected = buildAccounts('example.test');
  const users: ResearchUser[] = expected.map((account, index) => ({
    ...account,
    user_id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    role: Roles.USER,
    password_hash: `$2b$10$${String(index).padStart(53, '0')}`,
    first_name: 'Research',
    last_name: account.identifier,
    phone: `000000${account.client_slot}`,
    mfa_method: account.variant,
    totp_secret_encrypted:
      account.variant === MfaMethod.TOTP ? `encrypted-${index}` : null,
    totp_last_used_step:
      account.variant === MfaMethod.TOTP ? 1_000 + index : null,
  }));
  const webauthnUsers = users.filter(
    ({ variant }) => variant === MfaMethod.WEBAUTHN,
  );
  return {
    expected,
    users,
    allBenchEmails: users.map(({ email }) => email),
    credentials: webauthnUsers.map(({ user_id }) => ({
      user_id,
      credential_id: `credential-${user_id}`,
      sign_count: 0,
    })),
    challengeCount: 0,
    totpSecrets: Object.fromEntries(
      users
        .filter(({ variant }) => variant === MfaMethod.TOTP)
        .map(({ email, client_slot }, index) => [
          email,
          {
            client_slot,
            secret: `SECRET${String(index).padStart(4, '0')}`,
            first_used_step: 1_000 + index,
          },
        ]),
    ),
    webauthnSnapshot: {
      version: 1,
      rp_id: 'localhost',
      authenticator: {
        options: {
          protocol: 'ctap2',
          transport: 'internal',
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
        },
        credentials: webauthnUsers.map(({ user_id }, index) => ({
          credentialId: `credential-${user_id}`,
          rpId: 'localhost',
          privateKey: `private-${index}`,
          userHandle: Buffer.from(user_id).toString('base64url'),
          signCount: 0,
          isResidentCredential: false,
        })),
      },
    },
    csvRows: users.map(({ client_slot, variant, user_id, email }) => ({
      client_slot,
      variant,
      user_id,
      email,
    })),
  };
};

describe('research dataset', () => {
  it('builds stable 50 x 4 naming and unique emails', () => {
    const accounts = buildAccounts('example.test');
    expect(accounts).toHaveLength(200);
    expect(new Set(accounts.map(({ email }) => email)).size).toBe(200);
    expect(accounts[0].identifier).toBe('bench-none-001');
    expect(accounts.at(-1)?.identifier).toBe('bench-waut-050');
    for (let slot = 1; slot <= 50; slot += 1) {
      expect(
        accounts.filter(
          ({ client_slot }) => client_slot === String(slot).padStart(3, '0'),
        ),
      ).toHaveLength(4);
    }
  });

  it('plans an idempotent seed and excludes ordinary users from reset namespace', () => {
    const accounts = buildAccounts('example.test');
    expect(planMissingAccounts(accounts, [])).toHaveLength(200);
    expect(
      planMissingAccounts(
        accounts,
        accounts.map(({ email }) => email),
      ),
    ).toEqual([]);
    expect(
      parseResearchEmail('customer@example.test', 'example.test'),
    ).toBeNull();
  });

  it('accepts a complete dataset', () => {
    expect(validateDatasetState(validState())).toEqual([]);
  });

  it('matches CDP base64 credential IDs with database base64url IDs', () => {
    const state = validState();
    const bytes = Buffer.from('same credential bytes');
    state.credentials[0].credential_id = bytes.toString('base64url');
    state.webauthnSnapshot.authenticator.credentials[0].credentialId =
      bytes.toString('base64');
    expect(validateDatasetState(state)).toEqual([]);
  });

  it.each([
    [
      'missing TOTP secret',
      (state: DatasetState) =>
        delete state.totpSecrets[Object.keys(state.totpSecrets)[0]],
    ],
    ['extra challenge', (state: DatasetState) => (state.challengeCount = 1)],
    [
      'missing WebAuthn credential',
      (state: DatasetState) => state.credentials.pop(),
    ],
    [
      'wrong MFA method',
      (state: DatasetState) =>
        (state.users.find(
          ({ variant }) => variant === MfaMethod.TOTP,
        ).mfa_method = MfaMethod.NONE),
    ],
    [
      'duplicate slot',
      (state: DatasetState) => (state.csvRows[1] = state.csvRows[0]),
    ],
  ])('rejects %s', (_name, mutate) => {
    const state = validState();
    mutate(state);
    expect(validateDatasetState(state)).not.toEqual([]);
  });

  it('keeps secret values out of public artifacts', () => {
    const state = validState();
    expect(() =>
      assertPublicArtifactsExcludeSecrets(
        'client_slot,variant,user_id,email',
        'password',
        state.totpSecrets,
        state.webauthnSnapshot,
      ),
    ).not.toThrow();
    expect(() =>
      assertPublicArtifactsExcludeSecrets(
        `public ${Object.values(state.totpSecrets)[0].secret}`,
        'password',
        state.totpSecrets,
        state.webauthnSnapshot,
      ),
    ).toThrow('secret material');
  });
});
