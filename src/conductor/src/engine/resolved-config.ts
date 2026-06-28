import type { StepName, Phase, ComplexityTier } from '../types/index.js';
import type {
  HarnessConfig,
  EffortLevel,
  ReviewMode,
  StepConfig,
  PhaseConfig,
  TierOverride,
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
  bootstrap: 'haiku',
  memory: 'haiku',
  assess: 'haiku',
  brainstorm: 'opus',
  complexity: 'haiku',
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
  rebase: 'haiku',         // engine-native; no Claude dispatch (mirrors complexity)
  finish: 'haiku',
  remediate: 'opus',       // reasons over blocking audit gaps → dispositions + tasks
};

export const DEFAULT_STEP_EFFORT: Record<StepName, EffortLevel> = {
  bootstrap: 'low',
  memory: 'low',
  assess: 'high',          // orchestrator sets env var that cascades to subagents
  brainstorm: 'xhigh',     // design exploration — reasoning-heavy
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
  rebase: 'low',           // deterministic git work, no reasoning
  finish: 'low',
  remediate: 'high',       // gap reasoning + concrete task planning
};

export const DEFAULT_STEP_RETRIES: Record<StepName, number> = {
  bootstrap: 1,
  memory: 1,
  assess: 3,
  brainstorm: 5,
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
  brainstorm: 'manual',
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
    L: { effort: 'xhigh' },
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
