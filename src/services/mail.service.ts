import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Mailgun from 'mailgun.js';
import { Order } from '../entities/order.entity';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { formatCurrency, formatDateTime } from '../i18n/format';
import { DEFAULT_LOCALE, Locale } from '../i18n/locale';
import { INVOICE_FILE_PREFIX, LOGIN_PATH, MAIL_SUBJECTS } from '../i18n/labels';
import { OrderItemType } from '../enums/OrderItemType';
import { renderMailTemplate } from './mail-templates';
import * as FormData from 'form-data';
import { User } from '../entities/user.entity';
import { OrderType } from '../types/OrderType';
import { createTransport, Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

// TODO: Password change email confirmation
// TODO: Email change email confirmation
// TODO: Password reset email

export const E1_MAIL_DIAGNOSTIC_PREFIX = 'E1_MAIL_DIAGNOSTIC ';

type MailDiagnostic = {
  requestId: string;
  recipientHash: string;
  messageId: string;
  serviceStartedAtMs: number;
  queuedAtMs?: number;
  smtpStartedAtMs?: number;
  redactions: string[];
};

type TransportError = {
  name: unknown;
  message: unknown;
  code: unknown;
  responseCode: unknown;
  response: unknown;
  command: unknown;
  errno: unknown;
  syscall: unknown;
  cause: TransportError | null;
};

const elapsedMs = (startedAtMs: number, endedAtMs: number) =>
  Number((endedAtMs - startedAtMs).toFixed(3));

const sanitizeText = (value: string, redactions: string[]) => {
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
  redactions: string[],
  seen = new WeakSet<object>(),
  depth = 0,
): unknown => {
  if (typeof value === 'string') return sanitizeText(value, redactions);
  if (
    value === null ||
    value === undefined ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value ?? null;
  }
  if (typeof value !== 'object') return `[${typeof value}]`;
  if (depth === 5) return '[MaxDepth]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) =>
      sanitizeValue(entry, redactions, seen, depth + 1),
    );
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      sanitizeValue(entry, redactions, seen, depth + 1),
    ]),
  );
};

const errorField = (error: unknown, key: string, redactions: string[]) =>
  error && typeof error === 'object'
    ? sanitizeValue((error as Record<string, unknown>)[key], redactions)
    : null;

const transportError = (
  error: unknown,
  redactions: string[],
  seen = new WeakSet<object>(),
): TransportError => {
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
    name: errorField(error, 'name', redactions),
    message:
      error && typeof error !== 'object'
        ? sanitizeValue(error, redactions)
        : errorField(error, 'message', redactions),
    code: errorField(error, 'code', redactions),
    responseCode: errorField(error, 'responseCode', redactions),
    response: errorField(error, 'response', redactions),
    command: errorField(error, 'command', redactions),
    errno: errorField(error, 'errno', redactions),
    syscall: errorField(error, 'syscall', redactions),
    cause: cause === undefined ? null : transportError(cause, redactions, seen),
  };
};

@Injectable()
export class MailService implements OnModuleDestroy {
  private mg: ReturnType<InstanceType<typeof Mailgun>['client']>;
  private smtp: Transporter<
    SMTPTransport.SentMessageInfo,
    SMTPTransport.Options
  >;
  private readonly mailDiagnosticsEnabled: boolean;

  constructor(private readonly configService: ConfigService) {
    this.mailDiagnosticsEnabled =
      this.configService.get<string>('E1_MAIL_DIAGNOSTICS') === 'true';
    const apiKey = this.configService.get<string>('MAILGUN_API_KEY');
    const host = this.configService.get<string>('MAILGUN_HOST');
    const mailgun = new Mailgun(FormData);
    this.mg = mailgun.client({
      username: 'api',
      key: apiKey,
      url: host,
    });
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const smtpPassword = this.configService.get<string>('SMTP_PASSWORD');
    const secure = this.configService.get<string>('SMTP_SECURE') === 'true';
    this.smtp = createTransport({
      host: this.configService.get<string>('SMTP_HOST'),
      port: Number(this.configService.get<string>('SMTP_PORT') ?? 587),
      secure,
      requireTLS: Boolean(smtpUser && smtpPassword && !secure),
      ...(smtpUser && smtpPassword
        ? { auth: { user: smtpUser, pass: smtpPassword } }
        : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      tls: { rejectUnauthorized: true },
    });
  }

  async sendMfaOtp(
    email: string,
    code: string,
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<void> {
    const diagnostic = this.beginMailDiagnostic(email, code);
    const html = renderMailTemplate('mfa-otp', locale, { code });

    if (diagnostic) {
      this.queueMailDiagnostic(diagnostic);
      this.startMailDiagnostic(diagnostic);
    }
    try {
      const info = await this.smtp.sendMail({
        from: `Zielony Koszyk <${this.configService.get<string>('SMTP_FROM_EMAIL')}>`,
        to: email,
        subject: MAIL_SUBJECTS[locale].mfaOtp,
        html,
        ...(diagnostic ? { messageId: `<${diagnostic.messageId}>` } : {}),
      });
      if (diagnostic) {
        const endedAtMs = performance.now();
        this.emitMailDiagnostic({
          request_id: diagnostic.requestId,
          recipient_hash: diagnostic.recipientHash,
          status: 'smtp_accepted',
          timestamp_utc: new Date().toISOString(),
          queue_wait_ms:
            diagnostic.queuedAtMs === undefined ||
            diagnostic.smtpStartedAtMs === undefined
              ? null
              : elapsedMs(diagnostic.queuedAtMs, diagnostic.smtpStartedAtMs),
          smtp_send_ms:
            diagnostic.smtpStartedAtMs === undefined
              ? null
              : elapsedMs(diagnostic.smtpStartedAtMs, endedAtMs),
          total_mail_service_ms: elapsedMs(
            diagnostic.serviceStartedAtMs,
            endedAtMs,
          ),
          response: sanitizeValue(info.response, diagnostic.redactions),
        });
      }
    } catch (error) {
      if (diagnostic) {
        const endedAtMs = performance.now();
        this.emitMailDiagnostic({
          request_id: diagnostic.requestId,
          recipient_hash: diagnostic.recipientHash,
          status: 'smtp_failed',
          timestamp_utc: new Date().toISOString(),
          queue_wait_ms:
            diagnostic.queuedAtMs === undefined ||
            diagnostic.smtpStartedAtMs === undefined
              ? null
              : elapsedMs(diagnostic.queuedAtMs, diagnostic.smtpStartedAtMs),
          smtp_send_ms:
            diagnostic.smtpStartedAtMs === undefined
              ? null
              : elapsedMs(diagnostic.smtpStartedAtMs, endedAtMs),
          total_mail_service_ms: elapsedMs(
            diagnostic.serviceStartedAtMs,
            endedAtMs,
          ),
          elapsed_time_ms: elapsedMs(diagnostic.serviceStartedAtMs, endedAtMs),
          failure_phase:
            diagnostic.smtpStartedAtMs === undefined ? 'queue' : 'smtp',
          error: transportError(error, diagnostic.redactions),
        });
      }
      throw error;
    }
  }

  onModuleDestroy() {
    this.smtp.close();
  }

  private beginMailDiagnostic(
    email: string,
    code: string,
  ): MailDiagnostic | undefined {
    if (!this.mailDiagnosticsEnabled) return undefined;
    const requestId = randomUUID();
    const smtpUser = this.configService.get<string>('SMTP_USER') ?? '';
    const smtpPassword = this.configService.get<string>('SMTP_PASSWORD') ?? '';
    const smtpFrom = this.configService.get<string>('SMTP_FROM_EMAIL') ?? '';
    const messageIdDomain = smtpFrom.split('@').at(-1) || 'localhost';
    return {
      requestId,
      recipientHash: createHash('sha256')
        .update(email.toLowerCase())
        .digest('hex'),
      messageId: `e1-${requestId}@${messageIdDomain}`,
      serviceStartedAtMs: performance.now(),
      redactions: [
        email,
        code,
        smtpUser,
        smtpPassword,
        smtpFrom,
        Buffer.from(smtpUser).toString('base64'),
        Buffer.from(smtpPassword).toString('base64'),
        Buffer.from(`\u0000${smtpUser}\u0000${smtpPassword}`).toString(
          'base64',
        ),
      ],
    };
  }

  private queueMailDiagnostic(diagnostic: MailDiagnostic) {
    diagnostic.queuedAtMs = performance.now();
    this.emitMailDiagnostic({
      request_id: diagnostic.requestId,
      recipient_hash: diagnostic.recipientHash,
      status: 'queued',
      timestamp_utc: new Date().toISOString(),
    });
  }

  private startMailDiagnostic(diagnostic: MailDiagnostic) {
    diagnostic.smtpStartedAtMs = performance.now();
    this.emitMailDiagnostic({
      request_id: diagnostic.requestId,
      recipient_hash: diagnostic.recipientHash,
      status: 'smtp_started',
      timestamp_utc: new Date().toISOString(),
      queue_wait_ms:
        diagnostic.queuedAtMs === undefined
          ? null
          : elapsedMs(diagnostic.queuedAtMs, diagnostic.smtpStartedAtMs),
    });
  }

  private emitMailDiagnostic(event: Record<string, unknown>) {
    console.log(`${E1_MAIL_DIAGNOSTIC_PREFIX}${JSON.stringify(event)}`);
  }

  async sendOrderConfirmation(
    order: Order,
    pdfBuffer: Buffer<ArrayBufferLike>,
  ): Promise<void> {
    const domain = this.configService.get<string>('MAILGUN_DOMAIN');
    const fromEmail = this.configService.get<string>('MAILGUN_FROM_EMAIL');

    const { locale } = order;

    const customer_name =
      order.order_type === OrderType.COMPANY
        ? order.billingAddress.company_name
        : order.billingAddress.first_name +
          ' ' +
          order.billingAddress.last_name;

    const preparedItems = order.orderItems.map((item) => ({
      product_name: item.product_name,
      quantity: item.quantity,
      price: formatCurrency(item.price, locale),
      isDelivery: item.item_type === OrderItemType.DELIVERY,
    }));

    // Generate the email content in the language the order was placed in
    const html = renderMailTemplate('order-confirmation', locale, {
      customer_name,
      order_id: order.order_id,
      order_date: formatDateTime(order.order_date, locale),
      total_amount: formatCurrency(order.total_amount, locale),
      orderItems: preparedItems,
    });

    const attachment = {
      data: pdfBuffer,
      filename: `${INVOICE_FILE_PREFIX[locale]}_${order.order_id}.pdf`,
      contentType: 'application/pdf',
    };

    const data = {
      from: `Zielony Koszyk <${fromEmail}>`,
      to: order.customer_email,
      subject: MAIL_SUBJECTS[locale].orderConfirmation,
      html, // Use the generated HTML
      attachment: [attachment],
    };

    try {
      await this.mg.messages.create(domain, data);
    } catch (error) {
      console.error('Unable to send order confirmation', error);
    }
  }

  async sendEmailWithPassword(
    user: User,
    password: string,
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<void> {
    const domain = this.configService.get<string>('MAILGUN_DOMAIN');
    const fromEmail = this.configService.get<string>('MAILGUN_FROM_EMAIL');

    const html = renderMailTemplate('welcome-email-created-user', locale, {
      customer_name: `${user.first_name} ${user.last_name}`,
      email: user.email,
      password: password,
      login_url: `http://localhost:3000/${locale}/${LOGIN_PATH[locale]}`,
      contact_email: 'amokrzycki96@gmail.com',
    });

    const data = {
      from: `Zielony Koszyk <${fromEmail}>`,
      to: user.email,
      subject: MAIL_SUBJECTS[locale].welcome,
      html,
    };

    try {
      await this.mg.messages.create(domain, data);
    } catch (error) {
      console.error('Unable to send account welcome email', error);
    }
  }
}
