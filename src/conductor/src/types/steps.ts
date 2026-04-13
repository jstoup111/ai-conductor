export type StepName =
  | 'worktree'
  | 'memory'
  | 'brainstorm'
  | 'complexity'
  | 'stories'
  | 'conflict_check'
  | 'plan'
  | 'architecture_diagram'
  | 'architecture_review'
  | 'acceptance_specs'
  | 'build'
  | 'manual_test'
  | 'retro'
  | 'finish';

export type StepStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped' | 'stale';

export type Phase = 'SETUP' | 'UNDERSTAND' | 'DECIDE' | 'BUILD' | 'SHIP';

export type ComplexityTier = 'S' | 'M' | 'L';

export type EnforcementLevel = 'advisory' | 'gating' | 'structural' | 'mechanical';

export type RunMode = 'default' | 'auto' | 'interactive';

export type ViewMode = 'dashboard' | 'output';

export interface StepDefinition {
  name: StepName;
  label: string;
  phase: Phase;
  enforcement: EnforcementLevel;
  prerequisites: StepName[];
  skippableForTiers: ComplexityTier[];
  isCheckpoint: boolean;
  skillName?: string;
}
