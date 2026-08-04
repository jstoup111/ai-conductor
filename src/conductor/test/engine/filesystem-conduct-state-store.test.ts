import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createFilesystemConductStateStore,
  type AtomicStateFilesystem,
  type ConductStatePersistence,
} from '../../src/engine/filesystem-conduct-state-store.js';
import type { StateMutationDiagnostic } from '../../src/engine/conduct-state-conflicts.js';
import type { StateMutation } from '../../src/engine/conduct-state-store.js';
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

type NonAppliedMutationCase = {
  name: string;
  initialState: ConductState;
  mutation: StateMutation<ConductState>;
  disposition: 'idempotent' | 'resolved' | 'conflict';
};

async function writeLegacyWholeSnapshot(path: string, state: ConductState): Promise<void> {
  await writeState(path, state);
}

/**
 * Task 7's atomic-replacement boundary. The adapter owns this seam rather
 * than delegating one opaque whole-file write, so failure injection can prove
 * that an accepted mutation never tears the previous JSON document.
 */
type AtomicPersistenceOperation =
  | 'create-temp'
  | 'write-temp'
  | 'sync-temp'
  | 'close-temp'
  | 'rename-temp'
  | 'cleanup-temp';

type AtomicFilesystemFixture = AtomicStateFilesystem & {
  calls: AtomicPersistenceOperation[];
  tempDirectories: string[];
};

function createAtomicFilesystemFixture(
  failures: ReadonlySet<AtomicPersistenceOperation> = new Set(),
): AtomicFilesystemFixture {
  const calls: AtomicPersistenceOperation[] = [];
  const tempDirectories: string[] = [];
  const fail = (operation: AtomicPersistenceOperation): void => {
    if (failures.has(operation)) {
      throw new Error(`injected ${operation} failure`);
    }
  };

  return {
    calls,
    tempDirectories,
    async createTemp(directory) {
      calls.push('create-temp');
      tempDirectories.push(directory);
      fail('create-temp');
      return { path: join(directory, '.conduct-state.test.tmp') };
    },
    async writeTemp(temp, contents): Promise<void> {
      calls.push('write-temp');
      fail('write-temp');
      await writeFile(temp.path, contents, 'utf-8');
    },
    async syncTemp(): Promise<void> {
      calls.push('sync-temp');
      fail('sync-temp');
    },
    async closeTemp(): Promise<void> {
      calls.push('close-temp');
      fail('close-temp');
    },
    async renameTemp(tempPath, statePath): Promise<void> {
      calls.push('rename-temp');
      fail('rename-temp');
      await rename(tempPath, statePath);
    },
    async cleanupTemp(tempPath): Promise<void> {
      calls.push('cleanup-temp');
      fail('cleanup-temp');
      await rm(tempPath, { force: true });
    },
  };
}

/**
 * The fourth argument preserves the existing persistence/diagnostics
 * injection slots while giving Task 7 a precise filesystem failure seam.
 */
const atomicMutation: StateMutation<ConductState> = {
  field: 'complexity_tier',
  expected: 'S',
  intent: 'record assessed complexity',
  next: 'M',
};

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

  it.each<NonAppliedMutationCase>([
    {
      name: 'an idempotent stale expectation',
      initialState: { complexity_tier: 'M' },
      mutation: {
        field: 'complexity_tier',
        expected: 'S',
        intent: 'record assessed complexity',
        next: 'M',
      },
      disposition: 'idempotent',
    },
    {
      name: 'a terminal completion resolution',
      initialState: { feature_status: 'complete' },
      mutation: {
        field: 'feature_status',
        expected: undefined,
        intent: 'clear stale feature status',
        next: undefined,
      } as unknown as StateMutation<ConductState>,
      disposition: 'resolved',
    },
    {
      name: 'an unruled same-field mismatch',
      initialState: { complexity_tier: 'M' },
      mutation: {
        field: 'complexity_tier',
        expected: 'S',
        intent: 'record assessed complexity',
        next: 'L',
      },
      disposition: 'conflict',
    },
    {
      name: 'a stale done-to-stale invalidation',
      initialState: { plan: 'done' },
      mutation: {
        field: 'plan',
        expected: 'pending',
        intent: 'invalidate superseded plan',
        next: 'stale',
      },
      disposition: 'conflict',
    },
  ])('leaves state bytes and persistence untouched for $name', async ({
    initialState,
    mutation,
    disposition,
  }) => {
    const statePath = await createStatePath();
    await writeState(statePath, initialState);
    const originalBytes = await readFile(statePath, 'utf-8');
    const writes: ConductState[] = [];
    const store = createFilesystemConductStateStore(
      statePath,
      persistenceWritesToDisk(writes),
    );

    const result = await store.apply(mutation);

    if (disposition === 'conflict') {
      expect(result).toMatchObject({ kind: 'conflict' });
      if (result.kind === 'conflict') {
        expect(result.message).toContain(mutation.field);
      }
    } else {
      expect(result).toEqual({ kind: disposition });
    }
    expect(await readFile(statePath, 'utf-8')).toBe(originalBytes);
    expect(writes).toEqual([]);
  });

  it('forwards safe conflict diagnostics through the injected writer seam', async () => {
    const statePath = await createStatePath();
    await writeState(statePath, { feature_desc: 'existing description' });
    const diagnostics: StateMutationDiagnostic[] = [];
    const store = createFilesystemConductStateStore(
      statePath,
      persistenceWritesToDisk([]),
      {
        writer: 'test-client',
        emit: (diagnostic) => diagnostics.push(diagnostic),
      },
    );

    await expect(store.apply({
      field: 'feature_desc',
      expected: `token=${'x'.repeat(1_024)}`,
      intent: 'record feature description',
      next: 'replacement description',
    })).resolves.toMatchObject({ kind: 'conflict' });

    expect(diagnostics).toEqual([expect.objectContaining({
      field: 'feature_desc',
      writer: 'test-client',
      intent: 'record feature description',
      disposition: 'conflict',
      expected: { kind: 'string', length: 256, redacted: true, truncated: true },
    })]);
    expect(JSON.stringify(diagnostics)).not.toContain('token=');
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

  it('applies a named step-status and last_step invariant batch as one persisted snapshot', async () => {
    const statePath = await createStatePath();
    const initialState: ConductState = {
      explore: 'done',
      plan: 'pending',
      last_step: 'explore',
      pr_url: 'https://github.com/acme/repo/pull/101',
    };
    await writeState(statePath, initialState);
    const writes: ConductState[] = [];
    const store = createFilesystemConductStateStore(
      statePath,
      persistenceWritesToDisk(writes),
    );

    await expect(store.applyBatch({
      name: 'complete plan transition',
      mutations: [
        {
          field: 'plan',
          expected: 'pending',
          intent: 'complete plan step',
          next: 'done',
        },
        {
          field: 'last_step',
          expected: 'explore',
          intent: 'record completed plan step',
          next: 'plan',
        },
      ],
    })).resolves.toEqual({ kind: 'applied' });

    const expectedState: ConductState = {
      ...initialState,
      plan: 'done',
      last_step: 'plan',
    };
    expect(writes).toEqual([expectedState]);
    expect(JSON.parse(await readFile(statePath, 'utf-8'))).toEqual(expectedState);
  });

  it('persists none of a named batch when its second operation conflicts', async () => {
    const statePath = await createStatePath();
    const initialState: ConductState = {
      explore: 'done',
      plan: 'pending',
      last_step: 'explore',
      pr_url: 'https://github.com/acme/repo/pull/101',
    };
    await writeState(statePath, initialState);
    const originalBytes = await readFile(statePath, 'utf-8');
    const writes: ConductState[] = [];
    const store = createFilesystemConductStateStore(
      statePath,
      persistenceWritesToDisk(writes),
    );

    await expect(store.applyBatch({
      name: 'complete plan transition',
      mutations: [
        {
          field: 'plan',
          expected: 'pending',
          intent: 'complete plan step',
          next: 'done',
        },
        {
          field: 'last_step',
          expected: 'memory',
          intent: 'record completed plan step',
          next: 'plan',
        },
      ],
    })).resolves.toMatchObject({ kind: 'conflict' });

    expect(writes).toEqual([]);
    await expect(readFile(statePath, 'utf-8')).resolves.toBe(originalBytes);
  });

  it.each([
    {
      name: 'temporary-file creation',
      failures: new Set<AtomicPersistenceOperation>(['create-temp']),
      calls: ['create-temp'],
    },
    {
      name: 'temporary-file sync',
      failures: new Set<AtomicPersistenceOperation>(['sync-temp']),
      calls: ['create-temp', 'write-temp', 'sync-temp', 'close-temp', 'cleanup-temp'],
    },
    {
      name: 'temporary-file close',
      failures: new Set<AtomicPersistenceOperation>(['close-temp']),
      calls: ['create-temp', 'write-temp', 'sync-temp', 'close-temp', 'cleanup-temp'],
    },
    {
      name: 'atomic rename',
      failures: new Set<AtomicPersistenceOperation>(['rename-temp']),
      calls: ['create-temp', 'write-temp', 'sync-temp', 'close-temp', 'rename-temp', 'cleanup-temp'],
    },
    {
      name: 'cleanup after a sync failure',
      failures: new Set<AtomicPersistenceOperation>(['sync-temp', 'cleanup-temp']),
      calls: ['create-temp', 'write-temp', 'sync-temp', 'close-temp', 'cleanup-temp'],
    },
  ] as const)('returns persistence failure and preserves the exact prior JSON bytes on $name failure', async ({
    failures,
    calls,
  }) => {
    const statePath = await createStatePath();
    const originalBytes = '{\n  "complexity_tier": "S",\n  "legacy_marker": "keep these bytes"\n}\n';
    await writeFile(statePath, originalBytes, 'utf-8');
    const filesystem = createAtomicFilesystemFixture(failures);
    const store = createFilesystemConductStateStore(statePath, undefined, undefined, filesystem);

    await expect(store.apply(atomicMutation)).resolves.toMatchObject({ kind: 'persistence' });
    expect(filesystem.calls).toEqual(calls);
    expect(JSON.parse(await readFile(statePath, 'utf-8'))).toEqual({
      complexity_tier: 'S',
      legacy_marker: 'keep these bytes',
    });
    await expect(readFile(statePath, 'utf-8')).resolves.toBe(originalBytes);
  });

  it('uses a same-directory temporary file and atomically writes backward-compatible formatted JSON', async () => {
    const statePath = await createStatePath();
    await writeFile(statePath, '{"complexity_tier":"S","legacy_marker":"retained"}', 'utf-8');
    const filesystem = createAtomicFilesystemFixture();
    const store = createFilesystemConductStateStore(statePath, undefined, undefined, filesystem);

    await expect(store.apply(atomicMutation)).resolves.toEqual({ kind: 'applied' });
    expect(filesystem.tempDirectories).toEqual([dirname(statePath)]);
    expect(filesystem.calls).toEqual([
      'create-temp',
      'write-temp',
      'sync-temp',
      'close-temp',
      'rename-temp',
    ]);
    await expect(readFile(statePath, 'utf-8')).resolves.toBe(
      '{\n  "complexity_tier": "M",\n  "legacy_marker": "retained"\n}\n',
    );
  });
});
