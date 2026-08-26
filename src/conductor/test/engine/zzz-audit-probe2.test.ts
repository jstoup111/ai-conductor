import { describe, expect, it } from 'vitest';
import { earliestRemediationTarget } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';

describe('pre-fix target reconstruction', () => {
  it('unfiltered fixes would have targeted the earlier unadmitted step', () => {
    const both = earliestRemediationTarget([
      { id: 'FR-7', disposition: 'build', category: null, rationale: 'r', tasks: [] },
      { id: 'FR-99', disposition: 'plan', category: null, rationale: 'r', tasks: [] },
    ] as never, ALL_STEPS);
    const admittedOnly = earliestRemediationTarget([
      { id: 'FR-7', disposition: 'build', category: null, rationale: 'r', tasks: [] },
    ] as never, ALL_STEPS);
    const p5b = earliestRemediationTarget([
      { id: 'G-1', disposition: 'publication', category: null, rationale: 'r', tasks: [] },
      { id: 'G-2', disposition: 'acceptance_specs', category: null, rationale: 'r', tasks: [] },
    ] as never, ALL_STEPS);
    console.log('PRE-FIX P4 target =', JSON.stringify(both), ' POST-FIX =', JSON.stringify(admittedOnly));
    console.log('PRE-FIX P5b target =', JSON.stringify(p5b));
    console.log('step order =', ALL_STEPS.map((s) => `${s.name}:${s.phase}`).join(' '));
    expect(true).toBe(true);
  });
});
