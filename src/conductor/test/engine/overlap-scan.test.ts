import { describe, it, expect } from 'vitest';

import { enumerateUnmergedBranches, intersectFiles, blockerSweep, runOverlapScan } from '../../src/engine/overlap-scan.js';
import type { GitRunner, GitResult } from '../../src/engine/rebase.js';
import type { BlockerResolver, BlockerVerdict } from '../../src/engine/blocker-resolver.js';

function fakeResolver(verdict: BlockerVerdict): { resolver: BlockerResolver; calls: string[] } {
  const calls: string[] = [];
  const resolver: BlockerResolver = {
    async resolve(sourceRef: string) {
      calls.push(sourceRef);
      return verdict;
    },
  };
  return { resolver, calls };
}

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

describe('engine/overlap-scan — intersectFiles (Task 2)', () => {
  it('returns files present in both candidate and changed lists', () => {
    expect(intersectFiles(['a.ts'], ['a.ts', 'b.ts'])).toEqual(['a.ts']);
  });

  it('does not match on prefix/substring — only exact path equality', () => {
    expect(intersectFiles(['src/foo/helperx.ts'], ['src/foo/helper.ts'])).toEqual([]);
  });

  it('returns an empty array when the candidate list is empty', () => {
    expect(intersectFiles([], ['a.ts', 'b.ts'])).toEqual([]);
  });
});

describe('engine/overlap-scan — blockerSweep (Task 3)', () => {
  it('lists open blockers when the resolver verdict is blocked', async () => {
    const { resolver, calls } = fakeResolver({
      kind: 'blocked',
      blockers: [{ repo: 'org/repo', number: 'A' }],
    });

    const result = await blockerSweep('org/repo#42', resolver);

    expect(result.blockers).toEqual([{ repo: 'org/repo', number: 'A' }]);
    expect(result.indeterminate).toEqual([]);
    expect(calls).toEqual(['org/repo#42']);
  });

  it('returns no blockers/indeterminate when the resolver verdict is unblocked', async () => {
    const { resolver } = fakeResolver({ kind: 'unblocked' });

    const result = await blockerSweep('org/repo#42', resolver);

    expect(result.blockers).toEqual([]);
    expect(result.indeterminate).toEqual([]);
  });

  it('surfaces indeterminate verdicts with detail', async () => {
    const { resolver } = fakeResolver({ kind: 'indeterminate', detail: 'gh api timed out' });

    const result = await blockerSweep('org/repo#42', resolver);

    expect(result.blockers).toEqual([]);
    expect(result.indeterminate).toEqual([{ detail: 'gh api timed out' }]);
  });

  it('skips the sweep entirely when sourceRef is absent — resolver never called', async () => {
    const { resolver, calls } = fakeResolver({ kind: 'unblocked' });

    const result = await blockerSweep(undefined, resolver);

    expect(result.blockers).toEqual([]);
    expect(result.indeterminate).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('engine/overlap-scan — runOverlapScan (Task 4)', () => {
  it('combines per-branch seam overlaps and blocker entries into an OverlapReport', async () => {
    const { git } = fakeGit([
      // resolveBase: no origin remote → local base 'main'.
      { match: ['remote'], result: { stdout: '' } },
      {
        match: ['for-each-ref'],
        result: { stdout: 'spec/feature-a\nspec/feature-b\n' },
      },
      { match: ['rev-list', '--count', 'main..spec/feature-a'], result: { stdout: '2\n' } },
      { match: ['rev-list', '--count', 'main..spec/feature-b'], result: { stdout: '1\n' } },
      {
        match: ['diff', '--name-only', 'main', 'spec/feature-a'],
        result: { stdout: 'src/foo.ts\nsrc/bar.ts\n' },
      },
      {
        match: ['diff', '--name-only', 'main', 'spec/feature-b'],
        result: { stdout: 'src/baz.ts\n' },
      },
    ]);
    const { resolver, calls } = fakeResolver({
      kind: 'blocked',
      blockers: [{ repo: 'org/repo', number: 'A' }],
    });

    const result = await runOverlapScan({
      candidateFiles: ['src/foo.ts', 'src/qux.ts'],
      sourceRef: 'org/repo#42',
      git,
      resolver,
      localBase: 'main',
    });

    expect(result.seamOverlaps).toEqual(
      expect.arrayContaining([{ branch: 'spec/feature-a', files: ['src/foo.ts'] }]),
    );
    expect(result.seamOverlaps.find((s) => s.branch === 'spec/feature-b')).toBeUndefined();
    expect(result.blockers).toEqual([{ repo: 'org/repo', number: 'A' }]);
    expect(result.indeterminate).toEqual([]);
    expect(calls).toEqual(['org/repo#42']);
  });

  it('returns empty overlaps and blockers for a clean input', async () => {
    const { git } = fakeGit([
      { match: ['remote'], result: { stdout: '' } },
      { match: ['for-each-ref'], result: { stdout: '' } },
    ]);
    const { resolver } = fakeResolver({ kind: 'unblocked' });

    const result = await runOverlapScan({
      candidateFiles: ['src/foo.ts'],
      sourceRef: undefined,
      git,
      resolver,
      localBase: 'main',
    });

    expect(result.seamOverlaps).toEqual([]);
    expect(result.blockers).toEqual([]);
    expect(result.indeterminate).toEqual([]);
  });
});
