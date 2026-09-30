// Covers: task:3, task:4
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpoolStore, type SpoolFilesystem } from '../../../src/engine/otel/spool-store.js';

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'otel-spool-store-'));
  directories.push(directory);
  return directory;
}

function filesystem(overrides: Partial<SpoolFilesystem> = {}): SpoolFilesystem {
  return {
    mkdir: (path, options) => import('node:fs/promises').then((fs) => fs.mkdir(path, options)),
    open,
    readdir,
    readFile,
    rename,
    rm,
    stat: (path) => import('node:fs/promises').then((fs) => fs.stat(path)),
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('SpoolStore', () => {
  it('fsyncs a temporary batch before atomically publishing its complete protobuf body', async () => {
    const directory = await temporaryDirectory();
    const events: string[] = [];
    const store = new SpoolStore(directory, {
      filesystem: filesystem({
        open: async (path, flags) => {
          const handle = await open(path, flags);
          return {
            writeFile: handle.writeFile.bind(handle),
            sync: async () => { events.push('sync'); await handle.sync(); },
            close: handle.close.bind(handle),
          };
        },
        rename: async (source, destination) => { events.push('rename'); await rename(source, destination); },
      }),
    });
    const body = Buffer.from([0x0a, 0x02, 0x08, 0x01]);

    const batch = await store.write('traces', body);

    expect({ events, bytes: await readFile(batch.path), name: batch.name.endsWith('.pb') }).toEqual({
      events: ['sync', 'rename'], bytes: body, name: true,
    });
  });

  it('does not expose a final protobuf file when publication rename fails', async () => {
    const directory = await temporaryDirectory();
    const store = new SpoolStore(directory, {
      filesystem: filesystem({ rename: vi.fn(async () => { throw new Error('rename failed'); }) }),
    });

    await expect(store.write('metrics', Buffer.from('metric-batch'))).rejects.toThrow('rename failed');

    expect({
      listed: await store.list('metrics'),
      files: await readdir(join(directory, 'metrics')),
    }).toEqual({ listed: [], files: expect.arrayContaining([expect.stringMatching(/\.tmp$/)]) });
  });

  it('keeps same-millisecond writes from independent stores distinct and intact', async () => {
    const directory = await temporaryDirectory();
    const fixedNow = () => 1_727_000_000_000;
    const first = new SpoolStore(directory, { now: fixedNow });
    const second = new SpoolStore(directory, { now: fixedNow });

    await Promise.all([
      first.write('traces', Buffer.from('first-batch')),
      second.write('traces', Buffer.from('second-batch')),
    ]);
    const batches = await first.list('traces');

    expect({ names: new Set(batches.map((batch) => batch.name)).size, bodies: await Promise.all(batches.map((batch) => first.read(batch))) })
      .toEqual({ names: 2, bodies: expect.arrayContaining([Buffer.from('first-batch'), Buffer.from('second-batch')]) });
  });

  it('lists only final protobuf batches oldest-first, deletes one, and totals remaining bytes', async () => {
    const directory = await temporaryDirectory();
    let now = 1_727_000_000_000;
    const store = new SpoolStore(directory, { now: () => now });
    const oldest = await store.write('traces', Buffer.from('old'));
    now += 1;
    const newest = await store.write('traces', Buffer.from('newer'));
    await open(join(directory, 'traces', 'ignored.tmp'), 'w').then((handle) => handle.close());

    const beforeDelete = await store.list('traces');
    await store.delete(oldest);

    expect({
      beforeDelete: beforeDelete.map((batch) => batch.name),
      listed: (await store.list('traces')).map((batch) => batch.name),
      totalBytes: await store.totalBytes('traces'),
    }).toEqual({
      beforeDelete: [oldest.name, newest.name],
      listed: [newest.name],
      totalBytes: Buffer.byteLength('newer'),
    });
  });

  it('evicts the oldest batches and reports their item counts when a write exceeds the byte cap', async () => {
    const directory = await temporaryDirectory();
    let now = 1_727_000_000_000;
    const store = new SpoolStore(directory, { maxBytes: 1_048_576, now: () => now });
    await store.write('traces', Buffer.alloc(524_288), 2);
    now += 1;
    const retained = await store.write('traces', Buffer.alloc(524_288));
    now += 1;
    const result = await store.write('traces', Buffer.alloc(102_400), 7);
    if (result.rejectedOversize) throw new Error('expected the batch to be stored');

    expect({
      result: { evictedBatches: result.evictedBatches, evictedItems: result.evictedItems },
      names: (await store.list('traces')).map((batch) => batch.name),
      totalBytes: await store.totalBytes('traces'),
    }).toEqual({
      result: { evictedBatches: 1, evictedItems: 2 },
      names: [retained.name, result.name],
      totalBytes: 626_688,
    });
  });

  it('rejects an oversize batch with its item count without changing retained files', async () => {
    const directory = await temporaryDirectory();
    const store = new SpoolStore(directory, { maxBytes: 1_048_576 });
    const retained = await store.write('metrics', Buffer.from('retained'));
    const result = await store.write('metrics', Buffer.alloc(2_097_152), 11);

    expect({
      result: { rejectedOversize: result.rejectedOversize, rejectedItems: result.rejectedItems },
      batches: (await store.list('metrics')).map((batch) => batch.name),
      body: await store.read(retained),
    }).toEqual({
      result: { rejectedOversize: true, rejectedItems: 11 },
      batches: [retained.name],
      body: Buffer.from('retained'),
    });
  });
});
