import { describe, expect, it } from 'vitest';

import { planContractPointers } from '../src/engine/remediation-context-pointers.js';

describe('planContractPointers', () => {
  it('renders a concise plan-contract pointer for a completeness finding anchored to Task 1', () => {
    const plan = `# Implementation Plan

### Task 1: Join remediation findings to the plan contract

**Steps:**
1. This detailed implementation text must not appear in the pointer.
`;

    expect(
      planContractPointers(
        [
          {
            concernKind: 'missing-outcome',
            summary: 'The remediation context omits the governing plan task.',
            evidenceLocations: ['src/engine/conductor.ts:1'],
            anchor: {
              rubric: 'completeness',
              planTask: '1',
              missingOutcome: 'renders the plan contract pointer',
            },
          },
        ],
        plan,
        '.docs/plans/remediation-context.md',
      ),
    ).toEqual([
      'plan contract: .docs/plans/remediation-context.md — Task 1 (anchor: renders the plan contract pointer)',
    ]);
  });
});
