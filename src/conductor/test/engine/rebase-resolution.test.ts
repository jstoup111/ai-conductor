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
  runGatedRebaseResolution,
  featureCommitsPreserved,
  type ResolutionAttempt,
  type RebaseOutcome,
  runTier1,
  conflictedFiles,
} from '../../src/engine/rebase.js';

const execFile = promisify(execFileCb);

describe('engine/rebase — gated resolution loop (real git, fake resolver)', () => {
  let repo: string;
  const g = (args: string[]) => execFile('git', args, { cwd: repo });
  const gc = (args: string[]) =>
    execFile('git', ['-c', 'core.editor=true', ...args], { cwd: repo });

  // Build a repo where rebasing `feat` onto `main` conflicts on a.ts, leaving a
  // single feature commit ("feat: change a") to replay.
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'rebase-resolution-'));
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);
    await writeFile(join(repo, 'a.ts'), 'base\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);

    await g(['checkout', '-q', '-b', 'feat']);
    await writeFile(join(repo, 'a.ts'), 'feature\n');
    await g(['commit', '-q', '-am', 'feat: change a']);

    await g(['checkout', '-q', 'main']);
    await writeFile(join(repo, 'a.ts'), 'mainchange\n');
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
      await writeFile(join(repo, 'a.ts'), 'merged\n');
      await g(['add', 'a.ts']);
      await gc(['rebase', '--continue']);
      return { resolved: true };
    };

    const outcome = await resolveRebaseConflicts(git, repo, pre, resolver, 3);

    expect(calls).toBe(1);
    expect(outcome.kind).toBe('changed'); // a.ts is a code/test path
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

  it('FR-7: a negative cap also disables resolution (cap <= 0 guard)', async () => {
    const { git, pre } = await intoConflict();
    let calls = 0;
    const resolver = async (): Promise<ResolutionAttempt> => {
      calls++;
      return { resolved: true };
    };

    const outcome = await resolveRebaseConflicts(git, repo, pre, resolver, -1);

    expect(calls).toBe(0);
    expect(outcome.kind).toBe('conflict_halt');
  });

});

describe('engine/rebase — resolution reclassification: docs-only → noop', () => {
  let repo: string;
  const g = (args: string[]) => execFile('git', args, { cwd: repo });
  const gc = (args: string[]) =>
    execFile('git', ['-c', 'core.editor=true', ...args], { cwd: repo });

  // A repo whose ONLY conflict is on a .md (docs) file.
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'rebase-resolution-docs-'));
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);
    await writeFile(join(repo, 'notes.md'), 'base\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);

    await g(['checkout', '-q', '-b', 'feat']);
    await writeFile(join(repo, 'notes.md'), 'feature notes\n');
    await g(['commit', '-q', '-am', 'feat: notes']);

    await g(['checkout', '-q', 'main']);
    await writeFile(join(repo, 'notes.md'), 'main notes\n');
    await g(['commit', '-q', '-am', 'main: notes']);

    await g(['checkout', '-q', 'feat']);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('FR-2/FR-5: a docs-only resolution reclassifies as noop (no downstream re-verify)', async () => {
    const git = makeGitRunner(repo);
    const pre = await performRebase(git, repo, 'main');
    expect(pre.kind).toBe('conflict_halt');

    const resolver = async (): Promise<ResolutionAttempt> => {
      await writeFile(join(repo, 'notes.md'), 'merged notes\n');
      await g(['add', 'notes.md']);
      await gc(['rebase', '--continue']);
      return { resolved: true };
    };

    const outcome = await resolveRebaseConflicts(git, repo, pre, resolver, 3);

    // notes.md is a docs path → noop (FR-5: docs never invalidate build/manual_test),
    // even though the rebase completed and the branch is now current.
    expect(outcome.kind).toBe('noop');
    expect((await g(['rev-list', '--count', 'HEAD..main'])).stdout.trim()).toBe('0');
    expect((await g(['log', '--format=%s', 'main..HEAD'])).stdout).toContain('feat: notes');
  });
});

// ── Shared gate wrapper both call sites use (#300) ────────────────────────────

describe('engine/rebase — runGatedRebaseResolution (shared gate, real git)', () => {
  let repo: string;
  const g = (args: string[]) => execFile('git', args, { cwd: repo });
  const gc = (args: string[]) =>
    execFile('git', ['-c', 'core.editor=true', ...args], { cwd: repo });

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'gated-resolution-'));
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);
    await writeFile(join(repo, 'a.ts'), 'base\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);

    await g(['checkout', '-q', '-b', 'feat']);
    await writeFile(join(repo, 'a.ts'), 'feature\n');
    await g(['commit', '-q', '-am', 'feat: change a']);

    await g(['checkout', '-q', 'main']);
    await writeFile(join(repo, 'a.ts'), 'mainchange\n');
    await g(['commit', '-q', '-am', 'main: change a']);

    await g(['checkout', '-q', 'feat']);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  async function intoConflict() {
    const git = makeGitRunner(repo);
    const pre = await performRebase(git, repo, 'main');
    expect(pre.kind).toBe('conflict_halt');
    return { git, pre };
  }

  it('passes a non-conflict outcome straight through (no resolver, no callbacks)', async () => {
    const git = makeGitRunner(repo);
    let calls = 0;
    let settled: string | null = null;
    const noop: RebaseOutcome = { kind: 'noop' };
    const out = await runGatedRebaseResolution({
      git,
      projectRoot: repo,
      outcome: noop,
      cap: 3,
      resolve: async () => {
        calls++;
        return { resolved: true };
      },
      onSettled: (k) => {
        settled = k;
      },
    });
    expect(out).toBe(noop);
    expect(calls).toBe(0);
    expect(settled).toBeNull();
  });

  it('cap 0 → resolver never called, conflict returned unchanged (FR-7 parity)', async () => {
    const { git, pre } = await intoConflict();
    let calls = 0;
    const out = await runGatedRebaseResolution({
      git,
      projectRoot: repo,
      outcome: pre,
      cap: 0,
      resolve: async () => {
        calls++;
        return { resolved: true };
      },
    });
    expect(calls).toBe(0);
    expect(out.kind).toBe('conflict_halt');
  });

  it('no resolver wired → conflict returned unchanged (default play-forward behavior)', async () => {
    const { git, pre } = await intoConflict();
    const out = await runGatedRebaseResolution({
      git,
      projectRoot: repo,
      outcome: pre,
      cap: 3,
      // resolve omitted
    });
    expect(out.kind).toBe('conflict_halt');
  });

  it('resolver resolves → reclassified, onAttempt(1,3) fired, onSettled(succeeded)', async () => {
    const { git, pre } = await intoConflict();
    const attempts: Array<{ index: number; cap: number }> = [];
    let settled: string | null = null;
    const out = await runGatedRebaseResolution({
      git,
      projectRoot: repo,
      outcome: pre,
      cap: 3,
      resolve: async (): Promise<ResolutionAttempt> => {
        await writeFile(join(repo, 'a.ts'), 'merged\n');
        await g(['add', 'a.ts']);
        await gc(['rebase', '--continue']);
        return { resolved: true };
      },
      onAttempt: (index, cap) => {
        attempts.push({ index, cap });
      },
      onSettled: (k) => {
        settled = k;
      },
    });
    expect(out.kind).toBe('changed');
    expect(attempts[0]).toEqual({ index: 1, cap: 3 });
    expect(settled).toBe('succeeded');
  });

  it('resolver throws → caught as {resolved:false}, short-circuits to HALT, onSettled(exhausted)', async () => {
    const { git, pre } = await intoConflict();
    const attempts: number[] = [];
    let settled: string | null = null;
    const out = await runGatedRebaseResolution({
      git,
      projectRoot: repo,
      outcome: pre,
      cap: 3,
      resolve: async () => {
        throw new Error('resolver session expired');
      },
      onAttempt: (index) => {
        attempts.push(index);
      },
      onSettled: (k) => {
        settled = k;
      },
    });
    expect(out.kind).toBe('conflict_halt');
    // A throw degrades to {resolved:false} → FR-6 short-circuit (no further attempts).
    expect(attempts).toEqual([1]);
    expect(settled).toBe('exhausted');
    if (out.kind === 'conflict_halt') {
      expect(out.reason).toContain('resolver session expired');
    }
  });

  it('throwing observability callbacks never break resolution (best-effort)', async () => {
    const { git, pre } = await intoConflict();
    const out = await runGatedRebaseResolution({
      git,
      projectRoot: repo,
      outcome: pre,
      cap: 3,
      resolve: async (): Promise<ResolutionAttempt> => {
        await writeFile(join(repo, 'a.ts'), 'merged\n');
        await g(['add', 'a.ts']);
        await gc(['rebase', '--continue']);
        return { resolved: true };
      },
      onAttempt: () => {
        throw new Error('telemetry down');
      },
      onSettled: () => {
        throw new Error('telemetry down');
      },
    });
    expect(out.kind).toBe('changed');
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
    await writeFile(join(repo, 'a.ts'), 'base\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('returns true when the feature commit subjects all survive (even if diffs changed)', async () => {
    await g(['checkout', '-q', '-b', 'feat']);
    await writeFile(join(repo, 'a.ts'), 'feature\n');
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

describe('engine/rebase — .docs keep-both resolver (happy path)', () => {
  let repo: string;
  const g = (args: string[]) => execFile('git', args, { cwd: repo });
  const gc = (args: string[]) =>
    execFile('git', ['-c', 'core.editor=true', ...args], { cwd: repo });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  /**
   * add/add conflict inside .docs/: same file added with different content
   * on different branches. Expected: both versions kept and staged, rebase continues.
   */
  it('.docs/ add/add conflict: both versions kept and staged', async () => {
    repo = await mkdtemp(join(tmpdir(), 'rebase-docs-addadd-'));
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);

    // Base: init without .docs file
    await writeFile(join(repo, 'README.md'), 'base\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);

    // Feature branch: adds .docs/design.md with feature content
    await g(['checkout', '-q', '-b', 'feat']);
    await execFile('mkdir', ['-p', join(repo, '.docs')], {});
    await writeFile(join(repo, '.docs/design.md'), 'feature design\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'feat: add design docs']);

    // Main: adds .docs/design.md with main content (add/add conflict)
    await g(['checkout', '-q', 'main']);
    await execFile('mkdir', ['-p', join(repo, '.docs')], {});
    await writeFile(join(repo, '.docs/design.md'), 'main design\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'main: add design docs']);

    // Back to feat, set up for rebase
    await g(['checkout', '-q', 'feat']);

    // Trigger the conflict
    const git = makeGitRunner(repo);
    const pre = await performRebase(git, repo, 'main');
    expect(pre.kind).toBe('conflict_halt');

    // Use the .docs keep-both resolver
    const { docsKeepBothResolver } = await import('../../src/engine/rebase.js');
    const outcome = await resolveRebaseConflicts(git, repo, pre, docsKeepBothResolver, 3);

    // Should resolve cleanly, both versions kept (side-by-side), reclassify as noop (docs-only)
    expect(outcome.kind).toBe('noop'); // docs-only → no downstream invalidate
    expect((await g(['rev-list', '--count', 'HEAD..main'])).stdout.trim()).toBe('0');
    // Both versions of the file should be preserved (in a keep-both resolution, typically
    // both renamed to avoid collision: design~feature.md and design~main.md)
    const files = await g(['ls-tree', '-r', '--name-only', 'HEAD']);
    const paths = files.stdout.trim().split('\n');
    expect(paths.some((p) => p.includes('.docs') && p.includes('design'))).toBe(true);
  });

  /**
   * rename/rename collision inside .docs/: same file renamed differently
   * on each branch. Expected: both versions kept, staged, rebase continues.
   */
  it('.docs/ rename/rename conflict: both renamed versions kept and staged', async () => {
    repo = await mkdtemp(join(tmpdir(), 'rebase-docs-rename-'));
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);

    // Base: create a .docs file to rename
    await execFile('mkdir', ['-p', join(repo, '.docs')], {});
    await writeFile(join(repo, '.docs/original.md'), 'content\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);

    // Feature: rename to feature-name.md
    await g(['checkout', '-q', '-b', 'feat']);
    await g(['mv', '.docs/original.md', '.docs/feature-name.md']);
    await g(['commit', '-q', '-m', 'feat: rename to feature-name']);

    // Main: rename to main-name.md
    await g(['checkout', '-q', 'main']);
    await g(['mv', '.docs/original.md', '.docs/main-name.md']);
    await g(['commit', '-q', '-m', 'main: rename to main-name']);

    // Back to feat
    await g(['checkout', '-q', 'feat']);

    // Trigger the conflict
    const git = makeGitRunner(repo);
    const pre = await performRebase(git, repo, 'main');
    expect(pre.kind).toBe('conflict_halt');

    // Use the .docs keep-both resolver
    const { docsKeepBothResolver } = await import('../../src/engine/rebase.js');
    const outcome = await resolveRebaseConflicts(git, repo, pre, docsKeepBothResolver, 3);

    // Should resolve cleanly, both renamed versions kept, reclassify as noop
    expect(outcome.kind).toBe('noop'); // docs-only → no downstream invalidate
    expect((await g(['rev-list', '--count', 'HEAD..main'])).stdout.trim()).toBe('0');
    // Both renamed files should exist at HEAD
    const featureName = await execFile('git', ['show', 'HEAD:.docs/feature-name.md'], { cwd: repo });
    const mainName = await execFile('git', ['show', 'HEAD:.docs/main-name.md'], { cwd: repo });
    expect(featureName.stdout).toContain('content');
    expect(mainName.stdout).toContain('content');
  });

  /**
   * Non-.docs/ conflict mixed with .docs/ conflict: resolver should reject
   * since it only handles pure .docs/ conflicts.
   */
  it('.docs/ resolver rejects mixed .docs/ + non-.docs/ conflicts', async () => {
    repo = await mkdtemp(join(tmpdir(), 'rebase-docs-mixed-'));
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);

    // Base: init with both files
    await execFile('mkdir', ['-p', join(repo, '.docs')], {});
    await execFile('mkdir', ['-p', join(repo, 'src')], {});
    await writeFile(join(repo, 'src/code.ts'), 'base code\n');
    await writeFile(join(repo, '.docs/design.md'), 'base design\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);

    // Feature: change both files
    await g(['checkout', '-q', '-b', 'feat']);
    await writeFile(join(repo, 'src/code.ts'), 'feature code\n');
    await writeFile(join(repo, '.docs/design.md'), 'feature design\n');
    await g(['commit', '-q', '-am', 'feat: change both']);

    // Main: change both files differently (conflict on both)
    await g(['checkout', '-q', 'main']);
    await writeFile(join(repo, 'src/code.ts'), 'main code\n');
    await writeFile(join(repo, '.docs/design.md'), 'main design\n');
    await g(['commit', '-q', '-am', 'main: change both']);

    // Back to feat
    await g(['checkout', '-q', 'feat']);

    // Trigger the conflict
    const git = makeGitRunner(repo);
    const pre = await performRebase(git, repo, 'main');
    expect(pre.kind).toBe('conflict_halt');
    expect(pre.conflicts.length).toBe(2);

    // Use the .docs keep-both resolver
    const { docsKeepBothResolver } = await import('../../src/engine/rebase.js');
    const outcome = await resolveRebaseConflicts(git, repo, pre, docsKeepBothResolver, 1);

    // Should reject because src/code.ts is not in .docs/
    expect(outcome.kind).toBe('conflict_halt');
    if (outcome.kind === 'conflict_halt') {
      expect(outcome.reason).toContain('non-.docs/');
    }
  });

  /**
   * .docs/ add/add conflict with proper file staging verification.
   * After resolution, both versions should be committed and properly staged.
   */
  it('.docs/ resolved files are properly committed and in the final tree', async () => {
    repo = await mkdtemp(join(tmpdir(), 'rebase-docs-staging-'));
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);

    // Base: init without .docs file
    await writeFile(join(repo, 'README.md'), 'base\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);

    // Feature branch: adds .docs/notes.md with feature content
    await g(['checkout', '-q', '-b', 'feat']);
    await execFile('mkdir', ['-p', join(repo, '.docs')], {});
    await writeFile(join(repo, '.docs/notes.md'), 'feature notes\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'feat: add notes']);

    // Main: adds .docs/notes.md with main content (add/add conflict)
    await g(['checkout', '-q', 'main']);
    await execFile('mkdir', ['-p', join(repo, '.docs')], {});
    await writeFile(join(repo, '.docs/notes.md'), 'main notes\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'main: add notes']);

    // Back to feat
    await g(['checkout', '-q', 'feat']);

    // Trigger the conflict
    const git = makeGitRunner(repo);
    const pre = await performRebase(git, repo, 'main');
    expect(pre.kind).toBe('conflict_halt');

    // Use the .docs keep-both resolver
    const { docsKeepBothResolver } = await import('../../src/engine/rebase.js');
    const outcome = await resolveRebaseConflicts(git, repo, pre, docsKeepBothResolver, 3);

    // Should resolve cleanly
    expect(outcome.kind).toBe('noop');
    expect((await g(['rev-list', '--count', 'HEAD..main'])).stdout.trim()).toBe('0');

    // Both versions should exist in the final tree
    const files = await g(['ls-tree', '-r', '--name-only', 'HEAD']);
    const paths = files.stdout.trim().split('\n');
    const docsFiles = paths.filter((p) => p.startsWith('.docs/'));
    expect(docsFiles.length).toBeGreaterThanOrEqual(2); // At least both versions
    expect(paths.some((p) => p.includes('notes~ours'))).toBe(true);
    expect(paths.some((p) => p.includes('notes~theirs'))).toBe(true);
  });

  /**
   * Non-conflicted .docs/ files remain unchanged when resolving an add/add conflict
   * in a different .docs/ file.
   */
  it('non-conflicted .docs/ files remain unchanged during resolution', async () => {
    repo = await mkdtemp(join(tmpdir(), 'rebase-docs-unchanged-'));
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);

    // Base: init with a stable .docs file
    await execFile('mkdir', ['-p', join(repo, '.docs')], {});
    await writeFile(join(repo, '.docs/stable.md'), 'stable content\n');
    await writeFile(join(repo, 'README.md'), 'base\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);

    // Feature: add .docs/design.md, don't touch stable.md
    await g(['checkout', '-q', '-b', 'feat']);
    await writeFile(join(repo, '.docs/design.md'), 'feature design\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'feat: add design']);

    // Main: add .docs/design.md differently, don't touch stable.md (add/add conflict on design only)
    await g(['checkout', '-q', 'main']);
    await writeFile(join(repo, '.docs/design.md'), 'main design\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'main: add design']);

    // Back to feat
    await g(['checkout', '-q', 'feat']);

    // Trigger the conflict
    const git = makeGitRunner(repo);
    const pre = await performRebase(git, repo, 'main');
    expect(pre.kind).toBe('conflict_halt');

    // Use the .docs keep-both resolver
    const { docsKeepBothResolver } = await import('../../src/engine/rebase.js');
    const outcome = await resolveRebaseConflicts(git, repo, pre, docsKeepBothResolver, 3);

    // Should resolve cleanly
    expect(outcome.kind).toBe('noop');
    expect((await g(['rev-list', '--count', 'HEAD..main'])).stdout.trim()).toBe('0');

    // stable.md should still exist with original content
    const stableFile = await execFile('git', ['show', 'HEAD:.docs/stable.md'], { cwd: repo });
    expect(stableFile.stdout).toContain('stable content');

    // Both versions of design.md should exist
    const files = await g(['ls-tree', '-r', '--name-only', 'HEAD']);
    const paths = files.stdout.trim().split('\n');
    expect(paths).toContain('.docs/stable.md');
    expect(paths.some((p) => p.includes('design~ours'))).toBe(true);
    expect(paths.some((p) => p.includes('design~theirs'))).toBe(true);
  });
});

describe('engine/rebase — .docs keep-both resolver (negative scope cases)', () => {
  let repo: string;
  const g = (args: string[]) => execFile('git', args, { cwd: repo });
  const gc = (args: string[]) =>
    execFile('git', ['-c', 'core.editor=true', ...args], { cwd: repo });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  /**
   * Edit conflict (both sides modified same file): file has a common ancestor
   * and both sides changed its content. keep-both resolver should NOT resolve
   * these — they require human intervention.
   */
  it('rejects .docs/ edit conflict (content divergence) — not add/add or rename/rename', async () => {
    repo = await mkdtemp(join(tmpdir(), 'rebase-docs-edit-'));
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);

    // Base: create a .docs file with initial content
    await execFile('mkdir', ['-p', join(repo, '.docs')], {});
    await writeFile(join(repo, '.docs/design.md'), 'initial content\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);

    // Feature: edit the .docs file
    await g(['checkout', '-q', '-b', 'feat']);
    await writeFile(join(repo, '.docs/design.md'), 'feature content\n');
    await g(['commit', '-q', '-am', 'feat: change design']);

    // Main: edit the same .docs file differently (edit conflict, not add/add)
    await g(['checkout', '-q', 'main']);
    await writeFile(join(repo, '.docs/design.md'), 'main content\n');
    await g(['commit', '-q', '-am', 'main: change design']);

    // Back to feat
    await g(['checkout', '-q', 'feat']);

    // Trigger the conflict
    const git = makeGitRunner(repo);
    const pre = await performRebase(git, repo, 'main');
    expect(pre.kind).toBe('conflict_halt');

    // Use the .docs keep-both resolver — should reject edit conflicts
    const { docsKeepBothResolver } = await import('../../src/engine/rebase.js');
    const outcome = await resolveRebaseConflicts(git, repo, pre, docsKeepBothResolver, 1);

    // Should NOT resolve: edit conflicts are not in scope (only add/add and rename/rename)
    expect(outcome.kind).toBe('conflict_halt');
    if (outcome.kind === 'conflict_halt') {
      expect(outcome.reason).toContain('edit conflict') ||
        expect(outcome.reason).toContain('cannot be keep-both resolved');
    }
  });

  /**
   * Conflicted path outside .docs/ — resolver should reject entirely,
   * even if there might be .docs/ conflicts too.
   */
  it('rejects when any conflict is outside .docs/', async () => {
    repo = await mkdtemp(join(tmpdir(), 'rebase-docs-outside-'));
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);

    // Base: init with a src file
    await execFile('mkdir', ['-p', join(repo, 'src')], {});
    await writeFile(join(repo, 'src/code.ts'), 'base code\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);

    // Feature: edit src/code.ts
    await g(['checkout', '-q', '-b', 'feat']);
    await writeFile(join(repo, 'src/code.ts'), 'feature code\n');
    await g(['commit', '-q', '-am', 'feat: change code']);

    // Main: edit src/code.ts differently (conflict outside .docs/)
    await g(['checkout', '-q', 'main']);
    await writeFile(join(repo, 'src/code.ts'), 'main code\n');
    await g(['commit', '-q', '-am', 'main: change code']);

    // Back to feat
    await g(['checkout', '-q', 'feat']);

    // Trigger the conflict
    const git = makeGitRunner(repo);
    const pre = await performRebase(git, repo, 'main');
    expect(pre.kind).toBe('conflict_halt');
    expect(pre.conflicts).toContain('src/code.ts');

    // Use the .docs keep-both resolver — should reject non-.docs/ conflicts
    const { docsKeepBothResolver } = await import('../../src/engine/rebase.js');
    const outcome = await resolveRebaseConflicts(git, repo, pre, docsKeepBothResolver, 1);

    // Should reject because src/code.ts is not in .docs/
    expect(outcome.kind).toBe('conflict_halt');
    if (outcome.kind === 'conflict_halt') {
      expect(outcome.reason).toContain('non-.docs/');
    }
  });

  /**
   * Mixed conflict: .docs/ add/add + src/ edit conflict.
   * Resolver should reject the entire operation (cannot handle mixed scenarios).
   * The result should indicate which conflicts remain unresolved.
   */
  it('rejects mixed .docs/ add/add + src/ edit — does not partially resolve', async () => {
    repo = await mkdtemp(join(tmpdir(), 'rebase-docs-mixed-addadd-edit-'));
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);

    // Base: init with a src file
    await execFile('mkdir', ['-p', join(repo, '.docs')], {});
    await execFile('mkdir', ['-p', join(repo, 'src')], {});
    await writeFile(join(repo, 'src/code.ts'), 'base code\n');
    await writeFile(join(repo, 'README.md'), 'base\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);

    // Feature: adds .docs/design.md and edits src/code.ts
    await g(['checkout', '-q', '-b', 'feat']);
    await writeFile(join(repo, '.docs/design.md'), 'feature design\n');
    await writeFile(join(repo, 'src/code.ts'), 'feature code\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'feat: add docs and change code']);

    // Main: adds .docs/design.md differently and edits src/code.ts differently
    // This creates: .docs/design.md add/add conflict + src/code.ts edit conflict
    await g(['checkout', '-q', 'main']);
    await execFile('mkdir', ['-p', join(repo, '.docs')], {});
    await writeFile(join(repo, '.docs/design.md'), 'main design\n');
    await writeFile(join(repo, 'src/code.ts'), 'main code\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'main: add docs and change code']);

    // Back to feat
    await g(['checkout', '-q', 'feat']);

    // Trigger the conflict
    const git = makeGitRunner(repo);
    const pre = await performRebase(git, repo, 'main');
    expect(pre.kind).toBe('conflict_halt');
    expect(pre.conflicts.length).toBe(2); // both .docs/design.md and src/code.ts

    // Use the .docs keep-both resolver
    const { docsKeepBothResolver } = await import('../../src/engine/rebase.js');
    const outcome = await resolveRebaseConflicts(git, repo, pre, docsKeepBothResolver, 1);

    // Should reject because src/code.ts (non-.docs/) is in the conflict list
    // Result should indicate the conflicts remain
    expect(outcome.kind).toBe('conflict_halt');
    if (outcome.kind === 'conflict_halt') {
      expect(outcome.reason).toContain('non-.docs/');
      // The src/code.ts conflict should still be listed
      expect(outcome.conflicts).toContain('src/code.ts');
    }
  });
});

describe('engine/rebase — runTier1 driver (CHANGELOG + .docs keep-both resolvers)', () => {
  let repo: string;
  const g = (args: string[]) => execFile('git', args, { cwd: repo });
  const gc = (args: string[]) =>
    execFile('git', ['-c', 'core.editor=true', ...args], { cwd: repo });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  /**
   * Mixed: CHANGELOG + code conflict.
   * runTier1 should resolve the CHANGELOG, leaving only the code conflict.
   * Returns {resolved: ['CHANGELOG.md'], remaining: ['src/code.ts']}
   */
  it('CHANGELOG + code conflict: CHANGELOG resolved, code remains', async () => {
    repo = await mkdtemp(join(tmpdir(), 'rebase-tier1-changelog-code-'));
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);

    // Base: CHANGELOG + code file
    const baseChangelog = `# Changelog

## [Unreleased]

## [1.0.0]
- Initial release
`;
    await execFile('mkdir', ['-p', join(repo, 'src')], {});
    await writeFile(join(repo, 'CHANGELOG.md'), baseChangelog);
    await writeFile(join(repo, 'src/code.ts'), 'base\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);

    // Feature: add to CHANGELOG [Unreleased] + edit code
    await g(['checkout', '-q', '-b', 'feat']);
    const featureChangelog = `# Changelog

## [Unreleased]

### Added
- Feature X

## [1.0.0]
- Initial release
`;
    await writeFile(join(repo, 'CHANGELOG.md'), featureChangelog);
    await writeFile(join(repo, 'src/code.ts'), 'feature\n');
    await g(['commit', '-q', '-am', 'feat: add X and change code']);

    // Main: also adds to CHANGELOG [Unreleased] + edit code differently (both conflict)
    await g(['checkout', '-q', 'main']);
    const mainChangelog = `# Changelog

## [Unreleased]

### Fixed
- Bug Y

## [1.0.0]
- Initial release
`;
    await writeFile(join(repo, 'CHANGELOG.md'), mainChangelog);
    await writeFile(join(repo, 'src/code.ts'), 'main\n');
    await g(['commit', '-q', '-am', 'main: fix Y and change code']);

    // Back to feat, manually trigger rebase (catch the error)
    await g(['checkout', '-q', 'feat']);
    const git = makeGitRunner(repo);
    try {
      await g(['rebase', 'main']);
    } catch {
      // Expected: rebase fails due to conflicts
    }

    // Now we should have both CHANGELOG and src/code.ts in conflicts
    const conflicted = await conflictedFiles(git);
    expect(conflicted.length).toBeGreaterThan(0);
    expect(conflicted).toContain('CHANGELOG.md');
    expect(conflicted).toContain('src/code.ts');

    // Run tier1 resolver
    const result = await runTier1(git, repo);

    // CHANGELOG should be resolved
    expect(result.resolved).toContain('CHANGELOG.md');
    // But code conflict remains
    expect(result.remaining).toContain('src/code.ts');
  });

  /**
   * CHANGELOG-only conflict (no code conflicts): should be fully resolved.
   * Returns {resolved: ['CHANGELOG.md'], remaining: []}
   */
  it('CHANGELOG-only conflict: fully resolved', async () => {
    repo = await mkdtemp(join(tmpdir(), 'rebase-tier1-changelog-only-'));
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);

    // Base: CHANGELOG with [Unreleased]
    const baseChangelog = `# Changelog

## [Unreleased]

## [1.0.0]
- Initial release
`;
    await writeFile(join(repo, 'CHANGELOG.md'), baseChangelog);
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);

    // Feature: add to [Unreleased]
    await g(['checkout', '-q', '-b', 'feat']);
    const featureChangelog = `# Changelog

## [Unreleased]

### Added
- Feature X

## [1.0.0]
- Initial release
`;
    await writeFile(join(repo, 'CHANGELOG.md'), featureChangelog);
    await g(['commit', '-q', '-am', 'feat: add X']);

    // Main: add different entry to [Unreleased]
    await g(['checkout', '-q', 'main']);
    const mainChangelog = `# Changelog

## [Unreleased]

### Fixed
- Bug Y

## [1.0.0]
- Initial release
`;
    await writeFile(join(repo, 'CHANGELOG.md'), mainChangelog);
    await g(['commit', '-q', '-am', 'main: fix Y']);

    // Back to feat, manually trigger rebase (catch the error)
    await g(['checkout', '-q', 'feat']);
    const git = makeGitRunner(repo);
    try {
      await g(['rebase', 'main']);
    } catch {
      // Expected: rebase fails due to CHANGELOG conflict
    }

    // Verify CHANGELOG conflict
    const conflicted = await conflictedFiles(git);
    expect(conflicted).toContain('CHANGELOG.md');

    // Now test runTier1
    const result = await runTier1(git, repo);
    expect(result.resolved).toContain('CHANGELOG.md');
    expect(result.remaining.length).toBe(0);
    // Rebase should be complete and current
    expect((await g(['rev-list', '--count', 'HEAD..main'])).stdout.trim()).toBe('0');
  });

  /**
   * .docs/-only add/add conflict: resolved by keep-both resolver.
   * Returns {resolved: ['.docs/...'], remaining: []}
   */
  it('.docs/-only add/add conflict: resolved by keep-both', async () => {
    repo = await mkdtemp(join(tmpdir(), 'rebase-tier1-docs-addadd-'));
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);

    // Base: no .docs file
    await writeFile(join(repo, 'README.md'), 'base\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);

    // Feature: adds .docs/design.md
    await g(['checkout', '-q', '-b', 'feat']);
    await execFile('mkdir', ['-p', join(repo, '.docs')], {});
    await writeFile(join(repo, '.docs/design.md'), 'feature design\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'feat: add design']);

    // Main: adds same .docs/design.md with different content (add/add conflict)
    await g(['checkout', '-q', 'main']);
    await execFile('mkdir', ['-p', join(repo, '.docs')], {});
    await writeFile(join(repo, '.docs/design.md'), 'main design\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'main: add design']);

    // Back to feat, manually trigger rebase to pause
    await g(['checkout', '-q', 'feat']);
    const git = makeGitRunner(repo);
    try {
      await g(['rebase', 'main']);
    } catch {
      // Expected: rebase fails due to .docs conflict
    }

    // Verify conflict
    const conflicted = await conflictedFiles(git);
    expect(conflicted).toContain('.docs/design.md');

    // Run tier1 resolver
    const result = await runTier1(git, repo);

    expect(result.resolved.some((f) => f.includes('.docs/design'))).toBe(true);
    expect(result.remaining).not.toContain('.docs/design.md');
    // Rebase complete, both versions kept
    expect((await g(['rev-list', '--count', 'HEAD..main'])).stdout.trim()).toBe('0');
  });

  /**
   * Mixed CHANGELOG + .docs/ conflicts: both resolved by their respective resolvers.
   * Returns {resolved: ['CHANGELOG.md', '.docs/...'], remaining: []}
   */
  it('mixed CHANGELOG + .docs/ conflicts: both resolved', async () => {
    repo = await mkdtemp(join(tmpdir(), 'rebase-tier1-mixed-'));
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);

    // Base: CHANGELOG + .docs exists
    const baseChangelog = `# Changelog

## [Unreleased]

## [1.0.0]
- Initial
`;
    await execFile('mkdir', ['-p', join(repo, '.docs')], {});
    await writeFile(join(repo, 'CHANGELOG.md'), baseChangelog);
    await writeFile(join(repo, '.docs/design.md'), 'base design\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);

    // Feature: add to CHANGELOG [Unreleased] + add .docs/spec.md
    await g(['checkout', '-q', '-b', 'feat']);
    const featureChangelog = `# Changelog

## [Unreleased]

### Added
- Feature X

## [1.0.0]
- Initial
`;
    await writeFile(join(repo, 'CHANGELOG.md'), featureChangelog);
    await writeFile(join(repo, '.docs/spec.md'), 'feature spec\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'feat: add X and spec']);

    // Main: also adds to CHANGELOG + add .docs/spec.md (both add/add)
    await g(['checkout', '-q', 'main']);
    const mainChangelog = `# Changelog

## [Unreleased]

### Fixed
- Bug Y

## [1.0.0]
- Initial
`;
    await writeFile(join(repo, 'CHANGELOG.md'), mainChangelog);
    await writeFile(join(repo, '.docs/spec.md'), 'main spec\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'main: fix Y and add spec']);

    // Back to feat, manually trigger rebase (catch error)
    await g(['checkout', '-q', 'feat']);
    const git = makeGitRunner(repo);
    try {
      await g(['rebase', 'main']);
    } catch {
      // Expected: rebase fails due to conflicts
    }

    // Verify both conflicts
    const conflicted = await conflictedFiles(git);
    expect(conflicted.length).toBe(2);
    expect(conflicted).toContain('CHANGELOG.md');
    expect(conflicted.some((f) => f.includes('.docs/spec'))).toBe(true);

    // Run tier1 resolver
    const result = await runTier1(git, repo);

    // Both should be resolved
    expect(result.resolved).toContain('CHANGELOG.md');
    expect(result.resolved.some((f) => f.includes('.docs/spec'))).toBe(true);
    expect(result.remaining.length).toBe(0);
    // Rebase complete and current
    expect((await g(['rev-list', '--count', 'HEAD..main'])).stdout.trim()).toBe('0');
  });

  /**
   * Conflict on non-.docs/, non-CHANGELOG file: should remain unresolved.
   * Returns {resolved: [], remaining: ['src/code.ts']}
   */
  it('non-.docs/ non-CHANGELOG conflict: remains unresolved', async () => {
    repo = await mkdtemp(join(tmpdir(), 'rebase-tier1-other-'));
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);

    // Base: source file
    await execFile('mkdir', ['-p', join(repo, 'src')], {});
    await writeFile(join(repo, 'src/code.ts'), 'base\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);

    // Feature: edit src/code.ts
    await g(['checkout', '-q', '-b', 'feat']);
    await writeFile(join(repo, 'src/code.ts'), 'feature\n');
    await g(['commit', '-q', '-am', 'feat: change code']);

    // Main: edit src/code.ts differently (conflict)
    await g(['checkout', '-q', 'main']);
    await writeFile(join(repo, 'src/code.ts'), 'main\n');
    await g(['commit', '-q', '-am', 'main: change code']);

    // Back to feat, manually trigger rebase to pause (catch error)
    await g(['checkout', '-q', 'feat']);
    const git = makeGitRunner(repo);
    try {
      await g(['rebase', 'main']);
    } catch {
      // Expected: rebase fails due to conflicts
    }

    // Verify conflict
    const conflicted = await conflictedFiles(git);
    expect(conflicted).toContain('src/code.ts');

    // Run tier1 resolver
    const result = await runTier1(git, repo);

    // Should remain unresolved
    expect(result.resolved).not.toContain('src/code.ts');
    expect(result.remaining).toContain('src/code.ts');
  });
});
