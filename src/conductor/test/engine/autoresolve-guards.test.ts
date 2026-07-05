/**
 * Acceptance (RED) specs for the work-preservation guard sequence at the NEW
 * autoresolve call site (story: "Work-preservation guards reject lossy
 * resolutions", .docs/stories/auto-resolve-open-pr-conflicts.md).
 *
 * Covers: FR-8, FR-9
 *
 * §3d adversarial-derivation-coverage note: `featureCommitsPreserved` and
 * `isBranchCurrent` already have direct tests in
 * test/engine/rebase-resolution.test.ts (real-git) and test/engine/rebase.test.ts
 * (fakeGit unit), AND a real-git production call site test inside
 * `resolveRebaseConflicts` (the finish-time / Tier-2 sanctioned dispatch loop).
 * Those do NOT cover the SECOND production call site this feature introduces:
 * the open-PR resolution pipeline's own guard sequence (plan Task 10, wired
 * into the not-yet-existing `src/engine/autoresolve.ts`). A derivation covered
 * only at its first call site is incomplete per §3d — these specs exercise the
 * guards at the NEW call site with real adversarial git state (a real --skip'd
 * commit, a real base-advanced-again mid-resolution branch, and a resolver that
 * claims success while the rebase-merge dir is still on disk), not hand-crafted
 * fixtures fed directly to the guard helpers.
 *
 * `autoresolve.ts` does not exist yet, so every test imports it dynamically
 * inside the `it()` body — this yields a genuine per-test FAILED result
 * ("Cannot find module") rather than a suite-level collection error, which is
 * the correct RED signal for the acceptance-specs gate.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { makeGitRunner, type GitRunner } from '../../src/engine/rebase.js';

const execFile = promisify(execFileCb);

describe('engine/autoresolve — acceptance guard sequence at the sweep-resolution call site', () => {
  let repo: string;
  const g = (args: string[]) => execFile('git', args, { cwd: repo });
  const gc = (args: string[]) => execFile('git', ['-c', 'core.editor=true', ...args], { cwd: repo });

  async function rebaseInProgress(): Promise<boolean> {
    const a = await access(join(repo, '.git', 'rebase-merge')).then(() => true, () => false);
    const b = await access(join(repo, '.git', 'rebase-apply')).then(() => true, () => false);
    return a || b;
  }

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'autoresolve-guards-'));
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);
    await g(['config', 'commit.gpgsign', 'false']);
    await writeFile(join(repo, 'a.ts'), 'base\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);

    await g(['checkout', '-q', '-b', 'feat']);
    await writeFile(join(repo, 'a.ts'), 'feature v1\n');
    await g(['commit', '-q', '-am', 'feat: change a']);

    await g(['checkout', '-q', 'main']);
    await writeFile(join(repo, 'a.ts'), 'main change\n');
    await g(['commit', '-q', '-am', 'main: change a']);
    await g(['checkout', '-q', 'feat']);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('accepts a clean resolution: subjects preserved, branch current, rebase fully finished (FR-8/FR-9 happy)', async () => {
    const git: GitRunner = makeGitRunner(repo);
    await g(['rebase', 'main']).catch(() => undefined); // conflicts on a.ts
    await writeFile(join(repo, 'a.ts'), 'merged\n');
    await g(['add', 'a.ts']);
    await gc(['rebase', '--continue']);
    expect(await rebaseInProgress()).toBe(false);

    const autoresolve = await import('../../src/engine/autoresolve.js');
    const result = await autoresolve.runAcceptanceGuards(git, 'main', ['feat: change a']);
    expect(result).toEqual({ ok: true });
  });

  it('rejects a resolution that --skip-dropped the feature commit, naming featureCommitsPreserved (FR-9 negative)', async () => {
    const git: GitRunner = makeGitRunner(repo);
    await g(['rebase', 'main']).catch(() => undefined); // conflicts on a.ts
    // Operator/resolver --skips the conflicting patch instead of resolving it —
    // the "feat: change a" subject is now genuinely absent from main..HEAD.
    await gc(['rebase', '--skip']);
    expect(await rebaseInProgress()).toBe(false);
    const log = await g(['log', '--format=%s', 'main..HEAD']);
    expect(log.stdout).not.toContain('feat: change a');

    const autoresolve = await import('../../src/engine/autoresolve.js');
    const result = await autoresolve.runAcceptanceGuards(git, 'main', ['feat: change a']);
    expect(result).toEqual({
      ok: false,
      guard: 'featureCommitsPreserved',
      reason: expect.stringContaining('feat: change a'),
    });
  });

  it('rejects when the base advanced again mid-resolution, naming isBranchCurrent (FR-8 negative)', async () => {
    const git: GitRunner = makeGitRunner(repo);
    await g(['rebase', 'main']).catch(() => undefined);
    await writeFile(join(repo, 'a.ts'), 'merged\n');
    await g(['add', 'a.ts']);
    await gc(['rebase', '--continue']);
    expect(await rebaseInProgress()).toBe(false);

    // Base advances AGAIN after the rebase completed but before verification runs.
    await g(['checkout', 'main']);
    await writeFile(join(repo, 'sibling.ts'), 'export const s = 1;\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'another sibling merged to base']);
    await g(['checkout', 'feat']);

    const autoresolve = await import('../../src/engine/autoresolve.js');
    const result = await autoresolve.runAcceptanceGuards(git, 'main', ['feat: change a']);
    expect(result).toEqual({
      ok: false,
      guard: 'isBranchCurrent',
      reason: expect.any(String),
    });
  });

  it('treats a resolver "success" as failed while the rebase-merge dir is still present, naming rebaseStateActive (mid-rebase-state negative)', async () => {
    const git: GitRunner = makeGitRunner(repo);
    await g(['rebase', 'main']).catch(() => undefined);
    // Stage a resolution WITHOUT continuing: the resolver reports success, but
    // the tree is genuinely still mid-rebase (rebase-merge dir on disk).
    await writeFile(join(repo, 'a.ts'), 'merged\n');
    await g(['add', 'a.ts']);
    expect(await rebaseInProgress()).toBe(true);

    const autoresolve = await import('../../src/engine/autoresolve.js');
    const result = await autoresolve.runAcceptanceGuards(git, 'main', ['feat: change a']);
    expect(result).toEqual({
      ok: false,
      guard: 'rebaseStateActive',
      reason: expect.any(String),
    });
  });
});
