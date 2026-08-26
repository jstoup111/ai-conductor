import { describe, expect, it } from 'vitest';

import { appendRemediationTasks } from '../src/engine/remediation-append.js';
import type { RemediationGap } from '../src/engine/artifacts.js';

describe('prd_audit remediation append', () => {
  it('binds each FIXABLE task to its criterion and owning plan task', () => {
    const gap = {
      id: 'S2.1',
      disposition: 'build',
      category: null,
      rationale: 'The criterion is not implemented.',
      criterion: 'S2.1',
      parentTask: 4,
      tasks: [{ id: 'rem-s2-1', title: 'Implement the missing behavior' }],
    } satisfies RemediationGap & { criterion: string; parentTask: number };

    const result = appendRemediationTasks('### Task 4: Existing work\n', [gap], 'prd-audit');

    expect(result.planText).toContain('**Criterion:** S2.1');
    expect(result.planText).toContain('**Parent task:** 4');
    expect(result.planText).toContain('**Done when:**\n- S2.1 is satisfied by this task.');
  });
});
