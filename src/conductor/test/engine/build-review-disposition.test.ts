import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  classifyBuildReviewDisposition,
  extractFlaggedPaths,
  diffTouchedPaths,
} from '../../src/engine/build-review-disposition.js';
import type { GitRunner, GitResult } from '../../src/engine/rebase.js';

// Scripted GitRunner — same pattern as test/engine/rebase.test.ts's fakeGit.
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
    return { exitCode: 1, stdout: '', stderr: '' };
  };
  return { git, calls };
}

const freshProbeScript = [
  { match: ['remote'], result: { exitCode: 0, stdout: 'origin\n' } },
  {
    match: ['symbolic-ref', 'refs/remotes/origin/HEAD'],
    result: { exitCode: 0, stdout: 'refs/remotes/origin/main\n' },
  },
  {
    match: ['rev-parse', 'refs/remotes/origin/main'],
    result: { exitCode: 0, stdout: 'freshsha1\n' },
  },
  {
    match: ['ls-remote', 'origin', 'main'],
    result: { exitCode: 0, stdout: 'freshsha1\trefs/heads/main\n' },
  },
];

describe('engine/build-review-disposition — extractFlaggedPaths', () => {
  it('extracts path-like tokens from reason prose', () => {
    expect(
      extractFlaggedPaths(['diff touches src/foo/bar.ts which is out of scope']),
    ).toEqual(['src/foo/bar.ts']);
  });

  it('dedupes repeated mentions across reasons', () => {
    expect(
      extractFlaggedPaths([
        'src/foo/bar.ts is out of scope',
        'also see src/foo/bar.ts again',
      ]),
    ).toEqual(['src/foo/bar.ts']);
  });

  it('returns empty for undefined/empty reasons', () => {
    expect(extractFlaggedPaths(undefined)).toEqual([]);
    expect(extractFlaggedPaths([])).toEqual([]);
  });

  it('returns empty when no path-like tokens are present', () => {
    expect(extractFlaggedPaths(['this change is too broad'])).toEqual([]);
  });
});

describe('engine/build-review-disposition — diffTouchedPaths', () => {
  it('parses paths from diff --git headers', () => {
    const diff = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      'diff --git a/src/bar.ts b/src/bar.ts',
    ].join('\n');
    expect(diffTouchedPaths(diff)).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('returns empty for an empty diff', () => {
    expect(diffTouchedPaths('')).toEqual([]);
  });
});

describe('engine/build-review-disposition — classifyBuildReviewDisposition', () => {
  let dir: string;
  let planPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-review-disposition-'));
    planPath = join(dir, 'plan.md');
    await writeFile(planPath, '# Plan\n', 'utf-8');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('classifies stale-mirage: base changed AND flagged path absent from fresh diff', async () => {
    const { git } = fakeGit([
      ...freshProbeScript,
      { match: ['merge-base', 'origin/main', 'HEAD'], result: { exitCode: 0, stdout: 'freshmerge1\n' } },
      { match: ['diff', 'freshmerge1..HEAD'], result: { exitCode: 0, stdout: 'diff --git a/feat.txt b/feat.txt\n' } },
    ]);

    const result = await classifyBuildReviewDisposition(
      git,
      planPath,
      { baseRef: 'origin/main', mergeBase: 'stalemerge0' },
      ['diff touches merged-pr.txt which is out of scope for this plan'],
    );

    expect(result.disposition).toBe('stale-mirage');
    expect(result.baseChanged).toBe(true);
    expect(result.flaggedPaths).toEqual(['merged-pr.txt']);
    expect(result.freshDiffPaths).toEqual(['feat.txt']);
  });

  it('classifies genuine: flagged path persists in the fresh diff', async () => {
    const { git } = fakeGit([
      ...freshProbeScript,
      { match: ['merge-base', 'origin/main', 'HEAD'], result: { exitCode: 0, stdout: 'freshmerge1\n' } },
      {
        match: ['diff', 'freshmerge1..HEAD'],
        result: { exitCode: 0, stdout: 'diff --git a/feat.txt b/feat.txt\n' },
      },
    ]);

    const result = await classifyBuildReviewDisposition(
      git,
      planPath,
      { baseRef: 'origin/main', mergeBase: 'stalemerge0' },
      ['diff touches feat.txt which is out of scope for this plan'],
    );

    expect(result.disposition).toBe('genuine');
  });

  it('classifies genuine when the base never actually changed, even if flagged path is absent', async () => {
    const { git } = fakeGit([
      ...freshProbeScript,
      { match: ['merge-base', 'origin/main', 'HEAD'], result: { exitCode: 0, stdout: 'samemerge0\n' } },
      { match: ['diff', 'samemerge0..HEAD'], result: { exitCode: 0, stdout: 'diff --git a/feat.txt b/feat.txt\n' } },
    ]);

    const result = await classifyBuildReviewDisposition(
      git,
      planPath,
      { baseRef: 'origin/main', mergeBase: 'samemerge0' },
      ['diff touches merged-pr.txt which is out of scope for this plan'],
    );

    expect(result.disposition).toBe('genuine');
    expect(result.baseChanged).toBe(false);
  });

  it('classifies genuine (safe default) when reasons carry no extractable path, even if base changed', async () => {
    const { git } = fakeGit([
      ...freshProbeScript,
      { match: ['merge-base', 'origin/main', 'HEAD'], result: { exitCode: 0, stdout: 'freshmerge1\n' } },
      { match: ['diff', 'freshmerge1..HEAD'], result: { exitCode: 0, stdout: 'diff --git a/feat.txt b/feat.txt\n' } },
    ]);

    const result = await classifyBuildReviewDisposition(
      git,
      planPath,
      { baseRef: 'origin/main', mergeBase: 'stalemerge0' },
      ['this change is too broad in scope'],
    );

    expect(result.disposition).toBe('genuine');
    expect(result.flaggedPaths).toEqual([]);
  });

  it('never writes/commits/resets git state — only read-only argv (remote/symbolic-ref/rev-parse/ls-remote/merge-base/diff)', async () => {
    const { git, calls } = fakeGit([
      ...freshProbeScript,
      { match: ['merge-base', 'origin/main', 'HEAD'], result: { exitCode: 0, stdout: 'freshmerge1\n' } },
      { match: ['diff', 'freshmerge1..HEAD'], result: { exitCode: 0, stdout: '' } },
    ]);

    await classifyBuildReviewDisposition(
      git,
      planPath,
      { baseRef: 'origin/main', mergeBase: 'stalemerge0' },
      undefined,
    );

    const mutating = new Set(['commit', 'reset', 'checkout', 'fetch', 'push', 'rebase', 'merge']);
    for (const call of calls) {
      expect(mutating.has(call[0])).toBe(false);
    }
  });
});
