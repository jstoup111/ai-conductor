import { describe, expect, it } from 'vitest';

import {
  appendRemediationTasks,
  type CriterionBoundRemediationGap,
} from '../src/engine/remediation-append.js';
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

  it('renders and idempotently upserts as-built tasks with their governing clause', () => {
    const gap = {
      id: 'AB-1',
      disposition: 'build',
      category: null,
      rationale: 'The shipped boundary does not meet the approved decision.',
      governingClause: 'adr-2026-08-25-example decision 1',
      parentTask: '7',
      tasks: [{ id: 'boundary-guard', title: 'Add the boundary guard' }],
    } satisfies CriterionBoundRemediationGap;

    const first = appendRemediationTasks('### Task 7: Existing work\n', [gap], 'as-built');
    const second = appendRemediationTasks(first.planText, [gap], 'as-built');

    expect(first.ids).toEqual(['rem-as-built-boundary-guard']);
    expect(first.planText).toContain('### Task rem-as-built-boundary-guard: Add the boundary guard');
    expect(first.planText).toContain('**Gate:** as-built');
    expect(first.planText).toContain('**Governing clause:** adr-2026-08-25-example decision 1');
    expect(first.planText).toContain('**Parent task:** 7');
    expect(first.planText).toContain(
      '**Done when:**\n- adr-2026-08-25-example decision 1 is satisfied by this task.',
    );
    expect(second.ids).toEqual(first.ids);
    expect(second.planText).toBe(first.planText);
  });
});
