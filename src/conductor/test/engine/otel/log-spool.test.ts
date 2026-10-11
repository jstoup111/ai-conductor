// Covers: task:13, task:15
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExportResultCode } from '@opentelemetry/core';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SpoolDrainer } from '../../../src/engine/otel/spool-drainer.js';
import { SpoolStore } from '../../../src/engine/otel/spool-store.js';
import { SpoolingLogExporter } from '../../../src/engine/otel/spooling-exporter.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const directories: string[] = [];
const destinationId = 'sha256:3da5415594fc2c7ba17f6be9f4e61d562e26f67c30e251c6f5a8ca22ee1c0f8f';
const otherDestinationId = 'sha256:ed8d9d7e9ea46f6173d53828b9a1ae633d65a2385de9a07e6e97c2ba4be51874';

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'otel-log-spool-'));
  directories.push(directory);
  return directory;
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let turn = 0; turn < 1_000; turn += 1) {
    if (await predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('condition was not met');
}

const record = {
  hrTime: [1, 2] as [number, number], hrTimeObserved: [1, 2] as [number, number],
  resource: resourceFromAttributes({ 'conductor.project': 'durable-project' }),
  instrumentationScope: { name: 'conductor', version: '1.0.0' },
  severityText: 'INFO', severityNumber: 9, body: 'durable log record', eventName: 'operational_log',
  attributes: { 'conductor.feature': 'durable-feature' }, droppedAttributesCount: 0,
} as never;

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('durable log spool', () => {
  it('caps all log destinations without charging or changing trace and metric retention', async () => {
    const directory = await temporaryDirectory();
    let now = 1_727_000_000_000;
    const store = new SpoolStore(directory, { maxBytes: 1_024, logMaxBytes: 10, now: () => now });
    const trace = Buffer.from('trace-retained-byte-for-byte');
    const metric = Buffer.from('metric-retained-byte-for-byte');
    const inactiveDestination = 'sha256:inactive-destination';
    await store.write('traces', trace);
    await store.write('metrics', metric);
    await store.write('logs', Buffer.from('old!'), 2, inactiveDestination);
    now += 1;
    const active = await store.write('logs', Buffer.from('newer'), 3, destinationId);
    now += 1;
    const result = await store.write('logs', Buffer.from('last'), 5, destinationId);
    if (active.rejectedOversize || result.rejectedOversize) throw new Error('expected capped log batches to be retained');

    expect({
      eviction: { batches: result.evictedBatches, items: result.evictedItems },
      logs: (await store.list('logs')).map(({ destinationId: id, items }) => ({ id, items })),
      logBytes: await store.totalBytes('logs'),
      traces: await Promise.all((await store.list('traces')).map((batch) => store.read(batch))),
      metrics: await Promise.all((await store.list('metrics')).map((batch) => store.read(batch))),
    }).toEqual({
      eviction: { batches: 1, items: 2 },
      logs: [{ id: destinationId, items: 3 }, { id: destinationId, items: 5 }],
      logBytes: 9,
      traces: [trace],
      metrics: [metric],
    });
  });

  it.each(['ENOSPC', 'EACCES'])('reports a %s preservation failure and falls back without throwing', async (code) => {
    const events = new ConductorEventEmitter();
    const warnings: string[] = [];
    events.on('renderer_error', (event) => warnings.push(event.error));
    const preservationFailures = vi.fn();
    const direct = vi.fn((_records: unknown[], done: (result: { code: ExportResultCode }) => void) => {
      done({ code: ExportResultCode.SUCCESS });
    });
    const exporter = new SpoolingLogExporter({
      write: async () => { throw Object.assign(new Error(code), { code }); },
    } as unknown as SpoolStore, destinationId, { export: direct }, events, preservationFailures);

    await expect(new Promise<{ code: ExportResultCode }>((resolve) => exporter.export([record], resolve)))
      .resolves.toEqual({ code: ExportResultCode.SUCCESS });

    expect(direct).toHaveBeenCalledExactlyOnceWith([record], expect.any(Function));
    expect(preservationFailures).toHaveBeenCalledExactlyOnceWith(1);
    expect(warnings).toEqual(['[otel] log preservation failed; attempting authorized direct delivery']);
  });

  it('commits a protobuf log batch before acknowledgement, then a later authorized owner replays it with rotated credentials', async () => {
    const directory = await temporaryDirectory();
    const store = new SpoolStore(directory);
    let directSends = 0;
    const exporter = new SpoolingLogExporter(store, destinationId, {
      export(_records, done): void { directSends += 1; done({ code: ExportResultCode.SUCCESS }); },
    });

    const result = await new Promise<{ code: number }>((resolve) => exporter.export([record], resolve));
    const [batch] = await store.list('logs');
    const committedBody = await store.read(batch);
    const secretAtAdmission = 'log-secret-at-admission';
    const persisted = await Promise.all((await readdir(join(directory, 'logs'))).map(async (name) => {
      const path = join(directory, 'logs', name);
      return `${name}:${(await readFile(path)).toString('utf8')}`;
    }));

    expect(result.code).toBe(ExportResultCode.SUCCESS);
    expect(directSends).toBe(0);
    expect(batch).toMatchObject({ destinationId, items: 1 });
    expect(committedBody.byteLength).toBeGreaterThan(0);
    expect(persisted.join('')).not.toContain(secretAtAdmission);

    let currentCredential = secretAtAdmission;
    currentCredential = 'log-secret-after-rotation';
    const received: Array<{ url: string; authorization: string | undefined; body: Buffer }> = [];
    const drainer = new SpoolDrainer(new SpoolStore(directory), {
      endpoint: 'http://unused.test', headers: () => ({}),
      authorizeLog: async (identity) => identity === destinationId
        ? { endpoint: 'https://logs.example/v1/logs', headers: { authorization: `Bearer ${currentCredential}` } }
        : undefined,
      fetch: async (url, init) => {
        received.push({
          url: String(url), authorization: new Headers(init?.headers).get('authorization') ?? undefined,
          body: Buffer.from(init?.body as ArrayBuffer),
        });
        return new Response(undefined, { status: 200 });
      },
    });
    const draining = drainer.drainUntilStopped();
    try {
      await waitFor(() => received.length === 1);
    } finally {
      await drainer.stop();
      await draining;
    }

    expect(received).toEqual([{
      url: 'https://logs.example/v1/logs', authorization: 'Bearer log-secret-after-rotation', body: committedBody,
    }]);
    expect(await store.list('logs')).toEqual([]);
  });

  it('skips retained destination mismatches and delivers later eligible logs oldest-first without spinning', async () => {
    let now = 1_727_000_000_000;
    const store = new SpoolStore(await temporaryDirectory(), { now: () => now });
    await store.write('logs', Buffer.from('retained-mismatch'), 1, otherDestinationId);
    now += 1;
    await store.write('logs', Buffer.from('eligible-first'), 1, destinationId);
    now += 1;
    await store.write('logs', Buffer.from('eligible-second'), 1, destinationId);

    const bodies: string[] = [];
    let idlePolls = 0;
    const drainer = new SpoolDrainer(store, {
      endpoint: 'http://unused.test', headers: () => ({}),
      authorizeLog: async (identity) => identity === destinationId ? { endpoint: 'https://logs.example', headers: {} } : undefined,
      fetch: async (_url, init) => {
        bodies.push(Buffer.from(init?.body as ArrayBuffer).toString());
        return new Response(undefined, { status: 200 });
      },
      sleep: async () => { idlePolls += 1; await new Promise<void>(() => undefined); },
    });
    const draining = drainer.drainUntilStopped();
    try {
      await waitFor(() => bodies.length === 2 && idlePolls > 0);
    } finally {
      await drainer.stop();
      await draining;
    }

    expect(bodies).toEqual(['eligible-first', 'eligible-second']);
    expect(await store.list('logs')).toMatchObject([{ destinationId: otherDestinationId }]);
  });

  it.each([400, 413])('drops a retained log batch rejected with HTTP %i and records its count', async (status) => {
    const store = new SpoolStore(await temporaryDirectory());
    await store.write('logs', Buffer.from(`rejected-log-${status}`), 7, destinationId);
    const events = new ConductorEventEmitter();
    const drops: unknown[] = [];
    events.on('otel_spool_drop', (event) => drops.push(event));
    const drainer = new SpoolDrainer(store, {
      endpoint: 'http://unused.test', headers: () => ({}), events,
      authorizeLog: async () => ({ endpoint: 'https://logs.example', headers: {} }),
      fetch: async () => new Response(undefined, { status }),
    });
    const draining = drainer.drainUntilStopped();
    try {
      await waitFor(async () => (await store.list('logs')).length === 0);
    } finally {
      await drainer.stop();
      await draining;
    }

    expect(drops).toEqual([
      { type: 'otel_spool_drop', signal: 'logs', reason: 'rejected', batches: 1, items: 7, status },
    ]);
  });

  it('drops an OTLP partial log rejection once with its rejected-record count', async () => {
    const store = new SpoolStore(await temporaryDirectory());
    await store.write('logs', Buffer.from('partially-rejected-log'), 5, destinationId);
    const events = new ConductorEventEmitter();
    const drops: unknown[] = [];
    events.on('otel_spool_drop', (event) => drops.push(event));
    const drainer = new SpoolDrainer(store, {
      endpoint: 'http://unused.test', headers: () => ({}), events,
      authorizeLog: async () => ({ endpoint: 'https://logs.example/v1/logs', headers: {} }),
      // ExportLogsServiceResponse { partial_success: { rejected_log_records: 3 } }
      fetch: async () => new Response(new Uint8Array([0x0a, 0x02, 0x08, 0x03]), { status: 200 }),
    });
    const draining = drainer.drainUntilStopped();
    try {
      await waitFor(async () => (await store.list('logs')).length === 0);
    } finally {
      await drainer.stop();
      await draining;
    }

    expect(drops).toEqual([
      { type: 'otel_spool_drop', signal: 'logs', reason: 'rejected', batches: 1, items: 3, status: 200 },
    ]);
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [404, 'endpoint'],
    [408, 'throttled'],
    [429, 'throttled'],
    [503, 'server'],
  ] as const)('retains a log batch after HTTP %i, without rerouting it, and emits a safe %s warning', async (status, failureClass) => {
    const store = new SpoolStore(await temporaryDirectory());
    await store.write('logs', Buffer.from(`retain-log-${status}`), 1, destinationId);
    const events = new ConductorEventEmitter();
    const warnings: string[] = [];
    events.on('renderer_error', (event) => warnings.push(event.error));
    const destinations: string[] = [];
    const authorization = 'Bearer log-credential-sentinel';
    const drainer = new SpoolDrainer(store, {
      endpoint: 'http://unused.test', headers: () => ({}), events,
      authorizeLog: async () => ({ endpoint: 'https://incorrect-path.example/v1/logs', headers: { authorization } }),
      fetch: async (url) => {
        destinations.push(String(url));
        return new Response(undefined, { status });
      },
      sleep: async () => new Promise<void>(() => undefined),
    });
    const draining = drainer.drainUntilStopped();
    try {
      await waitFor(() => warnings.length === 1);
      expect(await store.list('logs')).toHaveLength(1);
    } finally {
      await drainer.stop();
      await draining;
    }

    expect(destinations).toEqual(['https://incorrect-path.example/v1/logs']);
    expect(warnings).toEqual([`OTLP logs delivery failed: ${failureClass}`]);
    expect(warnings.join('\n')).not.toContain(authorization);
  });

  it('retains an unavailable log destination and emits a safe network warning', async () => {
    const store = new SpoolStore(await temporaryDirectory());
    await store.write('logs', Buffer.from('network-retained-log'), 1, destinationId);
    const events = new ConductorEventEmitter();
    const warnings: string[] = [];
    events.on('renderer_error', (event) => warnings.push(event.error));
    const drainer = new SpoolDrainer(store, {
      endpoint: 'http://unused.test', headers: () => ({}), events,
      authorizeLog: async () => ({ endpoint: 'https://unavailable.example/v1/logs', headers: { authorization: 'Bearer network-secret' } }),
      fetch: async () => { throw new Error('Bearer network-secret unavailable'); },
      sleep: async () => new Promise<void>(() => undefined),
    });
    const draining = drainer.drainUntilStopped();
    try {
      await waitFor(() => warnings.length === 1);
      expect(await store.list('logs')).toHaveLength(1);
    } finally {
      await drainer.stop();
      await draining;
    }

    expect(warnings).toEqual(['OTLP logs delivery failed: network']);
    expect(warnings.join('\n')).not.toContain('network-secret');
  });

  it('honours Retry-After for logs before retrying the same retained batch', async () => {
    const store = new SpoolStore(await temporaryDirectory());
    await store.write('logs', Buffer.from('retry-after-log'), 1, destinationId);
    const delays: number[] = [];
    let releaseRetry!: () => void;
    let retryStarted!: () => void;
    const retryWaiting = new Promise<void>((resolve) => { retryStarted = resolve; });
    const drainer = new SpoolDrainer(store, {
      endpoint: 'http://unused.test', headers: () => ({}),
      authorizeLog: async () => ({ endpoint: 'https://logs.example', headers: {} }),
      fetch: async () => new Response(undefined, { status: 429, headers: { 'retry-after': '30' } }),
      sleep: async (delay) => new Promise<void>((resolve) => {
        // Trace/metric idle polls share this injected scheduler.  Only the
        // 30-second delay below is the log response's Retry-After directive.
        if (delay === 30_000) {
          delays.push(delay);
          releaseRetry = resolve;
          retryStarted();
        }
      }),
    });
    const draining = drainer.drainUntilStopped();
    try {
      await retryWaiting;
      expect(delays).toEqual([30_000]);
      expect(await store.list('logs')).toHaveLength(1);
    } finally {
      releaseRetry?.();
      await drainer.stop();
      await draining;
    }
  });

  it('allows only one retained log request in flight at a time', async () => {
    let now = 1_727_000_000_000;
    const store = new SpoolStore(await temporaryDirectory(), { now: () => now });
    await store.write('logs', Buffer.from('first-log'), 1, destinationId);
    now += 1;
    await store.write('logs', Buffer.from('second-log'), 1, destinationId);
    let active = 0;
    let highestActive = 0;
    let requestStarted!: () => void;
    const firstRequest = new Promise<void>((resolve) => { requestStarted = resolve; });
    const drainer = new SpoolDrainer(store, {
      endpoint: 'http://unused.test', headers: () => ({}),
      authorizeLog: async () => ({ endpoint: 'https://logs.example', headers: {} }),
      fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        active += 1;
        highestActive = Math.max(highestActive, active);
        requestStarted();
        init?.signal?.addEventListener('abort', () => {
          active -= 1;
          reject(new DOMException('aborted', 'AbortError'));
        }, { once: true });
      }),
    });
    const draining = drainer.drainUntilStopped();
    try {
      await firstRequest;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(highestActive).toBe(1);
      expect(await store.list('logs')).toHaveLength(2);
    } finally {
      await drainer.stop();
      await draining;
    }
  });
});
