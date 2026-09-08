import { readFile } from 'node:fs/promises';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server';
import { WebAuthnSnapshot, credentialIdKey } from '../../dataset';
import { WebAuthnBrowser } from '../../scripts/webauthn-browser';
import { atomicReplacePrivate } from './artifacts';
import {
  CLIENTS,
  CounterState,
  HarnessError,
  VERIFY_ENDPOINT,
  assertWebAuthnCounterProgression,
} from './protocol';
import type { HarnessDiagnostic } from './protocol';
import { RequestPackage } from './broker';
import { SecretRegistry } from './security';
import { MfaMethod } from '../../../src/enums/MfaMethod';

export type WebAuthnDatabaseCredential = {
  client_slot: string;
  credential_id: string;
  sign_count: number;
};

export type WebAuthnPreparation = WebAuthnDatabaseCredential & {
  token: string;
  options: PublicKeyCredentialRequestOptionsJSON;
};

type AssertionBrowser = Pick<
  WebAuthnBrowser,
  'generateAssertionOnly' | 'snapshot'
> &
  Partial<Pick<WebAuthnBrowser, 'diagnosticState'>>;

export const webAuthnDiagnostic = (
  error: unknown,
  input: {
    lifecycleStage: 'browser_launch' | 'assertion_generation';
    clientSlot?: string;
    durationMs: number;
    preparedAssertions: number;
    browserState?: ReturnType<WebAuthnBrowser['diagnosticState']>;
  },
): HarnessDiagnostic => {
  const type = error instanceof Error ? error.name : typeof error;
  const rawMessage =
    error instanceof Error ? error.message : 'Non-error browser rejection';
  const exceptionMessage = rawMessage
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+/gi, '[redacted]')
    .replace(/\b(?:https?|wss?):\/\/\S+/gi, '[redacted]')
    .replace(/\b(?:authorization|cookie|set-cookie|bearer)\b/gi, '[redacted]')
    .replace(/[A-Za-z0-9+/_=-]{16,}/g, '[redacted]')
    .replace(/[^\x20-\x7e]/g, '?')
    .slice(0, 200);
  const cdpState = input.browserState?.cdp_state;
  return {
    lifecycle_stage: input.lifecycleStage,
    ...(input.clientSlot ? { client_slot: input.clientSlot } : {}),
    exception_type: /^[A-Za-z][A-Za-z0-9.]{0,63}$/.test(type)
      ? type
      : 'UnknownError',
    exception_message: exceptionMessage || 'No browser error message',
    duration_ms: Math.max(0, Math.round(input.durationMs)),
    chromium_alive: input.browserState?.chromium_alive ?? false,
    cdp_state:
      typeof cdpState === 'string' &&
      ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].includes(cdpState)
        ? cdpState
        : 'UNKNOWN',
    prepared_assertions: input.preparedAssertions,
  };
};

const assertAuthenticatorConfiguration = (snapshot: WebAuthnSnapshot) => {
  const options = snapshot.authenticator.options;
  if (
    snapshot.rp_id !== process.env.WEBAUTHN_RP_ID ||
    options.protocol !== 'ctap2' ||
    options.transport !== 'internal' ||
    options.hasResidentKey !== true ||
    options.hasUserVerification !== true ||
    options.isUserVerified !== true ||
    options.automaticPresenceSimulation !== true
  ) {
    throw new HarnessError('WEBAUTHN_AUTHENTICATOR_CONFIG');
  }
};

const snapshotCounters = (
  snapshot: WebAuthnSnapshot,
  database: WebAuthnDatabaseCredential[],
): CounterState[] => {
  const credentials = new Map(
    snapshot.authenticator.credentials.map((credential) => [
      credentialIdKey(credential.credentialId),
      credential.signCount,
    ]),
  );
  if (database.length !== CLIENTS || credentials.size !== CLIENTS) {
    throw new HarnessError('WEBAUTHN_COUNTER_COUNT');
  }
  return database.map((entry) => {
    const count = credentials.get(credentialIdKey(entry.credential_id));
    if (!Number.isSafeInteger(count)) {
      throw new HarnessError('WEBAUTHN_CREDENTIAL_MISMATCH');
    }
    return { client_slot: entry.client_slot, count: count };
  });
};

export const assertWebAuthnInitialState = (
  snapshot: WebAuthnSnapshot,
  database: WebAuthnDatabaseCredential[],
) => {
  assertAuthenticatorConfiguration(snapshot);
  const authenticator = snapshotCounters(snapshot, database);
  const db = database.map(({ client_slot, sign_count }) => ({
    client_slot,
    count: sign_count,
  }));
  assertWebAuthnCounterProgression(db, db, authenticator, 0);
  return db;
};

export const generateAssertions = async (
  browser: AssertionBrowser,
  preparations: WebAuthnPreparation[],
  registry: SecretRegistry,
) => {
  if (preparations.length !== CLIENTS) {
    throw new HarnessError('WEBAUTHN_PREPARATION_COUNT');
  }
  const initialSnapshot = await browser.snapshot();
  const before = assertWebAuthnInitialState(initialSnapshot, preparations);
  const expected = new Map(
    before.map(({ client_slot, count }) => [client_slot, count]),
  );
  const packages: RequestPackage[] = [];
  for (const preparation of [...preparations].sort((left, right) =>
    left.client_slot.localeCompare(right.client_slot),
  )) {
    const allowed = preparation.options.allowCredentials;
    if (
      preparation.options.rpId !== process.env.WEBAUTHN_RP_ID ||
      preparation.options.userVerification !== 'required' ||
      !allowed ||
      allowed.length !== 1 ||
      credentialIdKey(allowed[0].id) !==
        credentialIdKey(preparation.credential_id)
    ) {
      throw new HarnessError('WEBAUTHN_OPTIONS_MISMATCH');
    }
    let assertion: Awaited<
      ReturnType<AssertionBrowser['generateAssertionOnly']>
    >;
    const assertionStartedAt = Date.now();
    try {
      assertion = await browser.generateAssertionOnly(preparation.options);
    } catch (error) {
      throw new HarnessError(
        'WEBAUTHN_ASSERTION_GENERATION',
        webAuthnDiagnostic(error, {
          lifecycleStage: 'assertion_generation',
          clientSlot: preparation.client_slot,
          durationMs: Date.now() - assertionStartedAt,
          preparedAssertions: packages.length,
          browserState: browser.diagnosticState?.(),
        }),
      );
    }
    registry.add(preparation.credential_id);
    registry.addAssertion(assertion);
    const response = assertion.response as unknown as Record<string, unknown>;
    if (
      typeof assertion.id !== 'string' ||
      !assertion.id ||
      assertion.type !== 'public-key' ||
      typeof assertion.rawId !== 'string' ||
      !assertion.rawId ||
      !['authenticatorData', 'clientDataJSON', 'signature'].every(
        (field) => typeof response[field] === 'string' && response[field],
      ) ||
      credentialIdKey(assertion.id) !==
        credentialIdKey(preparation.credential_id) ||
      credentialIdKey(assertion.rawId) !==
        credentialIdKey(preparation.credential_id)
    ) {
      throw new HarnessError('WEBAUTHN_ASSERTION_CREDENTIAL');
    }
    const current = snapshotCounters(await browser.snapshot(), preparations);
    expected.set(
      preparation.client_slot,
      (expected.get(preparation.client_slot) ?? -1) + 1,
    );
    if (
      current.some(
        ({ client_slot, count }) => expected.get(client_slot) !== count,
      )
    ) {
      throw new HarnessError('WEBAUTHN_ASSERTION_COUNTER');
    }
    packages.push({
      client_slot: preparation.client_slot,
      variant: MfaMethod.WEBAUTHN,
      endpoint: VERIFY_ENDPOINT[MfaMethod.WEBAUTHN],
      authorization: `Bearer ${preparation.token}`,
      body: JSON.stringify({ response: assertion }),
    });
  }
  return {
    packages,
    before,
    authenticatorAfterPreparation: [...expected].map(
      ([client_slot, count]) => ({ client_slot, count }),
    ),
  };
};

export class E2WebAuthnSession {
  private constructor(
    readonly browser: WebAuthnBrowser,
    readonly activeSnapshotPath: string,
    private readonly privateMaterial: string[],
  ) {}

  static async launch(activeSnapshotPath: string) {
    let snapshot: WebAuthnSnapshot;
    try {
      snapshot = JSON.parse(
        await readFile(activeSnapshotPath, 'utf8'),
      ) as WebAuthnSnapshot;
    } catch {
      throw new HarnessError('WEBAUTHN_ACTIVE_SNAPSHOT');
    }
    assertAuthenticatorConfiguration(snapshot);
    const launchedAt = Date.now();
    let browser: WebAuthnBrowser;
    try {
      browser = await WebAuthnBrowser.launch(snapshot);
    } catch (error) {
      throw new HarnessError(
        'WEBAUTHN_BROWSER_LAUNCH',
        webAuthnDiagnostic(error, {
          lifecycleStage: 'browser_launch',
          durationMs: Date.now() - launchedAt,
          preparedAssertions: 0,
        }),
      );
    }
    return new E2WebAuthnSession(
      browser,
      activeSnapshotPath,
      snapshot.authenticator.credentials.flatMap((credential) => [
        credential.credentialId,
        credential.privateKey,
        credential.userHandle,
      ]),
    );
  }

  registerSecrets(registry: SecretRegistry) {
    for (const value of this.privateMaterial) registry.add(value);
  }

  async checkpoint() {
    const snapshot = await this.browser.snapshot();
    await atomicReplacePrivate(
      this.activeSnapshotPath,
      `${JSON.stringify(snapshot, null, 2)}\n`,
    );
  }

  async counters(database: WebAuthnDatabaseCredential[]) {
    return snapshotCounters(await this.browser.snapshot(), database);
  }

  async close() {
    await this.browser.close();
  }
}
