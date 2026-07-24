import type { EffortLevel, TierOverride } from '../types/config.js';
import type { ComplexityTier, StepName } from '../types/steps.js';

type ReadonlyTierOverrides = Readonly<
  Partial<
    Record<
      StepName,
      Readonly<Partial<Record<ComplexityTier, Readonly<TierOverride>>>>
    >
  >
>;

export interface ProviderModelPolicy {
  readonly stepModels: Readonly<Record<StepName, string>>;
  readonly stepEfforts: Readonly<Record<StepName, EffortLevel>>;
  readonly stepTierOverrides: ReadonlyTierOverrides;
  readonly effortOrder: readonly EffortLevel[];
  readonly modelEscalationOrder: readonly string[];
  readonly modelFallbackLadder: readonly string[];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

const CLAUDE_STEP_MODELS: Record<StepName, string> = {
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

const CODEX_STEP_MODELS: Record<StepName, string> = {
  bootstrap: 'gpt-5.6-terra',
  memory: 'gpt-5.6-luna',
  assess: 'gpt-5.6-terra',
  explore: 'gpt-5.6-sol',
  prd: 'gpt-5.6-sol',
  complexity: 'gpt-5.6-terra',
  stories: 'gpt-5.6-terra',
  conflict_check: 'gpt-5.6-terra',
  plan: 'gpt-5.6-terra',
  architecture_diagram: 'gpt-5.6-terra',
  architecture_review: 'gpt-5.6-sol',
  worktree: 'gpt-5.6-luna',
  acceptance_specs: 'gpt-5.6-terra',
  build: 'gpt-5.6-terra',
  build_review: 'gpt-5.6-sol',
  wiring_check: 'gpt-5.6-terra',
  manual_test: 'gpt-5.6-terra',
  prd_audit: 'gpt-5.6-sol',
  architecture_review_as_built: 'gpt-5.6-terra',
  retro: 'gpt-5.6-terra',
  rebase: 'gpt-5.6-sol',
  finish: 'gpt-5.6-luna',
  remediate: 'gpt-5.6-sol',
  attribution_verify: 'gpt-5.6-sol',
};

const STEP_EFFORTS: Record<StepName, EffortLevel> = {
  bootstrap: 'low',
  memory: 'low',
  assess: 'high',
  explore: 'high',
  prd: 'high',
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

const COMMON_TIER_OVERRIDES: ReadonlyTierOverrides = {
  stories: {
    S: { effort: 'low' },
    L: { effort: 'high' },
  },
  explore: {
    S: { effort: 'low' },
  },
  plan: {
    S: { effort: 'medium', max_retries: 3 },
  },
  build: {
    S: { max_retries: 3 },
  },
};

export const CLAUDE_MODEL_POLICY: ProviderModelPolicy = deepFreeze({
  stepModels: CLAUDE_STEP_MODELS,
  stepEfforts: STEP_EFFORTS,
  stepTierOverrides: {
    ...COMMON_TIER_OVERRIDES,
    plan: {
      ...COMMON_TIER_OVERRIDES.plan,
      L: { effort: 'xhigh', model: 'fable' },
    },
    conflict_check: { L: { model: 'fable' } },
  },
  effortOrder: ['low', 'medium', 'high', 'xhigh', 'max'],
  modelEscalationOrder: ['haiku', 'sonnet', 'opus', 'fable'],
  modelFallbackLadder: ['fable', 'opus', 'sonnet'],
});

export const CODEX_MODEL_POLICY: ProviderModelPolicy = deepFreeze({
  stepModels: CODEX_STEP_MODELS,
  stepEfforts: STEP_EFFORTS,
  stepTierOverrides: {
    ...COMMON_TIER_OVERRIDES,
    plan: {
      ...COMMON_TIER_OVERRIDES.plan,
      L: { effort: 'xhigh', model: 'gpt-5.6-sol' },
    },
    conflict_check: { L: { model: 'gpt-5.6-sol' } },
  },
  effortOrder: ['low', 'medium', 'high', 'xhigh', 'max'],
  modelEscalationOrder: ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'],
  modelFallbackLadder: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
});
