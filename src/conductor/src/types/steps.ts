export type StepName =
  | 'bootstrap'
  | 'memory'
  | 'assess'
  | 'brainstorm'
  | 'complexity'
  | 'stories'
  | 'conflict_check'
  | 'plan'
  | 'architecture_diagram'
  | 'architecture_review'
  | 'worktree'
  | 'acceptance_specs'
  | 'build'
  | 'manual_test'
  | 'prd_audit'
  | 'architecture_review_as_built'
  | 'retro'
  | 'rebase'
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
  /**
   * This step participates in the gate-driven tail loop (build…finish): its
   * objective verdict is recomputed after it runs and the selector may route
   * to/over it. The conductor derives the loop region and the front/loop
   * boundary from this flag, so a custom config step inserted among the loop
   * steps joins the loop. Built-ins: build, manual_test, retro, finish.
   */
  loopGate?: boolean;
  /**
   * This upstream gate can be re-opened by a downstream kickback (build /
   * manual_test writing `{satisfied:false, kickback.from}`). The conductor
   * derives KICKBACK_TARGETS + the selector's region start from this flag.
   * Built-ins: stories, plan.
   */
  kickbackTarget?: boolean;
}
