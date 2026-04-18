import type { StepName, StepStatus, ComplexityTier } from './steps.js';

/**
 * Mode detected by the bootstrap skill when it first runs in a project.
 * Persisted to state so downstream steps (notably `assess`) can branch on
 * whether the project has a real codebase worth evaluating.
 *
 * - `new`            — empty directory at bootstrap time; bootstrap scaffolds
 *                      the project itself. Nothing to assess. Conductor skips
 *                      `assess` for this mode.
 * - `fresh`          — project code exists but no harness artifacts were
 *                      present. Assess runs normally.
 * - `partial`        — harness artifacts partially present (interrupted
 *                      bootstrap). Assess runs.
 * - `re-bootstrap`   — harness fully installed; bootstrap is refreshing
 *                      detection only. Assess runs.
 */
export type BootstrapMode = 'new' | 'fresh' | 'partial' | 're-bootstrap';

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
  bootstrap_mode?: BootstrapMode;
  run_started_at?: number;
  last_step?: StepName;
  pr_url?: string;
  worktree_dir?: string;
  worktree_branch?: string;
  feature_status?: 'complete';
  /**
   * Per-file approval records keyed by the artifact's absolute path (or a
   * stable relative path from projectRoot — implementation decides). The sha256
   * is recomputed on each review pass; unchanged files skip re-prompting.
   */
  artifact_approvals?: Record<string, ArtifactApproval>;
  // Project-level state preserved across features
  bootstrap?: StepStatus;
  assess?: StepStatus;
};

export interface ArtifactApproval {
  sha256: string;
  approved_at: string;
}

export interface TaskStatus {
  status: 'pending' | 'in_progress' | 'completed';
}

export type TaskStatusFile = Record<string, TaskStatus>;

export type StateError = {
  type: 'corrupted' | 'missing' | 'io_error';
  message: string;
};

export type StateResult<T> = { ok: true; value: T } | { ok: false; error: StateError };
