import { expect, it } from 'vitest';
import {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
} from '../../src/engine/provider-model-policy.js';
import type { EffortLevel } from '../../src/types/config.js';
import type { StepName } from '../../src/types/steps.js';

type Assert<T extends true> = T;
type IsExact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? (<T>() => T extends B ? 1 : 2) extends
      (<T>() => T extends A ? 1 : 2)
      ? true
      : false
    : false;

const STEP_EFFORTS = {
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
} as const satisfies Record<StepName, EffortLevel>;

const EXPECTED_POLICIES = {
  claude: {
    stepModels: {
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
    } satisfies Record<StepName, string>,
    stepEfforts: STEP_EFFORTS,
    stepTierOverrides: {
      stories: {
        S: { effort: 'low' },
        L: { effort: 'high' },
      },
      explore: {
        S: { effort: 'low' },
      },
      plan: {
        S: { effort: 'medium', max_retries: 3 },
        L: { effort: 'xhigh', model: 'fable' },
      },
      build: {
        S: { max_retries: 3 },
      },
      conflict_check: {
        L: { model: 'fable' },
      },
    },
    effortOrder: ['low', 'medium', 'high', 'xhigh', 'max'],
    modelEscalationOrder: ['haiku', 'sonnet', 'opus', 'fable'],
    modelFallbackLadder: ['fable', 'opus', 'sonnet'],
  },
  codex: {
    stepModels: {
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
    } satisfies Record<StepName, string>,
    stepEfforts: STEP_EFFORTS,
    stepTierOverrides: {
      stories: {
        S: { effort: 'low' },
        L: { effort: 'high' },
      },
      explore: {
        S: { effort: 'low' },
      },
      plan: {
        S: { effort: 'medium', max_retries: 3 },
        L: { effort: 'xhigh', model: 'gpt-5.6-sol' },
      },
      build: {
        S: { max_retries: 3 },
      },
      conflict_check: {
        L: { model: 'gpt-5.6-sol' },
      },
    },
    effortOrder: ['low', 'medium', 'high', 'xhigh', 'max'],
    modelEscalationOrder: ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'],
    modelFallbackLadder: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
  },
} as const;

function isDeeplyFrozen(value: unknown, seen = new Set<object>()): boolean {
  if (
    value === null ||
    (typeof value !== 'object' && typeof value !== 'function')
  ) {
    return true;
  }

  const object = value as object;
  if (seen.has(object)) return true;
  seen.add(object);

  return (
    Object.isFrozen(object) &&
    Reflect.ownKeys(object).every((key) =>
      isDeeplyFrozen(Reflect.get(object, key), seen),
    )
  );
}

it('defines exhaustive, provider-native, deeply frozen built-in model policies', () => {
  const claude = CLAUDE_MODEL_POLICY;
  const codex = CODEX_MODEL_POLICY;

  type _ClaudeModelKeysAreExactlyStepName = Assert<
    IsExact<keyof typeof claude.stepModels, StepName>
  >;
  type _ClaudeModelsAreAReadonlyRecord = Assert<
    typeof claude.stepModels extends Readonly<Record<StepName, string>>
      ? true
      : false
  >;
  type _ClaudeEffortKeysAreExactlyStepName = Assert<
    IsExact<keyof typeof claude.stepEfforts, StepName>
  >;
  type _ClaudeEffortsAreAReadonlyRecord = Assert<
    typeof claude.stepEfforts extends Readonly<Record<StepName, EffortLevel>>
      ? true
      : false
  >;
  type _CodexModelKeysAreExactlyStepName = Assert<
    IsExact<keyof typeof codex.stepModels, StepName>
  >;
  type _CodexModelsAreAReadonlyRecord = Assert<
    typeof codex.stepModels extends Readonly<Record<StepName, string>>
      ? true
      : false
  >;
  type _CodexEffortKeysAreExactlyStepName = Assert<
    IsExact<keyof typeof codex.stepEfforts, StepName>
  >;
  type _CodexEffortsAreAReadonlyRecord = Assert<
    typeof codex.stepEfforts extends Readonly<Record<StepName, EffortLevel>>
      ? true
      : false
  >;

  expect({
    policies: { claude, codex },
    deeplyFrozen: {
      claude: isDeeplyFrozen(claude),
      codex: isDeeplyFrozen(codex),
    },
  }).toEqual({
    policies: EXPECTED_POLICIES,
    deeplyFrozen: {
      claude: true,
      codex: true,
    },
  });
});
