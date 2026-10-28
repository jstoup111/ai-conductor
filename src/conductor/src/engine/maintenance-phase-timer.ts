import type {
  ConductorEvent,
  MaintenancePhase,
} from '../types/events.js';

type MaintenancePhaseEvent = Extract<ConductorEvent, { type: 'daemon_maintenance_phase' }>;
/** The event variant that owns `Phase`, and with it that phase's outcome and summary vocabulary. */
type PhaseEvent<Phase extends MaintenancePhase> = MaintenancePhaseEvent extends infer Event
  ? Event extends { phase: infer Owned } ? Phase extends Owned ? Event : never : never
  : never;
export type MaintenancePhaseResult<Phase extends MaintenancePhase> = Pick<PhaseEvent<Phase>, 'outcome' | 'summary'>;
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
export async function timeMaintenancePhase<P extends MaintenancePhaseInput, T extends PhaseEvent<P['phase']>['outcome'] | MaintenancePhaseResult<P['phase']> | void>(
  phase: P,
  run: () => Promise<T>,
  { now, emit }: MaintenancePhaseTimerOptions,
): Promise<T> {
  const startedAt = now();

  try {
    const result = await run();
    const resultFields = typeof result === 'object' && result !== null ? result : {};
    await emit({
      type: 'daemon_maintenance_phase',
      ...phase,
      ...resultFields,
      durationMs: now() - startedAt,
      outcome: typeof result === 'string' ? result : result?.outcome ?? 'completed',
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
