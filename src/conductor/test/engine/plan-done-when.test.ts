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

  it('accepts a compliant block and distinguishes an explicit blank criterion from an empty block', () => {
    expect(validatePlanDoneWhen(`### Task 1: compliant
**Done when:**
- one observable result
- another observable result
### Task 2: blank
**Done when:**
- 
- another result
### Task 3: fenced example
**Done when:**
\`\`\`
- not a criterion
- not a criterion
\`\`\`
- first real criterion
- second real criterion
`)).toEqual([{ taskId: '2', reason: 'blank' }]);
  });
});
