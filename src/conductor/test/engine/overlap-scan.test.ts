import { describe, it, expect } from 'vitest';

import { enumerateUnmergedBranches } from '../../src/engine/overlap-scan.js';
import type { GitRunner, GitResult } from '../../src/engine/rebase.js';

// A scripted GitRunner: matches argv prefixes to canned results (mirrors the
// fakeGit convention in test/engine/rebase.test.ts).
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
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  return { git, calls };
}

describe('engine/overlap-scan — enumerateUnmergedBranches (Task 1)', () => {
  it('returns only branches NOT merged into base, excluding merged ones', async () => {
    const { git } = fakeGit([
      {
        match: ['for-each-ref'],
        result: {
          stdout: [
            'spec/feature-a',
            'spec/feature-b',
            'spec/feature-merged',
            'origin/spec/feature-c',
          ].join('\n'),
        },
      },
      // feature-a: 3 commits ahead of base — unmerged.
      { match: ['rev-list', '--count', 'main..spec/feature-a'], result: { stdout: '3\n' } },
      // feature-b: 1 commit ahead of base — unmerged.
      { match: ['rev-list', '--count', 'main..spec/feature-b'], result: { stdout: '1\n' } },
      // feature-merged: 0 commits ahead of base — fully merged, excluded.
      {
        match: ['rev-list', '--count', 'main..spec/feature-merged'],
        result: { stdout: '0\n' },
      },
      // origin/spec/feature-c: 2 commits ahead — unmerged (open-PR head).
      {
        match: ['rev-list', '--count', 'main..origin/spec/feature-c'],
        result: { stdout: '2\n' },
      },
    ]);

    const result = await enumerateUnmergedBranches(git, 'main');

    expect(result).toEqual(
      expect.arrayContaining(['spec/feature-a', 'spec/feature-b', 'origin/spec/feature-c']),
    );
    expect(result).not.toContain('spec/feature-merged');
    expect(result).toHaveLength(3);
  });

  it('excludes the base branch itself even if it matches the candidate pattern', async () => {
    const { git } = fakeGit([
      {
        match: ['for-each-ref'],
        result: { stdout: 'spec/main\nspec/feature-x\n' },
      },
      { match: ['rev-list', '--count', 'spec/main..spec/feature-x'], result: { stdout: '1\n' } },
    ]);

    const result = await enumerateUnmergedBranches(git, 'spec/main');

    expect(result).toEqual(['spec/feature-x']);
  });

  it('treats an indeterminate rev-list result (non-zero exit) as unmerged, not silently dropped', async () => {
    const { git } = fakeGit([
      {
        match: ['for-each-ref'],
        result: { stdout: 'spec/feature-unknown\n' },
      },
      {
        match: ['rev-list', '--count', 'main..spec/feature-unknown'],
        result: { exitCode: 1, stderr: 'unknown revision' },
      },
    ]);

    const result = await enumerateUnmergedBranches(git, 'main');

    expect(result).toEqual(['spec/feature-unknown']);
  });
});
