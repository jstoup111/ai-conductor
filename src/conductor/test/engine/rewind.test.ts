import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ConductState, HarnessConfig } from '../../src/types/index.js';
import type {
  ConductStateStore,
  NamedAtomicStateMutationBatch,
  PrivilegedStateReplacement,
  StateMutation,
  StateMutationResult,
} from '../../src/engine/conduct-state-store.js';
import { clearHaltAtomically, dispatchRewindCommand, rewindState } from '../../src/engine/rewind.js';

class RecordingStateStore implements ConductStateStore<ConductState> {
  readonly batches: NamedAtomicStateMutationBatch<ConductState>[] = [];

  async apply(_mutation: StateMutation<ConductState>): Promise<StateMutationResult> {
    throw new Error('rewind must submit its demotions as one atomic batch');
  }

  async applyBatch(batch: NamedAtomicStateMutationBatch<ConductState>): Promise<StateMutationResult> {
    this.batches.push(batch);
    return { kind: 'applied' };
  }

  async replace(_replacement: PrivilegedStateReplacement<ConductState>): Promise<StateMutationResult> {
    throw new Error('rewind must not replace conduct state');
  }
}

class RefusingStateStore extends RecordingStateStore {
  override async applyBatch(_batch: NamedAtomicStateMutationBatch<ConductState>): Promise<StateMutationResult> {
    return { kind: 'conflict', message: 'Expected test_suite to match before operator rewind to build' };
  }
}

class ApplyingStateStore extends RecordingStateStore {
  constructor(readonly state: ConductState) {
    super();
  }

  override async applyBatch(batch: NamedAtomicStateMutationBatch<ConductState>): Promise<StateMutationResult> {
    this.batches.push(batch);
    const mutable = this.state as Record<string, unknown>;
    for (const mutation of batch.mutations) {
      if (mutable[mutation.field] !== mutation.expected) {
        return { kind: 'conflict', message: `${String(mutation.field)} changed` };
      }
    }
    for (const mutation of batch.mutations) {
      mutable[mutation.field] = mutation.next;
    }
    return { kind: 'applied' };
  }
}

describe('rewindState', () => {
  const completeState: ConductState = {
    worktree: 'done', memory: 'done', explore: 'done', complexity: 'done', prd: 'done',
    architecture_diagram: 'done', architecture_review: 'done', stories: 'done',
    conflict_check: 'done', plan: 'done', coherence_check: 'done', acceptance_specs: 'done',
    build: 'done', wiring_check: 'done', test_suite: 'done', build_review: 'done',
    manual_test: 'done', prd_audit: 'done', architecture_review_as_built: 'done',
    retro: 'done', rebase: 'done', finish: 'done', last_step: 'finish',
  };

  it('has no engine, daemon, or step-runner caller for operator rewind dispatch', async () => {
    const sourceRoot = join(import.meta.dirname, '..', '..', 'src');
    const sourceFiles = (await readdir(sourceRoot, { recursive: true }))
      .filter((path) => path.endsWith('.ts'))
      .map((path) => join(sourceRoot, path));
    const forbiddenCallers = await Promise.all(sourceFiles
      .filter((path) => path !== join(sourceRoot, 'index.ts') && path !== join(sourceRoot, 'engine', 'rewind.ts'))
      .map(async (path) => ({ path, source: await readFile(path, 'utf8') })));

    for (const { path, source } of forbiddenCallers) {
      expect(source, path).not.toMatch(/from ['\"][^'\"]*engine\/rewind\.js['\"]/);
      expect(source, path).not.toMatch(/\bdispatchRewindCommand\s*\(/);
    }
  });

  it('refuses an unknown target by name and lists the resolved registry without mutating', async () => {
    const store = new RecordingStateStore();
    const config: HarnessConfig = {
      steps: { lint: { after: 'build', skill: 'lint', enforcement: 'gating' } },
    };

    await expect(rewindState({ state: completeState, config, target: 'not-a-step', store, readCurrentState: async () => completeState }))
      .rejects.toThrow(/not-a-step.*Valid steps:.*lint/s);
    expect(store.batches).toEqual([]);
  });

  it('refuses a target at or after the current position without mutating', async () => {
    const store = new RecordingStateStore();

    await expect(rewindState({ state: completeState, config: {}, target: 'finish', store, readCurrentState: async () => completeState }))
      .rejects.toThrow(/earlier than current step "finish"/);
    expect(store.batches).toEqual([]);
  });

  it('accepts a config-declared custom target and demotes it plus non-skipped downstream steps to stale', async () => {
    const store = new RecordingStateStore();
    const config: HarnessConfig = {
      steps: { lint: { after: 'build', skill: 'lint', enforcement: 'gating' } },
    };
    const state = { ...completeState, lint: 'done', wiring_check: 'skipped', last_step: 'finish' } as ConductState;

    const result = await rewindState({ state, config, target: 'lint', store, readCurrentState: async () => state });

    expect(result).toEqual({ target: 'lint', demoted: ['lint', 'test_suite', 'build_review', 'manual_test', 'prd_audit', 'architecture_review_as_built', 'retro', 'rebase', 'finish'] });
    expect(store.batches).toEqual([{
      name: 'operator rewind state',
      mutations: [
        { field: 'lint', expected: 'done', intent: 'operator rewind to lint', next: 'stale' },
        { field: 'test_suite', expected: 'done', intent: 'operator rewind to lint', next: 'stale' },
        { field: 'build_review', expected: 'done', intent: 'operator rewind to lint', next: 'stale' },
        { field: 'manual_test', expected: 'done', intent: 'operator rewind to lint', next: 'stale' },
        { field: 'prd_audit', expected: 'done', intent: 'operator rewind to lint', next: 'stale' },
        { field: 'architecture_review_as_built', expected: 'done', intent: 'operator rewind to lint', next: 'stale' },
        { field: 'retro', expected: 'done', intent: 'operator rewind to lint', next: 'stale' },
        { field: 'rebase', expected: 'done', intent: 'operator rewind to lint', next: 'stale' },
        { field: 'finish', expected: 'done', intent: 'operator rewind to lint', next: 'stale' },
        { field: 'last_step', expected: 'finish', intent: 'operator rewind to lint', next: 'build' },
      ],
    }]);
  });

  it('reports the field, expected value, and current value when the port refuses a demotion', async () => {
    const store = new RefusingStateStore();
    const current: ConductState = { ...completeState, test_suite: 'failed' };

    await expect(rewindState({ state: completeState, config: {}, target: 'build', store, readCurrentState: async () => current }))
      .rejects.toThrow('test_suite: expected done, current failed');
  });

  describe('dispatchRewindCommand', () => {
  it('uses resolved config so a declared custom target is accepted at the command boundary', async () => {
    const config: HarnessConfig = {
      steps: { lint: { after: 'build', skill: 'lint', enforcement: 'gating' } },
    };
    const state = { ...completeState, lint: 'done', last_step: 'finish' } as ConductState;
    const store = new ApplyingStateStore(state);
    const emit = vi.fn(async () => {});

    await expect(dispatchRewindCommand({ kind: 'rewind', target: 'lint' }, '/fixture', {
      loadConfig: async () => ({ ok: true, config, warnings: [] }),
      readState: async () => ({ ok: true, value: state }),
      store,
      preflightDerivedRecords: async () => {},
      clearDerivedRecords: async () => {},
      emit,
    })).resolves.toBe(0);

    expect((state as Record<string, unknown>).lint).toBe('stale');
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ target: 'lint' }));
  });

  it('restores state through the mutation port when derived-record cleanup fails, leaving retry valid', async () => {
    const state: ConductState = { ...completeState };
    const original = { ...state };
    const store = new ApplyingStateStore(state);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build' }, '/fixture', {
      loadConfig: async () => ({ ok: true, config: {}, warnings: [] }),
      readState: async () => ({ ok: true, value: state }),
      store,
      preflightDerivedRecords: async () => {},
      clearDerivedRecords: async () => { throw new Error('cannot clear HALT'); },
    })).resolves.toBe(1);

    expect(state).toEqual(original);
    expect(store.batches.map((batch) => batch.name)).toEqual([
      'operator rewind state',
      'rollback failed operator rewind state',
    ]);
    error.mockRestore();
  });

  it('restores both HALT markers and state when only the second staged-marker deletion fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rewind-marker-rollback-'));
    const state: ConductState = { ...completeState };
    const original = { ...state };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await mkdir(join(root, '.pipeline'), { recursive: true });
      await writeFile(join(root, '.pipeline/conduct-state.json'), JSON.stringify(state));
      await writeFile(join(root, '.pipeline/HALT'), 'operator action required\n');
      await writeFile(join(root, '.pipeline/HALT.class'), 'needs-human\n');
      let removeCount = 0;

      await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build' }, root, {
        clearDerivedRecords: async (cwd) => clearHaltAtomically(cwd, {
          rename,
          remove: async (path, options) => {
            removeCount += 1;
            if (removeCount === 2) throw new Error('second staged marker cannot be removed');
            await rm(path, options);
          },
          readFile: (path) => readFile(path, 'utf-8'),
          restoreHalt: (cwd, body) => writeFile(join(cwd, '.pipeline/HALT'), body, 'utf-8'),
          writeClass: (path, contents) => writeFile(path, contents, 'utf-8'),
        }),
      })).resolves.toBe(1);

      expect(await readFile(join(root, '.pipeline/HALT'), 'utf-8')).toBe('operator action required\n');
      expect(await readFile(join(root, '.pipeline/HALT.class'), 'utf-8')).toBe('needs-human\n');
      expect(JSON.parse(await readFile(join(root, '.pipeline/conduct-state.json'), 'utf-8'))).toEqual(original);
    } finally {
      error.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed with a HALT marker when restoring a deleted marker also fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rewind-marker-protective-failure-'));
    const state: ConductState = { ...completeState };
    const original = { ...state };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await mkdir(join(root, '.pipeline'), { recursive: true });
      await writeFile(join(root, '.pipeline/conduct-state.json'), JSON.stringify(state));
      await writeFile(join(root, '.pipeline/HALT'), 'operator action required\n');
      await writeFile(join(root, '.pipeline/HALT.class'), 'needs-human\n');
      let removeCount = 0;

      await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build' }, root, {
        clearDerivedRecords: async (cwd) => clearHaltAtomically(cwd, {
          rename,
          remove: async (path, options) => {
            removeCount += 1;
            if (removeCount === 2) throw new Error('second staged marker cannot be removed');
            await rm(path, options);
          },
          readFile: (path) => readFile(path, 'utf-8'),
          restoreHalt: async () => { throw new Error('HALT restoration write failed'); },
          writeClass: (path, contents) => writeFile(path, contents, 'utf-8'),
        }),
      })).resolves.toBe(1);

      expect(await readFile(join(root, '.pipeline/HALT'), 'utf-8')).toBe('needs-human\n');
      expect(JSON.parse(await readFile(join(root, '.pipeline/conduct-state.json'), 'utf-8'))).toEqual(original);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('HALT restoration write failed'));
    } finally {
      error.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writes operator rewind audit evidence through the existing audit sink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rewind-audit-'));
    try {
      await mkdir(join(root, '.pipeline'), { recursive: true });
      await writeFile(join(root, '.pipeline/conduct-state.json'), JSON.stringify(completeState));
      await writeFile(join(root, '.pipeline/HALT'), 'operator action required\n');
      await writeFile(join(root, '.pipeline/HALT.class'), 'needs-human\n');

      await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build' }, root)).resolves.toBe(0);

      const records = (await readFile(join(root, '.pipeline/audit-trail/events.jsonl'), 'utf-8'))
        .trim().split('\n').map((line) => JSON.parse(line));
      expect(records).toContainEqual(expect.objectContaining({
        origin: 'operator', event: 'operator_rewind', reason: 'rewound to build',
      }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  });
});
