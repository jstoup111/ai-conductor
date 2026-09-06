// Covers: task:1, task:2
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEngineStateStore,
  type EngineStateFilesystem,
} from '../../src/engine/engine-state-store.js';
import { recordAppendedRemediationTaskIds } from '../../src/engine/artifacts.js';
import { recordActivePlanPath } from '../../src/engine/conductor.js';
import type { ConductStateLease } from '../../src/engine/conduct-state-lease.js';

const temporaryDirectories: string[] = [];

async function createStatePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'engine-state-store-'));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, '.pipeline'));
  return join(directory, '.pipeline', 'engine-state.json');
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

function refusingLease(message = 'lease held by a live owner'): ConductStateLease {
  return { acquire: async () => ({ ok: false, kind: 'timeout', message }) };
}

function leaseWithOwnerPublicationWindow(): ConductStateLease {
  let publishingOwner = false;
  return {
    async acquire() {
      if (publishingOwner) {
        return {
          ok: false,
          kind: 'recovery_refused',
          message: 'Unable to recover engine-state lease: owner metadata is unavailable',
        };
      }
      publishingOwner = true;
      await new Promise<void>((resolve) => setImmediate(resolve));
      publishingOwner = false;
      return { ok: true, handle: { release: async () => ({ ok: true }) } };
    },
  };
}

function filesystemWithFailure(
  failure: 'writeTemporary' | 'renameTemporary',
): EngineStateFilesystem {
  return {
    async createTemporary(directory) {
      await writeFile(join(directory, '.created'), '');
      return { path: join(directory, '.engine-state.test.tmp') };
    },
    async writeTemporary(temporary, contents) {
      if (failure === 'writeTemporary') throw new Error('temporary disk failure');
      await writeFile(temporary.path, contents, 'utf8');
    },
    async closeTemporary() {},
    async renameTemporary(source, destination) {
      if (failure === 'renameTemporary') throw new Error('rename failure');
      await rename(source, destination);
    },
    cleanupTemporary: async (path) => rm(path, { force: true }),
  };
}

describe('engine state store', () => {
  it('serializes local lease acquisition before its owner publication completes', async () => {
    const statePath = await createStatePath();
    const lease = leaseWithOwnerPublicationWindow();
    const first = createEngineStateStore(statePath, { lease });
    const second = createEngineStateStore(statePath, { lease });

    const results = await Promise.all([
      first.update((state) => ({ ...state, activePlanPath: '.docs/plans/current.md' })),
      second.update((state) => ({ ...state, appendedRemediationTaskIds: ['12'] })),
    ]);

    expect(results).toEqual([{ ok: true }, { ok: true }]);
  });

  it('preserves both bookkeeping updates and sibling repair state when they race', async () => {
    const statePath = await createStatePath();
    const projectRoot = dirname(dirname(statePath));
    await writeFile(statePath, JSON.stringify({
      unrelated: { retained: true },
      repairObligations: { version: 1, records: {} },
    }));

    await Promise.all([
      recordActivePlanPath(projectRoot, '.docs/plans/current.md'),
      recordAppendedRemediationTaskIds(projectRoot, ['12']),
      createEngineStateStore(statePath).update((state) => ({
        ...state,
        repairObligations: { version: 1, records: { repair: { open: true } } },
      })),
    ]);

    await expect(readFile(statePath, 'utf8')).resolves.toSatisfy((raw) => {
      expect(JSON.parse(raw)).toEqual({
        activePlanPath: '.docs/plans/current.md',
        appendedRemediationTaskIds: ['12'],
        unrelated: { retained: true },
        repairObligations: { version: 1, records: { repair: { open: true } } },
      });
      return true;
    });
  });

  it('refuses malformed state through both bookkeeping writers without replacing it', async () => {
    const statePath = await createStatePath();
    const projectRoot = dirname(dirname(statePath));
    await writeFile(statePath, '{not json');

    await expect(recordActivePlanPath(projectRoot, '.docs/plans/current.md'))
      .rejects.toThrow('Failed to record active plan path (malformed)');
    await expect(recordAppendedRemediationTaskIds(projectRoot, ['12']))
      .rejects.toThrow('Failed to record appended remediation task ids (malformed)');
    await expect(readFile(statePath, 'utf8')).resolves.toBe('{not json');
  });

  it('serializes concurrent updates and preserves unrelated durable fields', async () => {
    const statePath = await createStatePath();
    await writeFile(statePath, JSON.stringify({
      activePlanPath: '.docs/plans/current.md',
      unrelated: { retained: true },
      repairObligations: { version: 1, records: {} },
    }));
    const first = createEngineStateStore(statePath);
    const second = createEngineStateStore(statePath);
    let allowFirstUpdate: (() => void) | undefined;
    const firstMayUpdate = new Promise<void>((resolve) => { allowFirstUpdate = resolve; });
    let firstHasLease: (() => void) | undefined;
    const firstLeaseHeld = new Promise<void>((resolve) => { firstHasLease = resolve; });

    const firstUpdate = first.update(async (state) => {
      firstHasLease?.();
      await firstMayUpdate;
      return { ...state, activePlanPath: '.docs/plans/revised.md' };
    });
    await firstLeaseHeld;
    const secondUpdate = second.update((state) => ({ ...state, appendedRemediationTaskIds: ['12'] }));
    // Let the second writer observe the lease owner before the first releases it.
    await new Promise<void>((resolve) => setImmediate(resolve));
    allowFirstUpdate?.();
    const [firstResult, secondResult] = await Promise.all([firstUpdate, secondUpdate]);

    expect([firstResult, secondResult]).toEqual([
      { ok: true },
      { ok: true },
    ]);
    await expect(readFile(statePath, 'utf8')).resolves.toSatisfy((raw) => {
      expect(JSON.parse(raw)).toEqual({
        activePlanPath: '.docs/plans/revised.md',
        appendedRemediationTaskIds: ['12'],
        unrelated: { retained: true },
        repairObligations: { version: 1, records: {} },
      });
      return true;
    });
  });

  it('treats only an absent legacy file as an empty state', async () => {
    const statePath = await createStatePath();
    const store = createEngineStateStore(statePath);

    await expect(store.read()).resolves.toEqual({ ok: true, value: {} });
    await expect(store.update((state) => ({ ...state, activePlanPath: '.docs/plans/current.md' })))
      .resolves.toEqual({ ok: true });
  });

  it.each([
    ['malformed JSON', '{not json', 'malformed'],
    ['an incompatible repair section', JSON.stringify({ repairObligations: [] }), 'incompatible'],
  ])('refuses %s instead of treating it as legacy absence', async (_case, contents, kind) => {
    const statePath = await createStatePath();
    await writeFile(statePath, contents);
    const store = createEngineStateStore(statePath);

    await expect(store.read()).resolves.toMatchObject({ ok: false, kind });
    await expect(store.update((state) => ({ ...state, activePlanPath: '.docs/plans/current.md' })))
      .resolves.toMatchObject({ ok: false, kind });
    await expect(readFile(statePath, 'utf8')).resolves.toBe(contents);
  });

  it('reports a refused lease without changing the durable object', async () => {
    const statePath = await createStatePath();
    const initial = JSON.stringify({ unrelated: 'durable' });
    await writeFile(statePath, initial);
    const store = createEngineStateStore(statePath, { lease: refusingLease() });

    await expect(store.update((state) => ({ ...state, activePlanPath: '.docs/plans/current.md' })))
      .resolves.toEqual({ ok: false, kind: 'lease', message: 'lease held by a live owner' });
    await expect(readFile(statePath, 'utf8')).resolves.toBe(initial);
  });

  it.each(['writeTemporary', 'renameTemporary'] as const)(
    'reports a failed %s without publishing a partial object',
    async (failure) => {
      const statePath = await createStatePath();
      await writeFile(statePath, JSON.stringify({ unrelated: 'durable' }));
      const store = createEngineStateStore(statePath, { filesystem: filesystemWithFailure(failure) });

      await expect(store.update((state) => ({ ...state, activePlanPath: '.docs/plans/current.md' })))
        .resolves.toMatchObject({ ok: false, kind: 'persistence' });
      await expect(readFile(statePath, 'utf8')).resolves.toEqual(JSON.stringify({ unrelated: 'durable' }));
    },
  );
});
