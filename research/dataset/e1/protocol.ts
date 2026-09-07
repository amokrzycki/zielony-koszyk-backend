import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { MfaMethod } from '../../src/enums/MfaMethod';
import { ResearchAccount } from '../dataset';

export const E1_VARIANTS = [
  MfaMethod.NONE,
  MfaMethod.EMAIL_OTP,
  MfaMethod.TOTP,
  MfaMethod.WEBAUTHN,
] as const;

export type E1Variant = (typeof E1_VARIANTS)[number];

export const THREADS = 50;
export const INTER_VARIANT_IDLE_SECONDS = 10;
export const LIMITER_RESET_SECONDS = 65;
export const MEMORY_SAMPLE_INTERVAL_MS = 20;
export const SOURCE_IP_MAPPING_ID = 'loopback-127.0.0.2-127.0.0.51-v1';

export const WILLIAMS_BLOCK: readonly (readonly E1Variant[])[] = [
  [MfaMethod.NONE, MfaMethod.EMAIL_OTP, MfaMethod.WEBAUTHN, MfaMethod.TOTP],
  [MfaMethod.EMAIL_OTP, MfaMethod.TOTP, MfaMethod.NONE, MfaMethod.WEBAUTHN],
  [MfaMethod.TOTP, MfaMethod.WEBAUTHN, MfaMethod.EMAIL_OTP, MfaMethod.NONE],
  [MfaMethod.WEBAUTHN, MfaMethod.NONE, MfaMethod.TOTP, MfaMethod.EMAIL_OTP],
];

export const MEASURED_SCHEDULE: readonly (readonly E1Variant[])[] = [
  ...WILLIAMS_BLOCK,
  ...WILLIAMS_BLOCK,
  ...WILLIAMS_BLOCK,
];

export type ClientMapping = {
  client_slot: string;
  email: string;
  source_ip: string;
};

export type MailDiagnosticStatus =
  | 'queued'
  | 'smtp_started'
  | 'smtp_accepted'
  | 'smtp_failed';

export type MailDiagnosticEvent = {
  request_id: string;
  recipient_hash: string;
  status: MailDiagnosticStatus;
  timestamp_utc: string;
  queue_wait_ms?: unknown;
  smtp_send_ms?: unknown;
  total_mail_service_ms?: unknown;
  elapsed_time_ms?: unknown;
  failure_phase?: unknown;
  error?: unknown;
  response?: unknown;
};

export type MailpitInfo = {
  Version: string;
  Messages: number;
  RuntimeStats: {
    SMTPAccepted: number;
    SMTPRejected: number;
  };
};

export type MailpitMailbox = {
  total: number;
  messages_count: number;
  messages: Array<{
    MessageID: string;
    Created: string;
    To: Array<{ Address: string }>;
  }>;
};

export const summarizeMailpitPilot = (
  info: MailpitInfo,
  mailbox: MailpitMailbox,
  expectedRecipients: string[],
) => {
  const recipients = mailbox.messages.flatMap(({ To }) =>
    To.map(({ Address }) => Address.toLowerCase()),
  );
  const expected = [...expectedRecipients].map((email) => email.toLowerCase());
  const failures: string[] = [];
  if (
    info.Messages !== expected.length ||
    mailbox.total !== expected.length ||
    mailbox.messages_count !== expected.length ||
    mailbox.messages.length !== expected.length
  ) {
    failures.push('message count mismatch');
  }
  if (
    recipients.length !== expected.length ||
    new Set(recipients).size !== expected.length ||
    [...recipients].sort().join('\n') !== expected.sort().join('\n')
  ) {
    failures.push('recipient set mismatch');
  }
  if (
    info.RuntimeStats.SMTPAccepted !== expected.length ||
    info.RuntimeStats.SMTPRejected !== 0
  ) {
    failures.push('SMTP acceptance count mismatch');
  }
  if (mailbox.messages.some(({ MessageID }) => !MessageID.startsWith('e1-'))) {
    failures.push('unexpected Message-ID');
  }
  const timestamps = mailbox.messages
    .map(({ Created }) => Created)
    .filter(Boolean)
    .sort();
  return {
    validation: failures.length ? 'FAILED' : 'PASSED',
    failures,
    message_count: info.Messages,
    listed_message_count: mailbox.messages.length,
    recipient_count: recipients.length,
    unique_recipient_count: new Set(recipients).size,
    smtp_accepted_count: info.RuntimeStats.SMTPAccepted,
    smtp_rejected_count: info.RuntimeStats.SMTPRejected,
    e1_message_id_count: mailbox.messages.filter(({ MessageID }) =>
      MessageID.startsWith('e1-'),
    ).length,
    first_received_at_utc: timestamps.at(0) ?? null,
    last_received_at_utc: timestamps.at(-1) ?? null,
  };
};

const MAIL_DIAGNOSTIC_STATUSES = new Set<MailDiagnosticStatus>([
  'queued',
  'smtp_started',
  'smtp_accepted',
  'smtp_failed',
]);

export const parseMailDiagnosticEvents = (
  logs: string,
  prefix: string,
): MailDiagnosticEvent[] =>
  logs
    .split('\n')
    .filter((line) => line.includes(prefix))
    .map((line) => {
      const event = JSON.parse(
        line.slice(line.indexOf(prefix) + prefix.length),
      ) as MailDiagnosticEvent;
      if (
        typeof event.request_id !== 'string' ||
        typeof event.recipient_hash !== 'string' ||
        typeof event.timestamp_utc !== 'string' ||
        !MAIL_DIAGNOSTIC_STATUSES.has(event.status)
      ) {
        throw new Error('Invalid E1 mail diagnostic event');
      }
      return event;
    });

export const buildMailDiagnosticRequests = (
  mapping: ClientMapping[],
  samples: JtlSample[],
  events: MailDiagnosticEvent[],
) =>
  mapping.map(({ client_slot, email }) => {
    const recipientHash = createHash('sha256')
      .update(email.toLowerCase())
      .digest('hex');
    const requestEvents = events.filter(
      ({ recipient_hash }) => recipient_hash === recipientHash,
    );
    const requestIds = [
      ...new Set(requestEvents.map(({ request_id }) => request_id)),
    ];
    if (requestIds.length > 1) {
      throw new Error(`Multiple mail diagnostics for client ${client_slot}`);
    }
    const sample = samples.find(({ label }) =>
      label.endsWith(`:${client_slot}`),
    );
    const started = requestEvents.find(
      ({ status }) => status === 'smtp_started',
    );
    const terminal = requestEvents.find(
      ({ status }) => status === 'smtp_accepted' || status === 'smtp_failed',
    );
    return {
      client_slot,
      http_response_code: sample?.responseCode ?? null,
      http_elapsed_ms: sample?.elapsed ?? null,
      request_id: requestIds[0] ?? null,
      status: terminal?.status ?? requestEvents.at(-1)?.status ?? null,
      status_history: requestEvents.map(({ status, timestamp_utc }) => ({
        status,
        timestamp_utc,
      })),
      queue_wait_ms: terminal?.queue_wait_ms ?? started?.queue_wait_ms ?? null,
      smtp_send_ms: terminal?.smtp_send_ms ?? null,
      total_mail_service_ms: terminal?.total_mail_service_ms ?? null,
      elapsed_time_ms: terminal?.elapsed_time_ms ?? null,
      failure_phase: terminal?.failure_phase ?? null,
      response: terminal?.response ?? null,
      error: terminal?.error ?? null,
    };
  });

export const buildClientMapping = (
  accounts: Pick<ResearchAccount, 'client_slot' | 'variant' | 'email'>[],
  variant: E1Variant,
): ClientMapping[] => {
  const selected = accounts
    .filter((account) => account.variant === variant)
    .sort((left, right) => left.client_slot.localeCompare(right.client_slot))
    .map(({ client_slot, email }) => ({
      client_slot,
      email,
      source_ip: `127.0.0.${Number(client_slot) + 1}`,
    }));
  if (
    selected.length !== THREADS ||
    new Set(selected.map(({ client_slot }) => client_slot)).size !== THREADS ||
    new Set(selected.map(({ email }) => email)).size !== THREADS ||
    new Set(selected.map(({ source_ip }) => source_ip)).size !== THREADS ||
    selected.some(
      ({ client_slot }, index) =>
        client_slot !== String(index + 1).padStart(3, '0'),
    )
  ) {
    throw new Error(`Invalid ${variant} client mapping`);
  }
  return selected;
};

export const clientMappingCsv = (mapping: ClientMapping[]) =>
  [
    'client_slot,email,source_ip',
    ...mapping.map(({ client_slot, email, source_ip }) =>
      [client_slot, email, source_ip].join(','),
    ),
  ].join('\n') + '\n';

export const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(value);
      value = '';
    } else if (character === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error('Unterminated CSV quote');
  if (value || row.length) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
};

export type JtlSample = {
  timeStamp: number;
  elapsed: number;
  label: string;
  responseCode: string;
  success: boolean;
  threadName: string;
  connect: number;
  Latency: number;
};

const JTL_FIELDS = [
  'timeStamp',
  'elapsed',
  'label',
  'responseCode',
  'success',
  'threadName',
  'connect',
  'Latency',
] as const;

export const parseJtl = (text: string): JtlSample[] => {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Error('JTL is empty');
  const positions = Object.fromEntries(
    JTL_FIELDS.map((field) => [field, header.indexOf(field)]),
  ) as Record<(typeof JTL_FIELDS)[number], number>;
  if (positions.connect < 0) positions.connect = header.indexOf('Connect');
  const missing = JTL_FIELDS.filter((field) => positions[field] < 0);
  if (missing.length)
    throw new Error(`JTL missing fields: ${missing.join(', ')}`);
  return rows
    .filter((row) => row.some(Boolean))
    .map((row) => {
      if (row.length !== header.length) throw new Error('Invalid JTL CSV row');
      const number = (
        field: 'timeStamp' | 'elapsed' | 'connect' | 'Latency',
      ) => {
        const parsed = Number(row[positions[field]]);
        if (!Number.isFinite(parsed)) throw new Error(`Invalid JTL ${field}`);
        return parsed;
      };
      const success = row[positions.success];
      if (success !== 'true' && success !== 'false') {
        throw new Error('Invalid JTL success');
      }
      return {
        timeStamp: number('timeStamp'),
        elapsed: number('elapsed'),
        label: row[positions.label],
        responseCode: row[positions.responseCode],
        success: success === 'true',
        threadName: row[positions.threadName],
        connect: number('connect'),
        Latency: number('Latency'),
      };
    });
};

export const createExclusiveDirectory = (path: string) => mkdir(path);

export const assertNoSecrets = (texts: string[], secrets: string[]) => {
  const content = texts.join('\n');
  if (secrets.filter(Boolean).some((secret) => content.includes(secret))) {
    throw new Error('Public E1 artifact contains secret material');
  }
  if (/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(content)) {
    throw new Error('Public E1 artifact contains JWT material');
  }
};
