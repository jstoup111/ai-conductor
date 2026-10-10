// Covers: task:10, task:11, task:12, task:13, task:14
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

async function drainUntilEmpty(drainer: SpoolDrainer, store: SpoolStore): Promise<void> {
  const draining = drainer.drainUntilStopped();
  await waitForEmpty(store);
  await drainer.stop();
  await draining;
}

async function waitForEmpty(store: SpoolStore): Promise<void> {
  // Poll by wall-clock deadline, not a fixed turn count: the awaited state
  // follows real loopback HTTP, which a loaded CI runner can delay past any
  // fixed number of event-loop turns. The deadline only fails the test.
  for (const deadline = Date.now() + 5_000; Date.now() < deadline;) {
    const [traces, metrics] = await Promise.all([store.list('traces'), store.list('metrics')]);
    if (traces.length === 0 && metrics.length === 0) {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('spool did not drain');
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => close(server)));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('SpoolDrainer', () => {
  it('retries a transient spool list failure without delaying the other signal', async () => {
    const store = new SpoolStore(await temporaryDirectory());
    await store.write('traces', Buffer.from('retry-trace'));
    await store.write('metrics', Buffer.from('independent-metric'));
    const flakyStore = Object.create(store) as SpoolStore;
    const list = store.list.bind(store);
    let failed = false;
    flakyStore.list = async (signal) => {
      if (signal === 'traces' && !failed) {
        failed = true;
        throw new Error('transient list failure');
      }
      return list(signal);
    };
    const events = new ConductorEventEmitter();
    const errors: string[] = [];
    events.on('renderer_error', (event) => {
      if (event.type === 'renderer_error') errors.push(event.error);
    });
    const delivered: string[] = [];
    const drainer = new SpoolDrainer(flakyStore, {
      endpoint: 'http://collector.test', headers: () => ({}), events,
      sleep: async () => undefined,
      fetch: async (url, init) => {
        delivered.push(`${url}:${Buffer.from(init?.body as ArrayBuffer).toString()}`);
        return new Response(undefined, { status: 200 });
      },
    });

    await drainUntilEmpty(drainer, store);

    expect(delivered).toEqual(expect.arrayContaining([
      'http://collector.test/v1/traces:retry-trace',
      'http://collector.test/v1/metrics:independent-metric',
    ]));
    expect(errors.filter((error) => error.includes('spool delivery failed'))).toHaveLength(1);
  });

  it('continues after a listed batch is concurrently evicted before read', async () => {
    const store = new SpoolStore(await temporaryDirectory());
    await store.write('traces', Buffer.from('evicted'));
    await store.write('traces', Buffer.from('delivered'));
    const racingStore = Object.create(store) as SpoolStore;
    const read = store.read.bind(store);
    let evicted = false;
    racingStore.read = async (batch) => {
      if (!evicted) {
        evicted = true;
        await store.delete(batch);
        throw Object.assign(new Error('concurrently evicted'), { code: 'ENOENT' });
      }
      return read(batch);
    };
    const delivered: string[] = [];
    const drainer = new SpoolDrainer(racingStore, {
      endpoint: 'http://collector.test', headers: () => ({}),
      fetch: async (_url, init) => {
        delivered.push(Buffer.from(init?.body as ArrayBuffer).toString());
        return new Response(undefined, { status: 200 });
      },
    });

    await drainUntilEmpty(drainer, store);

    expect(delivered).toEqual(['delivered']);
    expect(await store.list('traces')).toEqual([]);
  });

  it('keeps draining batches appended while an earlier batch is being delivered', async () => {
    const store = new SpoolStore(await temporaryDirectory());
    await store.write('traces', Buffer.from('first'));
    const delivered: string[] = [];
    const drainer = new SpoolDrainer(store, {
      endpoint: 'http://collector.test',
      headers: () => ({}),
      fetch: async (_url, init) => {
        delivered.push(Buffer.from(init?.body as ArrayBuffer).toString());
        if (delivered.length === 1) await store.write('traces', Buffer.from('appended-during-drain'));
        return new Response(undefined, { status: 200 });
      },
    });

    await drainUntilEmpty(drainer, store);

    expect({ delivered, remaining: await store.list('traces') }).toEqual({
      delivered: ['first', 'appended-during-drain'], remaining: [],
    });
  });

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

    await drainUntilEmpty(new SpoolDrainer(store, { endpoint, headers: () => ({}) }), store);

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

    await drainUntilEmpty(drainer, store);

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

    await drainUntilEmpty(new SpoolDrainer(store, { endpoint, headers: () => ({}) }), store);

    expect({ received, remaining: await store.list('traces'), batch: batch.name }).toEqual({
      received: [Buffer.from('days-old-protobuf-body')], remaining: [], batch: expect.any(String),
    });
  });

  it.each([400, 413])('drops a days-old rejected batch and emits its status for HTTP %i', async (status) => {
    const events = new ConductorEventEmitter();
    const drops: unknown[] = [];
    const failures: unknown[] = [];
    events.on('otel_spool_drop', (event) => { drops.push(event); });
    events.on('renderer_error', (event) => { failures.push(event); });
    const server = createServer((request, response) => {
      request.resume();
      response.writeHead(status).end();
    });
    const endpoint = await listen(server);
    const store = new SpoolStore(await temporaryDirectory(), {
      now: () => 1_727_000_000_000 - (7 * 24 * 60 * 60 * 1_000),
    });
    await store.write('traces', Buffer.from('rejected-days-old-batch'), 2);

    await drainUntilEmpty(new SpoolDrainer(store, { endpoint, headers: () => ({}), events }), store);

    expect(await store.list('traces')).toEqual([]);
    expect(drops).toEqual([
      { type: 'otel_spool_drop', signal: 'traces', reason: 'rejected', batches: 1, items: 2, status },
    ]);
  });

  it('drops a partial-success response once and reports its rejected item count', async () => {
    const events = new ConductorEventEmitter();
    const drops: unknown[] = [];
    const received: string[] = [];
    events.on('otel_spool_drop', (event) => { drops.push(event); });
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

    await drainUntilEmpty(new SpoolDrainer(store, { endpoint, headers: () => ({}), events }), store);

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
    const failures: unknown[] = [];
    events.on('otel_spool_drop', (event) => { drops.push(event); });
    events.on('renderer_error', (event) => { failures.push(event); });
    const server = createServer((request, response) => {
      request.resume();
      response.writeHead(status).end();
    });
    const endpoint = await listen(server);
    const store = new SpoolStore(await temporaryDirectory());
    await store.write('traces', Buffer.from(`keep-${status}`));
    const failure = events.waitFor('renderer_error');
    const drainer = new SpoolDrainer(store, {
      endpoint,
      headers: () => ({}),
      events,
      sleep: async () => new Promise<void>(() => undefined),
    });
    const draining = drainer.drainUntilStopped();

    try {
      await failure;
      expect(await store.list('traces')).toHaveLength(1);
      expect(drops).toEqual([]);
      expect(failures).toContainEqual(expect.objectContaining({ error: `OTLP traces delivery failed: ${failureClass}` }));
    } finally {
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

    const crashingDrainer = new SpoolDrainer(crashBeforeDelete, { endpoint, headers: () => ({}) });
    const crashing = crashingDrainer.drainUntilStopped();
    // The crashing drainer's POST is real loopback I/O; wait for it by
    // deadline rather than a fixed turn count, which flaked under CI load.
    for (const deadline = Date.now() + 5_000; received.length === 0 && Date.now() < deadline;) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(received).toHaveLength(1);
    await crashingDrainer.stop();
    await crashing;
    await drainUntilEmpty(new SpoolDrainer(store, { endpoint, headers: () => ({}) }), store);

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

    const drainer = new SpoolDrainer(store, {
      endpoint,
      headers: () => ({}),
      now: () => now,
      sleep: async (delay: number) => { delays.push(delay); now += delay; },
      random: () => 0,
    });
    await drainUntilEmpty(drainer, store);

    expect(received).toEqual(['retry-me', 'retry-me', 'retry-me']);
    // The independent idle loops share this injected scheduler; the retry
    // sequence itself is visible as the 1 s then 2 s backoff.
    expect(delays).toContain(1_000);
    expect(delays).toContain(2_000);
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
    let signalSleepStarted!: () => void;
    const sleepStarted = new Promise<void>((resolve) => { signalSleepStarted = resolve; });
    const store = new SpoolStore(await temporaryDirectory(), { now: () => now });
    await store.write('traces', Buffer.from('respect-retry-after'));

    const drainer = new SpoolDrainer(store, {
      endpoint,
      headers: () => ({}),
      now: () => now,
      sleep: async (delay: number) => new Promise<void>((resolve) => {
        if (delay === 30_000) {
          delays.push(delay);
          releaseSleep = resolve;
          signalSleepStarted();
        }
      }),
      random: () => 0,
    });
    const draining = drainer.drainUntilStopped();

    try {
      await sleepStarted;
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

  it.each([
    { status: 503, retryAfter: '30', description: 'delay-seconds from a server error' },
    { status: 429, retryAfter: 'Mon, 02 Sep 2024 04:27:10 GMT', description: 'an HTTP-date from a throttled response' },
  ])('honours Retry-After $description before retrying traces and keeps the batch', async ({ status, retryAfter }) => {
    const received: string[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      received.push(Buffer.concat(chunks).toString());
      response.writeHead(status, { 'retry-after': retryAfter }).end();
    });
    const endpoint = await listen(server);
    let now = Date.parse('2024-09-02T04:26:40Z');
    const delays: number[] = [];
    let releaseSleep: (() => void) | undefined;
    let signalSleepStarted!: () => void;
    const sleepStarted = new Promise<void>((resolve) => { signalSleepStarted = resolve; });
    const store = new SpoolStore(await temporaryDirectory(), { now: () => now });
    await store.write('traces', Buffer.from('respect-retry-after'));

    const drainer = new SpoolDrainer(store, {
      endpoint,
      headers: () => ({}),
      now: () => now,
      sleep: async (delay: number) => new Promise<void>((resolve) => {
        if (delay === 30_000) {
          delays.push(delay);
          releaseSleep = resolve;
          signalSleepStarted();
        }
      }),
      random: () => 0,
    });
    const draining = drainer.drainUntilStopped();

    try {
      await sleepStarted;
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
    let now = 1_727_000_000_000;
    const delays: number[] = [];
    let sleepCount = 0;
    let releaseFirstTraceRetry: (() => void) | undefined;
    let signalFirstTraceRetry!: () => void;
    const firstTraceRetry = new Promise<void>((resolve) => { signalFirstTraceRetry = resolve; });
    let signalMetricsDelivered!: () => void;
    const metricsDelivered = new Promise<void>((resolve) => { signalMetricsDelivered = resolve; });
    const store = new SpoolStore(await temporaryDirectory(), { now: () => now });
    await store.write('traces', Buffer.from('oldest-trace'));
    now += 1;
    await store.write('traces', Buffer.from('newer-trace'));
    await store.write('metrics', Buffer.from('independent-metric'));

    const drainer = new SpoolDrainer(store, {
      endpoint: 'http://collector.test',
      headers: () => ({}),
      fetch: async (url, init) => {
        const path = new URL(String(url)).pathname;
        const body = Buffer.from(init?.body as ArrayBuffer).toString();
        received.push(`${path}:${body}`);
        if (path === '/v1/traces') {
          traceAttempts += 1;
          if (traceAttempts === 1) throw new Error('dropped trace connection');
          return new Response(undefined, { status: traceAttempts === 2 ? 503 : 200 });
        }

        // The metrics loop is independent, but it must not win the shared
        // sleep seam before the trace retry has installed its test barrier.
        await firstTraceRetry;
        signalMetricsDelivered();
        return new Response(undefined, { status: 200 });
      },
      now: () => now,
      sleep: async (delay: number) => {
        delays.push(delay);
        sleepCount += 1;
        if (sleepCount === 1) {
          await new Promise<void>((resolve) => {
            releaseFirstTraceRetry = resolve;
            signalFirstTraceRetry();
          });
        }
        now += delay;
      },
      random: () => 0,
    });
    const draining = drainer.drainUntilStopped();

    try {
      await Promise.all([firstTraceRetry, metricsDelivered]);
      expect(received.filter((entry) => entry.startsWith('/v1/traces:'))).toEqual(['/v1/traces:oldest-trace']);
      expect(await store.list('traces')).toHaveLength(2);
      expect(await store.list('metrics')).toEqual([]);

      releaseFirstTraceRetry?.();
      await waitForEmpty(store);
      await drainer.stop();
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
    const draining = drainer.drainUntilStopped();

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
    const failures: unknown[] = [];
    events.on('otel_spool_backlog', (event) => { backlog.push(event); });
    events.on('renderer_error', (event) => { failures.push(event); });
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
    const backlogSleepStarted: Array<() => void> = [];
    const nextBacklogSleep = () => new Promise<void>((resolve) => backlogSleepStarted.push(resolve));
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
        backlogSleepStarted.shift()?.();
      }),
    });

    const firstBacklogSleep = nextBacklogSleep();
    const draining = drainer.drainUntilStopped();
    await firstBacklogSleep;
    while (failures.length < 2) await new Promise<void>((resolve) => setImmediate(resolve));
    for (let interval = 0; interval < 3; interval += 1) {
      const releaseInterval = releaseBacklogInterval;
      releaseBacklogInterval = undefined;
      releaseInterval?.();
      const followingBacklogSleep = nextBacklogSleep();
      await followingBacklogSleep;
      while (backlog.length < (interval + 1) * 2) await new Promise<void>((resolve) => setImmediate(resolve));
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
      const draining = emptyDrainer.drainUntilStopped();
      await emptyDrainer.stop();
      await draining;
    }
    expect(emptyBacklog).toEqual([]);
  });

  it('reports a traces network failure once after a healthy export and suppresses further network failures', async () => {
    const events = new ConductorEventEmitter();
    const rendererErrors: unknown[] = [];
    events.on('renderer_error', (event) => { rendererErrors.push(event); });
    let failNetworkRequests = false;
    let networkAttempts = 0;
    const server = createServer((request, response) => {
      request.resume();
      if (!failNetworkRequests) {
        response.writeHead(200).end();
        return;
      }
      networkAttempts += 1;
      request.socket.destroy();
    });
    const endpoint = await listen(server);
    const store = new SpoolStore(await temporaryDirectory());
    const pendingSleeps: Array<() => void> = [];
    const drainer = new SpoolDrainer(store, {
      endpoint,
      headers: () => ({}),
      events,
      sleep: async () => new Promise<void>((resolve) => { pendingSleeps.push(resolve); }),
    });
    await store.write('traces', Buffer.from('healthy-trace'));
    const healthyDrain = drainer.drainUntilStopped();
    await waitForEmpty(store);

    failNetworkRequests = true;
    await store.write('traces', Buffer.from('network-failure-trace'));
    const draining = healthyDrain;

    try {
      for (let turns = 0; turns < 1_000 && networkAttempts < 6; turns += 1) {
        pendingSleeps.splice(0).forEach((release) => release());
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(networkAttempts).toBe(6);
      await drainer.stop();
      await draining;
    } finally {
      pendingSleeps.splice(0).forEach((release) => release());
      await drainer.stop();
      await draining.catch(() => undefined);
    }

    expect({ networkAttempts, rendererErrors }).toEqual({
      networkAttempts: 6,
      rendererErrors: [expect.objectContaining({
        type: 'renderer_error',
        rendererName: 'otel',
        error: expect.stringMatching(/traces.*network/i),
      })],
    });
  });

  it('reports recovery after a network failure, then reports a later network refusal again', async () => {
    const events = new ConductorEventEmitter();
    const rendererErrors: unknown[] = [];
    events.on('renderer_error', (event) => { rendererErrors.push(event); });
    const pendingSleeps: Array<() => void> = [];
    let traceAttempts = 0;
    const store = new SpoolStore(await temporaryDirectory());
    await store.write('traces', Buffer.from('network-failure-trace'));
    const drainer = new SpoolDrainer(store, {
      endpoint: 'http://collector.test',
      headers: () => ({}),
      events,
      fetch: async (url) => {
        if (new URL(String(url)).pathname !== '/v1/traces') return new Response(undefined, { status: 200 });
        if (++traceAttempts === 2) return new Response(undefined, { status: 200 });
        throw new TypeError('network refusal');
      },
      sleep: async () => new Promise<void>((resolve) => { pendingSleeps.push(resolve); }),
    });
    const draining = drainer.drainUntilStopped();

    try {
      for (let turns = 0; turns < 1_000 && rendererErrors.length < 2; turns += 1) {
        pendingSleeps.splice(0).forEach((release) => release());
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(traceAttempts).toBe(2);
      expect(rendererErrors).toHaveLength(2);

      await store.write('traces', Buffer.from('network-refusal-after-recovery'));
      const refusing = drainer.drainUntilStopped();
      for (let turns = 0; turns < 1_000 && rendererErrors.length < 3; turns += 1) {
        pendingSleeps.splice(0).forEach((release) => release());
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(traceAttempts).toBeGreaterThanOrEqual(3);
      await drainer.stop();
      pendingSleeps.splice(0).forEach((release) => release());
      await refusing;
    } finally {
      pendingSleeps.splice(0).forEach((release) => release());
      await drainer.stop();
      await draining.catch(() => undefined);
    }

    expect(rendererErrors).toEqual([
      expect.objectContaining({
        type: 'renderer_error',
        rendererName: 'otel',
        error: expect.stringMatching(/traces.*network/i),
      }),
      expect.objectContaining({
        type: 'renderer_error',
        rendererName: 'otel',
        error: expect.stringMatching(/recover/i),
      }),
      expect.objectContaining({
        type: 'renderer_error',
        rendererName: 'otel',
        error: expect.stringMatching(/traces.*network/i),
      }),
    ]);
  });

  it('reports an auth error when a traces failure changes from network to HTTP 401', async () => {
    const events = new ConductorEventEmitter();
    const rendererErrors: unknown[] = [];
    events.on('renderer_error', (event) => { rendererErrors.push(event); });
    const pendingSleeps: Array<() => void> = [];
    let attempts = 0;
    const server = createServer((request, response) => {
      request.resume();
      if (++attempts === 1) request.socket.destroy();
      else response.writeHead(401).end();
    });
    const store = new SpoolStore(await temporaryDirectory());
    await store.write('traces', Buffer.from('network-then-auth'));
    const drainer = new SpoolDrainer(store, {
      endpoint: await listen(server), headers: () => ({}), events,
      sleep: async () => new Promise<void>((resolve) => { pendingSleeps.push(resolve); }),
    });
    const draining = drainer.drainUntilStopped();

    try {
      for (let turns = 0; turns < 1_000 && rendererErrors.length < 2; turns += 1) {
        pendingSleeps.splice(0).forEach((release) => release());
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(rendererErrors).toHaveLength(2);
      await drainer.stop();
      await draining;
    } finally {
      pendingSleeps.splice(0).forEach((release) => release());
      await drainer.stop();
      await draining.catch(() => undefined);
    }

    expect(rendererErrors).toEqual([
      expect.objectContaining({ rendererName: 'otel', error: expect.stringMatching(/traces.*network/i) }),
      expect.objectContaining({ rendererName: 'otel', error: expect.stringMatching(/traces.*auth/i) }),
    ]);
  });
});
