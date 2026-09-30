// Covers: task:10, task:11, task:12, task:13
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpoolDrainer } from '../../../src/engine/otel/spool-drainer.js';
import { SpoolStore } from '../../../src/engine/otel/spool-store.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const directories: string[] = [];
const servers: Server[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'otel-spool-drainer-'));
  directories.push(directory);
  return directory;
}

function listen(server: Server, port = 0): Promise<string> {
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('expected a TCP test-server address');
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function reserveEndpoint(): Promise<number> {
  const server = createServer();
  const endpoint = await listen(server);
  await close(server);
  servers.splice(servers.indexOf(server), 1);
  return Number(new URL(endpoint).port);
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => close(server)));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('SpoolDrainer', () => {
  it('posts three traces batches oldest-first after the closed endpoint starts, then deletes each accepted batch', async () => {
    const reservedPort = await reserveEndpoint();
    let now = 1_727_000_000_000;
    const store = new SpoolStore(await temporaryDirectory(), { now: () => now });
    const oldest = await store.write('traces', Buffer.from('oldest-trace-protobuf'));
    now += 1;
    const middle = await store.write('traces', Buffer.from('middle-trace-protobuf'));
    now += 1;
    const newest = await store.write('traces', Buffer.from('newest-trace-protobuf'));
    const received: Array<{ path: string; body: Buffer }> = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      received.push({ path: request.url ?? '', body: Buffer.concat(chunks) });
      response.writeHead(200).end();
    });
    const endpoint = await listen(server, reservedPort);

    await new SpoolDrainer(store, { endpoint, headers: () => ({}) }).drain();

    expect({
      received: received.map(({ path, body }) => ({ path, body: body.toString() })),
      remaining: await store.list('traces'),
      written: [oldest.name, middle.name, newest.name],
    }).toEqual({
      received: [
        { path: '/v1/traces', body: 'oldest-trace-protobuf' },
        { path: '/v1/traces', body: 'middle-trace-protobuf' },
        { path: '/v1/traces', body: 'newest-trace-protobuf' },
      ],
      remaining: [],
      written: expect.arrayContaining([oldest.name, middle.name, newest.name]),
    });
  });

  it('sends both signals with protobuf content type and headers resolved when draining', async () => {
    const received: Array<{ path: string; contentType: string | undefined; authorization: string | undefined; body: Buffer }> = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      received.push({
        path: request.url ?? '',
        contentType: request.headers['content-type'],
        authorization: request.headers.authorization,
        body: Buffer.concat(chunks),
      });
      response.writeHead(200).end();
    });
    const endpoint = await listen(server);
    const store = new SpoolStore(await temporaryDirectory());
    await store.write('traces', Buffer.from('trace-protobuf'));
    await store.write('metrics', Buffer.from('metric-protobuf'));
    let apiKey = 'value-at-spool-time';
    const drainer = new SpoolDrainer(store, {
      endpoint,
      headers: () => ({ authorization: `Bearer ${apiKey}` }),
    });
    apiKey = 'value-at-drain-time';

    await drainer.drain();

    expect(received).toEqual(expect.arrayContaining([
      { path: '/v1/traces', contentType: 'application/x-protobuf', authorization: 'Bearer value-at-drain-time', body: Buffer.from('trace-protobuf') },
      { path: '/v1/metrics', contentType: 'application/x-protobuf', authorization: 'Bearer value-at-drain-time', body: Buffer.from('metric-protobuf') },
    ]));
  });

  it('posts a days-old spool body without a local age check', async () => {
    const received: Buffer[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      received.push(Buffer.concat(chunks));
      response.writeHead(200).end();
    });
    const endpoint = await listen(server);
    const daysOld = 1_727_000_000_000 - (7 * 24 * 60 * 60 * 1_000);
    const store = new SpoolStore(await temporaryDirectory(), { now: () => daysOld });
    const batch = await store.write('traces', Buffer.from('days-old-protobuf-body'));

    await new SpoolDrainer(store, { endpoint, headers: () => ({}) }).drain();

    expect({ received, remaining: await store.list('traces'), batch: batch.name }).toEqual({
      received: [Buffer.from('days-old-protobuf-body')], remaining: [], batch: expect.any(String),
    });
  });

  it.each([400, 413])('drops a days-old rejected batch and emits its status for HTTP %i', async (status) => {
    const events = new ConductorEventEmitter();
    const drops: unknown[] = [];
    events.on('otel_spool_drop', (event) => drops.push(event));
    const server = createServer((request, response) => {
      request.resume();
      response.writeHead(status).end();
    });
    const endpoint = await listen(server);
    const store = new SpoolStore(await temporaryDirectory(), {
      now: () => 1_727_000_000_000 - (7 * 24 * 60 * 60 * 1_000),
    });
    await store.write('traces', Buffer.from('rejected-days-old-batch'), 2);

    await new SpoolDrainer(store, { endpoint, headers: () => ({}), events }).drain();

    expect(await store.list('traces')).toEqual([]);
    expect(drops).toEqual([
      { type: 'otel_spool_drop', signal: 'traces', reason: 'rejected', batches: 1, items: 2, status },
    ]);
  });

  it('drops a partial-success response once and reports its rejected item count', async () => {
    const events = new ConductorEventEmitter();
    const drops: unknown[] = [];
    const received: string[] = [];
    events.on('otel_spool_drop', (event) => drops.push(event));
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      received.push(Buffer.concat(chunks).toString());
      // ExportTraceServiceResponse { partial_success: { rejected_spans: 3 } }
      response.writeHead(200, { 'content-type': 'application/x-protobuf' }).end(Buffer.from([0x0a, 0x02, 0x08, 0x03]));
    });
    const endpoint = await listen(server);
    const store = new SpoolStore(await temporaryDirectory());
    await store.write('traces', Buffer.from('partially-rejected-batch'), 5);

    await new SpoolDrainer(store, { endpoint, headers: () => ({}), events }).drain();

    expect(received).toEqual(['partially-rejected-batch']);
    expect(await store.list('traces')).toEqual([]);
    expect(drops).toEqual([
      { type: 'otel_spool_drop', signal: 'traces', reason: 'rejected', batches: 1, items: 3, status: 200 },
    ]);
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [404, 'endpoint'],
  ] as const)('keeps HTTP %i batches without emitting a drop event and preserves %s for backlog reporting', async (status, failureClass) => {
    const events = new ConductorEventEmitter();
    const drops: unknown[] = [];
    events.on('otel_spool_drop', (event) => drops.push(event));
    const server = createServer((request, response) => {
      request.resume();
      response.writeHead(status).end();
    });
    const endpoint = await listen(server);
    const store = new SpoolStore(await temporaryDirectory());
    await store.write('traces', Buffer.from(`keep-${status}`));
    let releaseSleep: (() => void) | undefined;
    const drainer = new SpoolDrainer(store, {
      endpoint,
      headers: () => ({}),
      events,
      sleep: async () => new Promise<void>((resolve) => { releaseSleep = resolve; }),
    });
    const draining = drainer.drain();

    try {
      for (let turns = 0; turns < 50 && !releaseSleep; turns += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(await store.list('traces')).toHaveLength(1);
      expect(drops).toEqual([]);
      expect(drainer.lastFailureClass('traces')).toBe(failureClass);
    } finally {
      releaseSleep?.();
      await drainer.stop();
      await draining.catch(() => undefined);
    }
  });

  it('redelivers exactly once after an accepted batch is left behind by a crash, then continues', async () => {
    const received: string[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      received.push(Buffer.concat(chunks).toString());
      response.writeHead(200).end();
    });
    const endpoint = await listen(server);
    let now = 1_727_000_000_000;
    const store = new SpoolStore(await temporaryDirectory(), { now: () => now });
    const acceptedButUndeleted = await store.write('traces', Buffer.from('accepted-before-crash'));
    now += 1;
    await store.write('traces', Buffer.from('next-batch'));
    const crashBeforeDelete = Object.assign(Object.create(store) as SpoolStore, {
      delete: async () => { throw new Error('simulated crash after accept before delete'); },
    });

    await expect(new SpoolDrainer(crashBeforeDelete, { endpoint, headers: () => ({}) }).drain())
      .rejects.toThrow('simulated crash after accept before delete');
    await new SpoolDrainer(store, { endpoint, headers: () => ({}) }).drain();

    expect({
      received,
      acceptedReceipts: received.filter((body) => body === 'accepted-before-crash'),
      remaining: await store.list('traces'),
      acceptedButUndeleted: acceptedButUndeleted.name,
    }).toEqual({
      received: ['accepted-before-crash', 'accepted-before-crash', 'next-batch'],
      acceptedReceipts: ['accepted-before-crash', 'accepted-before-crash'],
      remaining: [],
      acceptedButUndeleted: expect.any(String),
    });
  });

  it('retries a 503 batch with strictly increasing injected delays, then deletes it after a 200', async () => {
    const received: string[] = [];
    const replies = [503, 503, 200];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      received.push(Buffer.concat(chunks).toString());
      response.writeHead(replies.shift() ?? 200).end();
    });
    const endpoint = await listen(server);
    let now = 1_727_000_000_000;
    const delays: number[] = [];
    const store = new SpoolStore(await temporaryDirectory(), { now: () => now });
    await store.write('traces', Buffer.from('retry-me'));

    await new SpoolDrainer(store, {
      endpoint,
      headers: () => ({}),
      now: () => now,
      sleep: async (delay: number) => { delays.push(delay); now += delay; },
      random: () => 0,
    }).drain();

    expect(received).toEqual(['retry-me', 'retry-me', 'retry-me']);
    expect(delays).toEqual([1_000, 2_000]);
    expect(await store.list('traces')).toEqual([]);
  });

  it('honours Retry-After before retrying traces and keeps the rejected batch', async () => {
    const received: string[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      received.push(Buffer.concat(chunks).toString());
      response.writeHead(429, { 'retry-after': '30' }).end();
    });
    const endpoint = await listen(server);
    let now = 1_727_000_000_000;
    const delays: number[] = [];
    let releaseSleep: (() => void) | undefined;
    const store = new SpoolStore(await temporaryDirectory(), { now: () => now });
    await store.write('traces', Buffer.from('respect-retry-after'));

    const drainer = new SpoolDrainer(store, {
      endpoint,
      headers: () => ({}),
      now: () => now,
      sleep: async (delay: number) => new Promise<void>((resolve) => {
        delays.push(delay);
        releaseSleep = resolve;
      }),
      random: () => 0,
    });
    const draining = drainer.drain();

    try {
      for (let turns = 0; turns < 50 && !releaseSleep; turns += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(delays).toEqual([30_000]);
      expect(received).toEqual(['respect-retry-after']);
      now += 29_999;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(received).toEqual(['respect-retry-after']);

      now += 1;
      releaseSleep?.();
      for (let turns = 0; turns < 50 && received.length < 2; turns += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(received).toEqual(['respect-retry-after', 'respect-retry-after']);
      await expect(drainer.stop()).resolves.toBeUndefined();
      expect(await store.list('traces')).toHaveLength(1);
    } finally {
      releaseSleep?.();
      await draining.catch(() => undefined);
    }
  });

  it('keeps and retries a dropped oldest traces batch before newer traces while metrics drain independently', async () => {
    const received: string[] = [];
    let traceAttempts = 0;
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString();
      received.push(`${request.url}:${body}`);
      if (request.url === '/v1/traces') {
        traceAttempts += 1;
        if (traceAttempts === 1) {
          request.socket.destroy();
          return;
        }
        response.writeHead(traceAttempts === 2 ? 503 : 200).end();
        return;
      }
      response.writeHead(200).end();
    });
    const endpoint = await listen(server);
    let now = 1_727_000_000_000;
    const delays: number[] = [];
    let sleepCount = 0;
    let releaseFirstTraceRetry: (() => void) | undefined;
    const store = new SpoolStore(await temporaryDirectory(), { now: () => now });
    await store.write('traces', Buffer.from('oldest-trace'));
    now += 1;
    await store.write('traces', Buffer.from('newer-trace'));
    await store.write('metrics', Buffer.from('independent-metric'));

    const drainer = new SpoolDrainer(store, {
      endpoint,
      headers: () => ({}),
      now: () => now,
      sleep: async (delay: number) => {
        delays.push(delay);
        sleepCount += 1;
        if (sleepCount === 1) {
          await new Promise<void>((resolve) => { releaseFirstTraceRetry = resolve; });
        }
        now += delay;
      },
      random: () => 0,
    });
    const draining = drainer.drain();

    try {
      for (let turns = 0; turns < 50 && (!releaseFirstTraceRetry || !received.includes('/v1/metrics:independent-metric')); turns += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(received.filter((entry) => entry.startsWith('/v1/traces:'))).toEqual(['/v1/traces:oldest-trace']);
      expect(await store.list('traces')).toHaveLength(2);
      expect(await store.list('metrics')).toEqual([]);

      releaseFirstTraceRetry?.();
      await draining;

      expect(received.filter((entry) => entry.startsWith('/v1/traces:'))).toEqual([
        '/v1/traces:oldest-trace',
        '/v1/traces:oldest-trace',
        '/v1/traces:oldest-trace',
        '/v1/traces:newer-trace',
      ]);
      expect(await store.list('traces')).toEqual([]);
    } finally {
      releaseFirstTraceRetry?.();
      await draining.catch(() => undefined);
    }
  });

  it('stops an in-flight request within the injected export timeout and keeps its spool file', async () => {
    let received = false;
    let hangingResponse: import('node:http').ServerResponse | undefined;
    const server = createServer((request, response) => {
      received = true;
      hangingResponse = response;
      request.resume();
    });
    const endpoint = await listen(server);
    let now = 1_727_000_000_000;
    const store = new SpoolStore(await temporaryDirectory());
    await store.write('traces', Buffer.from('in-flight-batch'));
    const drainer = new SpoolDrainer(store, {
      endpoint,
      headers: () => ({}),
      exportTimeoutMs: 10,
      now: () => now,
      sleep: async (delay: number) => { now += delay; },
    });
    const draining = drainer.drain();

    try {
      for (let turns = 0; turns < 50 && !received; turns += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(received).toBe(true);
      const stopStartedAt = now;
      await expect(drainer.stop()).resolves.toBeUndefined();
      expect(now - stopStartedAt).toBeLessThanOrEqual(10);
      await expect(draining).resolves.toBeUndefined();
      expect(await store.list('traces')).toHaveLength(1);
    } finally {
      hangingResponse?.destroy();
      await draining.catch(() => undefined);
    }
  });

  it('reports each non-empty signal backlog every 30 seconds and remains silent for an empty spool', async () => {
    const events = new ConductorEventEmitter();
    const backlog: unknown[] = [];
    events.on('otel_spool_backlog', (event) => { backlog.push(event); });
    const server = createServer((request, response) => {
      request.resume();
      response.writeHead(503).end();
    });
    const endpoint = await listen(server);
    let now = 1_727_000_000_000;
    const store = new SpoolStore(await temporaryDirectory(), { now: () => now });
    await store.write('traces', Buffer.from('first'));
    now += 1_000;
    await store.write('traces', Buffer.from('second-batch'));
    await store.write('metrics', Buffer.from('metric'));

    let releaseBacklogInterval: (() => void) | undefined;
    const drainer = new SpoolDrainer(store, {
      endpoint,
      headers: () => ({}),
      events,
      now: () => now,
      random: () => 0,
      sleep: async () => new Promise<void>(() => undefined),
      backlogSleep: async () => new Promise<void>((resolve) => {
        releaseBacklogInterval = () => {
          now += 30_000;
          resolve();
        };
      }),
    });

    const draining = drainer.drain();
    for (let turns = 0; turns < 50 && (!releaseBacklogInterval || drainer.lastFailureClass('traces') !== 'server' || drainer.lastFailureClass('metrics') !== 'server'); turns += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    for (let interval = 0; interval < 3; interval += 1) {
      const releaseInterval = releaseBacklogInterval;
      releaseBacklogInterval = undefined;
      releaseInterval?.();
      for (let turns = 0; turns < 50 && (!releaseBacklogInterval || backlog.length < (interval + 1) * 2); turns += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    await drainer.stop();
    await draining;

    expect(backlog).toEqual([
      { type: 'otel_spool_backlog', signal: 'traces', files: 2, bytes: 17, oldestAgeMs: 31_000, lastFailureClass: 'server' },
      { type: 'otel_spool_backlog', signal: 'metrics', files: 1, bytes: 6, oldestAgeMs: 30_000, lastFailureClass: 'server' },
      { type: 'otel_spool_backlog', signal: 'traces', files: 2, bytes: 17, oldestAgeMs: 61_000, lastFailureClass: 'server' },
      { type: 'otel_spool_backlog', signal: 'metrics', files: 1, bytes: 6, oldestAgeMs: 60_000, lastFailureClass: 'server' },
      { type: 'otel_spool_backlog', signal: 'traces', files: 2, bytes: 17, oldestAgeMs: 91_000, lastFailureClass: 'server' },
      { type: 'otel_spool_backlog', signal: 'metrics', files: 1, bytes: 6, oldestAgeMs: 90_000, lastFailureClass: 'server' },
    ]);

    const emptyEvents = new ConductorEventEmitter();
    const emptyBacklog: unknown[] = [];
    emptyEvents.on('otel_spool_backlog', (event) => { emptyBacklog.push(event); });
    const emptyStore = new SpoolStore(await temporaryDirectory(), { now: () => now });
    const emptyDrainer = new SpoolDrainer(emptyStore, { endpoint, headers: () => ({}), events: emptyEvents, now: () => now });
    for (let interval = 0; interval < 3; interval += 1) {
      now += 30_000;
      await emptyDrainer.drain();
    }
    expect(emptyBacklog).toEqual([]);
  });
});
