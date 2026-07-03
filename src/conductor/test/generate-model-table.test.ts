import { describe, it, expect } from 'vitest';
import {
  spliceGeneratedRegion,
  MarkerError,
  BEGIN_MARKER,
  END_MARKER,
} from '../src/tools/generate-model-table.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED/GREEN specs for the pure marker-region splicer (.docs/stories/
// generated-model-table.md, TS-2 happy path 1; Task 6 of the implementation
// plan). spliceGeneratedRegion must be a pure function: no I/O, deterministic,
// replacing only the BEGIN/END marker region and leaving every other byte
// (prose, markers, interim-fallback blockquote) identical.
// ─────────────────────────────────────────────────────────────────────────────

const PROSE_BEFORE = '# Harness Behavioral Rules\n\nSome hand-authored prose above the table.\n\n';
const PROSE_AFTER =
  '\n\n> Interim fallback note (#186): survives byte-identical outside the region.\n' +
  '\nTwo enforcement paths: engine defaults and SKILL.md pins.\n';

const STALE_TABLE = '| Skill/Agent | Model | Effort | Why |\n|---|---|---|---|\n| stale | stale | stale | stale row from a previous run |';

const NEW_TABLE = '| Skill/Agent | Model | Effort | Why |\n|---|---|---|---|\n| plan | sonnet (S/M), fable (L) | medium (S) | because |';

function fixture(table: string): string {
  return (
    PROSE_BEFORE +
    BEGIN_MARKER +
    '\n' +
    table +
    '\n' +
    END_MARKER +
    PROSE_AFTER
  );
}

describe('spliceGeneratedRegion (TS-2 happy path 1)', () => {
  it('replaces only the region between the BEGIN/END markers', () => {
    const doc = fixture(STALE_TABLE);
    const result = spliceGeneratedRegion(doc, NEW_TABLE);

    expect(result).toBe(fixture(NEW_TABLE));
    expect(result).toContain(NEW_TABLE);
    expect(result).not.toContain('stale row from a previous run');
  });

  it('preserves every byte outside the region — prose, markers, blockquote', () => {
    const doc = fixture(STALE_TABLE);
    const result = spliceGeneratedRegion(doc, NEW_TABLE);

    expect(result.startsWith(PROSE_BEFORE + BEGIN_MARKER + '\n')).toBe(true);
    expect(result.endsWith(END_MARKER + PROSE_AFTER)).toBe(true);
  });

  it('is pure: calling it twice with the same inputs yields identical output and does not mutate inputs', () => {
    const doc = fixture(STALE_TABLE);
    const docCopy = doc.slice();

    const first = spliceGeneratedRegion(doc, NEW_TABLE);
    const second = spliceGeneratedRegion(doc, NEW_TABLE);

    expect(first).toBe(second);
    expect(doc).toBe(docCopy);
  });

  it('is idempotent: splicing the already-regenerated doc with the same table is a no-op', () => {
    const once = spliceGeneratedRegion(fixture(STALE_TABLE), NEW_TABLE);
    const twice = spliceGeneratedRegion(once, NEW_TABLE);
    expect(twice).toBe(once);
  });

  describe('marker validation (edge cases)', () => {
    it('throws MarkerError when the BEGIN marker is missing', () => {
      const doc = PROSE_BEFORE + 'no begin marker here\n' + END_MARKER + PROSE_AFTER;
      expect(() => spliceGeneratedRegion(doc, NEW_TABLE)).toThrow(MarkerError);
    });

    it('throws MarkerError when the END marker is missing', () => {
      const doc = PROSE_BEFORE + BEGIN_MARKER + '\n' + STALE_TABLE + '\nno end marker here' + PROSE_AFTER;
      expect(() => spliceGeneratedRegion(doc, NEW_TABLE)).toThrow(MarkerError);
    });

    it('throws MarkerError when END appears before BEGIN', () => {
      const doc = PROSE_BEFORE + END_MARKER + '\n' + STALE_TABLE + '\n' + BEGIN_MARKER + PROSE_AFTER;
      expect(() => spliceGeneratedRegion(doc, NEW_TABLE)).toThrow(MarkerError);
    });

    it('throws MarkerError on a duplicate BEGIN marker', () => {
      const doc =
        PROSE_BEFORE +
        BEGIN_MARKER +
        '\n' +
        STALE_TABLE +
        '\n' +
        BEGIN_MARKER +
        '\n' +
        END_MARKER +
        PROSE_AFTER;
      expect(() => spliceGeneratedRegion(doc, NEW_TABLE)).toThrow(MarkerError);
    });

    it('throws MarkerError on a duplicate END marker', () => {
      const doc =
        PROSE_BEFORE +
        BEGIN_MARKER +
        '\n' +
        STALE_TABLE +
        '\n' +
        END_MARKER +
        '\n' +
        END_MARKER +
        PROSE_AFTER;
      expect(() => spliceGeneratedRegion(doc, NEW_TABLE)).toThrow(MarkerError);
    });

    it('requires the BEGIN marker to be on its own line', () => {
      const doc = PROSE_BEFORE + 'prefix text ' + BEGIN_MARKER + '\n' + STALE_TABLE + '\n' + END_MARKER + PROSE_AFTER;
      expect(() => spliceGeneratedRegion(doc, NEW_TABLE)).toThrow(MarkerError);
    });

    it('requires the END marker to be on its own line', () => {
      const doc = PROSE_BEFORE + BEGIN_MARKER + '\n' + STALE_TABLE + '\n' + END_MARKER + ' trailing text' + PROSE_AFTER;
      expect(() => spliceGeneratedRegion(doc, NEW_TABLE)).toThrow(MarkerError);
    });
  });
});
