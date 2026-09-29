// Covers: task:3
import { expect, it } from 'vitest';
import {
  BUILT_IN_PROVIDER_MODEL_POLICIES,
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
  COST_SELF_REPORTING_PROVIDERS,
  resolveProviderModelPolicy,
} from '../../src/engine/provider-model-policy.js';
import { BUILT_IN_PROVIDERS } from '../../src/execution/provider-catalog.js';
import type { EffortLevel } from '../../src/types/config.js';
import type { StepName } from '../../src/types/steps.js';


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
  coherence_check: 'medium',
  architecture_diagram: 'medium',
  architecture_review: 'high',
  worktree: 'low',
  coverage_binding: 'low',
  acceptance_specs: 'medium',
  build: 'medium',
  build_review: 'high',
  test_suite: 'low',
  manual_test: 'medium',
  prd_audit: 'high',
  architecture_review_as_built: 'high',
  rebase: 'high',
  finish: 'medium',
  remediate: 'medium',
  attribution_verify: 'high',
} as const satisfies Record<StepName, EffortLevel>;

const EXPECTED_POLICIES = {
  claude: {
    stepModels: {
      bootstrap: 'sonnet',
      memory: 'haiku',
      assess: 'sonnet',
      explore: 'opus',
      prd: 'opus',
      complexity: 'sonnet',
      stories: 'sonnet',
      conflict_check: 'opus',
      plan: 'opus',
      coherence_check: 'sonnet',
      architecture_diagram: 'sonnet',
      architecture_review: 'opus',
      worktree: 'haiku',
      coverage_binding: 'sonnet',
      acceptance_specs: 'opus',
      build: 'sonnet',
      build_review: 'opus',
      test_suite: 'sonnet',
      manual_test: 'sonnet',
      prd_audit: 'opus',
      architecture_review_as_built: 'opus',
      rebase: 'opus',
      finish: 'sonnet',
      remediate: 'opus',
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
      acceptance_specs: {
        L: { effort: 'high' },
      },
      plan: {
        S: { effort: 'medium', max_retries: 3 },
        L: { effort: 'xhigh', model: 'opus' },
      },
      build: {
        S: { max_retries: 3 },
        L: { effort: 'high' },
      },
      conflict_check: {
        L: { model: 'opus' },
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
      plan: 'gpt-5.6-sol',
      coherence_check: 'gpt-5.6-terra',
      architecture_diagram: 'gpt-5.6-terra',
      architecture_review: 'gpt-5.6-sol',
      worktree: 'gpt-5.6-luna',
      coverage_binding: 'gpt-5.6-terra',
      acceptance_specs: 'gpt-5.6-sol',
      build: 'gpt-5.6-terra',
      build_review: 'gpt-5.6-sol',
      test_suite: 'gpt-5.6-terra',
      manual_test: 'gpt-5.6-terra',
      prd_audit: 'gpt-5.6-sol',
      architecture_review_as_built: 'gpt-5.6-sol',
      rebase: 'gpt-5.6-terra',
      finish: 'gpt-5.6-terra',
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
      acceptance_specs: {
        L: { effort: 'high' },
      },
      plan: {
        S: { effort: 'medium', max_retries: 3 },
        L: { effort: 'xhigh', model: 'gpt-5.6-sol' },
      },
      build: {
        S: { max_retries: 3 },
        L: { effort: 'high' },
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

it('never selects fable from Claude autonomous model defaults', () => {
  const defaultModels = [
    ...Object.values(CLAUDE_MODEL_POLICY.stepModels),
    ...Object.values(CLAUDE_MODEL_POLICY.stepTierOverrides).flatMap((tiers) =>
      Object.values(tiers).flatMap((override) =>
        override.model === undefined ? [] : [override.model],
      ),
    ),
  ];

  expect(defaultModels).not.toContain('fable');
});

it('defines exhaustive, provider-native, deeply frozen built-in model policies', () => {
  const claude = CLAUDE_MODEL_POLICY;
  const codex = CODEX_MODEL_POLICY;


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

it('derives built-in model and cost policies from catalog descriptors', () => {
  expect({
    modelPolicies: Object.entries(BUILT_IN_PROVIDER_MODEL_POLICIES),
    costSelfReportingProviders: [...COST_SELF_REPORTING_PROVIDERS],
  }).toEqual({
    modelPolicies: BUILT_IN_PROVIDERS.map((provider) => [provider.id, provider.modelPolicy]),
    costSelfReportingProviders: BUILT_IN_PROVIDERS
      .filter((provider) =>
        'costSelfReporting' in provider.capabilities
        && provider.capabilities.costSelfReporting === true,
      )
      .map((provider) => provider.id),
  });
});

it('looks up built-in policies and warns with an actionable Claude-compatible fallback', () => {
  const warnings: string[] = [];
  const warn = (message: string): void => {
    warnings.push(message);
  };
  const claude = resolveProviderModelPolicy('claude', warn);
  const codex = resolveProviderModelPolicy('codex', warn);
  const knownWarningCount = warnings.length;
  const unknownProviderKey = 'nebula-adapter';
  const firstUnknown = resolveProviderModelPolicy(unknownProviderKey, warn);
  const secondUnknown = resolveProviderModelPolicy(unknownProviderKey, warn);
  const unknownWithoutWarn = resolveProviderModelPolicy('silent-nebula-adapter');

  expect({
    claudeIsExactPolicy: claude === CLAUDE_MODEL_POLICY,
    codexIsExactPolicy: codex === CODEX_MODEL_POLICY,
    knownWarningCount,
    repeatedUnknownsAreExactClaudePolicy:
      firstUnknown === CLAUDE_MODEL_POLICY &&
      secondUnknown === CLAUDE_MODEL_POLICY,
    unknownWithoutWarnIsExactClaudePolicy:
      unknownWithoutWarn === CLAUDE_MODEL_POLICY,
    unknownWarningCount: warnings.length,
    warningDetails: warnings.map((warning) => ({
      namesUnknownProvider: warning.includes(unknownProviderKey),
      explainsCompatibilityDefault:
        /Claude-compatible model defaults are being used/i.test(warning),
      directsPolicyAddition:
        /add (?:a )?provider model policy/i.test(warning),
    })),
  }).toEqual({
    claudeIsExactPolicy: true,
    codexIsExactPolicy: true,
    knownWarningCount: 0,
    repeatedUnknownsAreExactClaudePolicy: true,
    unknownWithoutWarnIsExactClaudePolicy: true,
    unknownWarningCount: 2,
    warningDetails: [
      {
        namesUnknownProvider: true,
        explainsCompatibilityDefault: true,
        directsPolicyAddition: true,
      },
      {
        namesUnknownProvider: true,
        explainsCompatibilityDefault: true,
        directsPolicyAddition: true,
      },
    ],
  });
});

it('runs finish one tier above the weakest model on both built-in providers', () => {
  // finish drives the most procedurally intricate step in the pipeline: a
  // multi-branch STOP contract, inline push/PR sequencing, and a mandatory
  // terminal `conduct-ts finish-record` call. The weakest tier lost the turn
  // often enough to leave features complete-but-unshipped, so both provider
  // policies pin finish one step up their own escalation ladder.
  const claudeLadder = CLAUDE_MODEL_POLICY.modelEscalationOrder;
  const codexLadder = CODEX_MODEL_POLICY.modelEscalationOrder;

  expect({
    claudeFinish: CLAUDE_MODEL_POLICY.stepModels.finish,
    claudeRungAboveWeakest: claudeLadder[1],
    claudeIsNotWeakest:
      CLAUDE_MODEL_POLICY.stepModels.finish !== claudeLadder[0],
    codexFinish: CODEX_MODEL_POLICY.stepModels.finish,
    codexRungAboveWeakest: codexLadder[1],
    codexIsNotWeakest: CODEX_MODEL_POLICY.stepModels.finish !== codexLadder[0],
    // STEP_EFFORTS is a single shared const across both policies; the bump is
    // model-only, so effort must stay put for each.
    claudeEffort: CLAUDE_MODEL_POLICY.stepEfforts.finish,
    codexEffort: CODEX_MODEL_POLICY.stepEfforts.finish,
  }).toEqual({
    claudeFinish: 'sonnet',
    claudeRungAboveWeakest: 'sonnet',
    claudeIsNotWeakest: true,
    codexFinish: 'gpt-5.6-terra',
    codexRungAboveWeakest: 'gpt-5.6-terra',
    codexIsNotWeakest: true,
    claudeEffort: 'medium',
    codexEffort: 'medium',
  });
});
