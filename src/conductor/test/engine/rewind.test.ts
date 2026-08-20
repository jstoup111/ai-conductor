import { describe, expect, it } from 'vitest';

import type { ConductState, HarnessConfig } from '../../src/types/index.js';
import type {
  ConductStateStore,
  NamedAtomicStateMutationBatch,
  PrivilegedStateReplacement,
  StateMutation,
  StateMutationResult,
} from '../../src/engine/conduct-state-store.js';
import { rewindState } from '../../src/engine/rewind.js';

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

describe('rewindState', () => {
  const completeState: ConductState = {
    worktree: 'done', memory: 'done', explore: 'done', complexity: 'done', prd: 'done',
    architecture_diagram: 'done', architecture_review: 'done', stories: 'done',
    conflict_check: 'done', plan: 'done', coherence_check: 'done', acceptance_specs: 'done',
    build: 'done', wiring_check: 'done', test_suite: 'done', build_review: 'done',
    manual_test: 'done', prd_audit: 'done', architecture_review_as_built: 'done',
    retro: 'done', rebase: 'done', finish: 'done', last_step: 'finish',
  };

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
    const state: ConductState = { ...completeState, lint: 'done', wiring_check: 'skipped', last_step: 'finish' };

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
      ],
    }]);
  });

  it('reports the field, expected value, and current value when the port refuses a demotion', async () => {
    const store = new RefusingStateStore();
    const current: ConductState = { ...completeState, test_suite: 'failed' };

    await expect(rewindState({ state: completeState, config: {}, target: 'build', store, readCurrentState: async () => current }))
      .rejects.toThrow('test_suite: expected done, current failed');
  });
});
