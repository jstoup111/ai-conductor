// Covers: task:3
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
});
