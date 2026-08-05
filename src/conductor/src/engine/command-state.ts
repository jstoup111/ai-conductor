import type { ConductState, StepName } from '../types/index.js';
import type { ConductStateStore, StateMutation } from './conduct-state-store.js';
import { createFilesystemConductStateStore } from './filesystem-conduct-state-store.js';
import {
  applyStateCorrection,
  replaceState,
  requireStateMutation,
} from './state.js';

/** Clear every feature-state field only for an explicit reset/start-over choice. */
export async function replaceCommandState(
  stateFilePath: string,
  intent: 'reset conductor state' | 'start over conductor state',
  store: ConductStateStore<ConductState> = createFilesystemConductStateStore(stateFilePath),
): Promise<void> {
  requireStateMutation(await replaceState(stateFilePath, {}, intent, store), intent);
}

/** Atomically clear a verified-incomplete completion marker and restage failed steps. */
export async function recoverCommandState(
  stateFilePath: string,
  observedState: ConductState,
  failedSteps: readonly StepName[],
  store: ConductStateStore<ConductState> = createFilesystemConductStateStore(stateFilePath),
): Promise<void> {
  const corrections = failedSteps.map((step) => ({
    field: step,
    expected: observedState[step],
    intent: 'restage failed verification step',
    next: 'pending',
  } as StateMutation<ConductState>));
  requireStateMutation(
    await applyStateCorrection(
      stateFilePath,
      {
        name: 'recover incomplete feature state',
        deletions: [{
          field: 'feature_status',
          expected: observedState.feature_status,
          intent: 'clear incomplete feature completion',
        }],
        mutations: corrections,
        privileged: true,
      },
      store,
    ),
    'Feature recovery state update',
  );
}
