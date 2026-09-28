// Covers: task:9
import { describe, expect, it, vi } from 'vitest';

import type { ConductState } from '../../src/types/index.js';
import { makeNoVerdictOutcome, runGroupBranch } from '../../src/engine/group-core.js';

describe('as-built deterministic dispatch faults', () => {
  it('returns a terminal validation-group fault without retrying or invoking the provider', async () => {
    const fakeProvider = { invoke: vi.fn() };
    const run = vi.fn().mockResolvedValue({
      success: false,
      asBuiltFault: {
        kind: 'input',
        reason: 'as-built input projection fault: plan (fixture unreadable)',
      },
    });
    const retries = vi.fn();

    const outcome = await runGroupBranch(
      {
        name: 'architecture_review_as_built',
        skill: 'architecture-review',
        outcome: makeNoVerdictOutcome('not-run'),
      },
      {} as ConductState,
      {
        stepRunner: { run },
        lifecycleObserver: { onAdmitted: vi.fn(), onAttempt: vi.fn(), onRetry: retries, onSettled: vi.fn() },
      },
      3,
    );

    expect({ outcome, dispatches: run.mock.calls.length, retries: retries.mock.calls.length, providerCalls: fakeProvider.invoke.mock.calls.length }).toEqual({
      outcome: { kind: 'mechanical-fault', reason: 'as-built input projection fault: plan (fixture unreadable)' },
      dispatches: 1,
      retries: 0,
      providerCalls: 0,
    });
  });
});
