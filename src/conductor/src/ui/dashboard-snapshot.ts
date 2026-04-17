import type {
  ConductState,
  StepDefinition,
  StepStatus,
  StepName,
} from '../types/index.js';
import type { ArtifactPatternStatus } from '../engine/artifacts.js';
import type { DashboardSnapshot, StepSnapshot } from './types.js';

export type ArtifactsByStep = Partial<Record<StepName, ArtifactPatternStatus[]>>;

export function buildDashboardSnapshot(
  state: ConductState,
  steps: StepDefinition[],
  featureName?: string,
  artifacts?: ArtifactsByStep,
): DashboardSnapshot {
  const stepSnapshots: StepSnapshot[] = steps.map((step) => {
    const status: StepStatus = (state[step.name] as StepStatus) ?? 'pending';
    const stepArtifacts = artifacts?.[step.name];
    const snap: StepSnapshot = {
      name: step.name,
      label: step.label,
      phase: step.phase,
      status,
    };
    if (stepArtifacts && hasAttempted(status)) {
      snap.artifacts = stepArtifacts;
    }
    return snap;
  });

  return {
    featureName,
    complexityTier: state.complexity_tier,
    steps: stepSnapshots,
  };
}

function hasAttempted(status: StepStatus): boolean {
  return (
    status === 'done' ||
    status === 'failed' ||
    status === 'stale' ||
    status === 'in_progress'
  );
}
