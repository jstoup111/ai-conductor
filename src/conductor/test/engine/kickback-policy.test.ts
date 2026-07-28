import { expect, it } from 'vitest';
import { ALL_STEPS } from '../../src/engine/steps.js';

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
