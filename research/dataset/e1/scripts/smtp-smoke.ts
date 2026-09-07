import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { format } from 'node:util';
import Handlebars from 'handlebars';
import { createTransport } from 'nodemailer';
import type { Logger, LoggerLevel } from 'nodemailer/lib/shared';
import { MfaMethod } from '../../../src/enums/MfaMethod';
import {
  ACCOUNTS_PATH,
  parseAccountsCsv,
  requireEnvironment,
  writeJsonPrivate,
} from '../../dataset';

const RESULTS_ROOT = resolve(__dirname, '../../results/e1-init');
const BACKEND_ROOT = resolve(__dirname, '../../..');
const TEMPLATE_PATH = resolve(__dirname, '../../../src/constants/mfa-otp.hbs');
type Phase = 'long-session' | 'reconnect';
type TechnicalError = {
  name: unknown;
  message: unknown;
  code: unknown;
  responseCode: unknown;
  response: unknown;
  command: unknown;
  errno: unknown;
  syscall: unknown;
  cause: TechnicalError | null;
};

const redactions = new Set<string>();

const sanitizeText = (value: string) => {
  let sanitized = value;
  for (const secret of redactions) {
    if (secret) sanitized = sanitized.split(secret).join('[REDACTED]');
  }
  return sanitized
    .replace(/\b(AUTH\s+(?:PLAIN|LOGIN))\s+\S+/gi, '$1 [REDACTED_CREDENTIALS]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '[REDACTED_EMAIL]')
    .replace(/\b\d{6}\b/g, '[REDACTED_OTP]');
};

const sanitizeValue = (
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): unknown => {
  if (typeof value === 'string') return sanitizeText(value);
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === undefined
  ) {
    return value ?? null;
  }
  if (typeof value !== 'object') return typeof value;
  if (depth === 5) return '[MaxDepth]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, seen, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      sanitizeValue(entry, seen, depth + 1),
    ]),
  );
};

const errorField = (error: unknown, key: string) =>
  error && typeof error === 'object'
    ? sanitizeValue((error as Record<string, unknown>)[key])
    : null;

const technicalError = (
  error: unknown,
  seen = new WeakSet<object>(),
): TechnicalError => {
  if (error && typeof error === 'object') {
    if (seen.has(error)) {
      return {
        name: null,
        message: '[Circular]',
        code: null,
        responseCode: null,
        response: null,
        command: null,
        errno: null,
        syscall: null,
        cause: null,
      };
    }
    seen.add(error);
  }
  const cause =
    error && typeof error === 'object'
      ? (error as { cause?: unknown }).cause
      : undefined;
  return {
    name: errorField(error, 'name'),
    message: errorField(error, 'message'),
    code: errorField(error, 'code'),
    responseCode: errorField(error, 'responseCode'),
    response: errorField(error, 'response'),
    command: errorField(error, 'command'),
    errno: errorField(error, 'errno'),
    syscall: errorField(error, 'syscall'),
    cause: cause === undefined ? null : technicalError(cause, seen),
  };
};

const selfCheck = () => {
  redactions.add('smtp-password');
  const value = sanitizeText(
    'smtp-password user@example.com OTP 123456; SMTP 421 4.7.0; AUTH PLAIN credential',
  );
  if (
    value.includes('smtp-password') ||
    value.includes('user@example.com') ||
    value.includes('123456') ||
    value.includes('credential') ||
    !value.includes('421 4.7.0')
  ) {
    throw new Error('SMTP smoke redaction self-check failed');
  }
  console.log('SMTP smoke self-check OK');
};

const scrubArtifact = async (input: string | undefined) => {
  const path = resolve(input ?? '');
  if (!path.startsWith(`${RESULTS_ROOT}${sep}smtp-smoke-`)) {
    throw new Error('Can only scrub an E1 SMTP smoke artifact');
  }
  const artifact = JSON.parse(await readFile(path, 'utf8')) as unknown;
  await writeJsonPrivate(path, sanitizeValue(artifact));
  console.log('SMTP smoke artifact scrubbed');
};

const main = async () => {
  if (process.argv.includes('--self-check')) return selfCheck();
  if (process.argv[2] === 'scrub-artifact') {
    return scrubArtifact(process.argv[3]);
  }
  if (!process.argv.includes('--confirm-real-email')) {
    throw new Error('Pass --confirm-real-email to authorize SMTP smoke sends');
  }
  const phase = process.argv[2] as Phase;
  if (!['long-session', 'reconnect'].includes(phase)) {
    throw new Error('Phase must be long-session or reconnect');
  }
  const reconnectFlags = process.argv.filter((argument) =>
    argument.startsWith('--reconnect='),
  );
  if (
    phase === 'reconnect' &&
    (reconnectFlags.length !== 1 || reconnectFlags[0] !== '--reconnect=1')
  ) {
    throw new Error('Reconnect diagnostic requires exactly --reconnect=1');
  }
  const env = requireEnvironment(
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_SECURE',
    'SMTP_USER',
    'SMTP_PASSWORD',
    'SMTP_FROM_EMAIL',
  );
  if (
    env.SMTP_HOST !== 'smtp.eu.mailgun.org' ||
    env.SMTP_PORT !== '587' ||
    env.SMTP_SECURE !== 'false'
  ) {
    throw new Error('SMTP smoke requires the confirmed Mailgun EU settings');
  }
  redactions.add(env.SMTP_USER);
  redactions.add(env.SMTP_PASSWORD);
  redactions.add(env.SMTP_FROM_EMAIL);
  redactions.add(Buffer.from(env.SMTP_USER).toString('base64'));
  redactions.add(Buffer.from(env.SMTP_PASSWORD).toString('base64'));
  redactions.add(
    Buffer.from(`\u0000${env.SMTP_USER}\u0000${env.SMTP_PASSWORD}`).toString(
      'base64',
    ),
  );

  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const root =
    phase === 'long-session'
      ? resolve(RESULTS_ROOT, `smtp-smoke-${timestamp}`)
      : resolve(process.env.E1_SMOKE_ROOT ?? '');
  if (
    !root.startsWith(`${RESULTS_ROOT}${sep}smtp-smoke-`) ||
    (phase === 'reconnect' && !process.env.E1_SMOKE_ROOT)
  ) {
    throw new Error('Reconnect requires a valid E1_SMOKE_ROOT');
  }
  if (phase === 'long-session') await mkdir(root, { recursive: false });
  else await access(resolve(root, 'long-session.json'));
  const artifactPath = resolve(root, `${phase}.json`);

  const longSession =
    phase === 'reconnect'
      ? (JSON.parse(
          await readFile(resolve(root, 'long-session.json'), 'utf8'),
        ) as {
          attempts: unknown[];
        })
      : undefined;
  const previousAttempts = longSession?.attempts.length ?? 0;
  const attemptLimit = phase === 'long-session' ? 10 : 1;
  if (previousAttempts + attemptLimit > 12) {
    throw new Error('SMTP smoke hard limit is 12 total attempts');
  }

  const accounts = parseAccountsCsv(await readFile(ACCOUNTS_PATH, 'utf8'))
    .filter(({ variant }) => variant === MfaMethod.EMAIL_OTP)
    .sort((left, right) => left.client_slot.localeCompare(right.client_slot))
    .slice(previousAttempts, previousAttempts + attemptLimit);
  if (accounts.length !== attemptLimit) {
    throw new Error('Not enough EMAIL_OTP research accounts');
  }
  for (const { email } of accounts) redactions.add(email);

  if (phase === 'reconnect') {
    const builtServicePath = resolve(
      BACKEND_ROOT,
      'dist/src/services/mail.service.js',
    );
    await access(builtServicePath);
    process.env.E1_MAIL_DIAGNOSTICS = 'true';
    const built = (await import(builtServicePath)) as {
      E1_MAIL_DIAGNOSTIC_PREFIX: string;
      MailService: new (config: ConfigService) => {
        sendMfaOtp(email: string, code: string): Promise<void>;
        onModuleDestroy(): void;
      };
    };
    const service = new built.MailService(new ConfigService());
    try {
      await writeFile(resolve(root, `${phase}.started`), timestamp, {
        flag: 'wx',
      });
    } catch (error) {
      service.onModuleDestroy();
      throw error;
    }
    const mailDiagnostics: unknown[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      for (const argument of args) {
        if (
          typeof argument === 'string' &&
          argument.startsWith(built.E1_MAIL_DIAGNOSTIC_PREFIX)
        ) {
          mailDiagnostics.push(
            JSON.parse(argument.slice(built.E1_MAIL_DIAGNOSTIC_PREFIX.length)),
          );
        }
      }
      originalLog(...args);
    };
    const attempts: unknown[] = [];
    const startedAt = new Date().toISOString();
    const [account] = accounts;
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    redactions.add(code);
    const attemptStartedAt = new Date().toISOString();
    const attemptStartedMs = performance.now();
    try {
      await service.sendMfaOtp(account.email, code);
      attempts.push({
        sequence: previousAttempts + 1,
        client_slot: account.client_slot,
        timestamp_utc: attemptStartedAt,
        completed_at_utc: new Date().toISOString(),
        elapsed_time_ms: Number(
          (performance.now() - attemptStartedMs).toFixed(3),
        ),
        outcome: 'accepted',
      });
    } catch (error) {
      attempts.push({
        sequence: previousAttempts + 1,
        client_slot: account.client_slot,
        timestamp_utc: attemptStartedAt,
        completed_at_utc: new Date().toISOString(),
        elapsed_time_ms: Number(
          (performance.now() - attemptStartedMs).toFixed(3),
        ),
        outcome: 'error',
        error: technicalError(error),
      });
    } finally {
      service.onModuleDestroy();
      console.log = originalLog;
      await writeJsonPrivate(artifactPath, {
        experiment: 'E1 SMTP diagnostic',
        phase,
        reconnect: 1,
        implementation: 'MailService.sendMfaOtp',
        started_at_utc: startedAt,
        ended_at_utc: new Date().toISOString(),
        transport: {
          host: env.SMTP_HOST,
          port: Number(env.SMTP_PORT),
          secure: false,
          require_tls: true,
          pool: true,
          max_connections: 1,
          rate_limit: 1,
          rate_delta_ms: 500,
        },
        attempts,
        mail_diagnostics: mailDiagnostics,
      });
    }
    originalLog(`SMTP_DIAGNOSTIC_ARTIFACT=${artifactPath}`);
    originalLog(
      `SMTP_DIAGNOSTIC_RESULT=${(attempts[0] as { outcome: string }).outcome}`,
    );
    if ((attempts[0] as { outcome: string }).outcome === 'error') {
      process.exitCode = 1;
    }
    return;
  }

  await writeFile(resolve(root, `${phase}.started`), timestamp, { flag: 'wx' });

  const smtpTrace: unknown[] = [];
  const log =
    (level: LoggerLevel) =>
    (data: unknown, message?: unknown, ...args: unknown[]) => {
      smtpTrace.push({
        timestamp_utc: new Date().toISOString(),
        level,
        message: sanitizeText(format(message, ...args)),
        data: sanitizeValue(data),
      });
    };
  const logger: Logger = {
    level: () => undefined,
    trace: log('trace'),
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    fatal: log('fatal'),
  };

  const maxMessages = phase === 'long-session' ? 100 : 1;
  const transport = createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT),
    secure: false,
    requireTLS: true,
    pool: true,
    maxConnections: 1,
    maxMessages,
    rateDelta: 500,
    rateLimit: 1,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    tls: { rejectUnauthorized: true },
    transactionLog: true,
    debug: false,
    logger,
    component: `e1-smtp-smoke-${phase}`,
  });
  const template = Handlebars.compile(await readFile(TEMPLATE_PATH, 'utf8'));
  const attempts: unknown[] = [];
  const startedAt = new Date().toISOString();
  for (const [index, account] of accounts.entries()) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    redactions.add(code);
    const attemptStartedAt = new Date().toISOString();
    try {
      const info = await transport.sendMail({
        from: `Zielony Koszyk <${env.SMTP_FROM_EMAIL}>`,
        to: account.email,
        subject: 'Kod logowania do Zielonego Koszyka',
        html: template({ code }),
      });
      attempts.push({
        sequence: previousAttempts + index + 1,
        client_slot: account.client_slot,
        timestamp_utc: attemptStartedAt,
        completed_at_utc: new Date().toISOString(),
        outcome: 'accepted',
        response: sanitizeText(info.response),
        accepted_count: info.accepted.length,
        rejected_count: info.rejected.length,
      });
    } catch (error) {
      attempts.push({
        sequence: previousAttempts + index + 1,
        client_slot: account.client_slot,
        timestamp_utc: attemptStartedAt,
        completed_at_utc: new Date().toISOString(),
        outcome: 'error',
        error: technicalError(error),
      });
      break;
    } finally {
      await writeJsonPrivate(artifactPath, {
        experiment: 'E1 SMTP smoke',
        phase,
        started_at_utc: startedAt,
        updated_at_utc: new Date().toISOString(),
        transport: {
          host: env.SMTP_HOST,
          port: Number(env.SMTP_PORT),
          secure: false,
          require_tls: true,
          pool: true,
          max_connections: 1,
          max_messages: maxMessages,
          rate_limit: 1,
          rate_delta_ms: 500,
          transaction_log: true,
        },
        attempts,
        smtp_trace: smtpTrace,
      });
    }
    if (index + 1 < accounts.length) await delay(500);
  }
  transport.close();
  await delay(100);
  await writeJsonPrivate(artifactPath, {
    experiment: 'E1 SMTP smoke',
    phase,
    started_at_utc: startedAt,
    ended_at_utc: new Date().toISOString(),
    transport: {
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT),
      secure: false,
      require_tls: true,
      pool: true,
      max_connections: 1,
      max_messages: maxMessages,
      rate_limit: 1,
      rate_delta_ms: 500,
      transaction_log: true,
    },
    attempts,
    smtp_trace: smtpTrace,
  });
  console.log(`SMTP_SMOKE_ARTIFACT=${artifactPath}`);
  console.log(
    `SMTP_SMOKE_RESULT=${attempts.filter((attempt) => (attempt as { outcome: string }).outcome === 'accepted').length}/${attempts.length}`,
  );
};

void main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
