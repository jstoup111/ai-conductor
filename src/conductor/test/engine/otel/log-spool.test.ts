// Covers: task:13
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExportResultCode } from '@opentelemetry/core';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SpoolDrainer } from '../../../src/engine/otel/spool-drainer.js';
import { SpoolStore } from '../../../src/engine/otel/spool-store.js';
import { SpoolingLogExporter } from '../../../src/engine/otel/spooling-exporter.js';

const directories: string[] = [];
const destinationId = 'sha256:3da5415594fc2c7ba17f6be9f4e61d562e26f67c30e251c6f5a8ca22ee1c0f8f';
const otherDestinationId = 'sha256:ed8d9d7e9ea46f6173d53828b9a1ae633d65a2385de9a07e6e97c2ba4be51874';

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'otel-log-spool-'));
  directories.push(directory);
  return directory;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let turn = 0; turn < 1_000; turn += 1) {
    if (predicate()) return;
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
});
