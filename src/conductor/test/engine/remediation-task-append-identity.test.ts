// Covers: task:6
import { describe, expect, it } from 'vitest';

import { appendRemediationTasks } from '../../src/engine/conductor.js';
import { appendConductorRemediationTasks } from '../../src/engine/remediation-task-append.js';
import { appendRemediationTasks as appendCriterionBoundRemediationTasks } from '../../src/engine/remediation-append.js';

describe('conductor remediation task append identity', () => {
  it('keeps the conductor shim bound to its renamed appender, not the criterion-bound appender', () => {
    expect({
      conductorMatchesRenamedAppender: Object.is(appendRemediationTasks, appendConductorRemediationTasks),
      conductorDiffersFromCriterionBoundAppender: !Object.is(appendRemediationTasks, appendCriterionBoundRemediationTasks),
    }).toEqual({
      conductorMatchesRenamedAppender: true,
      conductorDiffersFromCriterionBoundAppender: true,
    });
  });
});
