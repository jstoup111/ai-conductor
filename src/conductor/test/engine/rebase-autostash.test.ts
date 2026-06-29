/**
 * Real-git test for `performRebase` autostash handling.
 *
 * Regression: a daemon build/lint step can leave uncommitted changes in the
 * worktree (e.g. a formatter dropping an unused import without committing). Plain
 * `git rebase` then refuses — "cannot rebase: You have unstaged changes" — which
 * `performRebase` surfaced as a 0-conflict failure and mis-parked as a "rebase
 * conflict" the operator could not resolve. `git rebase --autostash` stashes the
 * stray changes, rebases, and reapplies them, so a clean (non-overlapping) rebase
 * succeeds even with a dirty tree.
 *
 * Uses a real throwaway repo (no origin → `resolveBase` falls back to local
 * `main`), because autostash is git-native behavior a fake runner can't exercise.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { performRebase, makeGitRunner } from '../../src/engine/rebase.js';

const execFile = promisify(execFileCb);

describe('engine/rebase — performRebase autostash (real git)', () => {
  let repo: string;
  const g = (args: string[]) => execFile('git', args, { cwd: repo });
  const read = (p: string) => readFile(join(repo, p), 'utf-8');

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'rebase-autostash-'));
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);
    await writeFile(join(repo, 'a.txt'), 'a0\n');
    await writeFile(join(repo, 'b.txt'), 'b0\n');
    await writeFile(join(repo, 'c.txt'), 'c0\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('rebases a clean non-overlapping change even with a dirty worktree, reapplying the dirty change', async () => {
    // Feature branch advances a.txt.
    await g(['checkout', '-q', '-b', 'feat']);
    await writeFile(join(repo, 'a.txt'), 'a1\n');
    await g(['commit', '-q', '-am', 'feat: a1']);

    // main advances a DIFFERENT file (no overlap with the feature).
    await g(['checkout', '-q', 'main']);
    await writeFile(join(repo, 'b.txt'), 'b1\n');
    await g(['commit', '-q', '-am', 'main: b1']);

    // Back on the feature branch, leave an uncommitted change — the exact state a
    // stray lint/format edit produces, which blocks a plain `git rebase`.
    await g(['checkout', '-q', 'feat']);
    await writeFile(join(repo, 'c.txt'), 'c-dirty\n');

    const outcome = await performRebase(makeGitRunner(repo), repo, 'main');

    // The clean rebase must NOT be mis-parked as a conflict.
    expect(outcome.kind).not.toBe('conflict_halt');
    // main's commit is now in the feature branch (rebased onto it).
    expect(await read('b.txt')).toBe('b1\n');
    expect(await read('a.txt')).toBe('a1\n');
    // The dirty change was autostashed and reapplied.
    expect(await read('c.txt')).toBe('c-dirty\n');
    // No rebase left in progress.
    const inProgress = await execFile('git', ['status'], { cwd: repo });
    expect(inProgress.stdout).not.toMatch(/rebase in progress|currently rebasing/i);
  }, 20000);

  it('still HALTs on a genuine overlapping conflict (autostash does not mask real conflicts)', async () => {
    // Feature and main both change the SAME file with divergent content.
    await g(['checkout', '-q', '-b', 'feat']);
    await writeFile(join(repo, 'a.txt'), 'feature-line\n');
    await g(['commit', '-q', '-am', 'feat: a']);
    await g(['checkout', '-q', 'main']);
    await writeFile(join(repo, 'a.txt'), 'main-line\n');
    await g(['commit', '-q', '-am', 'main: a']);
    await g(['checkout', '-q', 'feat']);

    const outcome = await performRebase(makeGitRunner(repo), repo, 'main');
    expect(outcome.kind).toBe('conflict_halt');
  }, 20000);
});
