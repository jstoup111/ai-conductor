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
// ────────────────────────────────────────────────────────────────────────────

export const DEFAULT_STEP_MODELS: Record<StepName, string> = {
  bootstrap: 'sonnet',     // authors the project CLAUDE.md every later step depends on
  memory: 'haiku',
  assess: 'sonnet',        // dispatches 9 specialists + drives structure verification; synthesis is the opus cto-orchestrator agent
  explore: 'opus',         // divergent discovery: approach trade-offs + product/technical track classification — mistakes here cascade downstream
  prd: 'opus',             // product-only PRD authoring — reasoning-heavy
  complexity: 'sonnet',    // assigns S/M/L, which gates every downstream model/effort decision — a wrong tier cascades
  stories: 'sonnet',
  conflict_check: 'sonnet',
  plan: 'sonnet',
  architecture_diagram: 'sonnet',
  architecture_review: 'opus',
  worktree: 'haiku',
  acceptance_specs: 'sonnet',
  build: 'haiku',
  manual_test: 'sonnet',
  prd_audit: 'opus',       // cross-reference PRD intent vs shipped implementation
  architecture_review_as_built: 'sonnet', // pattern-match code vs approved design
  retro: 'sonnet',
  rebase: 'opus',          // gate is engine-native, but conflict RESOLUTION dispatches the rebase skill — semantic merge judgment
  finish: 'haiku',
  remediate: 'opus',       // reasons over blocking audit gaps → dispositions + tasks
};

export const DEFAULT_STEP_EFFORT: Record<StepName, EffortLevel> = {
  bootstrap: 'low',
  memory: 'low',
  assess: 'high',          // orchestrator sets env var that cascades to subagents
  explore: 'xhigh',        // divergent approach trade-offs + track classification — reasoning-heavy
  prd: 'xhigh',            // product-only PRD authoring — reasoning-heavy
  complexity: 'low',
  stories: 'medium',
  conflict_check: 'medium',
  plan: 'high',
  architecture_diagram: 'medium',
  architecture_review: 'high',
  worktree: 'low',
  acceptance_specs: 'medium',
  build: 'low',            // dispatcher; intelligence is in per-task sub-sessions
  manual_test: 'medium',
  prd_audit: 'high',       // FR-by-FR intent vs implementation reasoning
  architecture_review_as_built: 'medium',
  retro: 'medium',
  rebase: 'high',          // conflict resolution dispatch reasons over both sides of a hunk
  finish: 'low',
  remediate: 'high',       // gap reasoning + concrete task planning
};

export const DEFAULT_STEP_RETRIES: Record<StepName, number> = {
  bootstrap: 1,
  memory: 1,
  assess: 3,
  explore: 5,
  prd: 5,
  complexity: 1,
  stories: 3,
  conflict_check: 3,
  plan: 5,
  architecture_diagram: 3,
  architecture_review: 5,
  worktree: 1,
  acceptance_specs: 3,
  build: 5,
  manual_test: 3,
  prd_audit: 3,
  architecture_review_as_built: 3,
  retro: 3,
  rebase: 1,
  finish: 1,
  remediate: 3,
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
  manual_test: 'auto',
  prd_audit: 'conditional',          // marker written only when an FR is non-ALIGNED
  architecture_review_as_built: 'conditional', // marker written only on drift/BLOCKED
  retro: 'manual',
  rebase: 'auto',
  finish: 'auto',
  remediate: 'auto',       // conductor routes deterministically from remediation.json
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
    L: { effort: 'xhigh', model: 'opus' }, // task sequencing/dependency reasoning at scale needs opus
  },
  conflict_check: {
    L: { model: 'opus' }, // subtle cross-story contradictions at ≥15 stories need opus
  },
};

export const FALLBACK_MODEL = 'sonnet';
export const FALLBACK_EFFORT: EffortLevel = 'medium';
export const FALLBACK_RETRIES = 3;
export const FALLBACK_REVIEW: ReviewMode = 'manual';

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
// Self-host guardrails (adr-2026-06-30-self-host-detection-seam / TR-11)
//
// The resolved shape every guardrail site reads. Resolution is SAFE-BY-DEFAULT:
// an absent block, or any omitted field, yields auto-detection with every gate
// ENABLED. A partial config can never silently disable a guardrail.
// ────────────────────────────────────────────────────────────────────────────

export const DEFAULT_SELF_HOST_ACTIVATION: SelfHostActivation = 'auto';

/** Fully-resolved self-host guardrail settings (no optional fields). */
export interface ResolvedSelfHostConfig {
  activation: SelfHostActivation;
  skillRelinkPreflight: boolean;
  sandboxBuildEnv: boolean;
  versionApprovalGate: boolean;
  releaseArtifactGate: boolean;
}

/**
 * Resolve the `harness_self_host` block to concrete settings. Absent block or
 * omitted fields default to the safe posture (auto-detect, all gates on).
 * Validation of the raw block happens in `validateConfig`; this resolver assumes
 * a validated (or absent) block and only applies defaults.
 */
export function resolveSelfHostConfig(config?: HarnessConfig): ResolvedSelfHostConfig {
  const block = config?.harness_self_host;
  return {
    activation: block?.activation ?? DEFAULT_SELF_HOST_ACTIVATION,
    skillRelinkPreflight: block?.skill_relink_preflight ?? true,
    sandboxBuildEnv: block?.sandbox_build_env ?? true,
    versionApprovalGate: block?.version_approval_gate ?? true,
    releaseArtifactGate: block?.release_artifact_gate ?? true,
  };
}
