// Covers: task:3, task:4, task:rem-prd-audit-4a, task:rem-prd-audit-4b
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, open, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
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
    stat,
    ...overrides,
  };
}

function owner(pid: number, token: string): string {
  return JSON.stringify({ pid, token, createdAt: 0 });
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
            sync: async () => {
              events.push('sync');
              await handle.sync();
            },
            close: handle.close.bind(handle),
          };
        },
        rename: async (source, destination) => {
          events.push('rename');
          await rename(source, destination);
        },
      }),
    });
    const body = Buffer.from([0x0a, 0x02, 0x08, 0x01]);

    const batch = await store.write('traces', body);

    expect({ events, bytes: await readFile(batch.path), name: batch.name.endsWith('.pb') }).toEqual({
      events: ['sync', 'rename'],
      bytes: body,
      name: true,
    });
  });

  it('removes its temporary file and does not expose a final protobuf file when publication rename fails', async () => {
    const directory = await temporaryDirectory();
    const store = new SpoolStore(directory, {
      filesystem: filesystem({
        rename: vi.fn(async () => {
          throw new Error('rename failed');
        }),
      }),
    });

    await expect(store.write('metrics', Buffer.from('metric-batch'))).rejects.toThrow('rename failed');

    expect({
      listed: await store.list('metrics'),
      files: await readdir(join(directory, 'metrics')),
    }).toEqual({ listed: [], files: [] });
  });

  it('removes stale temporary files during a capped write without disturbing a fresh writer', async () => {
    const directory = await temporaryDirectory();
    const now = 1_727_000_000_000;
    const traces = join(directory, 'traces');
    await new SpoolStore(directory, { maxBytes: 1024, now: () => now }).write('traces', Buffer.from('seed'));
    const stale = join(traces, 'crashed.tmp');
    const fresh = join(traces, 'writer-in-flight.tmp');
    await open(stale, 'w').then((handle) => handle.close());
    await open(fresh, 'w').then((handle) => handle.close());
    await utimes(stale, (now - 60_001) / 1000, (now - 60_001) / 1000);
    await utimes(fresh, now / 1000, now / 1000);

    await new SpoolStore(directory, { maxBytes: 1024, now: () => now }).write('traces', Buffer.from('next'));

    await expect(readdir(traces)).resolves.toEqual(expect.arrayContaining(['writer-in-flight.tmp']));
    await expect(readdir(traces)).resolves.not.toContain('crashed.tmp');
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

    expect({
      names: new Set(batches.map((batch) => batch.name)).size,
      bodies: await Promise.all(batches.map((batch) => first.read(batch))),
    }).toEqual({ names: 2, bodies: expect.arrayContaining([Buffer.from('first-batch'), Buffer.from('second-batch')]) });
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

  it('reclaims a cap lock held by a dead writer so trace and metric writers both complete', async () => {
    const directory = await temporaryDirectory();
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, '.cap.lock'), owner(41_001, 'dead-cap-owner'));
    const store = new SpoolStore(directory, {
      maxBytes: 1024,
      isProcessAlive: (pid) => pid !== 41_001,
    });

    await expect(
      Promise.all([store.write('traces', Buffer.from('span')), store.write('metrics', Buffer.from('metric'))]),
    ).resolves.toHaveLength(2);

    await expect(Promise.all([store.list('traces'), store.list('metrics')])).resolves.toEqual([
      [expect.objectContaining({ size: 4 })],
      [expect.objectContaining({ size: 6 })],
    ]);
    await expect(readdir(directory)).resolves.not.toContain('.cap.lock');
  });

  it('bounds acquisition when a cap lock has no provable owner', async () => {
    const directory = await temporaryDirectory();
    const lockPath = join(directory, '.cap.lock');
    await mkdir(directory, { recursive: true });
    await writeFile(lockPath, 'incomplete owner record');
    await utimes(lockPath, (Date.now() - 60_001) / 1_000, (Date.now() - 60_001) / 1_000);
    let lockNow = 0;
    const store = new SpoolStore(directory, {
      maxBytes: 1024,
      capLockAcquireTimeoutMs: 2,
      lockNow: () => lockNow,
      yieldForCapLock: async () => {
        lockNow += 1;
      },
    });

    await expect(store.write('traces', Buffer.from('span'))).rejects.toThrow(
      'Timed out acquiring spool cap lock after 2ms',
    );
    await expect(readFile(lockPath, 'utf8')).resolves.toBe('incomplete owner record');
  });

  it('does not retry acquisition after reclaiming a lock consumes its deadline', async () => {
    const directory = await temporaryDirectory();
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, '.cap.lock'), owner(41_002, 'expired-cap-owner'));
    let lockNow = 0;
    const store = new SpoolStore(directory, {
      maxBytes: 1024,
      lockNow: () => lockNow,
      capLockAcquireTimeoutMs: 5,
      isProcessAlive: () => {
        lockNow = 5;
        return false;
      },
    });

    await expect(store.write('traces', Buffer.from('span'))).rejects.toThrow(
      'Timed out acquiring spool cap lock after 5ms',
    );
  });

  it('reclaims an orphaned recovery lock so trace and metric writes both complete', async () => {
    const directory = await temporaryDirectory();
    await mkdir(directory, { recursive: true });
    let lockNow = 1_727_000_000_000;
    await Promise.all([
      writeFile(join(directory, '.cap.lock'), owner(41_003, 'dead-cap-owner')),
      writeFile(join(directory, '.cap.lock.reclaim.dead-cap-owner'), owner(41_004, 'dead-reclaimer')),
    ]);
    const store = new SpoolStore(directory, {
      maxBytes: 1024,
      capLockAcquireTimeoutMs: 10,
      lockNow: () => lockNow,
      isProcessAlive: () => false,
      yieldForCapLock: async () => {
        lockNow += 1;
      },
    });

    await expect(store.write('traces', Buffer.from('span'))).resolves.toMatchObject({ size: 4 });
    await expect(store.write('metrics', Buffer.from('metric'))).resolves.toMatchObject({ size: 6 });
    await expect(readdir(directory)).resolves.not.toEqual(
      expect.arrayContaining(['.cap.lock', '.cap.lock.reclaim.dead-cap-owner']),
    );
  });

  it('does not remove a fresh recovery lock created after it claims an orphan', async () => {
    const directory = await temporaryDirectory();
    const recoveryPath = join(directory, '.cap.lock.reclaim.abandoned-cap-owner');
    const staleContents = Buffer.from(owner(41_004, 'stale-reclaimer'));
    const freshContents = Buffer.from(owner(41_005, 'fresh-reclaimer'));
    await mkdir(directory, { recursive: true });
    await writeFile(recoveryPath, staleContents);
    let replaced = false;
    const store = new SpoolStore(directory, {
      maxBytes: 1024,
      isProcessAlive: (pid) => pid === 41_005,
      filesystem: filesystem({
        readFile: async (path) => {
          const contents = await readFile(path);
          if (!replaced && path.includes('.cap.lock.reclaim')) {
            replaced = true;
            await writeFile(recoveryPath, freshContents);
          }
          return contents;
        },
      }),
    });

    await (
      store as unknown as { reclaimOrphanedCapRecoveryLock(path: string): Promise<void> }
    ).reclaimOrphanedCapRecoveryLock(recoveryPath);

    await expect(readFile(recoveryPath)).resolves.toEqual(freshContents);
  });

  it('does not remove a successor cap lock when a stale reclaimer loses its observed owner', async () => {
    const directory = await temporaryDirectory();
    const capPath = join(directory, '.cap.lock');
    const abandonedContents = Buffer.from(owner(41_006, 'abandoned-cap-owner'));
    const successorContents = Buffer.from(owner(41_007, 'successor-cap-owner'));
    await mkdir(directory, { recursive: true });
    await writeFile(capPath, abandonedContents);
    let replaced = false;
    const store = new SpoolStore(directory, {
      maxBytes: 1024,
      pid: 41_008,
      isProcessAlive: (pid) => pid === 41_007,
      filesystem: filesystem({
        readFile: async (path) => {
          const contents = await readFile(path);
          if (!replaced && path === capPath) {
            replaced = true;
            await writeFile(capPath, successorContents);
          }
          return contents;
        },
      }),
    });

    await (store as unknown as { reclaimAbandonedCapLock(path: string): Promise<boolean> }).reclaimAbandonedCapLock(
      capPath,
    );

    await expect(readFile(capPath)).resolves.toEqual(successorContents);
    await expect(readdir(directory)).resolves.not.toContain('.cap.lock.reclaim.abandoned-cap-owner');
  });

  it('serializes two reclaimers through one abandoned cap-lock incarnation and preserves the byte cap', async () => {
    const directory = await temporaryDirectory();
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, '.cap.lock'), owner(41_009, 'dead-cap-owner'));
    let activeCriticalSections = 0;
    let maximumCriticalSections = 0;
    let releaseFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstPublication = true;
    const criticalFilesystem = filesystem({
      rename: async (source, destination) => {
        if (destination.endsWith('.pb')) {
          activeCriticalSections += 1;
          maximumCriticalSections = Math.max(maximumCriticalSections, activeCriticalSections);
          if (firstPublication) {
            firstPublication = false;
            await firstEntered;
          }
          activeCriticalSections -= 1;
        }
        await rename(source, destination);
      },
    });
    const first = new SpoolStore(directory, {
      maxBytes: 12,
      pid: 41_010,
      randomBytes: (size) => Buffer.alloc(size, 1),
      isProcessAlive: (pid) => pid !== 41_009,
      filesystem: criticalFilesystem,
    });
    const second = new SpoolStore(directory, {
      maxBytes: 12,
      pid: 41_011,
      randomBytes: (size) => Buffer.alloc(size, 2),
      isProcessAlive: (pid) => pid !== 41_009,
      filesystem: criticalFilesystem,
    });

    const firstWrite = first.write('traces', Buffer.alloc(8));
    await vi.waitFor(() => expect(activeCriticalSections).toBe(1));
    const secondWrite = second.write('metrics', Buffer.alloc(8));
    releaseFirst();
    await Promise.all([firstWrite, secondWrite]);

    expect({ maximumCriticalSections, totalBytes: await first.totalBytes() }).toEqual({
      maximumCriticalSections: 1,
      totalBytes: 8,
    });
  });

  it('rejects a capped write when a live cap lock remains held past its acquisition deadline', async () => {
    const directory = await temporaryDirectory();
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, '.cap.lock'), owner(41_002, 'live-cap-owner'));
    const store = new SpoolStore(directory, {
      maxBytes: 1024,
      capLockAcquireTimeoutMs: 5,
      isProcessAlive: () => true,
    });

    await expect(store.write('metrics', Buffer.from('metric'))).rejects.toThrow(
      'Timed out acquiring spool cap lock after 5ms',
    );
  });

  it('surfaces cap-lock release failures after attempting cleanup', async () => {
    const directory = await temporaryDirectory();
    const store = new SpoolStore(directory, {
      maxBytes: 1024,
      filesystem: filesystem({
        open: async (path, flags) => {
          const handle = await open(path, flags);
          if (!path.endsWith('.cap.lock')) return handle;
          return {
            writeFile: handle.writeFile.bind(handle),
            sync: handle.sync.bind(handle),
            close: async () => {
              await handle.close();
              throw new Error('cap lock close failed');
            },
          };
        },
      }),
    });

    await expect(store.write('traces', Buffer.from('span'))).rejects.toThrow(
      'Spool cap lock operation or release failed',
    );
    await expect(readdir(directory)).resolves.not.toContain('.cap.lock');
  });
});
