// Covers: task:2
import { afterEach, expect, it } from 'vitest';
import {
  installResolvedModelTiers,
  resetResolvedModelTiersForTest,
  resolveModelTierFloors,
} from '../../src/engine/model-tier-resolution.js';
import {
  CODEX_MODEL_POLICY,
  resolveProviderModelPolicy,
} from '../../src/engine/provider-model-policy.js';
import { providerDescriptor } from '../../src/execution/provider-catalog.js';
import { resolveStepConfig } from '../../src/engine/resolved-config.js';

const FULL_LISTING = [
  'gpt-6.1-sol',
  'gpt-6-astra',
  'gpt-6-sol',
  'gpt-6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
];

function codexFloorIds(): string[] {
  return [
    ...Object.values(CODEX_MODEL_POLICY.stepModels),
    ...Object.values(CODEX_MODEL_POLICY.stepTierOverrides).flatMap((tiers) =>
      Object.values(tiers ?? {}).flatMap((override) => override?.model === undefined ? [] : [override.model]),
    ),
    ...CODEX_MODEL_POLICY.modelEscalationOrder,
    ...CODEX_MODEL_POLICY.modelFallbackLadder,
  ];
}

afterEach(() => {
  resetResolvedModelTiersForTest();
});

it('uses the newest same-tier catalog models for Codex step resolution', () => {
  installResolvedModelTiers('codex', resolveModelTierFloors(codexFloorIds(), FULL_LISTING));

  const policy = resolveProviderModelPolicy('codex');

  expect({
    buildReview: resolveStepConfig('build_review', 'BUILD', policy).model,
    memory: resolveStepConfig('memory', 'UNDERSTAND', policy).model,
    build: resolveStepConfig('build', 'BUILD', policy).model,
  }).toEqual({
    buildReview: 'gpt-6.1-sol',
    memory: 'gpt-6-luna',
    build: 'gpt-5.6-terra',
  });
});

it('materializes tier overrides and model ladders from the same catalog map', () => {
  installResolvedModelTiers('codex', resolveModelTierFloors(codexFloorIds(), FULL_LISTING));

  const policy = resolveProviderModelPolicy('codex');

  expect({
    planLarge: policy.stepTierOverrides.plan?.L?.model,
    escalationOrder: policy.modelEscalationOrder,
    fallbackLadder: policy.modelFallbackLadder,
    deeplyFrozen: Object.isFrozen(policy)
      && Object.isFrozen(policy.stepModels)
      && Object.isFrozen(policy.stepTierOverrides),
  }).toEqual({
    planLarge: 'gpt-6.1-sol',
    escalationOrder: CODEX_MODEL_POLICY.modelEscalationOrder.map((model) =>
      ({ 'gpt-5.6-luna': 'gpt-6-luna', 'gpt-5.6-sol': 'gpt-6.1-sol' }[model] ?? model)),
    fallbackLadder: ['gpt-6.1-sol', 'gpt-5.6-terra', 'gpt-6-luna'],
    deeplyFrozen: true,
  });
});

it.each([
  { listed: ['gpt-5.4-sol', 'gpt-5.6-sol'], expected: 'gpt-5.6-sol' },
  { listed: ['gpt-6.9-sol', 'gpt-6.10-sol'], expected: 'gpt-6.10-sol' },
])('keeps the highest strictly newer numeric same-tier version', ({ listed, expected }) => {
  const resolved = resolveModelTierFloors(['gpt-5.6-sol'], listed);

  expect(resolved.get('gpt-5.6-sol')).toBe(expected);
});

it('leaves opaque floor ids unchanged and preserves the static policy without a registry entry', () => {
  const resolved = resolveModelTierFloors(['gpt-5.6-sol', 'gpt-reserve'], FULL_LISTING);

  expect({
    opaqueId: resolved.get('gpt-reserve'),
    policyIsStatic: resolveProviderModelPolicy('codex') === CODEX_MODEL_POLICY,
    descriptorPolicy: providerDescriptor('codex').modelPolicy,
  }).toEqual({
    opaqueId: 'gpt-reserve',
    policyIsStatic: true,
    descriptorPolicy: CODEX_MODEL_POLICY,
  });
});

it('does not introduce non-tier catalog entries into a materialized policy', () => {
  installResolvedModelTiers('codex', resolveModelTierFloors(codexFloorIds(), [
    ...FULL_LISTING,
    'gpt-6-chat-thinking',
    'gpt-reserve',
    'codex-auto-review',
  ]));

  const policy = resolveProviderModelPolicy('codex');
  const policyModels = [
    ...Object.values(policy.stepModels),
    ...Object.values(policy.stepTierOverrides).flatMap((tiers) =>
      Object.values(tiers ?? {}).flatMap((override) => override?.model === undefined ? [] : [override.model]),
    ),
  ];

  expect(policyModels).not.toEqual(expect.arrayContaining([
    'gpt-6-chat-thinking',
    'gpt-reserve',
    'codex-auto-review',
  ]));
});
