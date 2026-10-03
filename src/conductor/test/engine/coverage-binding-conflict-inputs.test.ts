import { describe, expect, it } from 'vitest';
import { buildConflictTaskTable } from '../../src/engine/coverage-binding-conflict-inputs.js';

describe('buildConflictTaskTable', () => {
  it('returns every plan task, including remediation tasks, with titles and Done when checks', () => {
    const plan = `### Task 1: Establish the first obligation
**Done when:**
- First observable check

### Task 2: Establish the second obligation
**Done when:**
- Second observable check
- Another second check

### Task rem-build-review-2: Repair the review finding
**Done when:**
- The review repair is observable`;

    expect(buildConflictTaskTable(plan)).toEqual([
      { id: '1', title: 'Establish the first obligation', doneWhen: ['First observable check'] },
      { id: '2', title: 'Establish the second obligation', doneWhen: ['Second observable check', 'Another second check'] },
      { id: 'rem-build-review-2', title: 'Repair the review finding', doneWhen: ['The review repair is observable'] },
    ]);
  });

  it('keeps a task without a Done when block with an empty checks list', () => {
    expect(buildConflictTaskTable(`### Task 1: Legacy task\n**Files:** src/legacy.ts`)).toEqual([
      { id: '1', title: 'Legacy task', doneWhen: [] },
    ]);
  });

  it('excludes slice membership and manifest text from task rows', () => {
    const plan = `## Slices

| Slice | Title | Tasks |
| --- | --- | --- |
| 1 | Foundation slice | 1 |

### Task 1: Build the foundation
**Done when:**
- Foundation is built`;

    const [row] = buildConflictTaskTable(plan);

    expect(row).toEqual({ id: '1', title: 'Build the foundation', doneWhen: ['Foundation is built'] });
    expect(Object.keys(row!)).toEqual(['id', 'title', 'doneWhen']);
    expect(JSON.stringify(row)).not.toContain('slice');
    expect(JSON.stringify(row)).not.toContain('Foundation slice');
  });
});
