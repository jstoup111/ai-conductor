// Covers: task:2
import { describe, expect, it, vi } from 'vitest';

import { timeMaintenancePhase } from '../../src/engine/maintenance-phase-timer.js';

describe('timeMaintenancePhase', () => {
  it('emits a completed event with the injected clock duration when work resolves', async () => {
    let now = 100;
    const emit = vi.fn();

    await timeMaintenancePhase(
      'startup-refresh',
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
      'rekick',
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
      'parked-reconcile',
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
});
