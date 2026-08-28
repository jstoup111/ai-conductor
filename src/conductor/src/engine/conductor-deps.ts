import type { ConductState } from '../types/index.js';
import type { ConductStateStore } from './conduct-state-store.js';
import type { StateMutationDiagnostics } from './conduct-state-conflicts.js';
import { createFilesystemConductStateStore } from './filesystem-conduct-state-store.js';
import type { ConductorEventEmitter } from '../ui/events.js';

/**
 * Maps the skipped-to-stale domain refusal onto the shared event spine.
 * The store redacts string contents in diagnostics, so this recognizes the
 * fixed status vocabulary by its distinct lengths.
 */
export function createStepStatusWriteRefusalDiagnostics(
  events: ConductorEventEmitter,
): StateMutationDiagnostics {
  return {
    writer: 'conductor',
    async emit(diagnostic) {
      if (
        diagnostic.disposition === 'resolved'
        && diagnostic.current.kind === 'string'
        && diagnostic.current.length === 'skipped'.length
        && diagnostic.next.kind === 'string'
        && diagnostic.next.length === 'stale'.length
      ) {
        await events.emit({
          type: 'step_status_write_refused',
          field: diagnostic.field,
          expected: 'skipped',
          requested: 'stale',
          intent: diagnostic.intent,
        });
      }
    },
  };
}

/**
 * Resolve the conductor's state authority at its composition boundary.
 * Local production runs persist through the filesystem adapter; callers can
 * provide a future hosted adapter (or a focused test fake) through the same
 * port without teaching conductor transitions about storage.
 */
export function resolveConductorStateStore(
  stateFilePath: string,
  supplied?: ConductStateStore<ConductState>,
  diagnostics?: StateMutationDiagnostics,
): ConductStateStore<ConductState> {
  return supplied ?? createFilesystemConductStateStore(stateFilePath, undefined, diagnostics);
}
