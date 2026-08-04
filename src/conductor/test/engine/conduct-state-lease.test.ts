import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createConductStateLease,
  type ConductStateLeaseFilesystem,
} from '../../src/engine/conduct-state-lease.js';
import {
  createFilesystemConductStateStore,
  type ConductStatePersistence,
} from '../../src/engine/filesystem-conduct-state-store.js';
import { writeState } from '../../src/engine/state.js';
import type { ConductState } from '../../src/types/state.js';

const temporaryDirectories: string[] = [];

async function createStatePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'conduct-state-lease-'));
  temporaryDirectories.push(directory);
  return join(directory, 'conduct-state.json');
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

function alreadyExists(): NodeJS.ErrnoException {
  return Object.assign(new Error('lease exists'), { code: 'EEXIST' });
}

function sharedLeaseFilesystem(): ConductStateLeaseFilesystem & { owner: string | undefined } {
  const directories = new Set<string>();
  const files = new Map<string, string>();

  function missing(path: string): NodeJS.ErrnoException {
    return Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
  }

  return {
    get owner(): string | undefined {
      return [...files.entries()].find(([path]) => path.endsWith('/owner.json'))?.[1];
    },
    async acquireDirectory(path): Promise<void> {
      if (directories.has(path)) throw alreadyExists();
      directories.add(path);
    },
    async writeOwner(path, contents): Promise<void> {
      if (files.has(path)) throw alreadyExists();
      files.set(path, contents);
    },
    async readOwner(path): Promise<string> {
      const owner = files.get(path);
      if (owner === undefined) throw missing(path);
      return owner;
    },
    async writeRecoveryClaim(path, contents): Promise<void> {
      if (files.has(path)) throw alreadyExists();
      files.set(path, contents);
    },
    async readRecoveryClaim(path): Promise<string | null> {
      return files.get(path) ?? null;
    },
    async moveDirectory(path, destination): Promise<void> {
      if (!directories.delete(path)) throw missing(path);
      directories.add(destination);
      for (const [filePath, contents] of [...files]) {
        if (filePath.startsWith(`${path}/`)) {
          files.delete(filePath);
          files.set(`${destination}${filePath.slice(path.length)}`, contents);
        }
      }
    },
    async releaseDirectory(path): Promise<void> {
      directories.delete(path);
      for (const filePath of [...files.keys()]) {
        if (filePath.startsWith(`${path}/`)) files.delete(filePath);
      }
    },
  };
}

describe('conduct-state lease', () => {
  it('returns a typed timeout without stealing from a live owner', async () => {
    const statePath = '/worktree/live/.pipeline/conduct-state.json';
    const filesystem = sharedLeaseFilesystem();
    const held = await createConductStateLease(statePath, {
      filesystem,
      pid: 101,
      newToken: () => 'live-owner',
    }).acquire();
    if (!held.ok) throw new Error(held.message);

    let now = 0;
    const attempted = createConductStateLease(statePath, {
      filesystem,
      now: () => now,
      wait: async () => { now += 10; },
      processIsLive: (pid) => pid === 101,
      pid: 202,
      newToken: () => 'waiting-writer',
      waitTimeoutMs: 10,
      retryDelayMs: 10,
    });

    await expect(attempted.acquire()).resolves.toMatchObject({
      ok: false,
      kind: 'timeout',
      message: 'Unable to acquire conduct-state lease within 10ms; owner pid 101 is live',
    });
    expect(filesystem.owner).toContain('live-owner');
    await held.handle.release();
  });

  it('recovers a lease only after injected liveness proves its owner dead', async () => {
    const statePath = '/worktree/dead/.pipeline/conduct-state.json';
    const filesystem = sharedLeaseFilesystem();
    const held = await createConductStateLease(statePath, {
      filesystem,
      pid: 101,
      newToken: () => 'dead-owner',
    }).acquire();
    if (!held.ok) throw new Error(held.message);
    const diagnostics: unknown[] = [];

    const recovered = await createConductStateLease(statePath, {
      filesystem,
      pid: 202,
      newToken: () => 'recovered-owner',
      processIsLive: () => false,
      onRecoveryDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    }).acquire();

    expect(recovered).toMatchObject({ ok: true });
    expect(filesystem.owner).toContain('recovered-owner');
    expect(diagnostics).toEqual([{
      kind: 'recovered',
      statePath,
      ownerPid: 101,
    }]);
    if (recovered.ok) await expect(recovered.handle.release()).resolves.toEqual({ ok: true });
  });

  it.each([
    ['corrupt', '{not json', 'invalid_owner_metadata'],
    ['ambiguous', JSON.stringify({ version: 1, pid: 101, token: 'owner', acquiredAt: 'not-a-date' }), 'invalid_owner_metadata'],
  ])('refuses %s owner metadata instead of stealing the lease', async (_case, owner, reason) => {
    const statePath = '/worktree/ambiguous/.pipeline/conduct-state.json';
    const filesystem = sharedLeaseFilesystem();
    await filesystem.acquireDirectory(`${statePath}.lease`);
    await filesystem.writeOwner(`${statePath}.lease/owner.json`, owner);
    const diagnostics: unknown[] = [];

    await expect(createConductStateLease(statePath, {
      filesystem,
      processIsLive: () => false,
      onRecoveryDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    }).acquire()).resolves.toMatchObject({
      ok: false,
      kind: 'recovery_refused',
      message: 'Unable to recover conduct-state lease: owner metadata is invalid or ambiguous',
    });
    expect(diagnostics).toEqual([{ kind: 'refused', statePath, reason }]);
    expect(filesystem.owner).toBe(owner);
  });

  it('keeps leases for independent worktree state paths isolated', async () => {
    const filesystem = sharedLeaseFilesystem();
    const first = createConductStateLease('/worktree/one/.pipeline/conduct-state.json', {
      filesystem,
      newToken: () => 'one',
    });
    const second = createConductStateLease('/worktree/two/.pipeline/conduct-state.json', {
      filesystem,
      newToken: () => 'two',
    });

    const [firstAcquired, secondAcquired] = await Promise.all([first.acquire(), second.acquire()]);
    expect(firstAcquired).toMatchObject({ ok: true });
    expect(secondAcquired).toMatchObject({ ok: true });
    if (firstAcquired.ok) await firstAcquired.handle.release();
    if (secondAcquired.ok) await secondAcquired.handle.release();
  });

  it('holds the first writer, waits the second, then re-evaluates from the first committed state', async () => {
    const statePath = await createStatePath();
    await writeState(statePath, { complexity_tier: 'S', pr_url: 'https://example.test/pr/1' });
    const filesystem = sharedLeaseFilesystem();
    let now = 0;
    let firstWriterMayRelease: (() => void) | undefined;
    const firstWriterReleased = new Promise<void>((resolve) => {
      firstWriterMayRelease = resolve;
    });
    let firstWriterCommitted: (() => void) | undefined;
    const firstWriterHasCommitted = new Promise<void>((resolve) => {
      firstWriterCommitted = resolve;
    });
    let secondWaited = false;
    const wait = async (): Promise<void> => {
      secondWaited = true;
      firstWriterMayRelease?.();
      now += 1;
    };
    const newLease = (pid: number) => createConductStateLease(statePath, {
      filesystem,
      now: () => now,
      wait,
      pid,
      newToken: () => `writer-${pid}`,
      processIsLive: (ownerPid) => ownerPid === 101,
      waitTimeoutMs: 10,
      retryDelayMs: 1,
    });
    const firstPersistence: ConductStatePersistence = {
      async write(path, state): Promise<void> {
        await writeState(path, state);
        firstWriterCommitted?.();
        await firstWriterReleased;
      },
    };
    const secondWrites: ConductState[] = [];
    const secondPersistence: ConductStatePersistence = {
      async write(path, state): Promise<void> {
        secondWrites.push(state);
        await writeState(path, state);
      },
    };
    const first = createFilesystemConductStateStore(
      statePath,
      firstPersistence,
      undefined,
      undefined,
      newLease(101),
    );
    const second = createFilesystemConductStateStore(
      statePath,
      secondPersistence,
      undefined,
      undefined,
      newLease(202),
    );

    const firstApply = first.apply({
      field: 'complexity_tier',
      expected: 'S',
      intent: 'record assessed complexity',
      next: 'M',
    });
    await firstWriterHasCommitted;

    expect(JSON.parse(filesystem.owner ?? '{}')).toMatchObject({
      version: 1,
      pid: 101,
      token: 'writer-101',
      acquiredAt: '1970-01-01T00:00:00.000Z',
    });

    await expect(second.apply({
      field: 'pr_url',
      expected: 'https://example.test/pr/1',
      intent: 'record pull request URL',
      next: 'https://example.test/pr/2',
    })).resolves.toEqual({ kind: 'applied' });
    await expect(firstApply).resolves.toEqual({ kind: 'applied' });

    expect(secondWaited).toBe(true);
    expect(secondWrites).toEqual([{
      complexity_tier: 'M',
      pr_url: 'https://example.test/pr/2',
    }]);
    await expect(readFile(statePath, 'utf8')).resolves.toContain('"complexity_tier": "M"');
  });
});
