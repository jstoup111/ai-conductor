// Covers: task:6
import { describe, expect, it } from 'vitest';
import {
  dependencyOrderCandidates,
  PlanReviewInputError,
} from '../../src/engine/plan-review-candidates.js';

describe('dependencyOrderCandidates', () => {
  it('names a task whose Done-when cites an export introduced only by a dependent later task', () => {
    expect(dependencyOrderCandidates(`# Plan

### Task 7: Validate the review input
**Steps:**
1. Add validation.

**Done when:**
- [test] The review calls \`dependencyOrderCandidates\`.

**Dependencies:** none

### Task 8: Add dependency-order candidates
**Steps:**
1. Export \`dependencyOrderCandidates\`.

**Dependencies:** Task 7
`)).toEqual([expect.objectContaining({
      lens: 'dependency-order',
      taskId: '7',
      relatedTaskId: '8',
      identifier: 'dependencyOrderCandidates',
    })]);
  });

  it('names a task that cites a config key introduced outside its dependency closure', () => {
    expect(dependencyOrderCandidates(`# Plan

### Task 4: Add daemon config
**Steps:**
1. Add \`plan_review\` to the daemon config.

**Dependencies:** none

### Task 12: Use the config
**Steps:**
1. Read the daemon config.

**Done when:**
- [test] The daemon reads \`plan_review\`.

**Dependencies:** none
`)).toEqual([expect.objectContaining({
      lens: 'dependency-order',
      taskId: '12',
      relatedTaskId: '4',
      identifier: 'plan_review',
    })]);
  });

  it('does not flag an identifier introduced through a transitive dependency', () => {
    expect(dependencyOrderCandidates(`# Plan

### Task 1: Add config
**Steps:**
1. Add \`plan_review\`.

**Dependencies:** none

### Task 2: Prepare the runner
**Steps:**
1. Prepare the runner.

**Dependencies:** Task 1

### Task 3: Use config
**Done when:**
- [test] The runner reads \`plan_review\`.

**Dependencies:** Task 2
`)).toEqual([]);
  });

  it.each([
    ['malformed', '**Dependencies:** all prior.'],
    ['unknown', '**Dependencies:** Task 99'],
  ])('refuses a %s Dependencies line instead of treating its task as dependency-free', (_name, dependencies) => {
    expect(() => dependencyOrderCandidates(`# Plan

### Task 1: Broken metadata
**Steps:**
1. Add \`plan_review\`.

${dependencies}
`)).toThrow(expect.objectContaining({
      name: 'PlanReviewInputError',
      message: expect.stringContaining('Task 1'),
    }));
    expect(() => dependencyOrderCandidates(`# Plan

### Task 1: Broken metadata
**Steps:**
1. Add \`plan_review\`.

${dependencies}
`)).toThrow(PlanReviewInputError);
  });
});
