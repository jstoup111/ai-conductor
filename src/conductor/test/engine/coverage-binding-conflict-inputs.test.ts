// Covers: S2.1, S2.2, S2.3
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildConflictTaskTable, resolveConflictSubjectAdrs } from '../../src/engine/coverage-binding-conflict-inputs.js';

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

describe('resolveConflictSubjectAdrs', () => {
  it('returns approved DECIDE-set and cited ADRs, including partial supersessions', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'coverage-binding-conflict-inputs-'));
    const decisions = join(projectRoot, '.docs', 'decisions');

    try {
      await mkdir(decisions, { recursive: true });
      await Promise.all([
        writeFile(join(decisions, 'adr-changed.md'), '**Status:** APPROVED\n'),
        writeFile(join(decisions, 'adr-cited.md'), '**Status:** Approved\n'),
        writeFile(join(decisions, 'adr-partial.md'), '**Status:** SUPERSEDED in part by adr-replacement\n'),
        writeFile(join(decisions, 'adr-draft.md'), '**Status:** DRAFT\n'),
        writeFile(join(decisions, 'adr-superseded.md'), '**Status:** SUPERSEDED by adr-replacement\n'),
        writeFile(join(decisions, 'adr-uncited.md'), '**Status:** APPROVED\n'),
      ]);

      await expect(resolveConflictSubjectAdrs({
        projectRoot,
        planText: 'Cites adr-cited, adr-partial, adr-draft, adr-superseded, and adr-missing.',
        decideSetAdrPaths: new Set(['.docs/decisions/adr-changed.md']),
      })).resolves.toEqual([
        '.docs/decisions/adr-changed.md',
        '.docs/decisions/adr-cited.md',
        '.docs/decisions/adr-partial.md',
      ]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
