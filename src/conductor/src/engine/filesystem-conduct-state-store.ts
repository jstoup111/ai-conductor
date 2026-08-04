import { readState, writeState } from './state.js';
import type { ConductState, StateResult } from '../types/state.js';
import type { StateMutation, StateMutationResult } from './conduct-state-store.js';

/**
 * Persistence seam for the adapter's accepted state snapshots. Later tasks
 * own atomic replacement and local-process serialization behind this boundary.
 */
export interface ConductStatePersistence {
  write(path: string, state: ConductState): Promise<void>;
}

export interface FilesystemConductStateStore {
  read(): Promise<StateResult<ConductState>>;
  apply(mutation: StateMutation<ConductState>): Promise<StateMutationResult>;
}

const defaultPersistence: ConductStatePersistence = {
  write: writeState,
};

/**
 * Creates the local persistent adapter for the backwards-compatible flat
 * conduct-state JSON file. Every mutation reads the current state immediately
 * before applying its one owned field, so a stale caller snapshot cannot be
 * persisted as a whole-object replacement.
 */
export function createFilesystemConductStateStore(
  path: string,
  persistence: ConductStatePersistence = defaultPersistence,
): FilesystemConductStateStore {
  return {
    read(): Promise<StateResult<ConductState>> {
      return readState(path);
    },

    async apply(mutation: StateMutation<ConductState>): Promise<StateMutationResult> {
      const current = await readState(path);
      if (!current.ok) {
        return { kind: 'persistence', message: current.error.message };
      }

      const state = current.value;
      const currentValue = (state as Record<string, unknown>)[mutation.field];
      if (!Object.is(currentValue, mutation.expected)) {
        return {
          kind: 'conflict',
          message: `Expected ${mutation.field} to match before ${mutation.intent}`,
        };
      }

      const nextState: ConductState = {
        ...state,
        [mutation.field]: mutation.next,
      };
      try {
        await persistence.write(path, nextState);
      } catch (error) {
        return { kind: 'persistence', message: `Failed to persist state: ${error}` };
      }
      return { kind: 'applied' };
    },
  };
}
