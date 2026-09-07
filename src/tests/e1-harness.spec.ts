import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MfaMethod } from '../enums/MfaMethod';
import { buildAccounts } from '../../research/dataset';
import {
  E1_VARIANTS,
  MEASURED_SCHEDULE,
  SOURCE_IP_MAPPING_ID,
  assertNoSecrets,
  buildMailDiagnosticRequests,
  buildClientMapping,
  createExclusiveDirectory,
  parseMailDiagnosticEvents,
  parseJtl,
  summarizeMailpitPilot,
} from '../../research/e1/protocol';

describe('E1 harness', () => {
  it('uses the exact 12-round balanced Williams schedule', () => {
    expect(MEASURED_SCHEDULE).toHaveLength(12);
    for (const round of MEASURED_SCHEDULE) {
      expect(round).toHaveLength(4);
      expect(new Set(round)).toEqual(new Set(E1_VARIANTS));
    }
    for (const variant of E1_VARIANTS) {
      expect(
        MEASURED_SCHEDULE.flat().filter((value) => value === variant),
      ).toHaveLength(12);
    }
  });

  it.each(E1_VARIANTS)(
    'maps 50 unique %s accounts, slots and source IPs',
    (variant) => {
      const mapping = buildClientMapping(
        buildAccounts('example.test'),
        variant,
      );
      expect(mapping).toHaveLength(50);
      expect(new Set(mapping.map(({ client_slot }) => client_slot)).size).toBe(
        50,
      );
      expect(new Set(mapping.map(({ email }) => email)).size).toBe(50);
      expect(new Set(mapping.map(({ source_ip }) => source_ip)).size).toBe(50);
      expect(mapping[0].source_ip).toBe('127.0.0.2');
      expect(mapping[49].source_ip).toBe('127.0.0.51');
      expect(SOURCE_IP_MAPPING_ID).toContain('127.0.0.2-127.0.0.51');
    },
  );

  it('rejects incomplete variant account mapping', () => {
    expect(() =>
      buildClientMapping(
        buildAccounts('example.test').filter(
          ({ variant, client_slot }) =>
            variant !== MfaMethod.TOTP || client_slot !== '050',
        ),
        MfaMethod.TOTP,
      ),
    ).toThrow('Invalid TOTP client mapping');
  });

  it('parses required JTL fields without using latency as elapsed', () => {
    const [sample] = parseJtl(
      'timeStamp,elapsed,label,responseCode,success,threadName,Connect,Latency\n' +
        '1000,42,"NONE:001",201,true,"E1 NONE 1-1",3,7\n',
    );
    expect(sample.elapsed).toBe(42);
    expect(sample.Latency).toBe(7);
    expect(sample.success).toBe(true);
  });

  it('configures JTL without response, request or header data', async () => {
    const [properties, jmx] = await Promise.all([
      readFile(
        resolve(__dirname, '../../research/e1/jmeter/e1.properties'),
        'utf8',
      ),
      readFile(
        resolve(__dirname, '../../research/e1/jmeter/e1-login.jmx'),
        'utf8',
      ),
    ]);
    for (const property of [
      'response_data=false',
      'response_data.on_error=false',
      'samplerData=false',
      'responseHeaders=false',
      'requestHeaders=false',
    ]) {
      expect(properties).toContain(property);
    }
    expect(properties).toContain('httpclient4.retrycount=0');
    expect(jmx).toContain("System.getenv('MFA_RESEARCH_PASSWORD')");
    expect(jmx).toContain('groovy.json.JsonOutput.toJson');
    expect(jmx).not.toContain('__P(password');
    expect(jmx).not.toContain('-Jpassword');
  });

  it('detects plaintext secrets and JWTs in public artifacts', () => {
    expect(() =>
      assertNoSecrets(['safe output'], ['research-password']),
    ).not.toThrow();
    expect(() =>
      assertNoSecrets(['contains research-password'], ['research-password']),
    ).toThrow('secret material');
    expect(() =>
      assertNoSecrets(['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature'], []),
    ).toThrow('JWT material');
  });

  it('maps mail stages and SMTP errors to all 50 client requests', () => {
    const mapping = buildClientMapping(
      buildAccounts('example.test'),
      MfaMethod.EMAIL_OTP,
    );
    const recipientHash = createHash('sha256')
      .update(mapping[0].email)
      .digest('hex');
    const prefix = 'E1_MAIL_DIAGNOSTIC ';
    const events = parseMailDiagnosticEvents(
      [
        `${prefix}${JSON.stringify({ request_id: 'request-1', recipient_hash: recipientHash, status: 'queued', timestamp_utc: '2026-09-07T00:00:00Z' })}`,
        `${prefix}${JSON.stringify({ request_id: 'request-1', recipient_hash: recipientHash, status: 'smtp_started', timestamp_utc: '2026-09-07T00:00:01Z', queue_wait_ms: 1000 })}`,
        `${prefix}${JSON.stringify({ request_id: 'request-1', recipient_hash: recipientHash, status: 'smtp_failed', timestamp_utc: '2026-09-07T00:00:02Z', queue_wait_ms: 1000, smtp_send_ms: 1000, total_mail_service_ms: 2000, elapsed_time_ms: 2000, failure_phase: 'smtp', error: { responseCode: 421, response: '421 rejected' } })}`,
      ].join('\n'),
      prefix,
    );
    const requests = buildMailDiagnosticRequests(
      mapping,
      [
        {
          timeStamp: 1,
          elapsed: 2001,
          label: 'EMAIL_OTP:001',
          responseCode: '503',
          success: false,
          threadName: 'thread',
          connect: 1,
          Latency: 2001,
        },
      ],
      events,
    );

    expect(requests).toHaveLength(50);
    expect(requests[0]).toMatchObject({
      client_slot: '001',
      http_response_code: '503',
      status: 'smtp_failed',
      queue_wait_ms: 1000,
      smtp_send_ms: 1000,
      total_mail_service_ms: 2000,
      failure_phase: 'smtp',
      error: { responseCode: 421, response: '421 rejected' },
    });
    expect(requests[1]).toMatchObject({
      client_slot: '002',
      request_id: null,
      status: null,
    });
  });

  it('validates 50 Mailpit SMTP acceptances without exposing recipients', () => {
    const recipients = Array.from(
      { length: 50 },
      (_, index) => `bench-email-${index + 1}@example.test`,
    );
    const summary = summarizeMailpitPilot(
      {
        Version: '1.31.1',
        Messages: 50,
        RuntimeStats: { SMTPAccepted: 50, SMTPRejected: 0 },
      },
      {
        total: 50,
        messages_count: 50,
        messages: recipients.map((Address, index) => ({
          MessageID: `e1-${index}@example.test`,
          Created: `2026-09-07T12:00:${String(index).padStart(2, '0')}Z`,
          To: [{ Address }],
        })),
      },
      recipients,
    );

    expect(summary).toMatchObject({
      validation: 'PASSED',
      message_count: 50,
      recipient_count: 50,
      unique_recipient_count: 50,
      smtp_accepted_count: 50,
      smtp_rejected_count: 0,
      e1_message_id_count: 50,
    });
    expect(JSON.stringify(summary)).not.toContain('bench-email');
    expect(
      summarizeMailpitPilot(
        {
          Version: '1.31.1',
          Messages: 49,
          RuntimeStats: { SMTPAccepted: 49, SMTPRejected: 1 },
        },
        { total: 49, messages_count: 49, messages: [] },
        recipients,
      ).validation,
    ).toBe('FAILED');
  });

  it('never overwrites an existing run directory or its raw files', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'e1-harness-'));
    const run = join(parent, 'round-01');
    try {
      await createExclusiveDirectory(run);
      const raw = join(run, 'jmeter.jtl');
      await writeFile(raw, 'partial raw data');
      await expect(createExclusiveDirectory(run)).rejects.toMatchObject({
        code: 'EEXIST',
      });
      expect(await readFile(raw, 'utf8')).toBe('partial raw data');
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
