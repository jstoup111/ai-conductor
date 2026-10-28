// Covers: task:2
import { describe, expect, it, vi } from 'vitest';

import { timeMaintenancePhase } from '../../src/engine/maintenance-phase-timer.js';

// Type-only: never invoked. Each call must be rejected by the compiler (`npm run typecheck:test`).
const options = { now: () => 1, emit: () => {} };
const summary = { reconciled: 1, deferred: 0, orphaned: 0, parked: 0, refused: 0, skipped: 0 };
function rejectedPhaseResults(): void {
  // @ts-expect-error only repairs are deferred.
  void timeMaintenancePhase({ phase: 'startup-refresh' }, async () => 'deferred' as const, options);
  // @ts-expect-error only parked reconciliation skips unchanged inputs.
  void timeMaintenancePhase({ phase: 'repair', prUrl: 'https://example.test/pr/1' }, async () => 'skipped-unchanged' as const, options);
  // @ts-expect-error only parked reconciliation carries a summary.
  void timeMaintenancePhase({ phase: 'rekick' }, async () => ({ outcome: 'completed' as const, summary }), options);
}
void rejectedPhaseResults;

describe('timeMaintenancePhase', () => {
  it('emits a completed event with the injected clock duration when work resolves', async () => {
    let now = 100;
    const emit = vi.fn();

    await timeMaintenancePhase(
      { phase: 'startup-refresh' },
      async () => {
        now += 25;
      },
      { now: () => now, emit },
    );

    expect(emit).toHaveBeenCalledExactlyOnceWith({
      type: 'daemon_maintenance_phase',
      phase: 'startup-refresh',
      durationMs: 25,
      outcome: 'completed',
    });
  });

  it('emits a failed event and rethrows the original error when work rejects', async () => {
    let now = 100;
    const emit = vi.fn();
    const failure = new Error('refresh failed');

    await expect(timeMaintenancePhase(
      { phase: 'rekick' },
      async () => {
        now += 40;
        throw failure;
      },
      { now: () => now, emit },
    )).rejects.toBe(failure);

    expect(emit).toHaveBeenCalledExactlyOnceWith({
      type: 'daemon_maintenance_phase',
      phase: 'rekick',
      durationMs: 40,
      outcome: 'failed',
    });
  });

  it('uses the resolved skipped-unchanged outcome', async () => {
    const emit = vi.fn();

    await timeMaintenancePhase(
      { phase: 'parked-reconcile' },
      async () => 'skipped-unchanged' as const,
      { now: () => 1, emit },
    );

    expect(emit).toHaveBeenCalledExactlyOnceWith({
      type: 'daemon_maintenance_phase',
      phase: 'parked-reconcile',
      durationMs: 0,
      outcome: 'skipped-unchanged',
    });
  });

  it('carries a resolved parked-reconcile summary onto the event', async () => {
    const emit = vi.fn();
    const summary = { reconciled: 1, deferred: 2, orphaned: 3, parked: 4, refused: 5, skipped: 6 };

    await timeMaintenancePhase(
      { phase: 'parked-reconcile' },
      async () => ({ outcome: 'skipped-unchanged' as const, summary }),
      { now: () => 1, emit },
    );

    expect(emit).toHaveBeenCalledExactlyOnceWith({
      type: 'daemon_maintenance_phase',
      phase: 'parked-reconcile',
      durationMs: 0,
      outcome: 'skipped-unchanged',
      summary,
    });
  });
});
