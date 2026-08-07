import { describe, expect, it } from 'vitest';
import { PRESEEDED_DONE } from '../../src/daemon-cli.js';
import { ALL_STEPS } from '../../src/engine/steps.js';

// Replacement contract from APPROVED ADR
// `.docs/decisions/adr-2026-08-03-fail-closed-decide-entry.md`, D2.
// The prior acceptance suite intentionally required every DECIDE step in this
// preseed. The new design moves satisfaction to Conductor.run(), so keeping
// those assertions would preserve the defect rather than protect behavior.
describe('acceptance: the daemon preseed does not claim DECIDE satisfaction', () => {
  it('preseeds only mechanical worktree and memory state', () => {
    expect(PRESEEDED_DONE).toEqual(['worktree', 'memory']);
  });

  it('contains no step whose resolved phase is DECIDE', () => {
    const decideSteps = new Set(
      ALL_STEPS.filter((step) => step.phase === 'DECIDE').map((step) => step.name),
    );
    expect(PRESEEDED_DONE.filter((step) => decideSteps.has(step))).toEqual([]);
  });
});
