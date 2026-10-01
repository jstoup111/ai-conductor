// Covers: task:1
import { describe, expect, it } from 'vitest';

import { EVENT_SINKS } from '../../src/engine/event-sinks.js';
import {
  applyRebaseVerdicts,
  emitRebaseEvent,
  recordRebaseStepCompletion,
  type RebaseOutcome,
} from '../../src/engine/rebase.js';
import type { ConductorEvent } from '../../src/types/events.js';

describe('engine/rebase flatten type contracts', () => {
  it('declares the flatten refusal outcome and persisted merge audit event', () => {
    const outcome: RebaseOutcome = {
      kind: 'flatten_refused',
      mergeSha: 'merge-sha',
      parents: ['first-parent-sha', 'second-parent-sha'],
      flattenedSha: 'flattened-sha',
      conflicts: ['src/conflicted.ts'],
      reason: 'flattened merge conflicts with the target base',
      recipe: 'git -C <worktree> rebase -i --rebase-merges <base>',
    };
    const event: ConductorEvent = {
      type: 'rebase_merge_audit',
      flattenedMerges: ['merge-sha'],
      ancestryOnlyMerges: ['ancestry-only-sha'],
      sideLineageCount: 2,
    };

    expect(outcome.kind).toBe('flatten_refused');
    expect(event.type).toBe('rebase_merge_audit');
    expect(EVENT_SINKS.rebase_merge_audit.persist).toBe(true);
  });

  it('rejects a widened outcome kind at every rebase outcome consumer', () => {
    const widened: RebaseOutcome | { kind: 'future_outcome' } = { kind: 'future_outcome' };
    // These are compile-time contracts: a future union member cannot quietly
    // reach a consumer that forgot its explicit terminal branch.
    if (false) {
      // @ts-expect-error synthetic kind is not a RebaseOutcome
      void applyRebaseVerdicts('/tmp', widened, false);
      // @ts-expect-error synthetic kind is not a RebaseOutcome
      void recordRebaseStepCompletion('/tmp/state.json', widened);
      // @ts-expect-error synthetic kind is not a RebaseOutcome
      void emitRebaseEvent({ emit: async () => undefined } as never, widened);
    }
    expect(widened.kind).toBe('future_outcome');
  });
});
