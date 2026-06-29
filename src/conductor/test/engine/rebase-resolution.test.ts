/**
 * Acceptance (RED) spec for the gated rebase-conflict resolution sub-loop.
 *
 * Feature: feat/rebase-resolution-skill — PRD .docs/specs/2026-06-29-rebase-resolution-skill.md.
 * The conductor's engine-native `rebase` step today writes `.pipeline/HALT` immediately on any
 * non-CHANGELOG conflict. This feature inserts a bounded resolution loop FIRST: dispatch a resolver
 * up to N times, accept ONLY when the branch is genuinely current (FR-8) with feature commits
 * preserved (FR-9), else HALT.
 *
 * These tests exercise the pure engine helper `resolveRebaseConflicts(git, root, conflictOutcome,
 * resolver, cap)` against a REAL throwaway repo (never the live checkout) with an INJECTED fake
 * resolver — no Claude dispatch. They FAIL until the helper + `featureCommitsPreserved` exist
 * (RED phase).
 *
 * Loop contract pinned here:
 *   - resolver returns {resolved:false, reason}        → short-circuit HALT (FR-6), 1 call.
 *   - resolver returns {resolved:true} but rebase still
 *     in progress (didn't actually complete)           → failed attempt, retry; N such → HALT (FR-5).
 *   - resolver completes the rebase but the branch is
 *     NOT current (FR-8) or a feature commit was
 *     dropped (FR-9)                                    → REJECT → HALT (no unsafe retry), 1 call.
 *   - resolver completes cleanly, current, preserved    → outcome reclassified ('changed'/'noop') (FR-2).
 *   - cap === 0                                          → resolver NOT called; passthrough HALT (FR-7).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import {
  performRebase,
  makeGitRunner,
  resolveRebaseConflicts,
  featureCommitsPreserved,
  type ResolutionAttempt,
} from '../../src/engine/rebase.js';

const execFile = promisify(execFileCb);

describe('engine/rebase — gated resolution loop (real git, fake resolver)', () => {
  let repo: string;
  const g = (args: string[]) => execFile('git', args, { cwd: repo });
  const gc = (args: string[]) =>
    execFile('git', ['-c', 'core.editor=true', ...args], { cwd: repo });

  // Build a repo where rebasing `feat` onto `main` conflicts on a.txt, leaving a
  // single feature commit ("feat: change a") to replay.
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'rebase-resolution-'));
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);
    await writeFile(join(repo, 'a.txt'), 'base\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);

    await g(['checkout', '-q', '-b', 'feat']);
    await writeFile(join(repo, 'a.txt'), 'feature\n');
    await g(['commit', '-q', '-am', 'feat: change a']);

    await g(['checkout', '-q', 'main']);
    await writeFile(join(repo, 'a.txt'), 'mainchange\n');
    await g(['commit', '-q', '-am', 'main: change a']);

    await g(['checkout', '-q', 'feat']);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  /** Drive performRebase into the paused conflict_halt state the loop consumes. */
  async function intoConflict() {
    const git = makeGitRunner(repo);
    const pre = await performRebase(git, repo, 'main');
    expect(pre.kind).toBe('conflict_halt');
    return { git, pre };
  }

  it('FR-2: a clean resolution completes the rebase and reclassifies as code-changed', async () => {
    const { git, pre } = await intoConflict();
    let calls = 0;
    const resolver = async (): Promise<ResolutionAttempt> => {
      calls++;
      await writeFile(join(repo, 'a.txt'), 'merged\n');
      await g(['add', 'a.txt']);
      await gc(['rebase', '--continue']);
      return { resolved: true };
    };

    const outcome = await resolveRebaseConflicts(git, repo, pre, resolver, 3);

    expect(calls).toBe(1);
    expect(outcome.kind).toBe('changed'); // a.txt is a code/test path
    // rebase actually finished + branch current with base
    expect((await g(['rev-list', '--count', 'HEAD..main'])).stdout.trim()).toBe('0');
    // feature commit subject survived
    expect((await g(['log', '--format=%s', 'main..HEAD'])).stdout).toContain('feat: change a');
  });

  it('FR-6: an explicit cannot-resolve signal short-circuits to HALT after one attempt', async () => {
    const { git, pre } = await intoConflict();
    let calls = 0;
    const resolver = async (): Promise<ResolutionAttempt> => {
      calls++;
      return { resolved: false, reason: 'semantic conflict — human needed' };
    };

    const outcome = await resolveRebaseConflicts(git, repo, pre, resolver, 3);

    expect(calls).toBe(1); // remaining attempts NOT consumed
    expect(outcome.kind).toBe('conflict_halt');
    if (outcome.kind === 'conflict_halt') {
      expect(outcome.reason).toContain('human needed');
    }
  });

  it('FR-5/FR-3: a resolver that never actually completes is retried exactly N times, then HALTs', async () => {
    const { git, pre } = await intoConflict();
    let calls = 0;
    // Claims success but leaves the rebase paused (resolves nothing) → failed attempt.
    const resolver = async (): Promise<ResolutionAttempt> => {
      calls++;
      return { resolved: true };
    };

    const outcome = await resolveRebaseConflicts(git, repo, pre, resolver, 3);

    expect(calls).toBe(3); // exactly N
    expect(outcome.kind).toBe('conflict_halt');
    if (outcome.kind === 'conflict_halt') {
      expect(outcome.reason).toMatch(/3/); // attempt count surfaced
    }
  });

  it('FR-8: a completed rebase that leaves the branch NOT current is rejected → HALT', async () => {
    const { git, pre } = await intoConflict();
    let calls = 0;
    // Aborts the rebase (back to pre-rebase feat) but claims success → not current.
    const resolver = async (): Promise<ResolutionAttempt> => {
      calls++;
      await gc(['rebase', '--abort']);
      return { resolved: true };
    };

    const outcome = await resolveRebaseConflicts(git, repo, pre, resolver, 3);

    expect(calls).toBe(1); // no unsafe retry after a completed-but-bad rebase
    expect(outcome.kind).toBe('conflict_halt');
    // branch is genuinely NOT current — base still has a commit the branch lacks
    expect((await g(['rev-list', '--count', 'HEAD..main'])).stdout.trim()).not.toBe('0');
  });

  it('FR-9: a resolution that drops the feature commit (--skip) is rejected → HALT', async () => {
    const { git, pre } = await intoConflict();
    let calls = 0;
    // `--skip` drops the conflicting feature commit and completes the rebase: branch
    // becomes current, but "feat: change a" is gone — must be caught and HALTed.
    const resolver = async (): Promise<ResolutionAttempt> => {
      calls++;
      await gc(['rebase', '--skip']);
      return { resolved: true };
    };

    const outcome = await resolveRebaseConflicts(git, repo, pre, resolver, 3);

    expect(calls).toBe(1);
    expect(outcome.kind).toBe('conflict_halt');
    if (outcome.kind === 'conflict_halt') {
      expect(outcome.reason).toMatch(/commit/i); // dropped-commit reason
    }
    // sanity: the branch WOULD have looked "current" (the trap FR-9 guards against)
    expect((await g(['rev-list', '--count', 'HEAD..main'])).stdout.trim()).toBe('0');
    expect((await g(['log', '--format=%s', 'main..HEAD'])).stdout).not.toContain('feat: change a');
  });

  it('FR-7: cap of 0 disables resolution — resolver is never called, HALT passes through', async () => {
    const { git, pre } = await intoConflict();
    let calls = 0;
    const resolver = async (): Promise<ResolutionAttempt> => {
      calls++;
      return { resolved: true };
    };

    const outcome = await resolveRebaseConflicts(git, repo, pre, resolver, 0);

    expect(calls).toBe(0);
    expect(outcome.kind).toBe('conflict_halt');
  });
});

describe('engine/rebase — featureCommitsPreserved (real git)', () => {
  let repo: string;
  const g = (args: string[]) => execFile('git', args, { cwd: repo });

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'commits-preserved-'));
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);
    await writeFile(join(repo, 'a.txt'), 'base\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('returns true when the feature commit subjects all survive (even if diffs changed)', async () => {
    await g(['checkout', '-q', '-b', 'feat']);
    await writeFile(join(repo, 'a.txt'), 'feature\n');
    await g(['commit', '-q', '-am', 'feat: change a']);
    const subjectsBefore = ['feat: change a'];

    const ok = await featureCommitsPreserved(makeGitRunner(repo), 'main', subjectsBefore);
    expect(ok).toBe(true);
  });

  it('returns false when a feature commit subject is missing (dropped)', async () => {
    // base..HEAD has nothing of "feat: change a" → it was dropped.
    const ok = await featureCommitsPreserved(
      makeGitRunner(repo),
      'main',
      ['feat: change a'],
    );
    expect(ok).toBe(false);
  });

  it('does not false-positive on a legitimately-empty feature (no prior commits to lose)', async () => {
    const ok = await featureCommitsPreserved(makeGitRunner(repo), 'main', []);
    expect(ok).toBe(true);
  });
});
