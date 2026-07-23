// Test: coherence artifact parser (coherence-validator.ts)
//
// Covers parseCoherenceArtifact(text | null):
//   - well-formed table → typed rows across all four row classes
//   - missing file (null input) → 'missing-coherence-artifact'
//   - zero-byte/whitespace-only text → 'empty-coherence-artifact'
//   - corrupted/unparseable table → 'unparseable-coherence-artifact'
//   - three distinct error kinds, never collapsed into one generic error

import { describe, it, expect, vi } from 'vitest';
import {
  parseCoherenceArtifact,
  crossCheckIds,
  checkOutcomeCoverage,
  checkFrCoverage,
  checkStoryCoverage,
  checkOrphanTasks,
  checkCoverageTableConsistency,
  renderGapReport,
  validateCoherence,
  scanDuplicateClaim,
  advisoryDuplicateClaimWarn,
  type CrossCheckInputs,
  type CoherenceGap,
  type ValidateCoherenceInputs,
} from '../../../src/engine/engineer/coherence-validator.js';
import { evaluateCoherenceWaiver } from '../../../src/engine/engineer/coherence-waiver.js';
import type { GitRunner, GitResult } from '../../../src/engine/rebase.js';
import type { RunOverlapScanArgs } from '../../../src/engine/overlap-scan.js';

// A scripted GitRunner: matches argv prefixes to canned results, and records
// every invocation so tests can assert zero-network-call behavior.
function fakeGit(
  script: Array<{ match: string[]; result: Partial<GitResult> }>,
): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    calls.push(args);
    for (const entry of script) {
      if (entry.match.every((tok, i) => args[i] === tok)) {
        return {
          exitCode: entry.result.exitCode ?? 0,
          stdout: entry.result.stdout ?? '',
          stderr: entry.result.stderr ?? '',
        };
      }
    }
    return { exitCode: 1, stdout: '', stderr: '' };
  };
  return { git, calls };
}

const WELL_FORMED = `# Coherence Map

| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-1, task-1 | covered | "ship the widget" |
| fr | FR-1 | story-1 | covered | "FR-1: widgets ship" |
| story | story-1 | task-1, task-2 | covered | "As a user..." |
| task | task-1 | story-1 | covered | "Task 1: build widget" |
`;

describe('parseCoherenceArtifact', () => {
  it('parses a well-formed table into typed rows across all four row classes', () => {
    const result = parseCoherenceArtifact(WELL_FORMED);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(4);

    const outcome = result.rows.find((r) => r.rowClass === 'outcome');
    expect(outcome).toEqual({
      rowClass: 'outcome',
      id: 'outcome-1',
      citedIds: ['story-1', 'task-1'],
      verdict: 'covered',
      quote: 'ship the widget',
    });

    const fr = result.rows.find((r) => r.rowClass === 'fr');
    expect(fr).toEqual({
      rowClass: 'fr',
      id: 'FR-1',
      citedIds: ['story-1'],
      verdict: 'covered',
      quote: 'FR-1: widgets ship',
    });

    const story = result.rows.find((r) => r.rowClass === 'story');
    expect(story).toEqual({
      rowClass: 'story',
      id: 'story-1',
      citedIds: ['task-1', 'task-2'],
      verdict: 'covered',
      quote: 'As a user...',
    });

    const task = result.rows.find((r) => r.rowClass === 'task');
    expect(task).toEqual({
      rowClass: 'task',
      id: 'task-1',
      citedIds: ['story-1'],
      verdict: 'covered',
      quote: 'Task 1: build widget',
    });
  });

  it('rejects a missing file (null input) as missing-coherence-artifact', () => {
    const result = parseCoherenceArtifact(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('missing-coherence-artifact');
  });

  it.each(['', '   ', '\n\n\t  \n'])(
    'rejects zero-byte/whitespace-only text %p as empty-coherence-artifact',
    (input) => {
      const result = parseCoherenceArtifact(input);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('empty-coherence-artifact');
    },
  );

  it.each([
    ['prose with no table at all', 'not a table, just prose about the feature.'],
    ['a header row but no data rows', '| Row Class | Id | Cited Ids | Verdict | Quote |\n| --- | --- | --- | --- | --- |\n'],
    [
      'a row with a missing column',
      '| Row Class | Id | Cited Ids | Verdict | Quote |\n| --- | --- | --- | --- | --- |\n| outcome | outcome-1 | story-1 |\n',
    ],
    [
      'a row with an unrecognized row class',
      '| Row Class | Id | Cited Ids | Verdict | Quote |\n| --- | --- | --- | --- | --- |\n| widget | outcome-1 | story-1 | covered | "x" |\n',
    ],
  ])('rejects corrupted table (%s) as unparseable-coherence-artifact', (_label, input) => {
    const result = parseCoherenceArtifact(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unparseable-coherence-artifact');
  });

  it('produces three distinct error kinds, never a single generic error', () => {
    const missing = parseCoherenceArtifact(null);
    const empty = parseCoherenceArtifact('   ');
    const unparseable = parseCoherenceArtifact('garbled nonsense');
    expect(missing.ok).toBe(false);
    expect(empty.ok).toBe(false);
    expect(unparseable.ok).toBe(false);
    if (missing.ok || empty.ok || unparseable.ok) return;
    const reasons = new Set([missing.reason, empty.reason, unparseable.reason]);
    expect(reasons.size).toBe(3);
  });
});

describe('crossCheckIds', () => {
  const STORIES_TEXT = `# Stories

## Story 1: Widget shipping

### Acceptance Criteria
#### Happy Path
- Given a widget, when shipped, then it arrives.

## Story 2: Widget returns

### Acceptance Criteria
#### Happy Path
- Given a widget, when returned, then it is refunded.
`;

  const PLAN_TEXT = `# Plan

### Task 1: Build widget
**Story:** Story 1 (FR-1)
**Type:** happy-path
**Files:** src/widget.ts

### Task 2: Ship widget
**Story:** Story 1 (FR-1)
**Type:** happy-path
**Files:** src/ship.ts
`;

  const PRD_TEXT = `# PRD

## Functional Requirements

- FR-1: Widgets can be shipped.
- FR-2: Widgets can be returned.
`;

  const OUTCOME_BULLETS = ['- Ship widgets reliably.', '- Support returns.'];

  const WELL_FORMED_REAL = `# Coherence Map

| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-1 | covered | "ship widgets" |
| outcome | outcome-2 | story-2 | covered | "support returns" |
| fr | FR-1 | story-1 | covered | "FR-1: widgets" |
| fr | FR-2 | story-2 | covered | "FR-2: widgets" |
| story | story-1 | task-1, task-2 | covered | "As a user..." |
| story | story-2 | task-1 | covered | "As a user..." |
| task | task-1 | story-1 | covered | "Task 1: build widget" |
| task | task-2 | story-1 | covered | "Task 2: ship widget" |
`;

  function inputsFor(overrides: Partial<CrossCheckInputs> = {}): CrossCheckInputs {
    return {
      storiesText: STORIES_TEXT,
      planText: PLAN_TEXT,
      prdText: PRD_TEXT,
      outcomeCount: OUTCOME_BULLETS.length,
      ...overrides,
    };
  }

  function parsedRows(text: string) {
    const result = parseCoherenceArtifact(text);
    if (!result.ok) throw new Error('fixture must parse');
    return result.rows;
  }

  it('passes when every cited id resolves against real stories/plan/PRD/outcome inputs', () => {
    const result = crossCheckIds(parsedRows(WELL_FORMED_REAL), inputsFor());
    expect(result).toEqual({ ok: true });
  });

  it('rejects a row citing a fabricated story id, naming the row', () => {
    const withFabrication = WELL_FORMED_REAL.replace(
      '| task | task-1 | story-1 | covered | "Task 1: build widget" |',
      '| task | task-1 | story-99 | covered | "Task 1: build widget" |',
    );
    const result = crossCheckIds(parsedRows(withFabrication), inputsFor());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('fabricated-id');
    expect(result.rowClass).toBe('task');
    expect(result.rowId).toBe('task-1');
    expect(result.fabricatedId).toBe('story-99');
  });

  it('rejects a row citing a fabricated task id, naming the row', () => {
    const withFabrication = WELL_FORMED_REAL.replace(
      '| story | story-1 | task-1, task-2 | covered | "As a user..." |',
      '| story | story-1 | task-1, task-99 | covered | "As a user..." |',
    );
    const result = crossCheckIds(parsedRows(withFabrication), inputsFor());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('fabricated-id');
    expect(result.rowClass).toBe('story');
    expect(result.rowId).toBe('story-1');
    expect(result.fabricatedId).toBe('task-99');
  });

  it('rejects a row citing a fabricated FR id, naming the row', () => {
    const withFabrication = WELL_FORMED_REAL.replace(
      '| fr | FR-1 | story-1 | covered | "FR-1: widgets" |',
      '| fr | FR-99 | story-1 | covered | "FR-1: widgets" |',
    );
    const result = crossCheckIds(parsedRows(withFabrication), inputsFor());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('fabricated-id');
    expect(result.rowClass).toBe('fr');
    expect(result.rowId).toBe('FR-99');
  });

  it('rejects a row citing a fabricated outcome id, naming the row', () => {
    const withFabrication = WELL_FORMED_REAL.replace(
      '| outcome | outcome-1 | story-1 | covered | "ship widgets" |',
      '| outcome | outcome-99 | story-1 | covered | "ship widgets" |',
    );
    const result = crossCheckIds(parsedRows(withFabrication), inputsFor());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('fabricated-id');
    expect(result.rowClass).toBe('outcome');
    expect(result.rowId).toBe('outcome-99');
  });

  it('rejects a task row citing an id that resolves to no known class (nonexistent id in cited-ids)', () => {
    const withFabrication = WELL_FORMED_REAL.replace(
      '| task | task-2 | story-1 | covered | "Task 2: ship widget" |',
      '| task | task-2 | story-1, ghost-id | covered | "Task 2: ship widget" |',
    );
    const result = crossCheckIds(parsedRows(withFabrication), inputsFor());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('fabricated-id');
    expect(result.rowClass).toBe('task');
    expect(result.rowId).toBe('task-2');
    expect(result.fabricatedId).toBe('ghost-id');
  });
});

describe('checkOutcomeCoverage', () => {
  const BULLETS = ['- Ship widgets reliably.', '- Support returns.'];

  function rowsFrom(text: string) {
    const result = parseCoherenceArtifact(text);
    if (!result.ok) throw new Error('fixture must parse');
    return result.rows;
  }

  it('passes silently when every outcome bullet has an affirmative row', () => {
    const text = `# Coherence Map

| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-1 | covered | "Ship widgets reliably." |
| outcome | outcome-2 | story-2 | covered | "Support returns." |
`;
    const result = checkOutcomeCoverage(rowsFrom(text), BULLETS);
    expect(result).toEqual({ ok: true });
  });

  it('reports a gap outcome-<n> quoting the bullet when a bullet has no row', () => {
    const text = `# Coherence Map

| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-1 | covered | "Ship widgets reliably." |
`;
    const result = checkOutcomeCoverage(rowsFrom(text), BULLETS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('outcome-gap');
    expect(result.gapId).toBe('outcome-2');
    expect(result.bullet).toBe('- Support returns.');
  });

  it('reports a gap outcome-<n> when the matching row has a negative verdict', () => {
    const text = `# Coherence Map

| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-1 | covered | "Ship widgets reliably." |
| outcome | outcome-2 | story-2 | gap | "Support returns." |
`;
    const result = checkOutcomeCoverage(rowsFrom(text), BULLETS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('outcome-gap');
    expect(result.gapId).toBe('outcome-2');
    expect(result.bullet).toBe('- Support returns.');
  });

  it('surfaces a gap when coverage is asserted via a nonexistent story id (reuses the fabrication path)', () => {
    const text = `# Coherence Map

| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-1 | covered | "Ship widgets reliably." |
| outcome | outcome-2 | story-99 | covered | "Support returns." |
`;
    const rows = rowsFrom(text);
    const crossCheck = crossCheckIds(rows, {
      storiesText: `# Stories\n\n## Story 1: Widget shipping\n\n### Acceptance Criteria\n#### Happy Path\n- Given a widget, when shipped, then it arrives.\n`,
      planText: null,
      prdText: null,
      outcomeCount: BULLETS.length,
    });
    expect(crossCheck.ok).toBe(false);
    if (crossCheck.ok) return;
    expect(crossCheck.reason).toBe('fabricated-id');
    expect(crossCheck.fabricatedId).toBe('story-99');
  });
});

describe('checkFrCoverage', () => {
  const PRD_TEXT = `# PRD

## Functional Requirements

- FR-1: Widgets can be shipped.
- FR-2: Widgets can be returned.
`;

  it('passes when every PRD FR is cited by a story Requirement line and transitively by a task', () => {
    const storiesText = `# Stories

## Story 1: Widget shipping
**Requirement:** FR-1, FR-2

### Acceptance Criteria
#### Happy Path
- Given a widget, when shipped, then it arrives.
`;
    const planText = `# Plan

### Task 1: Build widget
**Story:** Story 1 (FR-1)
**Type:** happy-path
**Files:** src/widget.ts
`;
    const result = checkFrCoverage(PRD_TEXT, storiesText, planText);
    expect(result).toEqual({ ok: true });
  });

  it('reports a gap for an FR cited by no story', () => {
    const storiesText = `# Stories

## Story 1: Widget shipping
**Requirement:** FR-1

### Acceptance Criteria
#### Happy Path
- Given a widget, when shipped, then it arrives.
`;
    const planText = `# Plan

### Task 1: Build widget
**Story:** Story 1 (FR-1)
**Type:** happy-path
**Files:** src/widget.ts
`;
    const result = checkFrCoverage(PRD_TEXT, storiesText, planText);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('fr-gap');
    expect(result.frId).toBe('FR-2');
    expect(result.storyId).toBeUndefined();
  });

  it('reports a transitive gap naming both the FR and the story when the only citing story has no task', () => {
    const storiesText = `# Stories

## Story 1: Widget shipping
**Requirement:** FR-1

### Acceptance Criteria
#### Happy Path
- Given a widget, when shipped, then it arrives.

## Story 2: Widget returns
**Requirement:** FR-2

### Acceptance Criteria
#### Happy Path
- Given a widget, when returned, then it is refunded.
`;
    const planText = `# Plan

### Task 1: Build widget
**Story:** Story 1 (FR-1)
**Type:** happy-path
**Files:** src/widget.ts
`;
    // FR-2 is cited by story 2, but no task cites story 2 — a transitive
    // gap, not masked as either a plain uncovered-FR or silently passing.
    const result = checkFrCoverage(PRD_TEXT, storiesText, planText);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('fr-gap');
    expect(result.frId).toBe('FR-2');
    expect(result.storyId).toBe('2');
  });

  it('passes trivially (no PRD, technical track) when prdText is null', () => {
    const result = checkFrCoverage(null, '## Story 1\n', '### Task 1\n');
    expect(result).toEqual({ ok: true });
  });
});

describe('checkStoryCoverage', () => {
  it('passes when every story id is cited by ≥1 task **Story:** line', () => {
    const storiesText = `# Stories

## Story 1: Widget shipping

### Acceptance Criteria
#### Happy Path
- Given a widget, when shipped, then it arrives.

## Story 2: Widget returns

### Acceptance Criteria
#### Happy Path
- Given a widget, when returned, then it is refunded.
`;
    const planText = `# Plan

### Task 1: Build widget
**Story:** Story 1 (happy path)
**Files:** src/widget.ts

### Task 2: Build returns
**Story:** Story 2 (happy path)
**Files:** src/returns.ts
`;
    const result = checkStoryCoverage(storiesText, planText);
    expect(result).toEqual({ ok: true });
  });

  it('reports a gap naming the uncovered story id and title', () => {
    const storiesText = `# Stories

## Story 1: Widget shipping

### Acceptance Criteria
#### Happy Path
- Given a widget, when shipped, then it arrives.

## Story 2: Widget returns

### Acceptance Criteria
#### Happy Path
- Given a widget, when returned, then it is refunded.
`;
    const planText = `# Plan

### Task 1: Build widget
**Story:** Story 1 (happy path)
**Files:** src/widget.ts
`;
    const result = checkStoryCoverage(storiesText, planText);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('story-gap');
    expect(result.gapId).toBe('story-2');
    expect(result.title).toBe('Widget returns');
  });

  it('fails closed with unparseable-stories when the stories file has zero parseable blocks', () => {
    const storiesText = `# Stories

Just some prose, no story headings at all.
`;
    const planText = `# Plan

### Task 1: Build widget
**Story:** Story 1 (happy path)
**Files:** src/widget.ts
`;
    const result = checkStoryCoverage(storiesText, planText);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unparseable-stories');
  });
});

describe('checkOrphanTasks', () => {
  const STORIES_TEXT = `# Stories

## Story 1: Widget shipping

### Acceptance Criteria
#### Happy Path
- Given a widget, when shipped, then it arrives.
`;

  it('treats a task citing an existing story id as covered', () => {
    const planText = `# Plan

### Task 1: Build widget
**Story:** Story 1 (happy path)
**Type:** happy-path
**Files:** src/widget.ts
`;
    const result = checkOrphanTasks(STORIES_TEXT, planText);
    expect(result).toEqual({ ok: true });
  });

  it('treats an infrastructure task with a non-empty declared purpose as covered', () => {
    const planText = `# Plan

### Task 2: Test scaffolding
**Story:** none (infrastructure: test scaffolding for S2)
**Type:** infrastructure
**Files:** test/setup.ts
`;
    const result = checkOrphanTasks(STORIES_TEXT, planText);
    expect(result).toEqual({ ok: true });
  });

  it('treats a refactor task with a non-empty declared purpose as covered', () => {
    const planText = `# Plan

### Task 3: Cleanup
**Story:** none (refactor: dedupe helper functions)
**Type:** refactor
**Files:** src/util.ts
`;
    const result = checkOrphanTasks(STORIES_TEXT, planText);
    expect(result).toEqual({ ok: true });
  });

  it('reports task-<id> when a task cites only nonexistent story ids', () => {
    const planText = `# Plan

### Task 4: Build gizmo
**Story:** Story 99 (happy path)
**Type:** happy-path
**Files:** src/gizmo.ts
`;
    const result = checkOrphanTasks(STORIES_TEXT, planText);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('orphan-task');
    expect(result.gapId).toBe('task-4');
  });

  it('reports task-<id> for an infrastructure task with an empty/missing **Story:** line', () => {
    const planText = `# Plan

### Task 5: Scaffolding
**Story:**
**Type:** infrastructure
**Files:** test/setup.ts
`;
    const result = checkOrphanTasks(STORIES_TEXT, planText);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('orphan-task');
    expect(result.gapId).toBe('task-5');
  });

  it('reports task-<id> when there is no **Story:** line and the type is not infrastructure/refactor', () => {
    const planText = `# Plan

### Task 6: Mystery work
**Type:** happy-path
**Files:** src/mystery.ts
`;
    const result = checkOrphanTasks(STORIES_TEXT, planText);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('orphan-task');
    expect(result.gapId).toBe('task-6');
  });
});

describe('checkCoverageTableConsistency', () => {
  it('reports claim-<row> when a coverage-table row cites a task id absent from the task tree', () => {
    const planText = `# Plan

### Task 1: Build widget
**Story:** Story 1 (happy path)
**Type:** happy-path
**Files:** src/widget.ts

## Coverage Check

| Story | Tasks |
|---|---|
| 1 | 1 |
| 1 | 99 |
`;
    const result = checkCoverageTableConsistency(planText);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('coverage-table-gap');
    expect(result.gapId).toBe('claim-2');
    expect(result.detail).toContain('99');
  });

  it('reports claim-<row> when a table pair contradicts the task tree\'s actual **Story:** citations', () => {
    const planText = `# Plan

### Task 1: Build widget
**Story:** Story 1 (happy path)
**Type:** happy-path
**Files:** src/widget.ts

### Task 2: Build gizmo
**Story:** Story 2 (happy path)
**Type:** happy-path
**Files:** src/gizmo.ts

## Coverage Check

| Story | Tasks |
|---|---|
| 1 | 1 |
| 2 | 1 |
`;
    const result = checkCoverageTableConsistency(planText);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('coverage-table-gap');
    expect(result.gapId).toBe('claim-2');
  });

  it('passes when the coverage table is consistent with the task tree', () => {
    const planText = `# Plan

### Task 1: Build widget
**Story:** Story 1 (happy path)
**Type:** happy-path
**Files:** src/widget.ts

### Task 2: Build gizmo
**Story:** Story 2 (happy path)
**Type:** happy-path
**Files:** src/gizmo.ts

## Coverage Check

| Story | Tasks |
|---|---|
| 1 | 1 |
| 2 | 2 |
`;
    const result = checkCoverageTableConsistency(planText);
    expect(result).toEqual({ ok: true });
  });

  it('passes when the plan has no Coverage Check table at all', () => {
    const planText = `# Plan

### Task 1: Build widget
**Story:** Story 1 (happy path)
**Type:** happy-path
**Files:** src/widget.ts
`;
    const result = checkCoverageTableConsistency(planText);
    expect(result).toEqual({ ok: true });
  });
});

describe('validateCoherence + renderGapReport (aggregated deterministic gap report)', () => {
  // Fixture that trivially trips three distinct gap classes at once:
  //   - outcome: the staged outcome bullet has no outcome-1 row at all
  //   - fr: FR-1 is cited by story-1, but story-1 has no covering task
  //   - story: story-1 is declared but no plan task cites it
  const storiesTextThreeGaps = `# Stories

## Story 1: Ship the widget
**Requirement:** FR-1
As a user, I want a widget.
`;
  const planTextThreeGaps = `# Plan

No tasks yet.
`;
  const threeGapInputs: ValidateCoherenceInputs = {
    rows: [],
    outcomeBullets: ['Reduce checkout latency'],
    prdText: '## Functional Requirements\n\nFR-1: widgets ship\n',
    storiesText: storiesTextThreeGaps,
    planText: planTextThreeGaps,
  };

  it('aggregates gaps from three different classes into one report', () => {
    const result = validateCoherence(threeGapInputs);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.gaps).toHaveLength(3);
    const layers = result.gaps.map((g) => g.layer).sort();
    expect(layers).toEqual(['fr', 'outcome', 'story']);

    for (const gap of result.gaps) {
      expect(gap.gapId.length).toBeGreaterThan(0);
      expect(gap.artifact.length).toBeGreaterThan(0);
      expect(gap.item.length).toBeGreaterThan(0);
      expect(result.report).toContain(gap.gapId);
      expect(result.report).toContain(gap.artifact);
      expect(result.report).toContain(gap.item);
    }
  });

  it('reports the specific gap id for a single gap, not generic-only wording', () => {
    const inputs: ValidateCoherenceInputs = {
      // No outcome-1 row at all: everything else (fr/story/orphan/table)
      // is set up to pass cleanly, so exactly one gap (outcome-1) survives.
      rows: [],
      outcomeBullets: ['Reduce checkout latency'],
      prdText: null,
      storiesText: `# Stories

## Story 1: Ship the widget
**Requirement:** none
`,
      planText: `# Plan

### Task 1: Build the widget
**Story:** Story 1
**Type:** happy-path
`,
    };

    const result = validateCoherence(inputs);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].gapId).toBe('outcome-1');
    expect(result.report).toContain('outcome-1');
    expect(result.report).toContain('Reduce checkout latency');
    // Not generic-only: the specific bullet text and id must both appear.
    expect(result.report).not.toMatch(/^# Coherence gaps\n\n- \*\*outcome-\d+\*\* \(intake outcomes\): ""\n$/);
  });

  it('produces byte-identical reports for identical gap input, twice', () => {
    const gaps: CoherenceGap[] = [
      { layer: 'story', gapId: 'story-2', artifact: 'stories', item: 'Ship the gizmo' },
      { layer: 'outcome', gapId: 'outcome-1', artifact: 'intake outcomes', item: 'Reduce latency' },
      { layer: 'orphan-task', gapId: 'task-9', artifact: 'plan', item: 'Unrelated task' },
    ];

    const first = renderGapReport(gaps);
    const second = renderGapReport([...gaps]);
    expect(first).toBe(second);

    // Deterministic sort: outcome (layer 0) before story (layer 2) before
    // orphan-task (layer 3), regardless of input order.
    const outcomeIdx = first.indexOf('outcome-1');
    const storyIdx = first.indexOf('story-2');
    const orphanIdx = first.indexOf('task-9');
    expect(outcomeIdx).toBeGreaterThan(-1);
    expect(outcomeIdx).toBeLessThan(storyIdx);
    expect(storyIdx).toBeLessThan(orphanIdx);
  });

  it('renders each gap with its id, source artifact, and quoted item', () => {
    const gaps: CoherenceGap[] = [
      { layer: 'fr', gapId: 'FR-3', artifact: 'PRD', item: 'FR-3 is not cited by any story' },
    ];
    const report = renderGapReport(gaps);
    expect(report).toContain('FR-3');
    expect(report).toContain('PRD');
    expect(report).toContain('FR-3 is not cited by any story');
    // Not generic-only: the specific id must appear, not just a bare "gap" word.
    expect(report).not.toMatch(/^# Coherence gaps\n\nNo gaps found\.\n$/);
  });
});

describe('scanDuplicateClaim (Task 14, offline)', () => {
  const REF = 'acme/app#527';

  it('reports a duplicate:<ref> gap naming the conflicting slug when a default-branch intake marker carries the same Source-Ref', async () => {
    const { git, calls } = fakeGit([
      {
        match: ['ls-tree', '-r', '--name-only', 'main', '--', '.docs/intake'],
        result: { exitCode: 0, stdout: '.docs/intake/other-spec.md\n' },
      },
      {
        match: ['show', 'main:.docs/intake/other-spec.md'],
        result: { exitCode: 0, stdout: `# Intake origin: other-spec\n\nSource-Ref: ${REF}\n` },
      },
    ]);

    const result = await scanDuplicateClaim('/repo', 'main', REF, { git });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('duplicate-claim');
    expect(result.gapId).toBe(`duplicate:${REF}`);
    expect(result.conflictingSlug).toBe('other-spec');
    expect(result.gap.gapId).toBe(`duplicate:${REF}`);
    expect(result.gap.layer).toBe('duplicate-claim');
    expect(result.gap.item).toContain('other-spec');

    // Offline: only git was invoked, no gh/fetch/network call of any kind.
    expect(calls.every((c) => c[0] !== 'fetch')).toBe(true);
  });

  it('passes with zero network calls when no default-branch intake marker matches the Source-Ref', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { git, calls } = fakeGit([
      {
        match: ['ls-tree', '-r', '--name-only', 'main', '--', '.docs/intake'],
        result: { exitCode: 0, stdout: '.docs/intake/unrelated-spec.md\n' },
      },
      {
        match: ['show', 'main:.docs/intake/unrelated-spec.md'],
        result: { exitCode: 0, stdout: `# Intake origin: unrelated-spec\n\nSource-Ref: acme/app#999\n` },
      },
    ]);

    const result = await scanDuplicateClaim('/repo', 'main', REF, { git });
    expect(result.ok).toBe(true);
    expect(calls.every((c) => c[0] !== 'fetch' && c[0] !== 'gh')).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('excludes its own slug so a spec never flags itself as its own duplicate', async () => {
    const { git } = fakeGit([
      {
        match: ['ls-tree', '-r', '--name-only', 'main', '--', '.docs/intake'],
        result: { exitCode: 0, stdout: '.docs/intake/this-spec.md\n' },
      },
      {
        match: ['show', 'main:.docs/intake/this-spec.md'],
        result: { exitCode: 0, stdout: `# Intake origin: this-spec\n\nSource-Ref: ${REF}\n` },
      },
    ]);

    const result = await scanDuplicateClaim('/repo', 'main', REF, { git, excludeSlug: 'this-spec' });
    expect(result.ok).toBe(true);
  });

  it('trivially passes when there is no usable sourceRef, with zero git/network calls', async () => {
    const { git, calls } = fakeGit([]);
    const result = await scanDuplicateClaim('/repo', 'main', undefined, { git });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('integrates the duplicate:<ref> gap id with the Task 13 waiver vocabulary', async () => {
    const { git } = fakeGit([
      {
        match: ['ls-tree', '-r', '--name-only', 'main', '--', '.docs/intake'],
        result: { exitCode: 0, stdout: '.docs/intake/other-spec.md\n' },
      },
      {
        match: ['show', 'main:.docs/intake/other-spec.md'],
        result: { exitCode: 0, stdout: `# Intake origin: other-spec\n\nSource-Ref: ${REF}\n` },
      },
    ]);

    const result = await scanDuplicateClaim('/repo', 'main', REF, { git });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const verdict = await evaluateCoherenceWaiver({
      gaps: [result.gap],
      changedFiles: [{ status: 'A', path: '.docs/coherence-waivers/my-plan.md' }],
      readText: async () =>
        `Waives: ${result.gapId}\nRationale: operator approved re-claim of the same intake.\n`,
    });
    expect(verdict.ok).toBe(true);
  });
});

describe('advisoryDuplicateClaimWarn (fail-open, reuses overlap-scan.ts)', () => {
  it('is fail-open on a network/scan error: the warn is skipped, never throwing', async () => {
    const throwingGit: GitRunner = async () => {
      throw new Error('network error: could not resolve origin');
    };
    const args: RunOverlapScanArgs = {
      candidateFiles: ['src/foo.ts'],
      git: throwingGit,
      resolver: { resolve: vi.fn() } as unknown as RunOverlapScanArgs['resolver'],
      sourceRef: 'acme/app#527',
      localBase: 'main',
    };

    await expect(advisoryDuplicateClaimWarn(args)).resolves.toBeNull();
  });

  it('delegates to overlap-scan.ts machinery (no second scanner) and returns its report on success', async () => {
    const { git } = fakeGit([
      { match: ['symbolic-ref', 'refs/remotes/origin/HEAD'], result: { exitCode: 1 } },
      { match: ['rev-parse', '--verify', 'main'], result: { exitCode: 0 } },
      { match: ['for-each-ref'], result: { exitCode: 0, stdout: '' } },
    ]);
    const args: RunOverlapScanArgs = {
      candidateFiles: ['src/foo.ts'],
      git,
      resolver: { resolve: vi.fn(async () => ({ kind: 'unblocked' })) } as unknown as RunOverlapScanArgs['resolver'],
      sourceRef: 'acme/app#527',
      localBase: 'main',
    };

    const report = await advisoryDuplicateClaimWarn(args);
    expect(report).not.toBeNull();
    expect(report?.seamOverlaps).toEqual([]);
    expect(report?.skipNotes).toEqual([]);
  });
});
