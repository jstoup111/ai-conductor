import type {
  ConductorEvent,
  MaintenancePhaseOutcome,
} from '../types/events.js';

type MaintenancePhaseEvent = Extract<ConductorEvent, { type: 'daemon_maintenance_phase' }>;
export type MaintenancePhaseInput = MaintenancePhaseEvent extends infer Event
  ? Event extends MaintenancePhaseEvent
    ? Omit<Event, 'type' | 'durationMs' | 'outcome'>
    : never
  : never;

export interface MaintenancePhaseTimerOptions {
  readonly now: () => number;
  readonly emit: (event: MaintenancePhaseEvent) => void | Promise<void>;
}

/** Times one maintenance phase and records its terminal outcome on the event spine. */
export async function timeMaintenancePhase<T extends MaintenancePhaseOutcome | void, P extends MaintenancePhaseInput>(
  phase: P,
  run: () => Promise<T>,
  { now, emit }: MaintenancePhaseTimerOptions,
): Promise<T> {
  const startedAt = now();

  try {
    const result = await run();
    await emit({
      type: 'daemon_maintenance_phase',
      ...phase,
      durationMs: now() - startedAt,
      outcome: result ?? 'completed',
    } as MaintenancePhaseEvent);
    return result;
  } catch (error) {
    await emit({
      type: 'daemon_maintenance_phase',
      ...phase,
      durationMs: now() - startedAt,
      outcome: 'failed',
    } as MaintenancePhaseEvent);
    throw error;
  }
}
