import { expect, it } from 'vitest';
import { decideEntryDisposition } from '../../src/engine/decide-entry-policy.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ComplexityTier, StepDefinition, StepName } from '../../src/types/index.js';

type Input = Parameters<typeof decideEntryDisposition>[0];

function decideStep(overrides: Partial<StepDefinition> = {}): StepDefinition {
  return {
    name: 'plan',
    label: 'Plan',
    phase: 'DECIDE',
    enforcement: 'gating',
    prerequisites: [],
    skippableForTiers: [],
    isCheckpoint: false,
    ...overrides,
  };
}

function input(target: StepName, steps: StepDefinition[]): Input {
  return {
    target,
    steps,
    daemon: true,
    tier: 'L',
    hasContract: true,
    satisfied: false,
    grant: null,
    sourceGate: 'forward-walk',
  };
}

function summary(disposition: ReturnType<typeof decideEntryDisposition>): string {
  return disposition.kind === 'fast-forward'
    ? `${disposition.kind}:${disposition.as}`
    : disposition.kind;
}

it('applies every ordered autonomous DECIDE-entry disposition rule', () => {
  const tierSkippable = decideStep({ skippableForTiers: ['S'] });
  const noPhase = { ...decideStep(), phase: undefined } as unknown as StepDefinition;
  const customTarget = 'custom_decide' as StepName;
  const customDecideStep = decideStep({
    name: customTarget,
    label: 'Custom DECIDE',
  });
  const grant = {
    version: 1,
    step: 'plan' as StepName,
    reason: 'operator approved one authoring pass',
    grantedAt: '2026-08-07T00:00:00.000Z',
    grantedBy: 'operator',
  };
  const cases: Array<{ name: string; input: Input; expected: string }> = [
    {
      name: 'interactive runs pass through before target resolution',
      input: { ...input('remediate', []), daemon: false },
      expected: 'enter',
    },
    {
      name: 'an unresolved target halts',
      input: input('remediate', []),
      expected: 'halt',
    },
    {
      name: 'an undefined target phase halts',
      input: input('plan', [noPhase]),
      expected: 'halt',
    },
    ...ALL_STEPS
      .filter((step) => step.phase !== 'DECIDE')
      .map((step) => ({
        name: `known ${step.phase} target ${step.name} enters`,
        input: input(step.name, ALL_STEPS),
        expected: 'enter',
      })),
    {
      name: 'a tier-skippable DECIDE target fast-forwards as skipped',
      input: { ...input('plan', [tierSkippable]), tier: 'S' as ComplexityTier },
      expected: 'fast-forward:skipped',
    },
    {
      name: 'tier skippability beats no contract, satisfaction, and a grant',
      input: {
        ...input('plan', [tierSkippable]),
        tier: 'S' as ComplexityTier,
        hasContract: false,
        satisfied: true,
        grant,
      },
      expected: 'fast-forward:skipped',
    },
    {
      name: 'a DECIDE target without a completion contract fast-forwards as skipped',
      input: { ...input('plan', [decideStep()]), hasContract: false },
      expected: 'fast-forward:skipped',
    },
    {
      name: 'no completion contract beats satisfaction and a grant',
      input: {
        ...input('plan', [decideStep()]),
        hasContract: false,
        satisfied: true,
        grant,
      },
      expected: 'fast-forward:skipped',
    },
    {
      name: 'a satisfied DECIDE target fast-forwards as done',
      input: { ...input('plan', [decideStep()]), satisfied: true },
      expected: 'fast-forward:done',
    },
    {
      name: 'satisfaction beats a grant',
      input: { ...input('plan', [decideStep()]), satisfied: true, grant },
      expected: 'fast-forward:done',
    },
    {
      name: 'an in-scope operator grant permits entry',
      input: { ...input('plan', [decideStep()]), grant },
      expected: 'enter',
    },
    {
      name: 'a grant scoped to a different target halts',
      input: {
        ...input('plan', [decideStep()]),
        grant: { ...grant, step: 'stories' },
      },
      expected: 'halt',
    },
    ...ALL_STEPS
      .filter((step) => step.phase === 'DECIDE')
      .flatMap((step) => [false, 'unknown' as const].map((satisfied) => ({
        name: `unsatisfied ${step.name} (${String(satisfied)}) halts`,
        input: { ...input(step.name, ALL_STEPS), satisfied },
        expected: 'halt',
      }))),
    {
      name: 'an unsatisfied configured DECIDE target halts',
      input: input(customTarget, [customDecideStep]),
      expected: 'halt',
    },
  ];

  expect(cases.map(({ name, input: value }) => ({
    name,
    disposition: summary(decideEntryDisposition(value)),
  }))).toEqual(cases.map(({ name, expected }) => ({ name, disposition: expected })));
});
