// ─────────────────────────────────────────────────────────────────────────────
// Test: fileDirMatchesPlanPath — bounded immediate-parent-dir corroboration
// predicate (#707).
//
// Pure predicate: strips a leading `./` on both sides, then compares
// dirname(file) === dirname(planDeclaredPath) exactly. No ancestor/prefix
// logic — a file in a sibling or nested directory does not match.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { fileDirMatchesPlanPath } from '../../src/engine/autoheal.js';

describe('fileDirMatchesPlanPath (#707)', () => {
  it('matches when file and plan path share the same directory', () => {
    expect(fileDirMatchesPlanPath('src/e/a.ts', 'src/e/conductor.ts')).toBe(true);
  });

  it('rejects when file is in a different directory', () => {
    expect(fileDirMatchesPlanPath('src/cli.ts', 'src/e/conductor.ts')).toBe(false);
  });

  it('rejects when file is at repo root but plan path is nested', () => {
    expect(fileDirMatchesPlanPath('README.md', 'src/e/conductor.ts')).toBe(false);
  });

  it('strips a leading ./ before comparing', () => {
    expect(fileDirMatchesPlanPath('./src/e/a.ts', 'src/e/conductor.ts')).toBe(true);
  });
});
