import { describe, expect, it } from 'vitest';
import { validatePlanDoneWhen } from '../../src/engine/plan-done-when.js';

describe('validatePlanDoneWhen', () => {
  it('accepts plan tasks carrying between two and five nonblank Done-when criteria', () => {
    expect(validatePlanDoneWhen(`### Task 1: Two criteria
**Done when:**
- The first observable result exists.
- The second observable result exists.

### Task 2: Five criteria
**Done when:**
- The first observable result exists.
- The second observable result exists.
- The third observable result exists.
- The fourth observable result exists.
- The fifth observable result exists.
`)).toEqual([]);
  });

  it.each([
    ['missing', `### Task missing: No completion criteria\n\n**Files:** src/missing.ts`, {
      taskId: 'missing', reason: 'missing',
    }],
    ['blank zero-item block', `### Task blank-empty: Empty criteria\n**Done when:**\n\n**Files:** src/empty.ts`, {
      taskId: 'blank-empty', reason: 'blank',
    }],
    ['blank whitespace criterion', `### Task blank-item: Blank criterion\n**Done when:**\n-   \n- A real criterion\n`, {
      taskId: 'blank-item', reason: 'blank',
    }],
    ['too few', `### Task too-few: One criterion\n**Done when:**\n- Only one criterion\n`, {
      taskId: 'too-few', reason: 'too-few',
    }],
    ['too many', `### Task too-many: Six criteria\n**Done when:**\n- One\n- Two\n- Three\n- Four\n- Five\n- Six\n`, {
      taskId: 'too-many', reason: 'too-many',
    }],
  ])('reports %s Done-when criteria', (_caseName, plan, expected) => {
    expect(validatePlanDoneWhen(plan)).toEqual([expected]);
  });

  it('reports every violating task with its matching reason', () => {
    const plan = `### Task missing: No block

### Task blank: Empty block
**Done when:**

### Task too-many: Six criteria
**Done when:**
- One
- Two
- Three
- Four
- Five
- Six
`;

    expect(validatePlanDoneWhen(plan)).toEqual([
      { taskId: 'missing', reason: 'missing' },
      { taskId: 'blank', reason: 'blank' },
      { taskId: 'too-many', reason: 'too-many' },
    ]);
  });
});
