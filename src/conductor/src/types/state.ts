import type { StepName, StepStatus, ComplexityTier } from './steps.js';

/**
 * Matches the flat JSON structure of conduct-state.json.
 * Step names are keys with StepStatus values. Metadata keys are mixed in.
 * This flat structure is required for backward compatibility with the bash conductor.
 */
export type ConductState = {
  [K in StepName]?: StepStatus;
} & {
  feature_desc?: string;
  complexity_tier?: ComplexityTier;
  run_started_at?: number;
  last_step?: StepName;
  pr_url?: string;
  worktree_dir?: string;
  worktree_branch?: string;
  feature_status?: 'complete';
  // Project-level state preserved across features
  bootstrap?: StepStatus;
  assess?: StepStatus;
};

export interface TaskStatus {
  status: 'pending' | 'in_progress' | 'completed';
}

export type TaskStatusFile = Record<string, TaskStatus>;

export type StateError = {
  type: 'corrupted' | 'missing' | 'io_error';
  message: string;
};

export type StateResult<T> = { ok: true; value: T } | { ok: false; error: StateError };
