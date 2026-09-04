// Covers: task:10
// Test: coverage-binding claim assembly

import { describe, expect, it } from 'vitest';
import { assembleCoverageBindingClaims } from '../../src/engine/coverage-binding-inputs.js';

const PLAN_WITH_TASKS = `# Plan

### Task 1: First task
**Done when:**
- First check is true.

### Task 2: Second task
**Done when:**
- Second check is true.

### Task 3: Third task
**Done when:**
- Third check is true.
`;

describe('assembleCoverageBindingClaims', () => {
  it('assembles one M-tier claim per coherence criterion row with cited Done when checks', () => {
    const coherenceText = `| Row Class | Criterion | Cited Task Ids | Verdict | Quote | Disposition |
| --- | --- | --- | --- | --- | --- |
| criterion | First criterion | task-1 | covered | "First check" | diff-local |
| criterion | Second criterion | task-2 | covered | "Second check" | diff-local |
| criterion | Third criterion | task-1, task-3 | covered | "Third check" | diff-local |
`;

    expect(assembleCoverageBindingClaims({ tier: 'M', coherenceText, planText: PLAN_WITH_TASKS })).toEqual([
      {
        criterion: 'First criterion',
        taskIds: ['1'],
        doneWhen: [['First check is true.']],
        quote: 'First check',
        applicability: 'applicable',
      },
      {
        criterion: 'Second criterion',
        taskIds: ['2'],
        doneWhen: [['Second check is true.']],
        quote: 'Second check',
        applicability: 'applicable',
      },
      {
        criterion: 'Third criterion',
        taskIds: ['1', '3'],
        doneWhen: [['First check is true.'], ['Third check is true.']],
        quote: 'Third check',
        applicability: 'applicable',
      },
    ]);
  });

  it('uses the S-tier plan Coverage Check carrier', () => {
    const planText = `${PLAN_WITH_TASKS}
## Coverage Check

| Criterion | Tasks | Done when quote | Disposition |
| --- | --- | --- | --- |
| First criterion | 1 | "First check" | diff-local |
| Second criterion | 2 | "Second check" | diff-local |
`;

    expect(assembleCoverageBindingClaims({ tier: 'S', coherenceText: null, planText })).toEqual([
      {
        criterion: 'First criterion',
        taskIds: ['1'],
        doneWhen: [['First check is true.']],
        quote: 'First check',
        applicability: 'applicable',
      },
      {
        criterion: 'Second criterion',
        taskIds: ['2'],
        doneWhen: [['Second check is true.']],
        quote: 'Second check',
        applicability: 'applicable',
      },
    ]);
  });

  it('marks a claim not-applicable when a cited task has no Done when block', () => {
    const coherenceText = `| Row Class | Criterion | Cited Task Ids | Verdict | Quote | Disposition |
| --- | --- | --- | --- | --- | --- |
| criterion | Legacy criterion | task-4 | covered | "legacy quote" | diff-local |
`;
    const planText = `${PLAN_WITH_TASKS}
### Task 4: Legacy task
Task prose without a completion-check block.
`;

    expect(assembleCoverageBindingClaims({ tier: 'L', coherenceText, planText })).toEqual([
      {
        criterion: 'Legacy criterion',
        taskIds: ['4'],
        doneWhen: [],
        quote: 'legacy quote',
        applicability: 'not-applicable',
      },
    ]);
  });

  it('normalizes annotated task citations through the shared resolver for S and M/L carriers', () => {
    const planText = `${PLAN_WITH_TASKS}
### Task 7: Annotated task
**Done when:**
- The annotated task check is true.

## Coverage Check

| Criterion | Tasks | Done when quote | Disposition |
| --- | --- | --- | --- |
| S criterion | task-7 (landed) | "annotated task check" | diff-local |
`;
    const coherenceText = `| Row Class | Criterion | Cited Task Ids | Verdict | Quote | Disposition |
| --- | --- | --- | --- | --- | --- |
| criterion | M criterion | task-7 (landed) | covered | "annotated task check" | diff-local |
`;

    expect(assembleCoverageBindingClaims({ tier: 'S', coherenceText: null, planText })).toMatchObject([
      { taskIds: ['7'], doneWhen: [['The annotated task check is true.']], applicability: 'applicable' },
    ]);
    expect(assembleCoverageBindingClaims({ tier: 'M', coherenceText, planText })).toEqual([
      {
        criterion: 'M criterion',
        taskIds: ['7'],
        doneWhen: [['The annotated task check is true.']],
        quote: 'annotated task check',
        applicability: 'applicable',
      },
    ]);
  });

  it.each([
    ['annotated', 'task-2 (landed)', ['2']],
    ['multi-id', 'task-1, task-3', ['1', '3']],
    ['malformed', 'task#7', []],
    ['absent', 'task-9', []],
  ] as const)('uses shared citation resolution for %s citations on both carriers', (_label, citation, taskIds) => {
    const coherenceText = `| Row Class | Criterion | Cited Task Ids | Verdict | Quote | Disposition |
| --- | --- | --- | --- | --- | --- |
| criterion | M criterion | ${citation} | covered | "check" | diff-local |
`;
    const planText = `${PLAN_WITH_TASKS}
## Coverage Check

| Criterion | Tasks | Done when quote | Disposition |
| --- | --- | --- | --- |
| S criterion | ${citation} | "check" | diff-local |
`;

    for (const tier of ['M', 'S'] as const) {
      const [claim] = assembleCoverageBindingClaims({ tier, coherenceText, planText });
      expect(claim).toMatchObject({
        taskIds,
        applicability: taskIds.length === 0 ? 'not-applicable' : 'applicable',
      });
    }
  });

  it('returns no claims when the selected carrier has no criterion rows', () => {
    expect(assembleCoverageBindingClaims({ tier: 'M', coherenceText: null, planText: PLAN_WITH_TASKS })).toEqual([]);
    expect(assembleCoverageBindingClaims({ tier: 'S', coherenceText: null, planText: PLAN_WITH_TASKS })).toEqual([]);
  });

  it('exposes only the criterion, task ids, Done when checks, quote, and applicability', () => {
    const planText = `# Plan

### Task 1: First task
**Steps:**
1. Never send this task Steps text to the judge.

**Done when:**
- First check is true.

## Coverage Check

| Criterion | Tasks | Done when quote | Disposition |
| --- | --- | --- | --- |
| Criterion only | 1 | "First check" | diff-local |
`;

    const [claim] = assembleCoverageBindingClaims({ tier: 'S', coherenceText: null, planText });

    expect(Object.keys(claim).sort()).toEqual([
      'applicability',
      'criterion',
      'doneWhen',
      'quote',
      'taskIds',
    ]);
    expect(JSON.stringify(claim)).not.toContain('Task 1: First task');
    expect(JSON.stringify(claim)).not.toContain('Never send this task Steps text');
  });
});
