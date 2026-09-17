// Covers: task:1
import { describe, expect, it } from 'vitest';

import {
  appendRemediationTasks,
  type CriterionBoundRemediationGap,
} from '../src/engine/remediation-append.js';
import type { RemediationGap } from '../src/engine/artifacts.js';
import { validatePlanDoneWhen } from '../src/engine/plan-done-when.js';

describe('prd_audit remediation append', () => {
  it('renders one valid, idempotent Done-when block from every criterion-bound gap shape', () => {
    const existingPlan = [
      '### Task 4: Existing work',
      '**Done when:**',
      '- The existing work is complete.',
      '- The existing work remains verified.',
      '',
    ].join('\n');
    const cases = [
      {
        name: 'criterion and parent',
        gap: {
          id: 'S2.1',
          disposition: 'build',
          category: null,
          rationale: 'The criterion is not implemented.',
          criterion: 'S2.1',
          parentTask: 4,
          tasks: [{ id: 'criterion-parent', title: 'Implement the missing behavior' }],
        },
        checks: ['S2.1 is satisfied by this task.'],
        metadata: ['**Criterion:** S2.1', '**Parent task:** 4'],
      },
      {
        name: 'governing clause',
        gap: {
          id: 'AB-1',
          disposition: 'build',
          category: null,
          rationale: 'The shipped boundary does not meet the approved decision.',
          governingClause: 'adr-2026-08-25-example decision 1',
          tasks: [{ id: 'governing-clause', title: 'Add the boundary guard' }],
        },
        checks: ['adr-2026-08-25-example decision 1 is satisfied by this task.'],
        metadata: ['**Governing clause:** adr-2026-08-25-example decision 1'],
      },
      {
        name: 'criterion, parent, and governing clause',
        gap: {
          id: 'S2.2',
          disposition: 'build',
          category: null,
          rationale: 'The rendered task must retain every ownership field.',
          criterion: 'S2.2',
          parentTask: '4',
          governingClause: 'adr-example decision 2',
          tasks: [{ id: 'both-fields', title: 'Render both obligations' }],
        },
        checks: ['S2.2 is satisfied by this task.', 'adr-example decision 2 is satisfied by this task.'],
        metadata: [
          '**Criterion:** S2.2',
          '**Governing clause:** adr-example decision 2',
          '**Parent task:** 4',
        ],
      },
      {
        name: 'whitespace and multiline sources',
        gap: {
          id: 'S2.3',
          disposition: 'build',
          category: null,
          rationale: '  Repair the\n  rendered boundary.  ',
          criterion: '  S2.3\n  observable behavior  ',
          parentTask: 4,
          tasks: [{ id: 'multiline', title: '  Render\n  single-line checks  ' }],
        },
        checks: ['S2.3 observable behavior is satisfied by this task.'],
        metadata: ['**Criterion:** S2.3 observable behavior', '**Parent task:** 4'],
      },
      {
        name: 'blank optional fields',
        gap: {
          id: 'S2.4',
          disposition: 'build',
          category: null,
          rationale: '   ',
          criterion: ' \n ',
          parentTask: ' ',
          governingClause: '\n',
          tasks: [{ id: 'blank-fields', title: '  Supply fallback checks\n  from the title  ' }],
        },
        checks: [],
        metadata: [],
      },
    ] satisfies ReadonlyArray<{
      name: string;
      gap: CriterionBoundRemediationGap;
      checks: string[];
      metadata: string[];
    }>;

    for (const { name, gap, checks, metadata } of cases) {
      const first = appendRemediationTasks(existingPlan, [gap], 'prd-audit');
      const second = appendRemediationTasks(first.planText, [gap], 'prd-audit');
      const appended = first.planText.slice(existingPlan.length);
      const renderedChecks = [...appended.matchAll(/^- (.+)$/gm)].map((match) => match[1]);

      expect(validatePlanDoneWhen(first.planText), name).toEqual([]);
      expect(second.planText, name).toBe(first.planText);
      expect(renderedChecks.length, name).toBeGreaterThanOrEqual(2);
      expect(renderedChecks.length, name).toBeLessThanOrEqual(5);
      expect(renderedChecks.every((check) => check.trim() !== '' && !/[\r\n]/.test(check)), name).toBe(true);
      expect(appended.match(/^\*\*Done when:\*\*$/gm), name).toHaveLength(1);
      expect(appended.match(/^\*\*Parent task:\*\*/gm) ?? [], name).toHaveLength(
        String(gap.parentTask ?? '').trim() === '' ? 0 : 1,
      );
      for (const check of checks) expect(renderedChecks, name).toContain(check);
      for (const line of metadata) expect(appended, name).toContain(line);
    }
  });

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
