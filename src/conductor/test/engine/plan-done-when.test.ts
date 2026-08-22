import { describe, expect, it } from 'vitest';
import { validatePlanDoneWhen } from '../../src/engine/plan-done-when.js';

describe('validatePlanDoneWhen', () => {
  it('reports each land-time shape violation by task and reason', () => {
    expect(validatePlanDoneWhen(`### Task 1: good
**Done when:**
- one
- two
### Task 2: missing
### Task 3: short
**Done when:**
- one
### Task 4: long
**Done when:**
- 1
- 2
- 3
- 4
- 5
- 6
`)).toEqual([
      { taskId: '2', reason: 'missing' },
      { taskId: '3', reason: 'too-few' },
      { taskId: '4', reason: 'too-many' },
    ]);
  });
});
