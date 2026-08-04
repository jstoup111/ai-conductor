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
});
