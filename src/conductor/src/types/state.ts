import type { StepName, StepStatus, ComplexityTier, Track } from './steps.js';

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
  /**
   * Work track decided in `explore` (adr-2026-06-29-explore-prd-split-track-in-explore/adr-2026-06-29-track-marker-location). `product` features author a
   * PRD; `technical` features skip the `prd` step (and `prd-audit` at SHIP). A
   * missing track defaults to `product` (back-compat: pre-track specs are PRDs).
   */
  track?: Track;
  bootstrap_mode?: BootstrapMode;
  run_started_at?: number;
  /**
   * Epoch ms of the most recent `Conductor.run()` invocation. Set on every
   * entry to `run()` so SHIP-phase completion gates can compare artifact
   * mtimes against the current session's start and reject anything left
   * over from a previous run. Old state files without this field are
   * tolerated (gates fail open when undefined).
   */
  session_started_at?: number;
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
  /**
   * Set when a `build` step's retry budget exhausts but at least one attempt
   * moved HEAD (real, unattributed commits landed even though no plan task
   * row was ever explicitly resolved) — the engine routes this case through
   * the normal success/completion seam into `build_review` instead of
   * HALTing, and records why here so an operator (or a later coherence
   * check) can see which plan task ids were left unresolved. Not written on
   * ordinary success or ordinary HALT; absent means "did not apply."
   */
  build_routed_reason?: string;
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

/** A single field change with the writer's compare-and-set intent. */
export type StateMutation<State extends object> = {
  [Field in Extract<keyof State, string>]: {
    field: Field;
    expected: State[Field];
    intent: string;
    next: Exclude<State[Field], undefined>;
  };
}[Extract<keyof State, string>];

/** A named invariant whose field changes must either all apply or none do. */
export interface NamedAtomicStateMutationBatch<State extends object> {
  name: string;
  mutations: readonly StateMutation<State>[];
}

/** Explicit authority for deliberate whole-state replacement such as reset. */
export interface PrivilegedStateReplacement<State extends object> {
  intent: string;
  next: State;
  privileged: true;
}

/** Explicit deletion authority for a named, bounded corrective batch. */
export type StateFieldDeletion<State extends object> = {
  [Field in Extract<keyof State, string>]: {
    field: Field;
    expected: State[Field];
    intent: string;
  };
}[Extract<keyof State, string>];

/** Atomically combines explicit field deletion with normal field mutations. */
export interface PrivilegedStateCorrection<State extends object> {
  name: string;
  deletions: readonly StateFieldDeletion<State>[];
  mutations: readonly StateMutation<State>[];
  privileged: true;
}

export type StateMutationOutcome =
  | { kind: 'applied' }
  | { kind: 'idempotent' }
  | { kind: 'resolved' };

export type ConductStateStoreError =
  | { kind: 'conflict'; message: string }
  | { kind: 'lease'; message: string }
  | { kind: 'persistence'; message: string };

export type StateMutationResult = StateMutationOutcome | ConductStateStoreError;
