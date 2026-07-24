import { describe, it, expect } from 'vitest';
import {
  EFFORT_ORDER,
  MODEL_TIER_ORDER,
  bumpEffort,
  bumpModel,
  escalateAttempt,
} from '../../src/engine/escalation.js';
import {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
} from '../../src/engine/provider-model-policy.js';

const EFFORT_SEQUENCE = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const ATTEMPTS = [-1, 0, 1, 2, 3, 4, 5, 9] as const;

const PROVIDER_CASES = [
  {
    provider: 'Claude',
    policy: CLAUDE_MODEL_POLICY,
    models: ['haiku', 'sonnet', 'opus', 'fable'] as const,
  },
  {
    provider: 'Codex',
    policy: CODEX_MODEL_POLICY,
    models: ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'] as const,
  },
] as const;

const BUMP_MODEL_CASES = PROVIDER_CASES.flatMap(({ provider, policy, models }) =>
  models.flatMap((baseModel, baseIndex) =>
    [1, 2, 9].map((steps) => ({
      provider,
      policy,
      baseModel,
      steps,
      expectedModel: models[Math.min(baseIndex + steps, models.length - 1)]!,
    })),
  ),
);

const STABLE_MODEL_HELPER_CASES = PROVIDER_CASES.flatMap(
  ({ provider, policy, models }) =>
    models.flatMap((baseModel) =>
      [0, -2].map((steps) => ({
        provider,
        policy,
        baseModel,
        steps,
      })),
    ),
);

const BUMP_EFFORT_CASES = PROVIDER_CASES.flatMap(({ provider, policy }) =>
  EFFORT_SEQUENCE.flatMap((baseEffort, baseIndex) =>
    [1, 2, 9].map((steps) => ({
      provider,
      policy,
      baseEffort,
      steps,
      expectedEffort:
        EFFORT_SEQUENCE[Math.min(baseIndex + steps, EFFORT_SEQUENCE.length - 1)]!,
    })),
  ),
);

const STABLE_EFFORT_HELPER_CASES = PROVIDER_CASES.flatMap(({ provider, policy }) =>
  EFFORT_SEQUENCE.flatMap((baseEffort) =>
    [0, -2].map((steps) => ({
      provider,
      policy,
      baseEffort,
      steps,
    })),
  ),
);

const ESCALATION_CASES = PROVIDER_CASES.flatMap(({ provider, policy, models }) =>
  models.flatMap((baseModel, baseIndex) =>
    EFFORT_SEQUENCE.flatMap((baseEffort, effortIndex) =>
      ATTEMPTS.map((attempt) => {
        const modelSteps = Math.max(attempt - 2, 0);
        const effortSteps = attempt <= 1 ? 0 : 1;
        return {
          provider,
          policy,
          baseModel,
          baseEffort,
          attempt,
          expected: {
            model: models[Math.min(baseIndex + modelSteps, models.length - 1)]!,
            effort:
              EFFORT_SEQUENCE[
                Math.min(effortIndex + effortSteps, EFFORT_SEQUENCE.length - 1)
              ]!,
          },
        };
      }),
    ),
  ),
);

const DISABLED_CASES = PROVIDER_CASES.flatMap(({ provider, policy, models }) =>
  models.flatMap((baseModel) =>
    ATTEMPTS.map((attempt) => ({
      provider,
      policy,
      baseModel,
      attempt,
    })),
  ),
);

const UNORDERED_MODEL_CASES = PROVIDER_CASES.flatMap(({ provider, policy }) => [
  {
    provider,
    policy,
    kind: 'explicit',
    baseModel:
      provider === 'Claude'
        ? 'claude-3-5-sonnet-20241022'
        : 'gpt-5.6-luna-20260724',
  },
  {
    provider,
    policy,
    kind: 'other-provider',
    baseModel:
      provider === 'Claude'
        ? CODEX_MODEL_POLICY.modelEscalationOrder[0]
        : CLAUDE_MODEL_POLICY.modelEscalationOrder[0],
  },
  {
    provider,
    policy,
    kind: 'unknown',
    baseModel: 'Vendor/Custom-Model@2026-07-24',
  },
]);

describe('engine/escalation — compatibility constants and provider orders', () => {
  it('keeps the legacy effort and Claude model orders for compatibility', () => {
    expect({
      efforts: [...EFFORT_ORDER],
      models: [...MODEL_TIER_ORDER],
    }).toEqual({
      efforts: EFFORT_SEQUENCE,
      models: ['haiku', 'sonnet', 'opus', 'fable'],
    });
  });

  it.each(PROVIDER_CASES)(
    '$provider policy exposes its exact native model escalation sequence',
    ({ policy, models }) => {
      expect([...policy.modelEscalationOrder]).toEqual(models);
    },
  );
});

describe('engine/escalation — policy-aware helpers', () => {
  it.each(BUMP_EFFORT_CASES)(
    'bumps $provider effort $baseEffort by $steps rung(s) and caps at max',
    ({ policy, baseEffort, steps, expectedEffort }) => {
      expect(bumpEffort(baseEffort, steps, policy.effortOrder)).toBe(expectedEffort);
    },
  );

  it.each(STABLE_EFFORT_HELPER_CASES)(
    'keeps $provider effort $baseEffort unchanged for $steps steps',
    ({ policy, baseEffort, steps }) => {
      expect(bumpEffort(baseEffort, steps, policy.effortOrder)).toBe(baseEffort);
    },
  );

  it.each(BUMP_MODEL_CASES)(
    'bumps $provider model $baseModel by $steps rung(s) and caps at its deepest model',
    ({ policy, baseModel, steps, expectedModel }) => {
      expect(bumpModel(baseModel, steps, policy.modelEscalationOrder)).toBe(expectedModel);
    },
  );

  it.each(STABLE_MODEL_HELPER_CASES)(
    'keeps $provider model $baseModel unchanged for $steps steps',
    ({ policy, baseModel, steps }) => {
      expect(bumpModel(baseModel, steps, policy.modelEscalationOrder)).toBe(baseModel);
    },
  );

  it.each(UNORDERED_MODEL_CASES)(
    'keeps $provider $kind model "$baseModel" byte-for-byte unchanged in the helper',
    ({ policy, baseModel }) => {
      expect(bumpModel(baseModel, 9, policy.modelEscalationOrder)).toBe(baseModel);
    },
  );
});

describe('engine/escalation — provider-aware escalateAttempt', () => {
  it.each(ESCALATION_CASES)(
    '$provider $baseModel/$baseEffort attempt $attempt follows both selected orders and caps',
    ({ policy, baseModel, baseEffort, attempt, expected }) => {
      expect(escalateAttempt(baseModel, baseEffort, attempt, true, policy)).toEqual(
        expected,
      );
    },
  );

  it.each(DISABLED_CASES)(
    '$provider $baseModel attempt $attempt remains pinned when escalation is disabled',
    ({ policy, baseModel, attempt }) => {
      expect(escalateAttempt(baseModel, 'medium', attempt, false, policy)).toEqual({
        model: baseModel,
        effort: 'medium',
      });
    },
  );

  it.each(UNORDERED_MODEL_CASES)(
    'keeps $provider $kind model "$baseModel" byte-for-byte unchanged while escalating effort',
    ({ policy, baseModel }) => {
      expect(escalateAttempt(baseModel, 'medium', 9, true, policy)).toEqual({
        model: baseModel,
        effort: 'high',
      });
    },
  );
});
