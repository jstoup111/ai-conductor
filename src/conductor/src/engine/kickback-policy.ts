import type { StepDefinition, StepName } from '../types/index.js';

export type KickbackDisposition =
  | { kind: 'route' }
  | { kind: 'halt'; reason: string };

export function decideKickbackDisposition(input: {
  target: StepName;
  steps: StepDefinition[];
  daemon: boolean;
}): KickbackDisposition {
  const phase = input.steps.find((step) => step.name === input.target)?.phase;
  if (input.daemon && phase === 'DECIDE') {
    return {
      kind: 'halt',
      reason: `Kickback target '${input.target}' is a DECIDE step, which is operator-only in daemon mode.`,
    };
  }
  return { kind: 'route' };
}
