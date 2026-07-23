// Test: coherence artifact parser (coherence-validator.ts)
//
// Covers parseCoherenceArtifact(text | null):
//   - well-formed table → typed rows across all four row classes
//   - missing file (null input) → 'missing-coherence-artifact'
//   - zero-byte/whitespace-only text → 'empty-coherence-artifact'
//   - corrupted/unparseable table → 'unparseable-coherence-artifact'
//   - three distinct error kinds, never collapsed into one generic error

import { describe, it, expect } from 'vitest';
import { parseCoherenceArtifact } from '../../../src/engine/engineer/coherence-validator.js';

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
