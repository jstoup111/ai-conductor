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
  let acquired = false;
  let owner: string | undefined;
  return {
    get owner(): string | undefined {
      return owner;
    },
    async acquireDirectory(): Promise<void> {
      if (acquired) throw alreadyExists();
      acquired = true;
    },
    async writeOwner(_path, contents): Promise<void> {
      owner = contents;
    },
    async readOwner(): Promise<string> {
      if (owner === undefined) throw new Error('owner is absent');
      return owner;
    },
    async releaseDirectory(): Promise<void> {
      acquired = false;
      owner = undefined;
    },
  };
}

describe('conduct-state lease', () => {
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
