import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { chromium, Page } from 'playwright';
import * as OTPAuth from 'otpauth';
import {
  MFA_TOTP_ALGORITHM,
  MFA_TOTP_DIGITS,
  MFA_TOTP_ISSUER,
  MFA_TOTP_PERIOD_SECONDS,
} from '../../src/constants/constants';
import {
  ResearchUser,
  TotpSecretStore,
  WebAuthnSnapshot,
  writeJsonPrivate,
} from '../dataset';
import {
  BROWSER_FLAGS,
  CHROMIUM_EXECUTABLE,
  DEVICE_SCALE_FACTOR,
  E3Error,
  FRONTEND_URL,
  LOCALE,
  MAILPIT_TIMEOUT_MS,
  RUN_TIMEOUT_MS,
  Scenario,
  STEP_TIMEOUT_MS,
  TIMEZONE,
  THROTTLED_ENDPOINT,
  ThrottleScheduler,
  VIEWPORT,
  WEBAUTHN_CHECKPOINT_PATH,
  guardTotpStep,
} from './protocol';
import { ExternalResource } from './artifacts';

const MAILPIT_URL = 'http://127.0.0.1:8025';
const GOOGLE_FONT_HOSTS = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
]);

type MetricsSnapshot = {
  lcp: number | null;
  lcpElement: string | null;
  inp: number | null;
  inpTarget: string | null;
  clsHistory: Array<{
    value: number;
    entryStartTimes: number[];
  }>;
  firstTrustedInput: {
    type: string;
    target: string;
    gateComplete: boolean;
  } | null;
};

export type JourneyResult = {
  navigation_start_ts: string;
  measured_window_end_ts: string;
  duration_total_ms: number;
  lcp_ms: number | null;
  lcp_element_selector: string | null;
  inp_ms: number | null;
  inp_interaction_target: string | null;
  cls_value: number;
  cls_boundary_ts: number;
  chromium_pid_started_fresh: true;
  trusted_input: boolean;
  render_gate: boolean;
  cls_instrumented: boolean;
  external_resources: ExternalResource[];
};

export type JourneyInput = {
  scenario: Scenario;
  account: ResearchUser;
  password: string;
  scheduler: ThrottleScheduler;
  totpSecrets: TotpSecretStore;
  webauthnSnapshot: WebAuthnSnapshot;
  registerSecret?: (value: string) => void;
};

const instrumentation = async () => {
  const iifePath = resolve(
    dirname(require.resolve('web-vitals')),
    'web-vitals.iife.js',
  );
  const iife = await readFile(iifePath, 'utf8');
  return `${iife}\n;(() => {
    const targetName = (target) => {
      if (!(target instanceof Element)) return 'unknown';
      if (target.matches('button[type="submit"]')) {
        return target.textContent?.includes('Potwierdź') ? 'otp-submit' : 'login-submit';
      }
      if (target.textContent?.includes('Użyj klucza platformowego')) return 'webauthn-button';
      if (
        target.matches('input[type="email"], input[aria-label="Email"]') ||
        (target instanceof HTMLInputElement &&
          [...target.labels].some((label) => label.textContent?.trim() === 'Email'))
      ) return 'email-input';
      if (target.matches('input[type="password"]')) return 'password-input';
      if (target.matches('input[inputmode="numeric"]')) return 'otp-input';
      return target.tagName.toLowerCase();
    };
    const selector = (element) => {
      if (!(element instanceof Element)) return null;
      if (element.id) return '#' + CSS.escape(element.id);
      const classes = [...element.classList].filter((name) => /^[a-zA-Z0-9_-]+$/.test(name)).slice(0, 2);
      return element.tagName.toLowerCase() + classes.map((name) => '.' + CSS.escape(name)).join('');
    };
    const state = globalThis.__e3 = {
      gateComplete: false,
      firstTrustedInput: null,
      lcp: null,
      lcpElement: null,
      inp: null,
      inpTarget: null,
      clsHistory: [],
    };
    for (const type of ['keydown', 'click']) {
      addEventListener(type, (event) => {
        if (event.isTrusted && !state.firstTrustedInput) {
          state.firstTrustedInput = {
            type: event.type,
            target: targetName(event.target),
            gateComplete: state.gateComplete,
          };
        }
      }, { capture: true });
    }
    webVitals.onLCP((metric) => {
      state.lcp = metric.value;
      state.lcpElement = selector(metric.entries.at(-1)?.element);
    }, { reportAllChanges: false });
    webVitals.onINP((metric) => {
      state.inp = metric.value;
      state.inpTarget = targetName(metric.entries[0]?.target);
    }, { reportAllChanges: true });
    webVitals.onCLS((metric) => {
      state.clsHistory.push({
        value: metric.value,
        entryStartTimes: metric.entries.map((entry) => entry.startTime),
      });
    }, { reportAllChanges: true });
  })();`;
};

const responseFor = (page: Page, path: string) =>
  page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === path,
    { timeout: STEP_TIMEOUT_MS },
  );

const assertResponse = async (
  responsePromise: ReturnType<typeof responseFor>,
) => {
  const response = await responsePromise;
  if (response.status() === 429) throw new E3Error('HTTP_429');
  if (!response.ok()) throw new E3Error('LOGIN_FAILURE');
};

const purgeMailpit = async () => {
  const response = await fetch(`${MAILPIT_URL}/api/v1/messages`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
  });
  if (!response.ok) throw new E3Error('MAILPIT_FAILURE');
};

const waitForEmailOtp = async (email: string, loginSubmittedAt: number) => {
  const deadline = loginSubmittedAt + MAILPIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${MAILPIT_URL}/api/v1/messages?start=0&limit=50`,
      { signal: AbortSignal.timeout(STEP_TIMEOUT_MS) },
    );
    if (!response.ok) throw new E3Error('MAILPIT_FAILURE');
    const mailbox = (await response.json()) as {
      messages?: Array<{
        ID?: string;
        To?: Array<{ Address?: string }>;
      }>;
    };
    const summary = mailbox.messages?.find(
      (message) =>
        message.To?.length === 1 &&
        message.To[0].Address?.toLowerCase() === email.toLowerCase(),
    );
    if (summary?.ID) {
      const messageResponse = await fetch(
        `${MAILPIT_URL}/api/v1/message/${encodeURIComponent(summary.ID)}`,
        { signal: AbortSignal.timeout(STEP_TIMEOUT_MS) },
      );
      if (!messageResponse.ok) throw new E3Error('MAILPIT_FAILURE');
      const message = (await messageResponse.json()) as { HTML?: string };
      const codes = message.HTML?.match(/\b\d{6}\b/g) ?? [];
      if (codes.length !== 1) throw new E3Error('MAILPIT_FAILURE');
      return codes[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new E3Error('MAILPIT_FAILURE');
};

const renderGate = async (page: Page) => {
  try {
    await page.locator('form').first().waitFor({
      state: 'visible',
      timeout: STEP_TIMEOUT_MS,
    });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.waitForFunction(
      () =>
        [...document.images]
          .filter((image) => {
            const box = image.getBoundingClientRect();
            return box.width > 0 && box.height > 0;
          })
          .every((image) => image.complete && image.naturalWidth > 0),
      undefined,
      { timeout: STEP_TIMEOUT_MS },
    );
    const imageFailure = await page.evaluate(() =>
      [...document.images]
        .filter((image) => {
          const box = image.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        })
        .some((image) => !image.complete || image.naturalWidth <= 0),
    );
    if (imageFailure) throw new E3Error('CRITICAL_IMAGE_FAILURE');
    await page.evaluate(
      () =>
        new Promise<void>((resolveAnimation) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => resolveAnimation()),
          ),
        ),
    );
    await page.evaluate(() => {
      (
        globalThis as typeof globalThis & { __e3: { gateComplete: boolean } }
      ).__e3.gateComplete = true;
    });
  } catch (error) {
    if (error instanceof E3Error) throw error;
    throw new E3Error('RENDER_GATE_FAILURE');
  }
};

const typeInto = async (page: Page, label: string, value: string) => {
  const input = page.getByLabel(label, { exact: true });
  await input.focus();
  await page.keyboard.type(value);
};

const addVirtualAuthenticator = async (
  page: Page,
  snapshot: WebAuthnSnapshot,
  userId: string,
) => {
  const credential = snapshot.authenticator.credentials.find(
    (candidate) =>
      Buffer.from(candidate.userHandle, 'base64url').toString() === userId,
  );
  if (!credential) throw new E3Error('MFA_FAILURE');
  const session = await page.context().newCDPSession(page);
  await session.send('WebAuthn.enable');
  const { authenticatorId } = await session.send(
    'WebAuthn.addVirtualAuthenticator',
    { options: snapshot.authenticator.options },
  );
  await session.send('WebAuthn.addCredential', {
    authenticatorId,
    credential,
  });
  return { session, authenticatorId, credential };
};

const reserveEndpoints = async (input: JourneyInput) => {
  await input.scheduler.reserve(THROTTLED_ENDPOINT.login);
  const verifyEndpoint: string | undefined = (
    {
      S2_EMAIL_OTP: THROTTLED_ENDPOINT.emailOtp,
      S3_TOTP: THROTTLED_ENDPOINT.totp,
      S4_WEBAUTHN: THROTTLED_ENDPOINT.webauthn,
    } as Partial<Record<Scenario, string>>
  )[input.scenario];
  if (verifyEndpoint) await input.scheduler.reserve(verifyEndpoint);
};

export const runJourney = async (
  input: JourneyInput,
): Promise<JourneyResult> => {
  await reserveEndpoints(input);
  if (input.scenario === 'S2_EMAIL_OTP') await purgeMailpit();

  const profile = await mkdtemp(join(tmpdir(), 'zielony-e3-chromium-'));
  let startedAt = 0;
  let navigationStart = '';
  let crashed = false;
  let runTimer: NodeJS.Timeout | undefined;
  const fontNetwork = new Map<string, boolean>();
  let context:
    | Awaited<ReturnType<typeof chromium.launchPersistentContext>>
    | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: CHROMIUM_EXECUTABLE,
      headless: false,
      args: [...BROWSER_FLAGS],
      viewport: VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      locale: LOCALE,
      timezoneId: TIMEZONE,
    });
    await context.addInitScript(await instrumentation());
    const page = context.pages()[0] ?? (await context.newPage());
    let virtualAuthenticator:
      | Awaited<ReturnType<typeof addVirtualAuthenticator>>
      | undefined;
    page.on('crash', () => {
      crashed = true;
    });
    page.on('requestfailed', (request) => {
      const url = new URL(request.url());
      if (GOOGLE_FONT_HOSTS.has(url.hostname))
        fontNetwork.set(request.url(), false);
    });
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (GOOGLE_FONT_HOSTS.has(url.hostname)) {
        fontNetwork.set(
          response.url(),
          response.status() >= 200 && response.status() < 300,
        );
      }
    });
    if (input.scenario === 'S4_WEBAUTHN') {
      virtualAuthenticator = await addVirtualAuthenticator(
        page,
        input.webauthnSnapshot,
        input.account.user_id,
      );
    }
    if (input.scenario === 'S3_TOTP') await guardTotpStep();

    return await Promise.race([
      (async (): Promise<JourneyResult> => {
        startedAt = Date.now();
        navigationStart = new Date(startedAt).toISOString();
        try {
          await page.goto(`${FRONTEND_URL}/login`, {
            waitUntil: 'load',
            timeout: STEP_TIMEOUT_MS,
          });
        } catch {
          throw new E3Error('NAVIGATION_FAILURE');
        }
        await renderGate(page);
        await typeInto(page, 'Email', input.account.email);
        await typeInto(page, 'Hasło', input.password);

        const loginResponse = responseFor(page, '/auth/login');
        const loginSubmittedAt = Date.now();
        await page.getByRole('button', { name: 'Zaloguj się' }).click();
        await assertResponse(loginResponse);

        if (input.scenario === 'S2_EMAIL_OTP' || input.scenario === 'S3_TOTP') {
          await page.getByLabel('Kod jednorazowy', { exact: true }).waitFor({
            state: 'visible',
            timeout: STEP_TIMEOUT_MS,
          });
          let code: string;
          if (input.scenario === 'S2_EMAIL_OTP') {
            code = await waitForEmailOtp(input.account.email, loginSubmittedAt);
          } else {
            const secret = input.totpSecrets[input.account.email]?.secret;
            if (!secret) throw new E3Error('TOTP_FAILURE');
            code = new OTPAuth.TOTP({
              issuer: MFA_TOTP_ISSUER,
              label: input.account.email,
              algorithm: MFA_TOTP_ALGORITHM,
              digits: MFA_TOTP_DIGITS,
              period: MFA_TOTP_PERIOD_SECONDS,
              secret: OTPAuth.Secret.fromBase32(secret),
            }).generate();
          }
          input.registerSecret?.(code);
          await typeInto(page, 'Kod jednorazowy', code);
          const path =
            input.scenario === 'S2_EMAIL_OTP'
              ? '/auth/mfa/email-otp/verify'
              : '/auth/mfa/totp/verify';
          const verificationResponse = responseFor(page, path);
          await page.getByRole('button', { name: 'Potwierdź' }).click();
          try {
            await assertResponse(verificationResponse);
          } catch (error) {
            if (input.scenario === 'S3_TOTP') throw new E3Error('TOTP_FAILURE');
            throw error;
          }
        } else if (input.scenario === 'S4_WEBAUTHN') {
          const button = page.getByRole('button', {
            name: 'Użyj klucza platformowego',
          });
          await button.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
          const verificationResponse = responseFor(
            page,
            '/auth/mfa/webauthn/verify',
          );
          await button.click();
          try {
            await assertResponse(verificationResponse);
          } catch {
            throw new E3Error('MFA_FAILURE');
          }
          const { credentials } = await virtualAuthenticator.session.send(
            'WebAuthn.getCredentials',
            { authenticatorId: virtualAuthenticator.authenticatorId },
          );
          const updated = credentials.find(
            (credential) =>
              credential.credentialId ===
              virtualAuthenticator.credential.credentialId,
          );
          if (!updated) throw new E3Error('MFA_FAILURE');
          Object.assign(virtualAuthenticator.credential, updated);
          await writeJsonPrivate(
            WEBAUTHN_CHECKPOINT_PATH,
            input.webauthnSnapshot,
          );
        }

        await page.waitForURL(
          (url) => url.origin === FRONTEND_URL && url.pathname === '/',
          { timeout: STEP_TIMEOUT_MS },
        );
        const clsBoundary = await page.evaluate(() => performance.now());
        await page.waitForFunction(
          () =>
            (globalThis as typeof globalThis & { __e3: MetricsSnapshot }).__e3
              .inp !== null,
          undefined,
          { timeout: STEP_TIMEOUT_MS },
        );
        const [metrics, resources] = await Promise.all([
          page.evaluate(
            () =>
              (globalThis as typeof globalThis & { __e3: MetricsSnapshot })
                .__e3,
          ),
          page.evaluate(() =>
            performance
              .getEntriesByType('resource')
              .filter((entry) => {
                const host = new URL(entry.name).hostname;
                return (
                  host === 'fonts.googleapis.com' ||
                  host === 'fonts.gstatic.com'
                );
              })
              .map((entry) => {
                const timing = entry as PerformanceResourceTiming;
                const url = new URL(entry.name);
                return {
                  url: entry.name,
                  origin: url.origin,
                  host: url.host,
                  initiator_type: timing.initiatorType,
                  duration: timing.duration,
                  transfer_size: timing.transferSize,
                };
              }),
          ),
        ]);
        if (crashed) throw new E3Error('CHROMIUM_CRASH');
        if (
          metrics.firstTrustedInput?.type !== 'keydown' ||
          metrics.firstTrustedInput.target !== 'email-input' ||
          !metrics.firstTrustedInput.gateComplete
        ) {
          throw new E3Error('INTERACTION_FAILURE');
        }
        if (
          !fontNetwork.size ||
          [...fontNetwork.values()].some((success) => !success)
        ) {
          throw new E3Error('GOOGLE_FONTS_FAILURE');
        }
        const externalResources: ExternalResource[] = resources.map(
          (resource) => ({
            origin: resource.origin,
            host: resource.host,
            initiator_type: resource.initiator_type,
            duration: Number.isFinite(resource.duration)
              ? resource.duration
              : null,
            transfer_size: Number.isFinite(resource.transfer_size)
              ? resource.transfer_size
              : null,
            success: fontNetwork.get(resource.url) === true,
          }),
        );
        if (
          !externalResources.length ||
          externalResources.some(({ success }) => !success)
        ) {
          throw new E3Error('GOOGLE_FONTS_FAILURE');
        }
        const cls =
          metrics.clsHistory
            .filter(({ entryStartTimes }) =>
              entryStartTimes.every((startTime) => startTime < clsBoundary),
            )
            .at(-1)?.value ?? 0;
        return {
          navigation_start_ts: navigationStart,
          measured_window_end_ts: new Date().toISOString(),
          duration_total_ms: Date.now() - startedAt,
          lcp_ms: metrics.lcp,
          lcp_element_selector: metrics.lcpElement,
          inp_ms: metrics.inp,
          inp_interaction_target: metrics.inpTarget,
          cls_value: cls,
          cls_boundary_ts: clsBoundary,
          chromium_pid_started_fresh: true,
          trusted_input: true,
          render_gate: true,
          cls_instrumented: metrics.clsHistory.length > 0,
          external_resources: externalResources,
        };
      })(),
      new Promise<never>(
        (_, reject) =>
          (runTimer = setTimeout(
            () => reject(new E3Error('RUN_TIMEOUT')),
            RUN_TIMEOUT_MS,
          )),
      ),
    ]);
  } finally {
    clearTimeout(runTimer);
    await context?.close().catch(() => undefined);
    await rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
};
