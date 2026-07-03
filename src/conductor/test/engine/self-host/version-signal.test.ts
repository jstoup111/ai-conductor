import { describe, it, expect } from 'vitest';
import { PATCH_SAFE_GLOBS, classifyVersionSignal } from '../../../src/engine/self-host/version-signal.js';

// Task 4: classifier module + allow-list constant
//
// Test the core classifier skeleton: types, PATCH_SAFE_GLOBS constant, and
// fail-closed null/empty handling. Later tasks build out the MAJOR/MINOR/PATCH signals.

describe('PATCH_SAFE_GLOBS (TR-2 PATCH allow-list)', () => {
  it('exports an exact set of patch-safe glob patterns', () => {
    // The allow-list is the single source of truth for patch-safe paths.
    // This test asserts the exact contents so layout drift breaks loudly.
    expect(PATCH_SAFE_GLOBS).toEqual([
      'README.md',
      '.docs/**',
      'test/**',
      'src/conductor/src/**',
    ]);
  });
});

describe('classifyVersionSignal (TR-2 core)', () => {
  it('empty change set → undeterminable (fail-closed)', () => {
    const result = classifyVersionSignal([]);
    expect(result.level).toBe('halt-undeterminable');
  });

  it('null change set → undeterminable (fail-closed)', () => {
    const result = classifyVersionSignal(null);
    expect(result.level).toBe('halt-undeterminable');
  });
});

// Task 5: MAJOR surface detection
//
// MAJOR signals when breaking surfaces are modified: bin/conduct CLI,
// skill symlink targets (deleted or renamed), hook wiring, settings schema,
// or templates. Hooks with A (added) status are MINOR, not MAJOR (Task 7).

describe('classifyVersionSignal (TR-2 MAJOR happy)', () => {
  it('M bin/conduct → major/"bin/conduct CLI"', () => {
    const result = classifyVersionSignal([
      { status: 'M', path: 'bin/conduct' },
    ]);
    expect(result.level).toBe('major');
    if (result.level === 'major') {
      expect(result.signals).toContainEqual(
        expect.objectContaining({ kind: 'bin/conduct CLI' })
      );
    }
  });

  it('R100 skills/tdd/SKILL.md → archive/tdd/SKILL.md → major (origPath inspected)', () => {
    const result = classifyVersionSignal([
      { status: 'R100', path: 'archive/tdd/SKILL.md', origPath: 'skills/tdd/SKILL.md' },
    ]);
    expect(result.level).toBe('major');
    if (result.level === 'major') {
      expect(result.signals).toContainEqual(
        expect.objectContaining({ kind: 'skill symlink targets' })
      );
    }
  });

  it('D skills/finish/SKILL.md → major (deleted skill)', () => {
    const result = classifyVersionSignal([
      { status: 'D', path: 'skills/finish/SKILL.md' },
    ]);
    expect(result.level).toBe('major');
    if (result.level === 'major') {
      expect(result.signals).toContainEqual(
        expect.objectContaining({ kind: 'skill symlink targets' })
      );
    }
  });

  it('M hooks/claude/block-default-branch.sh → major (modified hook)', () => {
    const result = classifyVersionSignal([
      { status: 'M', path: 'hooks/claude/block-default-branch.sh' },
    ]);
    expect(result.level).toBe('major');
    if (result.level === 'major') {
      expect(result.signals).toContainEqual(
        expect.objectContaining({ kind: 'hook wiring' })
      );
    }
  });

  it('M templates/settings.json → major (settings template)', () => {
    const result = classifyVersionSignal([
      { status: 'M', path: 'templates/settings.json' },
    ]);
    expect(result.level).toBe('major');
    if (result.level === 'major') {
      expect(result.signals).toContainEqual(
        expect.objectContaining({ kind: 'settings.json schema' })
      );
    }
  });
});

// Task 6: mixed-signal precedence
//
// When a change set contains both MAJOR and MINOR signals, the result level must
// be MAJOR (precedence: major > minor > patch), and the signals array must contain
// ALL signals (for diagnostic purposes), not just the max-level ones.

describe('classifyVersionSignal (TR-2 MAJOR negative - mixed signals)', () => {
  it('A skills/new-skill/SKILL.md + D bin/install → level major, signals array contains both', () => {
    const result = classifyVersionSignal([
      { status: 'A', path: 'skills/new-skill/SKILL.md' },
      { status: 'D', path: 'bin/install' },
    ]);
    expect(result.level).toBe('major');
    if (result.level === 'major') {
      // Both signals should be present
      expect(result.signals).toHaveLength(2);
      expect(result.signals).toContainEqual(
        expect.objectContaining({ kind: 'skill symlink targets' })
      );
      expect(result.signals).toContainEqual(
        expect.objectContaining({ kind: 'new skill' })
      );
    }
  });
});

// Task 7: MINOR signal detection
//
// MINOR signals when additive (non-breaking) surfaces are added: new skills
// (A status + skills/*/SKILL.md), new hooks (A status + hooks/claude/*.sh),
// or new engine gates. Added files are distinct from modified files (A ≠ M).

describe('classifyVersionSignal (TR-2 MINOR happy)', () => {
  it('A skills/new-thing/SKILL.md → minor/"new skill"', () => {
    const result = classifyVersionSignal([
      { status: 'A', path: 'skills/new-thing/SKILL.md' },
    ]);
    expect(result.level).toBe('minor');
    if (result.level === 'minor') {
      expect(result.signals).toContainEqual(
        expect.objectContaining({ kind: 'new skill' })
      );
    }
  });

  it('A hooks/claude/new.sh → minor/"new hook"', () => {
    const result = classifyVersionSignal([
      { status: 'A', path: 'hooks/claude/new.sh' },
    ]);
    expect(result.level).toBe('minor');
    if (result.level === 'minor') {
      expect(result.signals).toContainEqual(
        expect.objectContaining({ kind: 'new hook' })
      );
    }
  });

  it('A src/conductor/src/engine/self-host/new-gate.ts → minor/"new engine gate"', () => {
    const result = classifyVersionSignal([
      { status: 'A', path: 'src/conductor/src/engine/self-host/new-gate.ts' },
    ]);
    expect(result.level).toBe('minor');
    if (result.level === 'minor') {
      expect(result.signals).toContainEqual(
        expect.objectContaining({ kind: 'new engine gate' })
      );
    }
  });
});

// Task 8: MINOR near-misses (adversarial)
//
// Adversarial boundary-condition tests to ensure the classifier doesn't
// misclassify ambiguous or unsupported changes as additive (MINOR).
// HARNESS.md changes are undeterminable (can't reason about additivity).
// Modified engine files are PATCH-safe. Supporting files (non-SKILL.md) don't
// count as new skills. These tests protect against false-positive MINOR signals.

describe('classifyVersionSignal (TR-2 MINOR near-misses - adversarial)', () => {
  it('M HARNESS.md → halt-undeterminable (additivity undecidable)', () => {
    const result = classifyVersionSignal([
      { status: 'M', path: 'HARNESS.md' },
    ]);
    expect(result.level).toBe('halt-undeterminable');
    if (result.level === 'halt-undeterminable') {
      // Reason should mention HARNESS.md or additivity concern
      expect(result.reason).toMatch(/HARNESS|additivity|undecidable/i);
    }
  });

  it('M src/conductor/src/engine/self-host/version-gate.ts alone → patch (PATCH_SAFE_GLOBS)', () => {
    const result = classifyVersionSignal([
      { status: 'M', path: 'src/conductor/src/engine/self-host/version-gate.ts' },
    ]);
    expect(result.level).toBe('patch');
  });

  it('A skills/new-thing/reference.md (no SKILL.md) → halt-unclassified (supporting file only)', () => {
    const result = classifyVersionSignal([
      { status: 'A', path: 'skills/new-thing/reference.md' },
    ]);
    expect(result.level).toBe('halt-undeterminable');
    if (result.level === 'halt-undeterminable') {
      // Reason should mention unclassified or unknown path
      expect(result.reason).toMatch(/unclassified|unknown|unsupported/i);
    }
  });
});

// Task 9: PATCH fail-closed boundaries
//
// PATCH requires EVERY path in the change set to match PATCH_SAFE_GLOBS.
// Any unclassified path (unknown to MAJOR/MINOR/PATCH) triggers fail-closed halt.
// Precedence: undeterminable (empty/null/unknown-path) > MAJOR > MINOR > PATCH.

describe('classifyVersionSignal (TR-2 PATCH happy)', () => {
  it('multi-patch set {M README.md, M .docs/plans/foo.md, M test/engine/x.test.ts, M src/conductor/src/engine/selector.ts} → patch', () => {
    const result = classifyVersionSignal([
      { status: 'M', path: 'README.md' },
      { status: 'M', path: '.docs/plans/foo.md' },
      { status: 'M', path: 'test/engine/x.test.ts' },
      { status: 'M', path: 'src/conductor/src/engine/selector.ts' },
    ]);
    expect(result.level).toBe('patch');
  });

  it('single-patch file M README.md → patch', () => {
    const result = classifyVersionSignal([
      { status: 'M', path: 'README.md' },
    ]);
    expect(result.level).toBe('patch');
  });

  it('patch-safe glob patterns all pass → patch', () => {
    const result = classifyVersionSignal([
      { status: 'M', path: '.docs/some/nested/file.md' },
      { status: 'M', path: 'test/some/test.ts' },
      { status: 'M', path: 'src/conductor/src/engine/something.ts' },
    ]);
    expect(result.level).toBe('patch');
  });
});

describe('classifyVersionSignal (TR-2 PATCH negatives - fail-closed)', () => {
  it('{M README.md, A some/new/dir/file.txt} → halt-undeterminable naming the unclassified path', () => {
    const result = classifyVersionSignal([
      { status: 'M', path: 'README.md' },
      { status: 'A', path: 'some/new/dir/file.txt' },
    ]);
    expect(result.level).toBe('halt-undeterminable');
    if (result.level === 'halt-undeterminable') {
      // The reason should name the unclassified path
      expect(result.reason).toContain('some/new/dir/file.txt');
    }
  });

  it('{M README.md, A skills/x/SKILL.md} → minor (allow-listed neighbors don\'t dilute)', () => {
    const result = classifyVersionSignal([
      { status: 'M', path: 'README.md' },
      { status: 'A', path: 'skills/x/SKILL.md' },
    ]);
    expect(result.level).toBe('minor');
    if (result.level === 'minor') {
      expect(result.signals).toContainEqual(
        expect.objectContaining({ kind: 'new skill' })
      );
    }
  });

  it('{M README.md, A .docs/new/doc.md, A some/unknown/file.ts} → halt-undeterminable naming unknown path', () => {
    const result = classifyVersionSignal([
      { status: 'M', path: 'README.md' },
      { status: 'A', path: '.docs/new/doc.md' },
      { status: 'A', path: 'some/unknown/file.ts' },
    ]);
    expect(result.level).toBe('halt-undeterminable');
    if (result.level === 'halt-undeterminable') {
      expect(result.reason).toContain('some/unknown/file.ts');
    }
  });

  it('A another/unclassified/file.txt alone → halt-undeterminable', () => {
    const result = classifyVersionSignal([
      { status: 'A', path: 'another/unclassified/file.txt' },
    ]);
    expect(result.level).toBe('halt-undeterminable');
    if (result.level === 'halt-undeterminable') {
      expect(result.reason).toContain('another/unclassified/file.txt');
    }
  });
});
