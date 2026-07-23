/**
 * Tests for the daemon poll-time fast-forward of the root checkout.
 *
 * Root cause (the bug this replaces): the poll loop discovered/validated specs on
 * the `origin/<default>` remote-tracking tree but materialized them by copying
 * from the local working tree, which was only ever `fetch`ed — never advanced. A
 * spec merged on origin while local `main` lagged would be discovered yet fail to
 * copy (ENOENT → HALT).
 *
 * The fix: on each idle poll the daemon FAST-FORWARDS its local default branch to
 * origin (`fastForwardRoot`). Worktrees are then cut from that fresh branch, so
 * the vetted stories/plan already physically exist — no copy step at all.
 *
 * Tests cover:
 *   - fastForwardRoot fetches + `merge --ff-only origin/<default>` when on the
 *     default branch with a clean tree
 *   - the discovered branch name is NOT hardcoded (trunk ≠ main)
 *   - no origin remote → no fetch/merge
 *   - origin/HEAD unset AND remote show fallback fails → skip (no fetch)
 *   - not on the default branch → skip with a warning, no fetch/merge
 *   - dirty working tree → skip with a warning, no fetch/merge
 *   - fetch failure (offline) → logs, no merge, does NOT throw
 *   - non-fast-forward (divergence) → logs, does NOT throw
 *   - git integration: a spec merged on origin but absent locally becomes present
 *     in the working tree (and discoverable on the LOCAL branch) after the ff
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { fastForwardRoot, discoverBacklog } from '../../src/engine/daemon-backlog.js';
import type { GitRunner, GitResult } from '../../src/engine/rebase.js';

const execFile = promisify(execFileCb);

// ── Fake git runner (mirrors rebase.test.ts pattern) ─────────────────────────

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

const onDefaultBranchClean = (branch: string) => [
  { match: ['remote'], result: { stdout: 'origin\n' } },
  {
    match: ['symbolic-ref', 'refs/remotes/origin/HEAD'],
    result: { stdout: `refs/remotes/origin/${branch}\n` },
  },
  { match: ['rev-parse', '--abbrev-ref', 'HEAD'], result: { stdout: `${branch}\n` } },
  { match: ['status', '--porcelain'], result: { stdout: '' } },
  { match: ['fetch', 'origin', branch], result: { exitCode: 0 } },
  { match: ['merge', '--ff-only', `origin/${branch}`], result: { exitCode: 0 } },
];

// ── fastForwardRoot unit tests ────────────────────────────────────────────────

describe('daemon-backlog — fastForwardRoot (per-poll root advance)', () => {
  it('fetches and fast-forward-merges origin/<default> when on the default branch + clean', async () => {
    const { git, calls } = fakeGit(onDefaultBranchClean('main'));
    await fastForwardRoot('/fake/repo', () => {}, git);
    expect(calls).toContainEqual(['fetch', 'origin', 'main']);
    expect(calls).toContainEqual(['merge', '--ff-only', 'origin/main']);
  });

  it('uses the discovered default branch name, NOT a hardcoded "main"', async () => {
    const { git, calls } = fakeGit(onDefaultBranchClean('trunk'));
    await fastForwardRoot('/fake/repo', () => {}, git);
    expect(calls).toContainEqual(['fetch', 'origin', 'trunk']);
    expect(calls).toContainEqual(['merge', '--ff-only', 'origin/trunk']);
    expect(calls.some((c) => c[0] === 'fetch' && c[2] === 'main')).toBe(false);
  });

  it('does nothing when there is no origin remote (local-only repo)', async () => {
    const { git, calls } = fakeGit([{ match: ['remote'], result: { stdout: '' } }]);
    await fastForwardRoot('/fake/repo', () => {}, git);
    expect(calls.some((c) => c[0] === 'fetch')).toBe(false);
    expect(calls.some((c) => c[0] === 'merge')).toBe(false);
  });

  it('skips when origin/HEAD is unset and remote show fallback also fails', async () => {
    const { git, calls } = fakeGit([
      { match: ['remote'], result: { stdout: 'origin\n' } },
      { match: ['symbolic-ref', 'refs/remotes/origin/HEAD'], result: { exitCode: 128 } },
      { match: ['remote', 'show', 'origin'], result: { exitCode: 1, stdout: '' } },
    ]);
    await fastForwardRoot('/fake/repo', () => {}, git);
    expect(calls.some((c) => c[0] === 'fetch')).toBe(false);
    expect(calls.some((c) => c[0] === 'merge')).toBe(false);
  });

  it('skips with a warning when the root is NOT on the default branch', async () => {
    const logs: string[] = [];
    const { git, calls } = fakeGit([
      { match: ['remote'], result: { stdout: 'origin\n' } },
      {
        match: ['symbolic-ref', 'refs/remotes/origin/HEAD'],
        result: { stdout: 'refs/remotes/origin/main\n' },
      },
      { match: ['rev-parse', '--abbrev-ref', 'HEAD'], result: { stdout: 'feature/x\n' } },
    ]);
    await fastForwardRoot('/fake/repo', (m) => logs.push(m), git);
    expect(calls.some((c) => c[0] === 'fetch')).toBe(false);
    expect(calls.some((c) => c[0] === 'merge')).toBe(false);
    expect(logs.join('\n')).toMatch(/not the default branch/);
  });

  it('skips with a warning when the working tree is dirty', async () => {
    const logs: string[] = [];
    const { git, calls } = fakeGit([
      { match: ['remote'], result: { stdout: 'origin\n' } },
      {
        match: ['symbolic-ref', 'refs/remotes/origin/HEAD'],
        result: { stdout: 'refs/remotes/origin/main\n' },
      },
      { match: ['rev-parse', '--abbrev-ref', 'HEAD'], result: { stdout: 'main\n' } },
      { match: ['status', '--porcelain'], result: { stdout: ' M src/foo.ts\n' } },
    ]);
    await fastForwardRoot('/fake/repo', (m) => logs.push(m), git);
    // Task 1: the dirty-skip outcome now probes origin (fetch, no merge) to
    // populate `behindOrigin`/`originHead` for TI-4's staleness warnings.
    expect(calls.some((c) => c[0] === 'fetch')).toBe(true);
    expect(calls.some((c) => c[0] === 'merge')).toBe(false);
    expect(logs.join('\n')).toMatch(/LEAK-SUSPECT/);
  });

  it('does NOT merge and does NOT throw when fetch fails (offline)', async () => {
    const logs: string[] = [];
    const { git, calls } = fakeGit([
      { match: ['remote'], result: { stdout: 'origin\n' } },
      {
        match: ['symbolic-ref', 'refs/remotes/origin/HEAD'],
        result: { stdout: 'refs/remotes/origin/main\n' },
      },
      { match: ['rev-parse', '--abbrev-ref', 'HEAD'], result: { stdout: 'main\n' } },
      { match: ['status', '--porcelain'], result: { stdout: '' } },
      { match: ['fetch', 'origin', 'main'], result: { exitCode: 1, stderr: 'network unreachable' } },
    ]);
    let threw = false;
    try {
      await fastForwardRoot('/fake/repo', (m) => logs.push(m), git);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(calls.some((c) => c[0] === 'merge')).toBe(false);
    expect(logs.length).toBeGreaterThan(0);
  });

  it('logs and does NOT throw on a non-fast-forward (local diverged from origin)', async () => {
    const logs: string[] = [];
    const { git, calls } = fakeGit([
      { match: ['remote'], result: { stdout: 'origin\n' } },
      {
        match: ['symbolic-ref', 'refs/remotes/origin/HEAD'],
        result: { stdout: 'refs/remotes/origin/main\n' },
      },
      { match: ['rev-parse', '--abbrev-ref', 'HEAD'], result: { stdout: 'main\n' } },
      { match: ['status', '--porcelain'], result: { stdout: '' } },
      { match: ['fetch', 'origin', 'main'], result: { exitCode: 0 } },
      {
        match: ['merge', '--ff-only', 'origin/main'],
        result: { exitCode: 128, stderr: 'Not possible to fast-forward' },
      },
    ]);
    let threw = false;
    try {
      await fastForwardRoot('/fake/repo', (m) => logs.push(m), git);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(calls).toContainEqual(['merge', '--ff-only', 'origin/main']);
    expect(logs.join('\n')).toMatch(/diverged|non-fast-forward/);
  });
});

// ── Git integration: merged-on-origin spec becomes present after the ff ────────
//
// Exercises the real git path end to end: a spec pushed to origin's default
// branch (a merged PR) while local lags is brought into the working tree by
// fastForwardRoot, and is then discoverable on the LOCAL branch.

describe('daemon-backlog — fastForwardRoot (git integration)', () => {
  let repoDir: string;
  let originDir: string;
  let defaultBranch: string;

  const APPROVED_STORIES = '# Stories\n**Status:** Accepted\n';
  const planWithDeps = (storiesRef: string) =>
    `# Plan\n**Stories:** ${storiesRef}\n\n### Task 1\n**Dependencies:** none\n`;

  async function git(args: string[], cwd: string): Promise<string> {
    const { stdout } = await execFile('git', args, { cwd });
    return stdout.trim();
  }

  beforeEach(async () => {
    originDir = await mkdtemp(join(tmpdir(), 'origin-ff-'));
    await execFile('git', ['init', '--bare', '-q', '-b', 'main'], { cwd: originDir });

    repoDir = await mkdtemp(join(tmpdir(), 'repo-ff-'));
    await execFile('git', ['clone', '-q', originDir, repoDir]);
    await execFile('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir });
    await execFile('git', ['config', 'user.name', 'Test'], { cwd: repoDir });

    await writeFile(join(repoDir, 'README.md'), 'init\n');
    await git(['add', 'README.md'], repoDir);
    await git(['commit', '-q', '-m', 'init'], repoDir);
    await git(['push', '-q', 'origin', 'HEAD'], repoDir);
    defaultBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoDir);
    // origin/HEAD so originDefaultBranch() resolves the default branch.
    await git(['remote', 'set-head', 'origin', defaultBranch], repoDir);
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
    await rm(originDir, { recursive: true, force: true });
  });

  it('brings a spec merged on origin into the local working tree, then discoverable locally', async () => {
    // Push a spec to origin's default branch (simulates a merged PR) WITHOUT
    // advancing the local checkout — this is the exact bug scenario.
    await git(['checkout', '-q', '-b', 'spec/remote-only'], repoDir);
    await mkdir(join(repoDir, '.docs/plans'), { recursive: true });
    await mkdir(join(repoDir, '.docs/stories'), { recursive: true });
    await writeFile(
      join(repoDir, '.docs/plans/remote-only.md'),
      planWithDeps('.docs/stories/remote-only.md'),
    );
    await writeFile(join(repoDir, '.docs/stories/remote-only.md'), APPROVED_STORIES);
    await git(['add', '.docs'], repoDir);
    await git(['commit', '-q', '-m', 'merge spec: remote-only'], repoDir);
    await git(['push', '-q', 'origin', `spec/remote-only:${defaultBranch}`], repoDir);

    // Back to local default branch — it does NOT have the spec yet.
    await git(['checkout', '-q', defaultBranch], repoDir);
    await git(['branch', '-D', 'spec/remote-only'], repoDir);

    // Before the ff: local lacks the spec on disk and discovery finds nothing.
    await expect(access(join(repoDir, '.docs/plans/remote-only.md'))).rejects.toThrow();
    const { items: before } = await discoverBacklog(repoDir, undefined, undefined, {
      baseBranch: defaultBranch,
    });
    expect(before).toHaveLength(0);

    // The poll-time fast-forward brings local <default> current with origin.
    await fastForwardRoot(repoDir);

    // After the ff: the spec physically exists in the working tree (so a fresh
    // worktree cut from <default> contains it) and is discovered on LOCAL <default>.
    await expect(access(join(repoDir, '.docs/plans/remote-only.md'))).resolves.toBeUndefined();
    const { items: after } = await discoverBacklog(repoDir, undefined, undefined, {
      baseBranch: defaultBranch,
    });
    expect(after.map((b) => b.slug)).toEqual(['remote-only']);
  });

  it('does NOT advance the working tree when it is dirty (no clobber)', async () => {
    // Advance origin with a new merged spec.
    await git(['checkout', '-q', '-b', 'spec/remote-2'], repoDir);
    await mkdir(join(repoDir, '.docs/plans'), { recursive: true });
    await mkdir(join(repoDir, '.docs/stories'), { recursive: true });
    await writeFile(
      join(repoDir, '.docs/plans/remote-2.md'),
      planWithDeps('.docs/stories/remote-2.md'),
    );
    await writeFile(join(repoDir, '.docs/stories/remote-2.md'), APPROVED_STORIES);
    await git(['add', '.docs'], repoDir);
    await git(['commit', '-q', '-m', 'merge spec: remote-2'], repoDir);
    await git(['push', '-q', 'origin', `spec/remote-2:${defaultBranch}`], repoDir);
    await git(['checkout', '-q', defaultBranch], repoDir);
    await git(['branch', '-D', 'spec/remote-2'], repoDir);

    // Dirty the working tree, then attempt the ff — it must skip.
    await writeFile(join(repoDir, 'README.md'), 'locally edited\n');
    const logs: string[] = [];
    await fastForwardRoot(repoDir, (m) => logs.push(m));

    await expect(access(join(repoDir, '.docs/plans/remote-2.md'))).rejects.toThrow();
    expect(logs.join('\n')).toMatch(/LEAK-SUSPECT/);
  });
});
