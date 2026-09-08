import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WEBAUTHN_SNAPSHOT_PATH,
  WebAuthnSnapshot,
  credentialIdKey,
  readJson,
  writeJsonPrivate,
} from '../dataset';
import { chromiumPath, frontendUrl } from '../runtime';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';

type CdpMessage = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message: string };
  sessionId?: string;
};

const AUTHENTICATOR_OPTIONS = {
  protocol: 'ctap2' as const,
  transport: 'internal' as const,
  hasResidentKey: true,
  hasUserVerification: true as const,
  isUserVerified: true as const,
  automaticPresenceSimulation: true as const,
};

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

class CdpClient {
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private listeners = new Map<string, Set<(params: unknown) => void>>();

  private constructor(private socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      if (message.method) {
        for (const listener of this.listeners.get(message.method) ?? []) {
          listener(message.params);
        }
      }
    });
  }

  static connect(url: string) {
    return new Promise<CdpClient>((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener('open', () => resolve(new CdpClient(socket)), {
        once: true,
      });
      socket.addEventListener(
        'error',
        () => reject(new Error('CDP connection failed')),
        {
          once: true,
        },
      );
    });
  }

  send<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  on<T>(method: string, listener: (params: T) => void) {
    const listeners = this.listeners.get(method) ?? new Set();
    const wrapped = (params: unknown) => listener(params as T);
    listeners.add(wrapped);
    this.listeners.set(method, listeners);
    return () => listeners.delete(wrapped);
  }

  close() {
    this.socket.close();
  }
}

const launchChromium = async () => {
  const profile = await mkdtemp(join(tmpdir(), 'zielony-research-chrome-'));
  const headless = process.env.RESEARCH_CHROMIUM_HEADLESS !== 'false';
  const child = spawn(
    chromiumPath(),
    [
      ...(headless ? ['--headless=new'] : []),
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  ) as ChildProcessWithoutNullStreams;

  let output = '';
  let websocketUrl: string;
  try {
    websocketUrl = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Chromium CDP startup timed out')),
        15_000,
      );
      child.stderr.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (!match) return;
        clearTimeout(timeout);
        resolve(match[1]);
      });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        const detail = output.trim().split('\n').at(-1);
        reject(
          new Error(
            `Chromium exited before CDP startup (${code ?? 'signal'})${detail ? `: ${detail}` : ''}`,
          ),
        );
      });
    });
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
    await rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
    throw error;
  }
  return { child, profile, websocketUrl };
};

export class WebAuthnBrowser {
  private credentialMetadata = new Map<
    string,
    WebAuthnSnapshot['authenticator']['credentials'][number]
  >();

  private constructor(
    private cdp: CdpClient,
    private sessionId: string,
    private authenticatorId: string,
    private child: ChildProcessWithoutNullStreams,
    private profile: string,
    snapshot?: WebAuthnSnapshot,
  ) {
    for (const credential of snapshot?.authenticator.credentials ?? []) {
      this.credentialMetadata.set(
        credentialIdKey(credential.credentialId),
        credential,
      );
    }
  }

  static async launch(snapshot?: WebAuthnSnapshot) {
    const launched = await launchChromium();
    let cdp: CdpClient | undefined;
    try {
      cdp = await CdpClient.connect(launched.websocketUrl);
      const { targetId } = await cdp.send<{ targetId: string }>(
        'Target.createTarget',
        {
          url: `${frontendUrl()}/login`,
        },
      );
      const { sessionId } = await cdp.send<{ sessionId: string }>(
        'Target.attachToTarget',
        { targetId, flatten: true },
      );
      await Promise.all([
        cdp.send('Page.enable', {}, sessionId),
        cdp.send('Runtime.enable', {}, sessionId),
        cdp.send('Network.enable', {}, sessionId),
        cdp.send('WebAuthn.enable', {}, sessionId),
      ]);
      const { authenticatorId } = await cdp.send<{ authenticatorId: string }>(
        'WebAuthn.addVirtualAuthenticator',
        { options: snapshot?.authenticator.options ?? AUTHENTICATOR_OPTIONS },
        sessionId,
      );
      for (const credential of snapshot?.authenticator.credentials ?? []) {
        await cdp.send(
          'WebAuthn.addCredential',
          { authenticatorId, credential },
          sessionId,
        );
      }
      const browser = new WebAuthnBrowser(
        cdp,
        sessionId,
        authenticatorId,
        launched.child,
        launched.profile,
        snapshot,
      );
      await browser.waitFor('document.readyState === "complete"');
      return browser;
    } catch (error) {
      cdp?.close();
      if (
        launched.child.exitCode === null &&
        launched.child.signalCode === null
      ) {
        launched.child.kill('SIGTERM');
        await new Promise((resolve) => launched.child.once('exit', resolve));
      }
      await rm(launched.profile, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
      throw error;
    }
  }

  async enroll(email: string, password: string) {
    await this.login(email, password);
    await this.navigate('/konto/mfa');
    await this.waitFor('document.body?.innerText.includes("Ustawienia MFA")');
    await this.evaluate(
      `document.querySelector('input[value="WEBAUTHN"]')?.click()`,
      true,
    );
    await this.waitFor(
      `document.querySelector('input[value="WEBAUTHN"]')?.checked === true`,
    );
    await this.fillByLabel('Aktualne hasło', password);
    await this.evaluate(
      `document.querySelector('button[type="submit"]')?.click()`,
      true,
    );
    await this.waitFor(
      'document.body?.innerText.includes("Aktywna: Klucz platformowy")',
      30_000,
    );
  }

  async verifyLoginAndReplay(email: string, password: string) {
    await this.navigate('/login');
    await this.waitFor(
      'document.querySelector(\'input[type="password"]\') !== null',
    );
    await this.fillByLabel('Email', email);
    await this.fillByLabel('Hasło', password);
    const loginResponse = this.captureJsonResponse('/auth/login');
    await this.evaluate(
      `document.querySelector('button[type="submit"]')?.click()`,
      true,
    );
    const pending = (await loginResponse) as { mfa_token?: string };
    if (!pending.mfa_token)
      throw new Error('WebAuthn login did not return MFA pending');
    await this.waitFor(
      `[...document.querySelectorAll('button')].some((button) => button.textContent?.includes('Użyj klucza platformowego'))`,
    );
    const verificationRequest = this.captureRequest(
      '/auth/mfa/webauthn/verify',
    );
    await this.evaluate(
      `[...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Użyj klucza platformowego'))?.click()`,
      true,
    );
    const request = await verificationRequest;
    await this.waitFor('location.pathname === "/"', 30_000);
    const replay = await fetch(request.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${pending.mfa_token}`,
      },
      body: request.postData,
    });
    if (replay.status !== 401) {
      throw new Error(
        `WebAuthn challenge replay returned HTTP ${replay.status}, expected 401`,
      );
    }
  }

  async generateAssertionOnly(
    options: PublicKeyCredentialRequestOptionsJSON,
  ): Promise<AuthenticationResponseJSON> {
    const origin = new URL(frontendUrl());
    if (
      origin.origin !== frontendUrl() ||
      origin.origin !== process.env.WEBAUTHN_ORIGIN ||
      !options.rpId ||
      options.rpId !== process.env.WEBAUTHN_RP_ID ||
      (origin.hostname !== options.rpId &&
        !origin.hostname.endsWith(`.${options.rpId}`))
    ) {
      throw new Error('WebAuthn assertion origin or RP ID mismatch');
    }
    const value = await this.evaluate(
      `(async () => {
        const options = ${JSON.stringify(options)};
        if (location.origin !== ${JSON.stringify(origin.origin)}) {
          throw new Error('assertion origin mismatch');
        }
        const decode = (value) => {
          const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
          const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
          return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
        };
        const encode = (value) => {
          const bytes = new Uint8Array(value);
          let binary = '';
          for (const byte of bytes) binary += String.fromCharCode(byte);
          return btoa(binary).split('+').join('-').split('/').join('_').replace(/=+$/, '');
        };
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        let credential;
        try {
          credential = await navigator.credentials.get({
            publicKey: {
              ...options,
              challenge: decode(options.challenge),
              allowCredentials: options.allowCredentials?.map((entry) => ({
                ...entry,
                id: decode(entry.id),
              })),
            },
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
        if (!(credential instanceof PublicKeyCredential) ||
            !(credential.response instanceof AuthenticatorAssertionResponse)) {
          throw new Error('invalid assertion');
        }
        return {
          id: credential.id,
          rawId: encode(credential.rawId),
          response: {
            authenticatorData: encode(credential.response.authenticatorData),
            clientDataJSON: encode(credential.response.clientDataJSON),
            signature: encode(credential.response.signature),
            userHandle: credential.response.userHandle
              ? encode(credential.response.userHandle)
              : undefined,
          },
          type: credential.type,
          clientExtensionResults: credential.getClientExtensionResults(),
          authenticatorAttachment: credential.authenticatorAttachment,
        };
      })()`,
      true,
    );
    if (!value || typeof value !== 'object') {
      throw new Error('WebAuthn assertion generation failed');
    }
    return value as AuthenticationResponseJSON;
  }

  async snapshot(): Promise<WebAuthnSnapshot> {
    const { credentials } = await this.cdp.send<{
      credentials: WebAuthnSnapshot['authenticator']['credentials'];
    }>(
      'WebAuthn.getCredentials',
      { authenticatorId: this.authenticatorId },
      this.sessionId,
    );
    const completeCredentials = credentials.map((credential) => ({
      ...this.credentialMetadata.get(credentialIdKey(credential.credentialId)),
      ...credential,
    }));
    for (const credential of completeCredentials) {
      this.credentialMetadata.set(
        credentialIdKey(credential.credentialId),
        credential,
      );
    }
    return {
      version: 1,
      rp_id: process.env.WEBAUTHN_RP_ID,
      authenticator: {
        options: AUTHENTICATOR_OPTIONS,
        credentials: completeCredentials,
      },
    };
  }

  async saveSnapshot() {
    await writeJsonPrivate(WEBAUTHN_SNAPSHOT_PATH, await this.snapshot());
  }

  async close() {
    this.cdp.close();
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill('SIGTERM');
      await new Promise((resolve) => this.child.once('exit', resolve));
    }
    await rm(this.profile, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }

  private async login(email: string, password: string) {
    await this.navigate('/login');
    await this.waitFor(
      'document.querySelector(\'input[type="password"]\') !== null',
    );
    await this.fillByLabel('Email', email);
    await this.fillByLabel('Hasło', password);
    await this.evaluate(
      `document.querySelector('button[type="submit"]')?.click()`,
      true,
    );
    await this.waitFor('location.pathname === "/"', 30_000);
  }

  private async navigate(path: string) {
    await this.cdp.send(
      'Page.navigate',
      { url: `${frontendUrl()}${path}` },
      this.sessionId,
    );
    await this.waitFor('document.readyState === "complete"');
  }

  private async fillByLabel(labelText: string, value: string) {
    await this.evaluate(`(() => {
      const label = [...document.querySelectorAll('label')].find((candidate) => candidate.textContent?.trim().startsWith(${JSON.stringify(labelText)}));
      const input = label?.htmlFor ? document.getElementById(label.htmlFor) : null;
      if (!(input instanceof HTMLInputElement)) throw new Error('Input not found');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
  }

  private async evaluate(expression: string, userGesture = false) {
    const result = await this.cdp.send<{
      result: { value: unknown };
      exceptionDetails?: { text: string };
    }>(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture },
      this.sessionId,
    );
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }

  private async waitFor(expression: string, timeout = 20_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.evaluate(`Boolean(${expression})`)) return;
      await wait(100);
    }
    throw new Error(`Browser state timed out: ${expression}`);
  }

  private captureRequest(path: string) {
    return new Promise<{ url: string; postData?: string }>((resolve) => {
      const unsubscribe = this.cdp.on<{
        request: { url: string; method: string; postData?: string };
      }>('Network.requestWillBeSent', ({ request }) => {
        if (
          request.method === 'POST' &&
          new URL(request.url).pathname === path
        ) {
          unsubscribe();
          resolve({ url: request.url, postData: request.postData });
        }
      });
    });
  }

  private captureJsonResponse(path: string) {
    return new Promise<unknown>((resolve, reject) => {
      const unsubscribe = this.cdp.on<{
        requestId: string;
        response: { url: string; status: number };
        type: string;
      }>('Network.responseReceived', ({ requestId, response, type }) => {
        if (
          type === 'Preflight' ||
          new URL(response.url).pathname !== path ||
          response.status < 200 ||
          response.status >= 300
        )
          return;
        unsubscribe();
        void this.responseBody(requestId).then(resolve, reject);
      });
    });
  }

  private async responseBody(requestId: string) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const { body } = await this.cdp.send<{ body: string }>(
          'Network.getResponseBody',
          { requestId },
          this.sessionId,
        );
        return JSON.parse(body) as unknown;
      } catch {
        await wait(100);
      }
    }
    throw new Error('Unable to read browser response body');
  }
}

const main = async () => {
  if (!process.argv.includes('--import')) {
    throw new Error('Pass --import to restore virtual authenticator state');
  }
  const snapshot = await readJson<WebAuthnSnapshot>(WEBAUTHN_SNAPSHOT_PATH);
  const browser = await WebAuthnBrowser.launch(snapshot);
  console.log(
    `Virtual authenticator restored: ${snapshot.authenticator.credentials.length} credentials; stop with Ctrl+C`,
  );
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  await browser.close();
};

if (require.main === module) {
  void main().catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  });
}
