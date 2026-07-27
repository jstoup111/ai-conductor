// Tests for the coherence waiver parser/evaluator (Task 13).
//
// Mirrors src/engine/self-host/release-gate.ts's parseWaiver/findWaiverInDiff
// semantics (adr-2026-07-22-coherence-waiver-and-duplicate-claim): parse-don't-
// validate, fresh-in-diff freshness, partial-coverage-still-blocks.

import { describe, it, expect } from 'vitest';
import {
  parseCoherenceWaiver,
  evaluateCoherenceWaiver,
  type CoherenceWaiverChangedFile,
} from '../../../src/engine/engineer/coherence-waiver.js';
import type { CoherenceGap } from '../../../src/engine/engineer/coherence-validator.js';

function gap(gapId: string): CoherenceGap {
  return { layer: 'outcome', gapId, artifact: 'intake outcomes', item: `bullet for ${gapId}` };
}

const WAIVER_PATH = '.docs/coherence-waivers/my-spec.md';

describe('parseCoherenceWaiver', () => {
  it('parses a valid Waives: + Rationale: block against the known gap-id vocabulary', () => {
    const text = 'Waives: outcome-2, story-4\nRationale: outcome-2 and story-4 are intentionally descoped.\n';
    const parsed = parseCoherenceWaiver(text, ['outcome-2', 'story-4', 'FR-3']);
    expect(parsed).toEqual({
      gapIds: ['outcome-2', 'story-4'],
      rationale: 'outcome-2 and story-4 are intentionally descoped.',
    });
  });

  it('is malformed when a waived gap id is not in the known vocabulary (unknown gap id)', () => {
    const text = 'Waives: outcome-9\nRationale: non-empty rationale.\n';
    const parsed = parseCoherenceWaiver(text, ['outcome-2']);
    expect(parsed).toBeNull();
  });

  it('is malformed when the rationale is empty', () => {
    const text = 'Waives: outcome-2\nRationale:\n';
    const parsed = parseCoherenceWaiver(text, ['outcome-2']);
    expect(parsed).toBeNull();
  });

  it('is malformed when there is no Waives: line', () => {
    const text = 'Rationale: no waives line here.\n';
    const parsed = parseCoherenceWaiver(text, ['outcome-2']);
    expect(parsed).toBeNull();
  });

  it('is malformed when the Waives: list is empty', () => {
    const text = 'Waives: \nRationale: nothing waived.\n';
    const parsed = parseCoherenceWaiver(text, ['outcome-2']);
    expect(parsed).toBeNull();
  });
});

describe('evaluateCoherenceWaiver', () => {
  it('passes with waiver when the waiver is fresh-in-diff and covers every gap id', async () => {
    const gaps = [gap('outcome-2'), gap('story-4')];
    const changedFiles: CoherenceWaiverChangedFile[] = [
      { status: 'A', path: WAIVER_PATH },
    ];
    const text = 'Waives: outcome-2, story-4\nRationale: both intentionally descoped for this milestone.\n';
    const result = await evaluateCoherenceWaiver({
      gaps,
      changedFiles,
      readText: async (p) => (p === WAIVER_PATH ? text : null),
    });
    expect(result.ok).toBe(true);
  });

  it('blocks naming the unwaived remainder on partial coverage', async () => {
    const gaps = [gap('outcome-2'), gap('story-4')];
    const changedFiles: CoherenceWaiverChangedFile[] = [
      { status: 'A', path: WAIVER_PATH },
    ];
    const text = 'Waives: outcome-2\nRationale: only outcome-2 is intentionally descoped.\n';
    const result = await evaluateCoherenceWaiver({
      gaps,
      changedFiles,
      readText: async (p) => (p === WAIVER_PATH ? text : null),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.unwaived.map((g) => g.gapId)).toEqual(['story-4']);
      expect(result.reason).toContain('story-4');
    }
  });

  it('blocks when the waiver cites an unknown gap id (malformed)', async () => {
    const gaps = [gap('outcome-2')];
    const changedFiles: CoherenceWaiverChangedFile[] = [
      { status: 'A', path: WAIVER_PATH },
    ];
    const text = 'Waives: outcome-9\nRationale: this id does not exist in the current gap set.\n';
    const result = await evaluateCoherenceWaiver({
      gaps,
      changedFiles,
      readText: async (p) => (p === WAIVER_PATH ? text : null),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.unwaived.map((g) => g.gapId)).toEqual(['outcome-2']);
      expect(result.reason.toLowerCase()).toContain('malformed');
    }
  });

  it('blocks when the waiver has an empty rationale (malformed)', async () => {
    const gaps = [gap('outcome-2')];
    const changedFiles: CoherenceWaiverChangedFile[] = [
      { status: 'A', path: WAIVER_PATH },
    ];
    const text = 'Waives: outcome-2\nRationale:\n';
    const result = await evaluateCoherenceWaiver({
      gaps,
      changedFiles,
      readText: async (p) => (p === WAIVER_PATH ? text : null),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.toLowerCase()).toContain('malformed');
    }
  });

  it('does not apply a waiver present on the base branch but absent from this change set (fresh-in-diff)', async () => {
    const gaps = [gap('outcome-2')];
    // The waiver file exists on disk (readText resolves it) but is NOT part of
    // the diff's changed files — simulating a waiver landed by a prior spec.
    const changedFiles: CoherenceWaiverChangedFile[] = [];
    const text = 'Waives: outcome-2\nRationale: landed by a prior, unrelated spec.\n';
    const result = await evaluateCoherenceWaiver({
      gaps,
      changedFiles,
      readText: async (p) => (p === WAIVER_PATH ? text : null),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.unwaived.map((g) => g.gapId)).toEqual(['outcome-2']);
      expect(result.reason.toLowerCase()).toContain('not committed with this change set');
    }
  });

  it('passes trivially when there are no gaps to waive, regardless of waiver presence', async () => {
    const result = await evaluateCoherenceWaiver({
      gaps: [],
      changedFiles: [],
      readText: async () => null,
    });
    expect(result.ok).toBe(true);
  });
});
