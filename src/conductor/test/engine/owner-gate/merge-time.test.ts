// Test: owner-gate merge-time derivation (merge-time.ts)
//
// Covers first-appearance time from git history (ADR-3):
//   - two ISO lines (newest-first log) → the EARLIEST (last line)
//   - empty stdout → null; non-zero git exit → null (indeterminate)

import { describe, it, expect } from 'vitest';
import { firstAppearanceTime } from '../../../src/engine/owner-gate/merge-time.js';
import type { GitRunner, GitResult } from '../../../src/engine/rebase.js';

interface GitStub {
  git: GitRunner;
  calls: string[][];
}

function gitReturning(result: Partial<GitResult>): GitStub {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    calls.push([...args]);
    return { exitCode: 0, stdout: '', stderr: '', ...result };
  };
  return { git, calls };
}

describe('firstAppearanceTime', () => {
  it('returns the earliest (first-appearance) commit time from a newest-first log', async () => {
    const { git, calls } = gitReturning({
      stdout: '2026-06-20T10:00:00Z\n2026-05-01T09:00:00Z\n',
    });
    await expect(firstAppearanceTime(git, 'main', '.docs/plans/my-slug.md')).resolves.toBe(
      '2026-05-01T09:00:00Z',
    );
    expect(calls[0]).toEqual([
      'log',
      'main',
      '--diff-filter=A',
      '--format=%cI',
      '--',
      '.docs/plans/my-slug.md',
    ]);
  });

  it('returns null on empty output (no history)', async () => {
    const { git } = gitReturning({ stdout: '\n' });
    await expect(firstAppearanceTime(git, 'main', '.docs/plans/x.md')).resolves.toBeNull();
  });

  it('returns null on a non-zero git exit (indeterminate)', async () => {
    const { git } = gitReturning({ exitCode: 128, stdout: '2026-05-01T09:00:00Z\n' });
    await expect(firstAppearanceTime(git, 'main', '.docs/plans/x.md')).resolves.toBeNull();
  });
});
