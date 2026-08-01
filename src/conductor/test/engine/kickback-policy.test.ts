import { expect, it } from 'vitest';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { StepDefinition, StepName } from '../../src/types/index.js';

it('halts every DECIDE target only in daemon mode and routes every other step', async () => {
  const { decideKickbackDisposition } = await import('../../src/engine/kickback-policy.js');
  const cases = ALL_STEPS.flatMap((step) => [
    { step, daemon: true },
    { step, daemon: false },
  ]);

  expect(cases.map(({ step, daemon }) => ({
    target: step.name,
    daemon,
    disposition: decideKickbackDisposition({
      target: step.name,
      steps: ALL_STEPS,
      daemon,
    }).kind,
  }))).toEqual(cases.map(({ step, daemon }) => ({
    target: step.name,
    daemon,
    disposition: daemon && step.phase === 'DECIDE' ? 'halt' : 'route',
  })));
});

it('fails open for unresolved targets while recognizing custom DECIDE steps', async () => {
  const { decideKickbackDisposition } = await import('../../src/engine/kickback-policy.js');
  const customTarget = 'custom_decide' as StepName;
  const customStep: StepDefinition = {
    name: customTarget,
    label: 'Custom DECIDE',
    phase: 'DECIDE',
    enforcement: 'gating',
    prerequisites: [],
    skippableForTiers: [],
    isCheckpoint: false,
  };
  const cases: Array<{
    name: string;
    target: StepName;
    steps: StepDefinition[];
    expected: 'route' | 'halt';
  }> = [
    { name: 'absent target', target: 'remediate', steps: ALL_STEPS, expected: 'route' },
    { name: 'empty table', target: 'plan', steps: [], expected: 'route' },
    { name: 'custom DECIDE step', target: customTarget, steps: [customStep], expected: 'halt' },
  ];

  expect(cases.map(({ name, target, steps }) => ({
    name,
    disposition: decideKickbackDisposition({ target, steps, daemon: true }).kind,
  }))).toEqual(cases.map(({ name, expected }) => ({ name, disposition: expected })));
});
