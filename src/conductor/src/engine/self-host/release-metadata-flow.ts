/** The self-host release-metadata flow's configured state. */
import type { HarnessConfig } from '../../types/config.js';

export type ReleaseMetadataFlow = 'inactive' | 'active' | 'step-missing';

/** Inputs supplied by the existing self-build detector and resolved config. */
export interface ReleaseMetadataFlowInput {
  readonly isSelfBuild: boolean;
  readonly releaseArtifactGateEnabled: boolean;
  readonly steps?: HarnessConfig['steps'];
}

/**
 * Activates release metadata handling only for this repository's declared
 * self-host flow. Step identity is its configured name, not its skill location.
 */
export function resolveReleaseMetadataFlow(input: ReleaseMetadataFlowInput): ReleaseMetadataFlow {
  if (!input.isSelfBuild || !input.releaseArtifactGateEnabled) return 'inactive';
  return Object.prototype.hasOwnProperty.call(input.steps, 'release-disposition')
    ? 'active'
    : 'step-missing';
}
