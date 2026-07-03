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
