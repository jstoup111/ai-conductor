// Test: coherence artifact parser (coherence-validator.ts)
//
// Covers parseCoherenceArtifact(text | null):
//   - well-formed table → typed rows across all four row classes
//   - missing file (null input) → 'missing-coherence-artifact'
//   - zero-byte/whitespace-only text → 'empty-coherence-artifact'
//   - corrupted/unparseable table → 'unparseable-coherence-artifact'
//   - three distinct error kinds, never collapsed into one generic error

import { describe, it, expect } from 'vitest';
import {
  parseCoherenceArtifact,
  crossCheckIds,
  checkOutcomeCoverage,
  checkFrCoverage,
  checkStoryCoverage,
  type CrossCheckInputs,
} from '../../../src/engine/engineer/coherence-validator.js';

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
