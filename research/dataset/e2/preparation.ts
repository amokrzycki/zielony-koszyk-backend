import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import {
  CLIENTS,
  HTTP_CONNECT_TIMEOUT_MS,
  HTTP_RESPONSE_TIMEOUT_MS,
  HarnessError,
  MAILPIT_IMAGE,
  MAILPIT_MAX_MESSAGES,
  MAILPIT_VERSION,
} from './protocol';

export type HttpResult = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

export class NoRetryHttpClient {
  private httpAgent = new HttpAgent({ keepAlive: true });
  private httpsAgent = new HttpsAgent({ keepAlive: true });

  request(input: {
    url: string;
    method: 'GET' | 'POST' | 'DELETE';
    body?: string;
    headers?: Record<string, string>;
    localAddress?: string;
  }) {
    return new Promise<HttpResult>((resolve, reject) => {
      const url = new URL(input.url);
      if (!['http:', 'https:'].includes(url.protocol)) {
        reject(new HarnessError('HTTP_PROTOCOL'));
        return;
      }
      const body =
        input.body === undefined ? undefined : Buffer.from(input.body);
      let responseTimer: NodeJS.Timeout | undefined;
      const startResponseTimer = (request: ReturnType<typeof httpRequest>) => {
        responseTimer ??= setTimeout(
          () => request.destroy(new HarnessError('HTTP_RESPONSE_TIMEOUT')),
          HTTP_RESPONSE_TIMEOUT_MS,
        );
      };
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: input.method,
          localAddress: input.localAddress,
          agent: url.protocol === 'https:' ? this.httpsAgent : this.httpAgent,
          headers: {
            connection: 'keep-alive',
            ...(body ? { 'content-length': String(body.length) } : {}),
            ...input.headers,
          },
        },
        (response) => {
          clearTimeout(connectTimer);
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 2 * 1024 * 1024) {
              request.destroy(new HarnessError('HTTP_BODY_LIMIT'));
              return;
            }
            chunks.push(chunk);
          });
          response.once('end', () => {
            clearTimeout(responseTimer);
            const headers: Record<string, string | string[] | undefined> = {
              ...response.headers,
            };
            resolve({
              statusCode: response.statusCode ?? 0,
              headers,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        },
      );
      const connectTimer = setTimeout(
        () => request.destroy(new HarnessError('HTTP_CONNECT_TIMEOUT')),
        HTTP_CONNECT_TIMEOUT_MS,
      );
      request.once('socket', (socket) => {
        const connected = () => {
          clearTimeout(connectTimer);
          startResponseTimer(request);
        };
        if (socket.connecting) {
          socket.once(
            url.protocol === 'https:' ? 'secureConnect' : 'connect',
            connected,
          );
        } else connected();
      });
      request.once('error', (error) => {
        clearTimeout(connectTimer);
        clearTimeout(responseTimer);
        reject(
          error instanceof HarnessError
            ? error
            : new HarnessError('HTTP_TRANSPORT'),
        );
      });
      request.end(body);
    });
  }

  close() {
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
  }
}

type MailpitSummary = {
  total: number;
  count?: number;
  messages_count?: number;
  messages: Array<{
    ID: string;
    To: Array<{ Address: string }>;
    Subject: string;
  }>;
};

type MailpitMessage = {
  ID: string;
  To: Array<{ Address: string }>;
  Subject: string;
  HTML: string;
};

const json = <T>(response: HttpResult): T => {
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new HarnessError('MAILPIT_HTTP_STATUS');
  }
  try {
    return JSON.parse(response.body) as T;
  } catch {
    throw new HarnessError('MAILPIT_JSON');
  }
};

export class MailpitClient {
  constructor(
    private readonly baseUrl: string,
    private readonly http: NoRetryHttpClient,
  ) {}

  private get<T>(path: string) {
    return this.http
      .request({ url: `${this.baseUrl}${path}`, method: 'GET' })
      .then(json<T>);
  }

  async assertVersion() {
    const info = await this.get<{ Version?: string }>('/api/v1/info');
    if (info.Version?.replace(/^v/, '') !== MAILPIT_VERSION) {
      throw new HarnessError('MAILPIT_VERSION');
    }
  }

  async assertOpenApi() {
    const specification = await this.get<{
      paths?: Record<string, Record<string, unknown>>;
    }>('/api/v1/swagger.json');
    if (
      !specification.paths?.['/api/v1/messages']?.get ||
      !specification.paths['/api/v1/messages'].delete ||
      !specification.paths?.['/api/v1/message/{ID}']?.get
    ) {
      throw new HarnessError('MAILPIT_OPENAPI_CONTRACT');
    }
  }

  async list() {
    return this.get<MailpitSummary>('/api/v1/messages?start=0&limit=50');
  }

  async count() {
    const mailbox = await this.list();
    return mailbox.total;
  }

  async purge() {
    const response = await this.http.request({
      url: `${this.baseUrl}/api/v1/messages`,
      method: 'DELETE',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new HarnessError('MAILPIT_PURGE');
    }
    if ((await this.count()) !== 0) throw new HarnessError('MAILPIT_NOT_EMPTY');
  }

  async waitForCodes(
    clients: Array<{ client_slot: string; email: string }>,
    timeoutMs = 30_000,
    registerSensitive: (value: string) => void = () => undefined,
  ) {
    if (clients.length !== CLIENTS)
      throw new HarnessError('MAILPIT_CLIENT_COUNT');
    const deadline = Date.now() + timeoutMs;
    let mailbox = await this.list();
    while (mailbox.total < CLIENTS && Date.now() < deadline) {
      await delay(100);
      mailbox = await this.list();
    }
    const listedCount = mailbox.count ?? mailbox.messages_count;
    if (
      mailbox.total !== CLIENTS ||
      listedCount !== CLIENTS ||
      mailbox.messages.length !== CLIENTS
    ) {
      throw new HarnessError('MAILPIT_MESSAGE_COUNT');
    }
    const clientsByEmail = new Map(
      clients.map((client) => [client.email.toLowerCase(), client.client_slot]),
    );
    const slots = new Set<string>();
    const identifiers = new Set<string>();
    const codes = new Map<string, string>();
    for (const summary of mailbox.messages) {
      if (!summary.ID || identifiers.has(summary.ID)) {
        throw new HarnessError('MAILPIT_MESSAGE_DUPLICATE');
      }
      registerSensitive(summary.ID);
      identifiers.add(summary.ID);
      const message = await this.get<MailpitMessage>(
        `/api/v1/message/${encodeURIComponent(summary.ID)}`,
      );
      registerSensitive(JSON.stringify(message));
      const recipient =
        message.To?.length === 1 ? message.To[0].Address.toLowerCase() : '';
      const slot = clientsByEmail.get(recipient);
      if (!slot || slots.has(slot)) throw new HarnessError('MAILPIT_RECIPIENT');
      if (message.Subject !== 'Kod logowania do Zielonego Koszyka') {
        throw new HarnessError('MAILPIT_SUBJECT');
      }
      const located = [
        ...message.HTML.matchAll(/<p><strong>(\d{6})<\/strong><\/p>/g),
      ];
      const allCodes = message.HTML.match(/\b\d{6}\b/g) ?? [];
      if (located.length !== 1 || allCodes.length !== 1) {
        throw new HarnessError('MAILPIT_OTP_FORMAT');
      }
      slots.add(slot);
      codes.set(slot, located[0][1]);
    }
    if (codes.size !== CLIENTS) throw new HarnessError('MAILPIT_CODE_COUNT');
    return codes;
  }
}

export type DockerInspect = {
  Config?: { Image?: string; Env?: string[] };
  HostConfig?: {
    AutoRemove?: boolean;
    Binds?: string[] | null;
    LogConfig?: { Type?: string };
    Tmpfs?: Record<string, string> | null;
  };
  Mounts?: Array<{ Type?: string; Destination?: string; RW?: boolean }>;
};

export const assertMailpitContainerInspect = (inspect: DockerInspect) => {
  const environment = new Set(inspect.Config?.Env ?? []);
  const mounts = inspect.Mounts ?? [];
  const tmpfs = inspect.HostConfig?.Tmpfs ?? {};
  if (
    inspect.Config?.Image !== MAILPIT_IMAGE ||
    inspect.HostConfig?.AutoRemove !== true ||
    (inspect.HostConfig.Binds?.length ?? 0) !== 0 ||
    inspect.HostConfig?.LogConfig?.Type !== 'none' ||
    mounts.length !== 0 ||
    Object.keys(tmpfs).length !== 1 ||
    typeof tmpfs['/mailpit-data'] !== 'string' ||
    !environment.has('MP_DATABASE=/mailpit-data/mailpit.db') ||
    !environment.has(`MP_MAX_MESSAGES=${MAILPIT_MAX_MESSAGES}`) ||
    !environment.has('MP_UI_BIND_ADDR=127.0.0.1:8025') ||
    !environment.has('MP_SMTP_BIND_ADDR=127.0.0.1:1025')
  ) {
    throw new HarnessError('MAILPIT_RAM_ONLY_MOUNT');
  }
};
