import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  classifyBuildProgress,
  shouldEscalateKickback,
} from '../../src/engine/kickback-escalation.js';

interface GitSnapshot {
  head: string;
  tree: string;
}

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function snapshot(repo: string): GitSnapshot {
  return {
    head: git(repo, 'rev-parse', 'HEAD'),
    tree: git(repo, 'rev-parse', 'HEAD^{tree}'),
  };
}

function withTestRepo(run: (repo: string) => void): void {
  const repo = mkdtempSync(join(tmpdir(), 'kickback-escalation-'));
  try {
    git(repo, 'init', '-b', 'main');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Test User');
    writeFileSync(join(repo, 'tracked.txt'), 'initial\n');
    git(repo, 'add', 'tracked.txt');
    git(repo, 'commit', '-m', 'initial');
    run(repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

function classifySnapshots(
  before: GitSnapshot,
  after: GitSnapshot,
  resolvedBefore = 0,
  resolvedAfter = 0,
) {
  return classifyBuildProgress({
    treeBefore: before.tree,
    treeAfter: after.tree,
    resolvedBefore,
    resolvedAfter,
  });
}

describe('classifyBuildProgress', () => {
  it('is did-work when tree changed', () => {
    expect(
      classifyBuildProgress({
        treeBefore: 'abc123',
        treeAfter: 'def456',
        resolvedBefore: 2,
        resolvedAfter: 2,
      }),
    ).toBe('did-work');
  });

  it('is did-work when resolvedAfter > resolvedBefore', () => {
    expect(
      classifyBuildProgress({
        treeBefore: 'abc123',
        treeAfter: 'abc123',
        resolvedBefore: 2,
        resolvedAfter: 3,
      }),
    ).toBe('did-work');
  });

  it('is no-work when neither tree nor resolved count moved', () => {
    expect(
      classifyBuildProgress({
        treeBefore: 'abc123',
        treeAfter: 'abc123',
        resolvedBefore: 2,
        resolvedAfter: 2,
      }),
    ).toBe('no-work');
  });

  it('is no-work when both tree hashes are null (unknown tree treated conservatively)', () => {
    expect(
      classifyBuildProgress({
        treeBefore: null,
        treeAfter: null,
        resolvedBefore: 0,
        resolvedAfter: 0,
      }),
    ).toBe('no-work');
  });

  it('is idempotent across repeated calls with identical input', () => {
    const input = {
      treeBefore: 'abc123',
      treeAfter: 'abc123',
      resolvedBefore: 1,
      resolvedAfter: 1,
    };
    expect(classifyBuildProgress(input)).toBe(classifyBuildProgress(input));
  });
});

describe('classifyBuildProgress tree-hash witness', () => {
  it('classifies an allow-empty commit with an unchanged tree as no-work', () => {
    withTestRepo((repo) => {
      const before = snapshot(repo);
      git(repo, 'commit', '--allow-empty', '-m', 'empty progress claim');
      const after = snapshot(repo);

      expect(classifySnapshots(before, after)).toBe('no-work');
    });
  });

  it('classifies a real file change with a changed tree as did-work', () => {
    withTestRepo((repo) => {
      const before = snapshot(repo);
      writeFileSync(join(repo, 'tracked.txt'), 'changed\n');
      git(repo, 'add', 'tracked.txt');
      git(repo, 'commit', '-m', 'change tracked file');
      const after = snapshot(repo);

      expect(classifySnapshots(before, after)).toBe('did-work');
    });
  });

  it.each([
    ['before', { head: 'before-commit', tree: null }, { head: 'after-commit', tree: 'after-tree' }],
    ['after', { head: 'before-commit', tree: 'before-tree' }, { head: 'after-commit', tree: null }],
  ] as const)('classifies a null tree hash on the %s side as no-work', (_side, before, after) => {
    expect(
      classifyBuildProgress({
        treeBefore: before.tree,
        treeAfter: after.tree,
        resolvedBefore: 0,
        resolvedAfter: 0,
      }),
    ).toBe('no-work');
  });

  it('retains a resolved-count increase as did-work when the tree is unchanged', () => {
    withTestRepo((repo) => {
      const unchanged = snapshot(repo);

      expect(classifySnapshots(unchanged, unchanged, 2, 3)).toBe('did-work');
    });
  });
});

describe('shouldEscalateKickback', () => {
  it('halts on no-work + matching verdict + enabled', () => {
    const result = shouldEscalateKickback({
      progress: 'no-work',
      priorVerdict: false,
      nextVerdict: false,
      enabled: true,
    });
    expect(result.halt).toBe(true);
    expect(result.reason).toBeTruthy();
    expect(result.reason).toMatch(/no.?work|head|resolved|unchanged|verdict/i);
  });

  it('does not halt on did-work', () => {
    const result = shouldEscalateKickback({
      progress: 'did-work',
      priorVerdict: false,
      nextVerdict: false,
      enabled: true,
    });
    expect(result.halt).toBe(false);
  });

  it('does not halt when verdicts differ', () => {
    const result = shouldEscalateKickback({
      progress: 'no-work',
      priorVerdict: false,
      nextVerdict: true,
      enabled: true,
    });
    expect(result.halt).toBe(false);
  });

  it('does not halt when disabled', () => {
    const result = shouldEscalateKickback({
      progress: 'no-work',
      priorVerdict: false,
      nextVerdict: false,
      enabled: false,
    });
    expect(result.halt).toBe(false);
  });

  it('is idempotent across repeated calls with identical input', () => {
    const input = {
      progress: 'no-work' as const,
      priorVerdict: false,
      nextVerdict: false,
      enabled: true,
    };
    expect(shouldEscalateKickback(input)).toEqual(shouldEscalateKickback(input));
  });
});
