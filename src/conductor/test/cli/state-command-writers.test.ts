import { describe, expect, it } from 'vitest';
import type { ConductState } from '../../src/types/index.js';
import type {
  ConductStateStore,
  NamedAtomicStateMutationBatch,
  PrivilegedStateCorrection,
  PrivilegedStateReplacement,
  StateMutation,
  StateMutationResult,
} from '../../src/engine/conduct-state-store.js';
import { recoverCommandState, replaceCommandState } from '../../src/index.js';

class RecordingConductStateStore implements ConductStateStore<ConductState> {
  readonly replacements: PrivilegedStateReplacement<ConductState>[] = [];
  readonly corrections: PrivilegedStateCorrection<ConductState>[] = [];

  constructor(private readonly result: StateMutationResult = { kind: 'applied' }) {}

  async apply(_mutation: StateMutation<ConductState>): Promise<StateMutationResult> {
    return this.result;
  }

  async applyBatch(_batch: NamedAtomicStateMutationBatch<ConductState>): Promise<StateMutationResult> {
    return this.result;
  }

  async applyCorrection(correction: PrivilegedStateCorrection<ConductState>): Promise<StateMutationResult> {
    this.corrections.push(correction);
    return this.result;
  }

  async replace(replacement: PrivilegedStateReplacement<ConductState>): Promise<StateMutationResult> {
    this.replacements.push(replacement);
    return this.result;
  }
}

describe('interactive command state writers (Task 17)', () => {
  it('uses privileged replacement for --reset and start-over', async () => {
    const resetStore = new RecordingConductStateStore();
    const startOverStore = new RecordingConductStateStore();

    await replaceCommandState('/tmp/conduct-state.json', 'reset conductor state', resetStore);
    await replaceCommandState('/tmp/conduct-state.json', 'start over conductor state', startOverStore);

    expect(resetStore.replacements).toEqual([
      { intent: 'reset conductor state', next: {}, privileged: true },
    ]);
    expect(startOverStore.replacements).toEqual([
      { intent: 'start over conductor state', next: {}, privileged: true },
    ]);
  });

  it('uses a deliberate corrective batch to remove completion and retry only failed steps', async () => {
    const store = new RecordingConductStateStore();
    await recoverCommandState(
      '/tmp/conduct-state.json',
      { feature_status: 'complete', finish: 'done', pr_url: 'https://github.com/acme/repo/pull/42' },
      ['finish'],
      store,
    );

    expect(store.corrections).toEqual([{
      name: 'recover incomplete feature state',
      privileged: true,
      deletions: [{
        field: 'feature_status',
        expected: 'complete',
        intent: 'clear incomplete feature completion',
      }],
      mutations: [{
        field: 'finish',
        expected: 'done',
        intent: 'restage failed verification step',
        next: 'pending',
      }],
    }]);
  });

  it('makes a failed reset actionable to the operator', async () => {
    await expect(replaceCommandState(
      '/tmp/conduct-state.json',
      'reset conductor state',
      new RecordingConductStateStore({ kind: 'persistence', message: 'state file is read-only' }),
    )).rejects.toThrow('reset conductor state failed (persistence): state file is read-only');
  });

  it('makes a failed corrective recovery actionable to the operator', async () => {
    await expect(recoverCommandState(
      '/tmp/conduct-state.json',
      { feature_status: 'complete', finish: 'done' },
      ['finish'],
      new RecordingConductStateStore({ kind: 'conflict', message: 'state changed before recovery' }),
    )).rejects.toThrow('Feature recovery state update failed (conflict): state changed before recovery');
  });
});
