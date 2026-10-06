// Covers: S2.1, S2.2, S2.3
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assembleConflictClaims,
  buildConflictTaskTable,
  resolveConflictSubjectAdrs,
} from '../../src/engine/coverage-binding-conflict-inputs.js';

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

describe('assembleConflictClaims', () => {
  const plan = `### Task 1: Preserve the first outcome
**Done when:**
- The first outcome is observable.

### Task 2: Preserve the second outcome
Task prose without a completion-check block.`;

  const stories = `## Story 1: Preserve outcomes

### Happy Path
- Given the first input, when the feature runs, then the first outcome is preserved.

### Negative Paths
- Given the rejected input, when the feature runs, then the fallback outcome is preserved.`;

  it('assembles one criterion claim per authoritative criterion against every plan task', () => {
    expect(assembleConflictClaims({
      planText: plan,
      storiesText: stories,
      subjectAdrs: [],
      amendmentClaims: [],
    })).toEqual([
      {
        id: 'stories#criterion-1',
        kind: 'criterion',
        text: 'Story 1 happy: Given the first input, when the feature runs, then the first outcome is preserved.',
        taskTable: [
          { id: '1', title: 'Preserve the first outcome', doneWhen: ['The first outcome is observable.'] },
          { id: '2', title: 'Preserve the second outcome', doneWhen: [] },
        ],
        applicability: 'applicable',
      },
      {
        id: 'stories#criterion-2',
        kind: 'criterion',
        text: 'Story 1 negative: Given the rejected input, when the feature runs, then the fallback outcome is preserved.',
        taskTable: [
          { id: '1', title: 'Preserve the first outcome', doneWhen: ['The first outcome is observable.'] },
          { id: '2', title: 'Preserve the second outcome', doneWhen: [] },
        ],
        applicability: 'applicable',
      },
    ]);
  });

  it('assembles grouped ADR decision passages and a section fallback, excluding amendment-owned decisions', () => {
    const amended = '> **Amended 2026-10-03 by #2750:**\n> 3. The amendment alone owns this decision.';

    expect(assembleConflictClaims({
      planText: plan,
      storiesText: '',
      subjectAdrs: [
        {
          path: '.docs/decisions/adr-subject.md',
          text: `# ADR\n\n## Decision\n\n1. First passage.\n\n**1. Second passage.**\n\n${amended}`,
        },
        {
          path: '.docs/decisions/adr-no-ids.md',
          text: '# ADR\n\n## Decision\n\nThis whole decision section has no citable id.',
        },
      ],
      amendmentClaims: [{
        kind: 'amendment',
        artifactPath: '.docs/decisions/adr-subject.md',
        amendment: amended,
        taskIds: ['1', '2'],
        doneWhen: [['The first outcome is observable.'], []],
      }],
    })).toEqual([
      {
        id: 'stories#unparseable',
        kind: 'criterion',
        text: '',
        taskTable: [
          { id: '1', title: 'Preserve the first outcome', doneWhen: ['The first outcome is observable.'] },
          { id: '2', title: 'Preserve the second outcome', doneWhen: [] },
        ],
        applicability: 'not-applicable',
      },
      {
        id: 'adr-subject#D1',
        kind: 'adr-decision',
        text: '1. First passage.\n\n**1. Second passage.**',
        taskTable: [
          { id: '1', title: 'Preserve the first outcome', doneWhen: ['The first outcome is observable.'] },
          { id: '2', title: 'Preserve the second outcome', doneWhen: [] },
        ],
        applicability: 'applicable',
      },
      {
        id: 'adr-no-ids#Decision',
        kind: 'adr-decision',
        text: 'This whole decision section has no citable id.',
        taskTable: [
          { id: '1', title: 'Preserve the first outcome', doneWhen: ['The first outcome is observable.'] },
          { id: '2', title: 'Preserve the second outcome', doneWhen: [] },
        ],
        applicability: 'applicable',
      },
    ]);
  });

  it('keeps inherited amendments in the decision text while excluding branch-owned amendments', () => {
    const inherited = '> **Amended 2026-10-01 by #2709:** The managed prelude no longer initializes configuration.';
    const branch = '> **Amended 2026-10-06 by #3010:** This branch amendment is judged by D18 alone.';

    const [claim] = assembleConflictClaims({
      planText: plan,
      storiesText: '',
      subjectAdrs: [{
        path: '.docs/decisions/adr-subject.md',
        text: `# ADR\n\n## Decision\n\n8. The managed prelude keeps its auto-init call.\n\n${inherited}\n\n${branch}\n\n` +
          'A ruling that follows both amendments.',
      }],
      amendmentClaims: [{
        kind: 'amendment',
        artifactPath: '.docs/decisions/adr-subject.md',
        amendment: branch,
        taskIds: ['1', '2'],
        doneWhen: [['The first outcome is observable.'], []],
      }],
    }).filter(({ kind }) => kind === 'adr-decision');

    expect(claim).toMatchObject({
      id: 'adr-subject#D8',
      text: '8. The managed prelude keeps its auto-init call.\n\n' +
        '**Amended 2026-10-01 by #2709:** The managed prelude no longer initializes configuration.\n\n' +
        'A ruling that follows both amendments.',
    });
  });

  it('marks every claim not-applicable when no task has a Done when block', () => {
    expect(assembleConflictClaims({
      planText: '### Task 1: Legacy task\nTask prose only.',
      storiesText: stories,
      subjectAdrs: [{
        path: '.docs/decisions/adr-subject.md',
        text: '# ADR\n\n## Decision\n\n1. A decision.',
      }],
      amendmentClaims: [],
    }).map(({ id, applicability }) => ({ id, applicability }))).toEqual([
      { id: 'stories#criterion-1', applicability: 'not-applicable' },
      { id: 'stories#criterion-2', applicability: 'not-applicable' },
      { id: 'adr-subject#D1', applicability: 'not-applicable' },
    ]);
  });
});
