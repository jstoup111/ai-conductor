import type {
  SpawnPermit,
  SpawnPermitDecision,
  SpawnPermitPurpose,
} from './llm-provider.js';

/** Evaluate lifecycle-owned spawn authority immediately before process creation. */
export function validateSpawnPermit(
  permit: SpawnPermit | undefined,
  purpose?: SpawnPermitPurpose,
): SpawnPermitDecision {
  return permit?.(purpose) ?? { permitted: true };
}
