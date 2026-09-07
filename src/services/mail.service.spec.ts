import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { E1_MAIL_DIAGNOSTIC_PREFIX, MailService } from './mail.service';

const mockSendMail = jest.fn();
const mockClose = jest.fn();

jest.mock('mailgun.js', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ client: jest.fn() })),
}));
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: mockSendMail,
    close: mockClose,
  })),
}));
jest.mock('node:fs', () => ({
  readFileSync: jest.fn(() => '<p>{{code}}</p>'),
}));

describe('MailService', () => {
  const config = (
    diagnostics = false,
    overrides: Record<string, string | undefined> = {},
  ) => {
    const values: Record<string, string | undefined> = {
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_USER: 'user',
      SMTP_PASSWORD: 'password',
      SMTP_FROM_EMAIL: 'sender@example.com',
      E1_MAIL_DIAGNOSTICS: String(diagnostics),
      ...overrides,
    };
    return {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;
  };

  const events = (log: jest.SpyInstance) =>
    log.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.startsWith(E1_MAIL_DIAGNOSTIC_PREFIX))
      .map(
        (line) =>
          JSON.parse(line.slice(E1_MAIL_DIAGNOSTIC_PREFIX.length)) as Record<
            string,
            unknown
          >,
      );

  const transportOptions = () =>
    (
      createTransport as unknown as {
        mock: { calls: Array<[SMTPTransport.Options]> };
      }
    ).mock.calls.at(-1)?.[0];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('configures authenticated SMTP without pooling or pacing', () => {
    new MailService(config());

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: { user: 'user', pass: 'password' },
        requireTLS: true,
      }),
    );
    const options = transportOptions();
    expect(options).not.toHaveProperty('pool');
    expect(options).not.toHaveProperty('rateLimit');
  });

  it('omits auth for unauthenticated Mailpit SMTP', () => {
    new MailService(
      config(false, {
        SMTP_HOST: 'mailpit',
        SMTP_PORT: '1025',
        SMTP_USER: undefined,
        SMTP_PASSWORD: undefined,
      }),
    );

    const options = transportOptions();
    expect(options).toMatchObject({
      host: 'mailpit',
      port: 1025,
      secure: false,
      requireTLS: false,
    });
    expect(options).not.toHaveProperty('auth');
  });

  it('logs every transport error field and rethrows the original error', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation();
    const service = new MailService(config(true));
    const cause = Object.assign(new Error('socket user@example.com'), {
      code: 'ECONNRESET',
      errno: 'ECONNRESET',
      syscall: 'read',
    });
    const smtpError = Object.assign(
      new Error('Message failed: 421 user@example.com OTP 123456'),
      {
        code: 'EMESSAGE',
        responseCode: 421,
        response: '421 4.7.0 user@example.com rejected 123456',
        command: 'DATA',
        errno: 'ETIMEDOUT',
        syscall: 'write',
        cause,
      },
    );
    mockSendMail.mockRejectedValueOnce(smtpError);

    await expect(service.sendMfaOtp('user@example.com', '123456')).rejects.toBe(
      smtpError,
    );

    const recorded = events(log);
    expect(recorded.map(({ status }) => status)).toEqual([
      'queued',
      'smtp_started',
      'smtp_failed',
    ]);
    expect(typeof recorded[2].queue_wait_ms).toBe('number');
    expect(typeof recorded[2].smtp_send_ms).toBe('number');
    expect(typeof recorded[2].total_mail_service_ms).toBe('number');
    expect(typeof recorded[2].elapsed_time_ms).toBe('number');
    expect(recorded[2]).toMatchObject({
      failure_phase: 'smtp',
      error: {
        name: 'Error',
        code: 'EMESSAGE',
        responseCode: 421,
        command: 'DATA',
        errno: 'ETIMEDOUT',
        syscall: 'write',
        cause: {
          name: 'Error',
          code: 'ECONNRESET',
          errno: 'ECONNRESET',
          syscall: 'read',
        },
      },
    });
    expect(JSON.stringify(recorded)).not.toMatch(
      /user@example\.com|123456|password/,
    );
  });

  it('waits for SMTP acceptance and records its timing stages', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation();
    const service = new MailService(config(true));
    let accept!: (value: { response: string }) => void;
    mockSendMail.mockReturnValueOnce(
      new Promise((resolve) => {
        accept = resolve;
      }),
    );

    const sending = service.sendMfaOtp('user@example.com', '123456');
    expect(
      await Promise.race([
        sending.then(() => 'settled'),
        Promise.resolve('pending'),
      ]),
    ).toBe('pending');
    accept({ response: '250 Great success' });
    await sending;

    const recorded = events(log);
    expect(recorded.map(({ status }) => status)).toEqual([
      'queued',
      'smtp_started',
      'smtp_accepted',
    ]);
    expect(typeof recorded[2].queue_wait_ms).toBe('number');
    expect(typeof recorded[2].smtp_send_ms).toBe('number');
    expect(typeof recorded[2].total_mail_service_ms).toBe('number');
    expect(recorded[2]).toMatchObject({
      response: '250 Great success',
    });
  });
});
