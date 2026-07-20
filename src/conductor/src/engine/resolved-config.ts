import { homedir } from 'os';
import type { StepName, Phase, ComplexityTier } from '../types/index.js';
import type {
  HarnessConfig,
  EffortLevel,
  ReviewMode,
  StepConfig,
  PhaseConfig,
  TierOverride,
  SelfHostActivation,
} from '../types/config.js';
import { getStepDefinition } from './steps.js';

// ────────────────────────────────────────────────────────────────────────────
// Built-in defaults
//
// These apply when nothing is set in config. The effort values map to Claude's
// native `/effort` levels and are passed via CLAUDE_CODE_EFFORT_LEVEL env var
// on the subprocess. Reviews default per step. Tune per step/phase in YAML.
//
// Rationale for each step's model/effort choice lives in `STEP_RATIONALE`
// (./model-table-metadata.ts), which also feeds the generated HARNESS.md
// model-selection table. Keep these value maps and that metadata in sync.
// ────────────────────────────────────────────────────────────────────────────

export const DEFAULT_STEP_MODELS: Record<StepName, string> = {
  bootstrap: 'sonnet',
  memory: 'haiku',
  assess: 'sonnet',
  explore: 'fable',
  prd: 'fable',
  complexity: 'sonnet',
  stories: 'sonnet',
  conflict_check: 'sonnet',
  plan: 'sonnet',
  architecture_diagram: 'sonnet',
  architecture_review: 'fable',
  worktree: 'haiku',
  acceptance_specs: 'sonnet',
  build: 'sonnet',
  build_review: 'opus',
  wiring_check: 'sonnet',
  manual_test: 'sonnet',
  prd_audit: 'opus',
  architecture_review_as_built: 'sonnet',
  retro: 'sonnet',
  rebase: 'fable',
  finish: 'haiku',
  remediate: 'fable',
  attribution_verify: 'opus',
};

export const DEFAULT_STEP_EFFORT: Record<StepName, EffortLevel> = {
  bootstrap: 'low',
  memory: 'low',
  assess: 'high',
  explore: 'medium',
  prd: 'medium',
  complexity: 'low',
  stories: 'medium',
  conflict_check: 'medium',
  plan: 'high',
  architecture_diagram: 'medium',
  architecture_review: 'high',
  worktree: 'low',
  acceptance_specs: 'medium',
  build: 'low',
  build_review: 'high',
  wiring_check: 'low',
  manual_test: 'medium',
  prd_audit: 'high',
  architecture_review_as_built: 'medium',
  retro: 'medium',
  rebase: 'max',
  finish: 'low',
  remediate: 'high',
  attribution_verify: 'high',
};

export const DEFAULT_STEP_RETRIES: Record<StepName, number> = {
  bootstrap: 1,
  memory: 1,
  assess: 3,
  // #188 retry-as-escalation: deep steps dropped 5 → 3. A retry now escalates
  // (effort, then model tier) instead of repeating an identical coin-flip, so
  // five identical retries are wasteful. Floored at 3, not 2 — the model-bump
  // rung lives at attempt 3, so a budget of 2 would truncate the ladder before
  // it ever exercises the model bump (adr Decision 4).
  explore: 3,
  prd: 3,
  complexity: 1,
  stories: 3,
  conflict_check: 3,
  plan: 3,
  architecture_diagram: 3,
  architecture_review: 5,
  worktree: 1,
  acceptance_specs: 3,
  build: 3,
  build_review: 3,
  wiring_check: 3,
  manual_test: 3,
  prd_audit: 3,
  architecture_review_as_built: 3,
  retro: 3,
  rebase: 1,
  finish: 1,
  remediate: 3,
  attribution_verify: 3,
};

export const DEFAULT_STEP_REVIEW: Record<StepName, ReviewMode> = {
  bootstrap: 'auto',
  memory: 'auto',
  assess: 'manual',
  explore: 'manual',
  prd: 'manual',
  complexity: 'auto',
  stories: 'manual',
  conflict_check: 'conditional',
  plan: 'manual',
  architecture_diagram: 'auto',
  architecture_review: 'conditional',
  worktree: 'auto',
  acceptance_specs: 'auto',
  build: 'auto',
  build_review: 'conditional', // marker written only on FAIL verdict (kickback)
  wiring_check: 'auto', // deterministic gap-carrying evidence file, no LLM verdict to review
  manual_test: 'auto',
  prd_audit: 'conditional',          // marker written only when an FR is non-ALIGNED
  architecture_review_as_built: 'conditional', // marker written only on drift/BLOCKED
  retro: 'manual',
  rebase: 'auto',
  finish: 'auto',
  remediate: 'auto',       // conductor routes deterministically from remediation.json
  attribution_verify: 'auto', // automated verification of commit attribution metadata
};

/**
 * Per-step complexity-tier overrides. Applied on top of step config at
 * resolve time when `state.complexity_tier` matches. Only listed steps are
 * tier-aware; everything else ignores the tier.
 */
export const DEFAULT_STEP_TIER_OVERRIDES: Partial<
  Record<StepName, Partial<Record<ComplexityTier, TierOverride>>>
> = {
  stories: {
    S: { effort: 'low' },
    L: { effort: 'high' },
  },
  plan: {
    S: { effort: 'medium', max_retries: 3 },
    L: { effort: 'xhigh', model: 'fable' },
  },
  conflict_check: {
    L: { model: 'fable' },
  },
};

export const FALLBACK_MODEL = 'sonnet';
export const FALLBACK_EFFORT: EffortLevel = 'medium';
export const FALLBACK_RETRIES = 3;
export const FALLBACK_REVIEW: ReviewMode = 'manual';

/**
 * Default for the per-step `escalate` knob (#188). True means retries climb the
 * escalation ladder (effort, then model tier). Existing configs begin escalating
 * by default — the intended behavior change, documented as a migration note.
 */
export const DEFAULT_STEP_ESCALATE = true;

// ────────────────────────────────────────────────────────────────────────────
// Resolution
// ────────────────────────────────────────────────────────────────────────────

export interface ResolvedStepConfig {
  step: StepName;
  model: string;
  effort: EffortLevel;
  max_retries: number;
  review: ReviewMode;
  skill?: string;
  hooks: { before?: string; after?: string };
  disabled: boolean;
  /**
   * Retry-as-escalation flag (#188). When true (default), the retry loop climbs
   * the escalation ladder on each attempt; when false, every attempt uses the
   * base (model, effort).
   */
  escalate: boolean;
}

export interface ResolveOptions {
  /** CLI `--model` override. Beats every other source. */
  modelCliOverride?: string;
  /** CLI `--effort` override. Beats every other source. */
  effortCliOverride?: EffortLevel;
  /**
   * Current feature tier. Applied as `by_tier[tier]` overrides on top of
   * step/phase/default resolution.
   */
  tier?: ComplexityTier;
}

/**
 * Resolve every knob for a step.
 *
 * Precedence per field (highest wins):
 *   1. CLI override (model, effort only)
 *   2. steps.<name>.by_tier.<tier>           (when tier matches)
 *   3. steps.<name>
 *   4. phases.<PHASE>.by_tier.<tier>
 *   5. phases.<PHASE>
 *   6. defaults
 *   7. Hardcoded built-in (DEFAULT_STEP_*)
 *   8. Fallback
 */
export function resolveStepConfig(
  step: StepName,
  phase: Phase,
  config?: HarnessConfig,
  options: ResolveOptions = {},
): ResolvedStepConfig {
  const stepCfg: StepConfig | undefined = config?.steps?.[step];
  const phaseCfg: PhaseConfig | undefined = config?.phases?.[phase];
  const defaultsCfg = config?.defaults;
  const tier = options.tier;

  // Tier-specific overrides from user config (step and phase)
  const stepTier = tier ? stepCfg?.by_tier?.[tier] : undefined;
  const phaseTier = tier ? phaseCfg?.by_tier?.[tier] : undefined;

  // Tier-specific overrides from hardcoded built-ins
  const hardcodedStepTier = tier
    ? DEFAULT_STEP_TIER_OVERRIDES[step]?.[tier]
    : undefined;

  const model =
    options.modelCliOverride ??
    stepTier?.model ??
    stepCfg?.model ??
    phaseTier?.model ??
    phaseCfg?.model ??
    defaultsCfg?.model ??
    hardcodedStepTier?.model ??
    DEFAULT_STEP_MODELS[step] ??
    FALLBACK_MODEL;

  const effort: EffortLevel =
    options.effortCliOverride ??
    stepTier?.effort ??
    stepCfg?.effort ??
    phaseTier?.effort ??
    phaseCfg?.effort ??
    defaultsCfg?.effort ??
    hardcodedStepTier?.effort ??
    DEFAULT_STEP_EFFORT[step] ??
    FALLBACK_EFFORT;

  const max_retries =
    stepTier?.max_retries ??
    stepCfg?.max_retries ??
    phaseTier?.max_retries ??
    phaseCfg?.max_retries ??
    defaultsCfg?.max_retries ??
    hardcodedStepTier?.max_retries ??
    DEFAULT_STEP_RETRIES[step] ??
    FALLBACK_RETRIES;

  // Review mode is fixed per step (not user-configurable) — it's a property
  // of the step's skill contract, not a tuning knob.
  const review: ReviewMode = DEFAULT_STEP_REVIEW[step] ?? FALLBACK_REVIEW;

  // #188: escalate follows the same step → phase → defaults precedence as the
  // other knobs (no tier/CLI override — it's a coarse per-step policy switch),
  // defaulting to DEFAULT_STEP_ESCALATE (true) when unset everywhere.
  const escalate: boolean =
    stepCfg?.escalate ??
    phaseCfg?.escalate ??
    defaultsCfg?.escalate ??
    DEFAULT_STEP_ESCALATE;

  return {
    step,
    model,
    effort,
    max_retries,
    review,
    skill: stepCfg?.skill,
    hooks: {
      before: stepCfg?.hooks?.before,
      after: stepCfg?.hooks?.after,
    },
    disabled: stepCfg?.disable === true,
    escalate,
  };
}

/**
 * Look up a step's phase from the registry. Delegates to `getStepDefinition`
 * so it resolves out-of-band steps (e.g. `remediate`) too — those are
 * dispatchable but absent from the linear `ALL_STEPS` sequence. A genuinely
 * unknown step still throws.
 */
export function phaseForStep(step: StepName): Phase {
  return getStepDefinition(step).phase;
}

// ────────────────────────────────────────────────────────────────────────────
// Rebase resolution attempt cap
// ────────────────────────────────────────────────────────────────────────────

/**
 * Default maximum number of Claude-assisted conflict-resolution attempts
 * inside the rebase step. Overridable via `rebase_resolution_attempts` in
 * the top-level HarnessConfig. 0 is valid (disables auto-resolution).
 * Negative or non-numeric values fall back to this default.
 */
export const DEFAULT_REBASE_RESOLUTION_ATTEMPTS = 3;

/**
 * Resolve the rebase-resolution attempt cap from HarnessConfig.
 *
 * Reads `config.rebase_resolution_attempts` (top-level HarnessConfig key).
 *
 * Resolution rules:
 *   - undefined / absent → DEFAULT_REBASE_RESOLUTION_ATTEMPTS (3)
 *   - integer >= 0       → use the value (0 = disabled, preserved as-is)
 *   - negative integer   → DEFAULT_REBASE_RESOLUTION_ATTEMPTS (3)
 *   - NaN or non-numeric → DEFAULT_REBASE_RESOLUTION_ATTEMPTS (3)
 */
export function resolveRebaseResolutionAttempts(config?: HarnessConfig): number {
  const override = config?.rebase_resolution_attempts;
  if (override === undefined || override === null) {
    return DEFAULT_REBASE_RESOLUTION_ATTEMPTS;
  }
  if (typeof override !== 'number' || !Number.isFinite(override) || override < 0) {
    return DEFAULT_REBASE_RESOLUTION_ATTEMPTS;
  }
  return override;
}

// ────────────────────────────────────────────────────────────────────────────
// OAuth token park-and-poll timeout (TR-5)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Default timeout in minutes for OAuth token park-and-poll recovery.
 * When the daemon detects an expired operator OAuth token, it parks the build
 * and polls for token refresh. This timeout caps the polling duration.
 *
 * Configuration semantics:
 *   - 0 or negative → opt-out flag; auth failure HALTs immediately (no polling)
 *   - positive      → polling timeout in minutes
 */
export const DEFAULT_AUTH_PARK_TIMEOUT_MINUTES = 60;

/**
 * Resolve the auth park timeout from HarnessConfig.
 *
 * Reads `config.auth_park_timeout_minutes` (top-level HarnessConfig key).
 *
 * Resolution rules:
 *   - undefined / absent     → DEFAULT_AUTH_PARK_TIMEOUT_MINUTES (60)
 *   - finite number (any)    → use the value (0 and negatives signal opt-out at runtime)
 *   - non-numeric (string)   → throw with clear error message
 *   - NaN or Infinity        → throw with clear error message
 *
 * @throws Error if the value is non-numeric or non-finite (NaN, Infinity)
 */
export function resolveAuthParkTimeoutMinutes(config?: HarnessConfig): number {
  const override = config?.auth_park_timeout_minutes;
  if (override === undefined || override === null) {
    return DEFAULT_AUTH_PARK_TIMEOUT_MINUTES;
  }
  if (typeof override !== 'number') {
    throw new Error(
      `Invalid auth_park_timeout_minutes: expected a number, got ${typeof override} (${JSON.stringify(override)})`
    );
  }
  if (!Number.isFinite(override)) {
    throw new Error(
      `Invalid auth_park_timeout_minutes: must be a finite number, got ${override}`
    );
  }
  // Preserve 0 and negative values as opt-out signals; positive values are timeout in minutes
  return override;
}

// ────────────────────────────────────────────────────────────────────────────
// Self-host guardrails (adr-2026-06-30-self-host-detection-seam / TR-11)
//
// The resolved shape every guardrail site reads. Resolution is SAFE-BY-DEFAULT:
// an absent block, or any omitted field, yields auto-detection with every gate
// ENABLED. A partial config can never silently disable a guardrail.
// ────────────────────────────────────────────────────────────────────────────

export const DEFAULT_SELF_HOST_ACTIVATION: SelfHostActivation = 'auto';

/** Default daemon build authentication mode (TR-1/2/3/4). */
export const DEFAULT_BUILD_AUTH_MODE = 'daemon-token';

/**
 * Default path for daemon build-auth token file (TR-1/2/3/4).
 * Resolves to ~/.ai-conductor/build-auth at resolution time.
 */
export function getDefaultBuildAuthTokenPath(): string {
  return `${homedir()}/.ai-conductor/build-auth`;
}

/** Fully-resolved self-host guardrail settings (no optional fields). */
export interface ResolvedSelfHostConfig {
  activation: SelfHostActivation;
  skillRelinkPreflight: boolean;
  sandboxBuildEnv: boolean;
  versionApprovalGate: boolean;
  releaseArtifactGate: boolean;
  /** Declared version freeze (#261); null = no freeze (gate halts as before). */
  versionFreeze: string | null;
  /** Timeout in minutes for credentials park-and-poll (TR-2/3/4/5). */
  authParkTimeoutMinutes: number;
  /** Daemon build authentication mode (TR-1/2/3/4). Defaults to 'daemon-token'. */
  buildAuthMode: string;
  /** Expanded path to daemon build-auth token file (TR-1/2/3/4). Defaults to ~/.ai-conductor/build-auth. */
  buildAuthTokenPath: string;
}

/**
 * Expand ~ to home directory in a path string.
 * If the path starts with ~, it is replaced with the result of homedir().
 * Otherwise, the path is returned unchanged.
 */
function expandTildePath(path: string): string {
  if (path.startsWith('~')) {
    return path.replace(/^~/, homedir());
  }
  return path;
}

/**
 * Normalize a token path by trimming whitespace and expanding tilde.
 * Returns the default path if the input is empty/whitespace.
 */
function resolveTokenPath(rawPath: string | undefined): string {
  const trimmed = rawPath?.trim() || '';
  if (!trimmed) {
    return getDefaultBuildAuthTokenPath();
  }
  return expandTildePath(trimmed);
}

/**
 * Resolve the `harness_self_host` block to concrete settings. Absent block or
 * omitted fields default to the safe posture (auto-detect, all gates on).
 * Validation of the raw block happens in `validateConfig`; this resolver assumes
 * a validated (or absent) block and only applies defaults.
 */
export function resolveSelfHostConfig(config?: HarnessConfig): ResolvedSelfHostConfig {
  const block = config?.harness_self_host;
  const buildAuthBlock = block?.build_auth;

  let timeoutMinutes = block?.auth_park_timeout_minutes ?? 60;
  // Negative or non-numeric values fall back to 60
  if (!Number.isInteger(timeoutMinutes) || timeoutMinutes < 0) {
    timeoutMinutes = 60;
  }

  return {
    activation: block?.activation ?? DEFAULT_SELF_HOST_ACTIVATION,
    skillRelinkPreflight: block?.skill_relink_preflight ?? true,
    sandboxBuildEnv: block?.sandbox_build_env ?? true,
    versionApprovalGate: block?.version_approval_gate ?? true,
    releaseArtifactGate: block?.release_artifact_gate ?? true,
    // Blank/whitespace normalizes to null so a freeze can never "match" an
    // empty VERSION read — safe-by-default like every other field here.
    versionFreeze: block?.version_freeze?.trim() || null,
    authParkTimeoutMinutes: timeoutMinutes,
    // Daemon build authentication mode: explicit or default to daemon-token
    buildAuthMode: buildAuthBlock?.mode || DEFAULT_BUILD_AUTH_MODE,
    // Daemon build-auth token path: explicit, tilde-expanded, or default
    buildAuthTokenPath: resolveTokenPath(buildAuthBlock?.token_path),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Mergeable autoresolve configuration (auto-resolve merge conflicts on open PRs)
// ────────────────────────────────────────────────────────────────────────────

export const DEFAULT_MERGEABLE_AUTORESOLVE_ENABLED = false;
export const DEFAULT_MERGEABLE_AUTORESOLVE_COOLDOWN_MINUTES = 60;

/** Fully-resolved mergeable autoresolve settings (no optional fields). */
export interface ResolvedMergeableAutoresolveConfig {
  enabled: boolean;
  cooldownMinutes: number;
  suiteCommand: string | undefined;
}

/**
 * Resolve the `mergeable_autoresolve` block to concrete settings.
 * Absent block defaults to disabled (safe-by-default).
 * Validation of the raw block happens in `validateConfig`; this resolver
 * assumes a validated (or absent) block and only applies defaults.
 */
export function resolveMergeableAutoresolve(config?: HarnessConfig): ResolvedMergeableAutoresolveConfig {
  const block = config?.mergeable_autoresolve;
  return {
    enabled: block?.enabled ?? DEFAULT_MERGEABLE_AUTORESOLVE_ENABLED,
    cooldownMinutes: block?.cooldownMinutes ?? DEFAULT_MERGEABLE_AUTORESOLVE_COOLDOWN_MINUTES,
    suiteCommand: block?.suiteCommand,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// build_review configuration (opt-in judgement gate at the build → manual_test seam)
// ────────────────────────────────────────────────────────────────────────────

export const DEFAULT_BUILD_REVIEW_ENABLED = false;

/** Fully-resolved build_review settings (no optional fields). */
export interface ResolvedBuildReviewConfig {
  enabled: boolean;
}

/**
 * Resolve the `build_review` block to concrete settings.
 * Absent/malformed block defaults to disabled (safe-by-default) — mirrors
 * `resolveMergeableAutoresolve` above. Validation and warning emission for
 * malformed input happens in `validateConfig`; this resolver assumes a
 * validated (or absent) block and only applies the default.
 */
export function resolveBuildReviewConfig(config?: HarnessConfig): ResolvedBuildReviewConfig {
  const block = config?.build_review;
  return {
    enabled: block?.enabled ?? DEFAULT_BUILD_REVIEW_ENABLED,
  };
}
