import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  extractFlaggedPaths,
  diffTouchedPaths,
  runScopeFailDisposition,
  resetRegradeCounter,
  readRegradeCount,
  incrementRegradeCounter,
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

describe('engine/build-review-disposition — regrade counter persistence', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'regrade-counter-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('readRegradeCount is 0 when no counter file exists yet', async () => {
    expect(await readRegradeCount(dir)).toBe(0);
  });

  it('incrementRegradeCounter persists and returns the new count, and is read back by readRegradeCount', async () => {
    expect(await incrementRegradeCounter(dir)).toBe(1);
    expect(await readRegradeCount(dir)).toBe(1);
    expect(await incrementRegradeCounter(dir)).toBe(2);
    expect(await readRegradeCount(dir)).toBe(2);
  });

  it('resetRegradeCounter zeroes an already-incremented counter', async () => {
    await incrementRegradeCounter(dir);
    await incrementRegradeCounter(dir);
    expect(await readRegradeCount(dir)).toBe(2);
    await resetRegradeCounter(dir);
    expect(await readRegradeCount(dir)).toBe(0);
  });

  it('resetRegradeCounter never creates .pipeline/ when no counter exists', async () => {
    // Regression: resetting at fresh-session start used to mkdir `.pipeline/`
    // unconditionally. An otherwise-empty `.pipeline/` is not inert — the
    // pre-dispatch attribution guard early-returns "intact" only when the
    // directory is absent, so conjuring it flips the guard into its
    // "machinery incomplete" branch, suppressing the build-step marker
    // (#505 TS-3) and, where enforcement is on, opening a HALT path.
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(dir, '.pipeline'))).toBe(false);

    await resetRegradeCounter(dir);

    expect(existsSync(join(dir, '.pipeline'))).toBe(false);
    // A missing counter already reads as a fresh session.
    expect(await readRegradeCount(dir)).toBe(0);
  });

  it('readRegradeCount is 0 for an unparseable counter file (fail-open to a fresh session)', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline', 'build-review-regrade.json'), 'not json', 'utf-8');
    expect(await readRegradeCount(dir)).toBe(0);
  });
});

describe('engine/build-review-disposition — runScopeFailDisposition', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'run-scope-fail-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const freshRevParseFreshRef = {
    match: ['rev-parse', 'origin/main'],
    result: { exitCode: 0, stdout: 'freshsha1\n' },
  };

  it('invalidated: base changed and flagged path absent from the fresh merge-base diff — regrade runs exactly once', async () => {
    const { git } = fakeGit([
      ...freshProbeScript,
      freshRevParseFreshRef,
      { match: ['merge-base', 'freshsha1', 'HEAD'], result: { exitCode: 0, stdout: 'freshsha1\n' } },
      { match: ['diff', '--name-only', 'freshsha1', 'HEAD'], result: { exitCode: 0, stdout: 'feat.txt\n' } },
    ]);
    let regradeCalls = 0;
    const result = await runScopeFailDisposition({
      git,
      root: dir,
      gradedBaseSha: 'stalesha0',
      flaggedPaths: ['merged-pr.txt'],
      regrade: async () => {
        regradeCalls++;
        return 'pass';
      },
    });
    expect(result.kind).toBe('invalidated');
    if (result.kind === 'invalidated') {
      expect(result.freshBaseSha).toBe('freshsha1');
      expect(result.regradeResult).toBe('pass');
    }
    expect(regradeCalls).toBe(1);
    expect(await readRegradeCount(dir)).toBe(1);
  });

  it('kicked-to-build: flagged path persists in the fresh diff — never invalidates, never regrades', async () => {
    const { git } = fakeGit([
      ...freshProbeScript,
      freshRevParseFreshRef,
      { match: ['merge-base', 'freshsha1', 'HEAD'], result: { exitCode: 0, stdout: 'freshsha1\n' } },
      { match: ['diff', '--name-only', 'freshsha1', 'HEAD'], result: { exitCode: 0, stdout: 'feat.txt\n' } },
    ]);
    let regradeCalls = 0;
    const result = await runScopeFailDisposition({
      git,
      root: dir,
      gradedBaseSha: 'stalesha0',
      flaggedPaths: ['feat.txt'],
      regrade: async () => {
        regradeCalls++;
        return 'pass';
      },
    });
    expect(result.kind).toBe('kicked-to-build');
    expect(regradeCalls).toBe(0);
    expect(await readRegradeCount(dir)).toBe(0);
  });

  it('kicked-to-build: base never actually changed, even if the flagged path is absent from the diff', async () => {
    const { git } = fakeGit([
      ...freshProbeScript,
      freshRevParseFreshRef,
      { match: ['merge-base', 'freshsha1', 'HEAD'], result: { exitCode: 0, stdout: 'freshsha1\n' } },
      { match: ['diff', '--name-only', 'freshsha1', 'HEAD'], result: { exitCode: 0, stdout: 'feat.txt\n' } },
    ]);
    const result = await runScopeFailDisposition({
      git,
      root: dir,
      gradedBaseSha: 'freshsha1', // already fresh
      flaggedPaths: ['merged-pr.txt'],
      regrade: async () => 'pass',
    });
    expect(result.kind).toBe('kicked-to-build');
  });

  it('halt: a second stale-mirage detection this session never re-enters grading', async () => {
    const { git } = fakeGit([
      ...freshProbeScript,
      freshRevParseFreshRef,
      { match: ['merge-base', 'freshsha1', 'HEAD'], result: { exitCode: 0, stdout: 'freshsha1\n' } },
      { match: ['diff', '--name-only', 'freshsha1', 'HEAD'], result: { exitCode: 0, stdout: 'feat.txt\n' } },
    ]);
    await incrementRegradeCounter(dir); // simulate an already-consumed regrade this session
    let regradeCalls = 0;
    const result = await runScopeFailDisposition({
      git,
      root: dir,
      gradedBaseSha: 'stalesha0',
      flaggedPaths: ['merged-pr.txt'],
      regrade: async () => {
        regradeCalls++;
        return 'pass';
      },
    });
    expect(result.kind).toBe('halt');
    if (result.kind === 'halt') {
      expect(result.gradedBaseSha).toBe('stalesha0');
      expect(result.freshBaseSha).toBe('freshsha1');
      expect(result.flaggedPaths).toEqual(['merged-pr.txt']);
      expect(result.regradeCount).toBe(1);
    }
    expect(regradeCalls).toBe(0);
  });
});
