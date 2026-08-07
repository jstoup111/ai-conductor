import { describe, expect, it } from 'vitest';
import { renderDecideEntryHalt } from '../../src/engine/decide-entry-policy.js';
import type { StepName } from '../../src/types/index.js';

describe('renderDecideEntryHalt', () => {
  it.each([
    {
      name: 'an unresolvable target',
      halt: {
        sourceGate: 'build' as const,
        target: 'custom/DECIDE-\ud83e\uddea' as StepName,
        evidence: 'persisted kickback verdict from build',
        reason: "DECIDE target 'custom/DECIDE-\ud83e\uddea' could not be resolved from the configured steps.",
      },
      expected: [
        'DECIDE entry refused \u2014 autonomous run may not enter DECIDE without operator direction.',
        '',
        'Source gate:       build',
        'Requested target:  custom/DECIDE-\ud83e\uddea',
        'Evidence:          persisted kickback verdict from build',
        "Why refused:       DECIDE target 'custom/DECIDE-\ud83e\uddea' could not be resolved from the configured steps.",
        'Operator choices:  direct a return to a named step | correct the routing target | reject the kickback',
      ].join('\n'),
    },
    {
      name: 'an unresolvable phase',
      halt: {
        sourceGate: 'resume-clamp' as const,
        target: 'plan' as const,
        evidence: 'configured step has no phase',
        reason: "DECIDE target 'plan' could not be resolved from the configured steps.",
      },
      expected: [
        'DECIDE entry refused \u2014 autonomous run may not enter DECIDE without operator direction.',
        '',
        'Source gate:       resume-clamp',
        'Requested target:  plan',
        'Evidence:          configured step has no phase',
        "Why refused:       DECIDE target 'plan' could not be resolved from the configured steps.",
        'Operator choices:  direct a return to a named step | correct the routing target | reject the kickback',
      ].join('\n'),
    },
    {
      name: 'an unsatisfied target without an in-scope grant',
      halt: {
        sourceGate: 'forward-walk' as const,
        target: 'stories' as const,
        reason: "Autonomous entry to DECIDE target 'stories' requires an in-scope grant from 'forward-walk'.",
      },
      expected: [
        'DECIDE entry refused \u2014 autonomous run may not enter DECIDE without operator direction.',
        '',
        'Source gate:       forward-walk',
        'Requested target:  stories',
        'Evidence:          none provided',
        "Why refused:       Autonomous entry to DECIDE target 'stories' requires an in-scope grant from 'forward-walk'.",
        'Operator choices:  direct a return to a named step | correct the routing target | reject the kickback',
      ].join('\n'),
    },
  ])('renders all five required fields for $name', ({ halt, expected }) => {
    expect(renderDecideEntryHalt(halt)).toBe(expected);
  });
});
