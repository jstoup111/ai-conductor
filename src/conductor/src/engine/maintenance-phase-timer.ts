import type {
  ConductorEvent,
  MaintenancePhase,
  MaintenancePhaseOutcome,
} from '../types/events.js';

type MaintenancePhaseEvent = Extract<ConductorEvent, { type: 'daemon_maintenance_phase' }>;

export interface MaintenancePhaseTimerOptions {
  readonly now: () => number;
  readonly emit: (event: MaintenancePhaseEvent) => void | Promise<void>;
}

/** Times one maintenance phase and records its terminal outcome on the event spine. */
export async function timeMaintenancePhase<T extends MaintenancePhaseOutcome | void>(
  phase: MaintenancePhase,
  run: () => Promise<T>,
  { now, emit }: MaintenancePhaseTimerOptions,
): Promise<T> {
  const startedAt = now();

  try {
    const result = await run();
    await emit({
      type: 'daemon_maintenance_phase',
      phase,
      durationMs: now() - startedAt,
      outcome: result ?? 'completed',
    });
    return result;
  } catch (error) {
    await emit({
      type: 'daemon_maintenance_phase',
      phase,
      durationMs: now() - startedAt,
      outcome: 'failed',
    });
    throw error;
  }
}
