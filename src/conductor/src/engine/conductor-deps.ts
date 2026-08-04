import type { ConductState } from '../types/index.js';
import type { ConductStateStore } from './conduct-state-store.js';
import { createFilesystemConductStateStore } from './filesystem-conduct-state-store.js';

/**
 * Resolve the conductor's state authority at its composition boundary.
 * Local production runs persist through the filesystem adapter; callers can
 * provide a future hosted adapter (or a focused test fake) through the same
 * port without teaching conductor transitions about storage.
 */
export function resolveConductorStateStore(
  stateFilePath: string,
  supplied?: ConductStateStore<ConductState>,
): ConductStateStore<ConductState> {
  return supplied ?? createFilesystemConductStateStore(stateFilePath);
}
