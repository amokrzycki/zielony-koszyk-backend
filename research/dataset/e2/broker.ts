import {
  createServer,
  IncomingMessage,
  Server,
  ServerResponse,
} from 'node:http';
import { AddressInfo } from 'node:net';
import { CLIENTS, CLIENT_SLOTS, E2Variant, HarnessError } from './protocol';
import type { SemanticResponse } from './security';

export type RequestPackage = {
  client_slot: string;
  variant: E2Variant;
  endpoint: string;
  authorization: string;
  body: string;
  expected_step?: number;
};

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
};

const deferred = (): Deferred => {
  let resolve: () => void;
  let reject: (error: Error) => void;
  const promise = new Promise<void>((done, failed) => {
    resolve = done;
    reject = failed;
  });
  void promise.catch(() => undefined);
  return { promise, resolve: resolve, reject: reject };
};

const withTimeout = async <T>(promise: Promise<T>, milliseconds: number) => {
  let timer: NodeJS.Timeout;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new HarnessError('BROKER_TIMEOUT')),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

export class InMemoryRequestBroker {
  private packages = new Map<string, RequestPackage>();
  private taken = new Set<string>();
  private readySlots = new Set<string>();
  private sampleEnds = new Map<string, SemanticResponse>();
  private semanticWaiters = new Map<
    string,
    { resolve: (code: string) => void; reject: (error: Error) => void }
  >();
  private allReady = deferred();
  private releaseSignal = deferred();
  private allSamplesEnded = deferred();
  private released = false;
  private aborted = false;

  constructor(packages: RequestPackage[]) {
    if (packages.length !== CLIENTS)
      throw new HarnessError('BROKER_PACKAGE_COUNT');
    for (const entry of packages) {
      if (
        !CLIENT_SLOTS.includes(entry.client_slot) ||
        this.packages.has(entry.client_slot)
      ) {
        throw new HarnessError('BROKER_DUPLICATE_SLOT');
      }
      this.packages.set(entry.client_slot, entry);
    }
  }

  takePackage(slot: string) {
    this.assertKnownSlot(slot);
    if (this.aborted) throw new HarnessError('BROKER_ABORTED');
    const entry = this.packages.get(slot);
    if (!entry || this.taken.has(slot)) {
      throw new HarnessError('BROKER_PACKAGE_ALREADY_TAKEN');
    }
    this.packages.delete(slot);
    this.taken.add(slot);
    return entry;
  }

  markReady(slot: string) {
    this.assertKnownSlot(slot);
    if (this.aborted) throw new HarnessError('BROKER_ABORTED');
    if (!this.taken.has(slot))
      throw new HarnessError('BROKER_READY_BEFORE_TAKE');
    if (this.readySlots.has(slot))
      throw new HarnessError('BROKER_DUPLICATE_READY');
    this.readySlots.add(slot);
    if (this.readySlots.size === CLIENTS) this.allReady.resolve();
    return this.readySlots.size;
  }

  async waitUntilReady(timeoutMs: number) {
    await withTimeout(this.allReady.promise, timeoutMs);
    return this.readySlots.size;
  }

  release() {
    if (this.aborted) throw new HarnessError('BROKER_ABORTED');
    if (this.released) throw new HarnessError('BROKER_DUPLICATE_RELEASE');
    if (this.readySlots.size !== CLIENTS || this.packages.size !== 0) {
      throw new HarnessError('BROKER_EARLY_RELEASE');
    }
    this.released = true;
    this.releaseSignal.resolve();
  }

  async waitForRelease() {
    await this.releaseSignal.promise;
  }

  submitSampleEnd(slot: string, response: SemanticResponse) {
    this.assertKnownSlot(slot);
    if (this.aborted) return Promise.reject(new HarnessError('BROKER_ABORTED'));
    if (!this.released || !this.readySlots.has(slot)) {
      throw new HarnessError('BROKER_SAMPLE_BEFORE_RELEASE');
    }
    if (this.sampleEnds.has(slot)) {
      throw new HarnessError('BROKER_DUPLICATE_SAMPLE_END');
    }
    this.sampleEnds.set(slot, response);
    if (this.sampleEnds.size === CLIENTS) this.allSamplesEnded.resolve();
    return new Promise<string>((resolve, reject) => {
      this.semanticWaiters.set(slot, { resolve, reject });
    });
  }

  async waitUntilSampleEnds(timeoutMs: number) {
    await withTimeout(this.allSamplesEnded.promise, timeoutMs);
    return this.sampleEnds.size;
  }

  responses() {
    if (this.sampleEnds.size !== CLIENTS) {
      throw new HarnessError('BROKER_INCOMPLETE_RESPONSES');
    }
    return new Map(this.sampleEnds);
  }

  resolveSemantics(codes: Map<string, string>) {
    if (this.sampleEnds.size !== CLIENTS || codes.size !== CLIENTS) {
      throw new HarnessError('BROKER_SEMANTIC_COUNT');
    }
    for (const slot of CLIENT_SLOTS) {
      const code = codes.get(slot);
      const waiter = this.semanticWaiters.get(slot);
      if (!code || !/^(?:OK|[A-Z][A-Z0-9_]*)$/.test(code) || !waiter) {
        throw new HarnessError('BROKER_SEMANTIC_SLOT');
      }
      waiter.resolve(code);
    }
    this.semanticWaiters.clear();
    this.sampleEnds.clear();
  }

  abort(code = 'BROKER_ABORTED') {
    if (this.aborted) return;
    this.aborted = true;
    const error = new HarnessError(code);
    this.allReady.reject(error);
    this.releaseSignal.reject(error);
    this.allSamplesEnded.reject(error);
    for (const waiter of this.semanticWaiters.values()) waiter.reject(error);
    this.semanticWaiters.clear();
    this.packages.clear();
    this.sampleEnds.clear();
  }

  clear() {
    this.packages.clear();
    this.sampleEnds.clear();
    this.semanticWaiters.clear();
  }

  get counts() {
    return {
      packages: this.packages.size,
      taken: this.taken.size,
      ready: this.readySlots.size,
      sample_end: this.sampleEnds.size,
      released: this.released,
    };
  }

  private assertKnownSlot(slot: string) {
    if (!CLIENT_SLOTS.includes(slot))
      throw new HarnessError('BROKER_UNKNOWN_SLOT');
  }
}

const readBody = (request: IncomingMessage, maximumBytes = 2 * 1024 * 1024) =>
  new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    request.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maximumBytes) {
        reject(new HarnessError('BROKER_BODY_LIMIT'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.once('error', () => reject(new HarnessError('BROKER_CHANNEL')));
  });

const json = (response: ServerResponse, status: number, value: unknown) => {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
};

const semanticResponse = (value: unknown): SemanticResponse => {
  if (!value || typeof value !== 'object') {
    throw new HarnessError('BROKER_RESPONSE_SCHEMA');
  }
  const entry = value as Record<string, unknown>;
  if (
    !Number.isInteger(entry.statusCode) ||
    typeof entry.contentType !== 'string' ||
    typeof entry.rateLimitLimit !== 'string' ||
    typeof entry.rateLimitRemaining !== 'string' ||
    typeof entry.rateLimitReset !== 'string' ||
    typeof entry.bodyText !== 'string' ||
    !Array.isArray(entry.setCookie) ||
    entry.setCookie.some((cookie) => typeof cookie !== 'string') ||
    !Number.isInteger(entry.requestCount) ||
    !Number.isInteger(entry.redirectCount) ||
    !Number.isInteger(entry.retryCount)
  ) {
    throw new HarnessError('BROKER_RESPONSE_SCHEMA');
  }
  return entry as unknown as SemanticResponse;
};

export class LoopbackBrokerServer {
  private server?: Server;

  constructor(readonly broker: InMemoryRequestBroker) {}

  async start() {
    if (this.server) throw new HarnessError('BROKER_ALREADY_LISTENING');
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    this.server.on('clientError', (_error, socket) => socket.end());
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address() as AddressInfo;
    return address.port;
  }

  async close() {
    if (!this.server) return;
    this.broker.abort();
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    try {
      if (request.socket.remoteAddress !== '127.0.0.1') {
        throw new HarnessError('BROKER_NON_LOOPBACK');
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const match = /^\/(package|ready|release|sample-end)\/(\d{3})$/.exec(
        url.pathname,
      );
      if (!match) throw new HarnessError('BROKER_ROUTE');
      const [, action, slot] = match;
      if (action === 'package' && request.method === 'GET') {
        json(response, 200, this.broker.takePackage(slot));
        return;
      }
      if (action === 'ready' && request.method === 'POST') {
        await readBody(request, 1);
        json(response, 200, { ready: this.broker.markReady(slot) });
        return;
      }
      if (action === 'release' && request.method === 'GET') {
        await this.broker.waitForRelease();
        json(response, 200, { released: true });
        return;
      }
      if (action === 'sample-end' && request.method === 'POST') {
        const body = semanticResponse(JSON.parse(await readBody(request)));
        const code = await this.broker.submitSampleEnd(slot, body);
        json(response, 200, { code });
        return;
      }
      throw new HarnessError('BROKER_METHOD');
    } catch (error) {
      const code =
        error instanceof HarnessError ? error.code : 'BROKER_CHANNEL';
      if (!response.headersSent) json(response, 409, { code });
      else response.end();
    }
  }
}
