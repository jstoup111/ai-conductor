// Covers: task:9
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpoolLease } from '../../../src/engine/otel/spool-lease.js';

const directories: string[] = [];
const now = 1_727_000_000_000;

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'otel-spool-lease-'));
  directories.push(directory);
  return directory;
}

async function writeLease(directory: string, lease: { pid: number; uuid: string; heartbeatAt: number }): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'lease.json'), JSON.stringify(lease));
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('SpoolLease', () => {
  it('keeps a fresh lease held by a live process exclusive', async () => {
    const directory = await temporaryDirectory();
    const first = new SpoolLease(directory, { now: () => now, isProcessAlive: () => true });
    const second = new SpoolLease(directory, { now: () => now, isProcessAlive: () => true });

    await expect(first.acquire()).resolves.toMatchObject({ acquired: true });
    await expect(second.acquire()).resolves.toEqual({ acquired: false });
    await expect(readFile(join(directory, 'lease.json'), 'utf8').then(JSON.parse)).resolves.toEqual({
      pid: process.pid,
      uuid: expect.any(String),
      heartbeatAt: now,
    });
  });

  it('reclaims an expired lease when its holder pid is dead', async () => {
    const directory = await temporaryDirectory();
    await writeLease(directory, { pid: 41, uuid: 'dead-holder', heartbeatAt: now - 60_001 });
    const openCalls: Array<{ path: string; flags: string }> = [];
    const lease = new SpoolLease(directory, {
      now: () => now,
      isProcessAlive: () => false,
      filesystem: {
        open: async (path, flags) => {
          openCalls.push({ path, flags });
          return open(path, flags);
        },
      },
    });

    await expect(lease.acquire()).resolves.toMatchObject({ acquired: true });
    expect(openCalls).toContainEqual({ path: join(directory, 'lease.json.next'), flags: 'wx' });
    await expect(readFile(join(directory, 'lease.json'), 'utf8').then(JSON.parse)).resolves.toEqual({
      pid: process.pid,
      uuid: expect.not.stringMatching(/^dead-holder$/),
      heartbeatAt: now,
    });
  });

  it('reclaims a stale lease when a dead successor was orphaned before rename', async () => {
    const directory = await temporaryDirectory();
    await writeLease(directory, { pid: 41, uuid: 'dead-holder', heartbeatAt: now - 60_001 });
    await writeFile(join(directory, 'lease.json.next'), JSON.stringify({ pid: 42, uuid: 'dead-successor', heartbeatAt: now - 60_001 }));

    const lease = new SpoolLease(directory, { now: () => now, isProcessAlive: () => false });
    await expect(lease.acquire()).resolves.toEqual({ acquired: true });
    await expect(readFile(join(directory, 'lease.json'), 'utf8').then(JSON.parse)).resolves.toMatchObject({ uuid: expect.not.stringMatching(/dead/) });
    await expect(readFile(join(directory, 'lease.json.next'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not steal a fresh successor whose writer is alive', async () => {
    const directory = await temporaryDirectory();
    await writeLease(directory, { pid: 41, uuid: 'dead-holder', heartbeatAt: now - 60_001 });
    await writeFile(join(directory, 'lease.json.next'), JSON.stringify({ pid: 42, uuid: 'live-successor', heartbeatAt: now }));

    const lease = new SpoolLease(directory, { now: () => now, isProcessAlive: (pid) => pid === 42 });
    await expect(lease.acquire()).resolves.toEqual({ acquired: false });
    await expect(readFile(join(directory, 'lease.json.next'), 'utf8').then(JSON.parse)).resolves.toMatchObject({ uuid: 'live-successor' });
  });

  it('schedules a held lease heartbeat every ten seconds without a real wait', async () => {
    const directory = await temporaryDirectory();
    const startedAt = 1_727_000_000_000;
    let currentTime = startedAt;
    let heartbeat: (() => void | Promise<void>) | undefined;
    const handle = { unref: () => undefined };
    const lease = new SpoolLease(directory, {
      now: () => currentTime,
      isProcessAlive: () => true,
      scheduleInterval: (callback, milliseconds) => {
        expect(milliseconds).toBe(10_000);
        heartbeat = callback;
        return handle;
      },
      clearInterval: (scheduled) => expect(scheduled).toBe(handle),
    });

    try {
      await expect(lease.acquire()).resolves.toMatchObject({ acquired: true });
      expect(heartbeat).toBeDefined();
      currentTime = startedAt + 10_000;
      if (!heartbeat) throw new Error('expected heartbeat callback to be scheduled');
      await heartbeat();

      await expect(readFile(join(directory, 'lease.json'), 'utf8').then(JSON.parse)).resolves.toMatchObject({
        heartbeatAt: startedAt + 10_000,
      });
    } finally {
      await lease.release();
    }
  });

  it('waits for an in-flight heartbeat before release removes both lease paths', async () => {
    const directory = await temporaryDirectory();
    const leasePath = join(directory, 'lease.json');
    const successorPath = `${leasePath}.next`;
    let heartbeat: (() => Promise<void>) | undefined;
    let resumeSuccessor!: () => void;
    const successorPaused = new Promise<void>((resolve) => { resumeSuccessor = resolve; });
    const lease = new SpoolLease(directory, {
      now: () => now,
      isProcessAlive: () => true,
      scheduleInterval: (callback) => { heartbeat = callback; return {}; },
      filesystem: {
        open: async (path, flags) => {
          const handle = await open(path, flags);
          if (path === successorPath) await successorPaused;
          return handle;
        },
      },
    });
    const contender = new SpoolLease(directory, { now: () => now, isProcessAlive: () => true });

    await lease.acquire();
    const refreshing = heartbeat?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const releasing = lease.release();
    resumeSuccessor();
    await Promise.all([refreshing, releasing]);

    await expect(readFile(leasePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(successorPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(contender.acquire()).resolves.toEqual({ acquired: true });
    await contender.release();
  });

  it('reclaims an expired lease whose live pid belongs to another uuid', async () => {
    const directory = await temporaryDirectory();
    await writeLease(directory, { pid: 42, uuid: 'unrelated-live-holder', heartbeatAt: now - 60_001 });
    const lease = new SpoolLease(directory, { now: () => now, isProcessAlive: () => true });

    await expect(lease.acquire()).resolves.toMatchObject({ acquired: true });
    await expect(readFile(join(directory, 'lease.json'), 'utf8').then(JSON.parse)).resolves.toEqual({
      pid: process.pid,
      uuid: expect.not.stringMatching(/^unrelated-live-holder$/),
      heartbeatAt: now,
    });
  });

  it('retries acquisition when a stale lease disappears during successor verification', async () => {
    const directory = await temporaryDirectory();
    const leasePath = join(directory, 'lease.json');
    const successorPath = join(directory, 'lease.json.next');
    await writeLease(directory, { pid: 43, uuid: 'vanishing-holder', heartbeatAt: now - 60_001 });
    let successorCreated = false;
    let removedStaleLease = false;
    const lease = new SpoolLease(directory, {
      now: () => now,
      isProcessAlive: () => false,
      filesystem: {
        open: async (path, flags) => {
          if (path === successorPath && flags === 'wx') successorCreated = true;
          return open(path, flags);
        },
        readFile: async (path, options) => {
          if (path === leasePath && successorCreated && !removedStaleLease) {
            removedStaleLease = true;
            await rm(leasePath);
          }
          return readFile(path, options);
        },
      },
    });

    await expect(lease.acquire()).resolves.toMatchObject({ acquired: true });
    expect({ removedStaleLease, files: await readdir(directory) }).toEqual({
      removedStaleLease: true,
      files: ['lease.json'],
    });
  });

  it('elects exactly one holder when twenty contenders reclaim one stale lease', async () => {
    const directory = await temporaryDirectory();
    await writeLease(directory, { pid: 43, uuid: 'stale-holder', heartbeatAt: now - 60_001 });
    const leases = Array.from({ length: 20 }, () => new SpoolLease(directory, {
      now: () => now,
      isProcessAlive: () => false,
    }));

    const results = await Promise.all(leases.map((lease) => lease.acquire()));

    expect(results.filter((result) => result.acquired)).toHaveLength(1);
  });

  it('makes the lease immediately available to the next acquirer after its holder releases', async () => {
    const directory = await temporaryDirectory();
    const holder = new SpoolLease(directory, { now: () => now, isProcessAlive: () => true });
    const contender = new SpoolLease(directory, { now: () => now, isProcessAlive: () => true });

    await expect(holder.acquire()).resolves.toMatchObject({ acquired: true });
    await holder.release();

    await expect(contender.acquire()).resolves.toMatchObject({ acquired: true });
  });

  it('does not release a replacement lease owned by a different uuid', async () => {
    const directory = await temporaryDirectory();
    const holder = new SpoolLease(directory, { now: () => now, isProcessAlive: () => true });
    const observer = new SpoolLease(directory, { now: () => now, isProcessAlive: () => true });

    await expect(holder.acquire()).resolves.toMatchObject({ acquired: true });
    await writeLease(directory, { pid: 44, uuid: 'replacement-holder', heartbeatAt: now });
    await holder.release();

    await expect(readFile(join(directory, 'lease.json'), 'utf8').then(JSON.parse)).resolves.toEqual({
      pid: 44,
      uuid: 'replacement-holder',
      heartbeatAt: now,
    });
    await expect(observer.acquire()).resolves.toEqual({ acquired: false });
  });

  it('restores a foreign successor swapped in between release verification and rename', async () => {
    const directory = await temporaryDirectory();
    const leasePath = join(directory, 'lease.json');
    const holder = new SpoolLease(directory, {
      now: () => now,
      isProcessAlive: () => true,
      filesystem: {
        rename: async (source, destination) => {
          if (source === leasePath && destination.endsWith('.release')) {
            await writeLease(directory, { pid: 44, uuid: 'foreign-successor', heartbeatAt: now });
          }
          await rename(source, destination);
        },
      },
    });

    await holder.acquire();
    await holder.release();

    await expect(readFile(leasePath, 'utf8').then(JSON.parse)).resolves.toMatchObject({ uuid: 'foreign-successor' });
  });

  it('notifies its owner when a contender replaces the lease during heartbeat', async () => {
    const directory = await temporaryDirectory();
    let heartbeat: (() => Promise<void>) | undefined;
    const lost: string[] = [];
    const lease = new SpoolLease(directory, {
      now: () => now,
      isProcessAlive: () => true,
      onLost: () => { lost.push('lost'); },
      scheduleInterval: (callback) => { heartbeat = callback; return {}; },
    });
    await lease.acquire();
    await writeLease(directory, { pid: 44, uuid: 'contender', heartbeatAt: now });
    await heartbeat?.();
    expect(lost).toEqual(['lost']);
  });
});
