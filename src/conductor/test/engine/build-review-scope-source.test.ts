import { describe, expect, it } from 'vitest';

import {
  BuildReviewSourceReadError,
  BuildReviewScopeSource,
  parseNameStatusZ,
  safeRepoRelativePath,
} from '../../src/engine/build-review-scope-source.js';
import type { GitRunner } from '../../src/engine/rebase.js';

function scriptedGit(entries: Record<string, { exitCode?: number; stdout?: string; stderr?: string }>): GitRunner {
  return async (args) => {
    const result = entries[args.join('\u0000')];
    return {
      exitCode: result?.exitCode ?? (result ? 0 : 1),
      stdout: result?.stdout ?? '',
      stderr: result?.stderr ?? 'unexpected git argv',
    };
  };
}

describe('build-review scope source', () => {
  it('parses NUL name-status inventory and preserves a space-containing rename pair', () => {
    expect(parseNameStatusZ('R100\u0000test/old name.test.ts\u0000test/new name.test.ts\u0000M\u0000src/a.ts\u0000')).toEqual([
      { kind: 'R', oldPath: 'test/old name.test.ts', path: 'test/new name.test.ts' },
      { kind: 'M', path: 'src/a.ts' },
    ]);
  });

  it.each(['/absolute.ts', '../escape.ts', 'src/../../escape.ts', 'src/has\u0000nul.ts'])(
    'rejects unsafe repository path %j',
    (path) => expect(() => safeRepoRelativePath(path)).toThrow(BuildReviewSourceReadError),
  );

  it('reads each pinned blob once and never falls back to live content', async () => {
    const calls: string[][] = [];
    const git: GitRunner = async (args) => {
      calls.push(args);
      return args.join('\u0000') === 'show\u0000head123:test/with space.test.ts'
        ? { exitCode: 0, stdout: 'pinned bytes', stderr: '' }
        : { exitCode: 1, stdout: '', stderr: 'missing' };
    };
    const source = new BuildReviewScopeSource(git, 'head123');

    await expect(source.readRequired('test/with space.test.ts')).resolves.toBe('pinned bytes');
    await expect(source.readRequired('test/with space.test.ts')).resolves.toBe('pinned bytes');
    expect(calls).toEqual([['show', 'head123:test/with space.test.ts']]);
  });

  it('reports a bounded required-read failure instead of an empty or live fallback', async () => {
    const source = new BuildReviewScopeSource(scriptedGit({
      'show\u0000head123:.docs/plans/active.md': { exitCode: 128, stderr: 'x'.repeat(2_000) },
    }), 'head123');

    await expect(source.readRequired('.docs/plans/active.md')).rejects.toMatchObject({
      name: 'BuildReviewSourceReadError',
      kind: 'required-read-failed',
      path: '.docs/plans/active.md',
    });
    await expect(source.readRequired('.docs/plans/active.md')).rejects.toThrow(/truncated/);
  });

  it('keeps a deleted side in inventory while a missing required HEAD blob is an error', async () => {
    const source = new BuildReviewScopeSource(scriptedGit({
      'diff\u0000--name-status\u0000-z\u0000--find-renames\u0000base123..head123\u0000--\u0000.': {
        stdout: 'D\u0000test/deleted.test.ts\u0000',
      },
      'show\u0000head123:test/missing.test.ts': { exitCode: 128, stderr: 'not in pinned tree' },
    }), 'head123');

    await expect(source.inventory('base123', ['--', '.'])).resolves.toEqual([
      { kind: 'D', path: 'test/deleted.test.ts' },
    ]);
    await expect(source.readRequired('test/missing.test.ts')).rejects.toMatchObject({
      kind: 'required-read-failed', path: 'test/missing.test.ts',
    });
  });
});
