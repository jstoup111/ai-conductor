import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createFilesystemConductStateStore,
  type ConductStatePersistence,
} from '../../src/engine/filesystem-conduct-state-store.js';
import { writeState } from '../../src/engine/state.js';
import type { ConductState } from '../../src/types/state.js';

const temporaryDirectories: string[] = [];

async function createStatePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'filesystem-conduct-state-store-'));
  temporaryDirectories.push(directory);
  return join(directory, 'conduct-state.json');
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

function persistenceWritesToDisk(writes: ConductState[]): ConductStatePersistence {
  return {
    async write(path, state): Promise<void> {
      writes.push(state);
      await writeState(path, state);
    },
  };
}

async function writeLegacyWholeSnapshot(path: string, state: ConductState): Promise<void> {
  await writeState(path, state);
}

describe('filesystem conduct state store', () => {
  it('reads existing flat conduct-state JSON through the established compatibility path', async () => {
    const statePath = await createStatePath();
    await writeFile(statePath, JSON.stringify({
      brainstorm: 'done',
      complexity_tier: 'M',
      pr_url: 'https://github.com/acme/repo/pull/101',
      legacy_marker: { retained: true },
    }));

    const store = createFilesystemConductStateStore(statePath);

    await expect(store.read()).resolves.toEqual({
      ok: true,
      value: {
        brainstorm: 'done',
        explore: 'done',
        prd: 'done',
        complexity_tier: 'M',
        pr_url: 'https://github.com/acme/repo/pull/101',
        legacy_marker: { retained: true },
      },
    });
  });

  it('applies one expected-value field mutation and preserves every other persisted field', async () => {
    const statePath = await createStatePath();
    const initialState = {
      feature_desc: 'retain peer-owned state',
      bootstrap: 'done',
      build: 'pending',
      complexity_tier: 'S',
      pr_url: 'https://github.com/acme/repo/pull/101',
      artifact_approvals: {
        '/project/.docs/plans/feature.md': {
          sha256: 'abc123',
          approved_at: '2026-08-04T12:00:00.000Z',
        },
      },
      legacy_marker: { retained: true },
    };
    await writeFile(statePath, JSON.stringify(initialState));
    const writes: ConductState[] = [];
    const store = createFilesystemConductStateStore(statePath, persistenceWritesToDisk(writes));

    await expect(store.apply({
      field: 'complexity_tier',
      expected: 'S',
      intent: 'record assessed complexity',
      next: 'M',
    })).resolves.toEqual({ kind: 'applied' });

    const expectedState = { ...initialState, complexity_tier: 'M' };
    expect(writes).toEqual([expectedState]);
    expect(JSON.parse(await readFile(statePath, 'utf-8'))).toEqual(expectedState);
  });

  it('re-reads after a stale whole snapshot and changes only the command-owned field', async () => {
    const statePath = await createStatePath();
    const initialState = {
      feature_desc: 'prevent stale writes',
      bootstrap: 'done',
      complexity_tier: 'S',
      pr_url: 'https://github.com/acme/repo/pull/101',
      legacy_marker: { retained: true },
    };
    await writeFile(statePath, JSON.stringify(initialState));
    const writes: ConductState[] = [];
    const store = createFilesystemConductStateStore(statePath, persistenceWritesToDisk(writes));

    const staleWholeSnapshot = await store.read();
    expect(staleWholeSnapshot).toEqual({ ok: true, value: initialState });

    const peerUpdate = {
      ...initialState,
      pr_url: 'https://github.com/acme/repo/pull/102',
      finish: 'done',
    };
    await writeFile(statePath, JSON.stringify(peerUpdate));

    await expect(store.apply({
      field: 'complexity_tier',
      expected: 'S',
      intent: 'record assessed complexity',
      next: 'M',
    })).resolves.toEqual({ kind: 'applied' });

    const expectedState = { ...peerUpdate, complexity_tier: 'M' };
    expect(writes).toEqual([expectedState]);
    expect(JSON.parse(await readFile(statePath, 'utf-8'))).toEqual(expectedState);
  });

  it.each([
    ['A then B', 'A', 'B'],
    ['B then A', 'B', 'A'],
  ] as const)('shows the legacy whole-object path loses the first disjoint update when %s commits', async (_order, firstClient, secondClient) => {
    const statePath = await createStatePath();
    const initialState = {
      feature_desc: 'preserve disjoint state changes',
      complexity_tier: 'S',
      pr_url: 'https://github.com/acme/repo/pull/101',
      legacy_marker: { retained: true },
    } as ConductState;
    await writeState(statePath, initialState);

    const staleClientA = JSON.parse(await readFile(statePath, 'utf-8')) as ConductState;
    const staleClientB = JSON.parse(await readFile(statePath, 'utf-8')) as ConductState;
    const clientSnapshots: Record<'A' | 'B', ConductState> = {
      A: { ...staleClientA, complexity_tier: 'M' },
      B: { ...staleClientB, pr_url: 'https://github.com/acme/repo/pull/102' },
    };

    await writeLegacyWholeSnapshot(statePath, clientSnapshots[firstClient]);
    await writeLegacyWholeSnapshot(statePath, clientSnapshots[secondClient]);

    expect(JSON.parse(await readFile(statePath, 'utf-8'))).toEqual(clientSnapshots[secondClient]);
  });

  it.each([
    ['A then B', 'A', 'B'],
    ['B then A', 'B', 'A'],
  ] as const)('preserves both disjoint client mutations when %s commits through the adapter', async (_order, firstClient, secondClient) => {
    const statePath = await createStatePath();
    const initialState = {
      feature_desc: 'preserve disjoint state changes',
      complexity_tier: 'S',
      pr_url: 'https://github.com/acme/repo/pull/101',
      legacy_marker: { retained: true },
    } as ConductState;
    await writeState(statePath, initialState);

    const clientA = createFilesystemConductStateStore(statePath);
    const clientB = createFilesystemConductStateStore(statePath);
    const staleClientA = await clientA.read();
    const staleClientB = await clientB.read();
    if (!staleClientA.ok || !staleClientB.ok) {
      throw new Error('expected both stale clients to read the initial state');
    }

    const mutations = {
      A: {
        field: 'complexity_tier',
        expected: staleClientA.value.complexity_tier,
        intent: 'record assessed complexity',
        next: 'M',
      },
      B: {
        field: 'pr_url',
        expected: staleClientB.value.pr_url,
        intent: 'record pull request URL',
        next: 'https://github.com/acme/repo/pull/102',
      },
    } as const;
    const clients = { A: clientA, B: clientB };

    await clients[firstClient].apply(mutations[firstClient]);
    await clients[secondClient].apply(mutations[secondClient]);

    expect(JSON.parse(await readFile(statePath, 'utf-8'))).toEqual({
      ...initialState,
      complexity_tier: 'M',
      pr_url: 'https://github.com/acme/repo/pull/102',
    });
  });
});
