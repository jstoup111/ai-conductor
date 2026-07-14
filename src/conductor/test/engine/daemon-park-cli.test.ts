import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import {
  detectDaemonParkCommand,
  dispatchDaemonPark,
  validateSlug,
  resolveMainRepoRoot,
} from '../../src/engine/daemon-park-cli.js';
import { isOperatorParked, __resetResolveCacheForTests } from '../../src/engine/park-marker.js';

const execFile = promisify(execFileCb);

describe('engine/daemon-park-cli', () => {
  let root: string;

  const makeWorktree = async (r: string, slug: string) => {
    await mkdir(join(r, '.worktrees', slug), { recursive: true });
  };

  /** Initialize a real git repo at root with a linked worktree. */
  const initGitRepoWithWorktree = async (r: string, slug: string) => {
    const g = (args: string[], cwd = r) => execFile('git', args, { cwd });
    try {
      // Initialize main repo
      await g(['init', '-q', '-b', 'main']);
      await g(['config', 'user.email', 't@t.com']);
      await g(['config', 'user.name', 'T']);
      await g(['config', 'commit.gpgsign', 'false']);
      await writeFile(join(r, 'README.md'), '# base\n');
      await g(['add', '.']);
      await g(['commit', '-q', '-m', 'init']);

      // Create worktree
      const worktreeDir = join(r, '.worktrees', slug);
      await mkdir(worktreeDir, { recursive: true });
      await g(['worktree', 'add', '-b', `spec/${slug}`, worktreeDir, 'main']);
      return worktreeDir;
    } catch (err) {
      // If git commands fail, just create the directory structure
      await mkdir(join(r, '.worktrees', slug), { recursive: true });
      return join(r, '.worktrees', slug);
    }
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'daemon-park-cli-'));
    __resetResolveCacheForTests();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    __resetResolveCacheForTests();
  });

  describe('resolveMainRepoRoot', () => {
    const git = (cwd: string, ...args: string[]) => execFile('git', args, { cwd });

    it('resolves the same root from the main root, a nested subdir, and a linked worktree', async () => {
      const repoRoot = await realpath(root);
      await git(repoRoot, 'init', '-q');
      await git(repoRoot, 'config', 'user.email', 'test@example.com');
      await git(repoRoot, 'config', 'user.name', 'Test');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(repoRoot, 'README.md'), '# repo\n');
      await git(repoRoot, 'add', '.');
      await git(repoRoot, 'commit', '-q', '-m', 'initial');

      const fromRoot = await resolveMainRepoRoot(repoRoot);
      expect(fromRoot).toEqual({ root: repoRoot });

      const nestedDir = join(repoRoot, 'a', 'b', 'c');
      await mkdir(nestedDir, { recursive: true });
      const fromNested = await resolveMainRepoRoot(nestedDir);
      expect(fromNested).toEqual({ root: repoRoot });

      const worktreeParent = await mkdtemp(join(tmpdir(), 'daemon-park-cli-wt-'));
      const worktreePath = join(await realpath(worktreeParent), 'linked-wt');
      await git(repoRoot, 'branch', 'wt-branch');
      await git(repoRoot, 'worktree', 'add', worktreePath, 'wt-branch');
      try {
        const fromWorktree = await resolveMainRepoRoot(worktreePath);
        expect(fromWorktree).toEqual({ root: repoRoot });
      } finally {
        await git(repoRoot, 'worktree', 'remove', '--force', worktreePath).catch(() => {});
        await rm(worktreeParent, { recursive: true, force: true });
      }
    });

    it('returns a clear error (not "slug not found") when called outside any git repo', async () => {
      const outsideDir = await mkdtemp(join(tmpdir(), 'daemon-park-cli-outside-'));
      try {
        const result = await resolveMainRepoRoot(outsideDir);
        expect('error' in result).toBe(true);
        if ('error' in result) {
          expect(result.error.toLowerCase()).toContain("daemon park <slug>");
          expect(result.error.toLowerCase()).not.toContain('slug not found');
        }
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });

  describe('detectDaemonParkCommand', () => {
    const argv = (...rest: string[]) => ['node', 'conduct', ...rest];

    it('detects `daemon park <slug>`', () => {
      expect(detectDaemonParkCommand(argv('daemon', 'park', 'my-slug'))).toEqual({
        kind: 'park',
        slug: 'my-slug',
      });
    });

    it('detects `daemon unpark <slug>`', () => {
      expect(detectDaemonParkCommand(argv('daemon', 'unpark', 'my-slug'))).toEqual({
        kind: 'unpark',
        slug: 'my-slug',
      });
    });

    it('does not match a typo\'d sub-verb', () => {
      expect(detectDaemonParkCommand(argv('daemon', 'parkk', 'my-slug'))).toBeNull();
    });

    it('does not match unrelated daemon sub-verbs', () => {
      expect(detectDaemonParkCommand(argv('daemon', 'observe'))).toBeNull();
      expect(detectDaemonParkCommand(argv('daemon', 'status'))).toBeNull();
    });

    it('returns null when the slug is missing', () => {
      expect(detectDaemonParkCommand(argv('daemon', 'park'))).toBeNull();
    });
  });

  describe('dispatchDaemonPark', () => {
    it('park writes the marker and prints a confirmation naming the slug', async () => {
      await makeWorktree(root, 'feat-widgets');
      const out: string[] = [];
      const code = await dispatchDaemonPark(
        { kind: 'park', slug: 'feat-widgets' },
        { cwd: root, out: (l) => out.push(l) },
      );
      expect(code).toBe(0);
      expect(await isOperatorParked(root, 'feat-widgets')).toBe(true);
      const joined = out.join('\n');
      expect(joined).toContain('feat-widgets');
      expect(joined.toLowerCase()).toContain(
        'will not be dispatched or re-kicked until unparked',
      );
    });

    it('park is idempotent — re-parking an already-parked slug does not throw', async () => {
      await makeWorktree(root, 'feat-widgets');
      const out: string[] = [];
      await dispatchDaemonPark({ kind: 'park', slug: 'feat-widgets' }, { cwd: root, out: () => {} });
      const code = await dispatchDaemonPark(
        { kind: 'park', slug: 'feat-widgets' },
        { cwd: root, out: (l) => out.push(l) },
      );
      expect(code).toBe(0);
      expect(await isOperatorParked(root, 'feat-widgets')).toBe(true);
    });

    it('re-park reports the existing park and preserves the original marker (mtime unchanged)', async () => {
      await makeWorktree(root, 'feat-widgets');
      await dispatchDaemonPark({ kind: 'park', slug: 'feat-widgets' }, { cwd: root, out: () => {} });
      const { stat } = await import('node:fs/promises');
      const markerPath = join(root, '.daemon', 'parked', 'feat-widgets');
      const before = await stat(markerPath);

      const out: string[] = [];
      const code = await dispatchDaemonPark(
        { kind: 'park', slug: 'feat-widgets' },
        { cwd: root, out: (l) => out.push(l) },
      );
      const after = await stat(markerPath);

      expect(code).toBe(0);
      expect(after.mtimeMs).toBe(before.mtimeMs);
      const joined = out.join('\n').toLowerCase();
      expect(joined).toContain('already parked');
    });

    it('unpark removes the marker and prints a confirmation', async () => {
      await makeWorktree(root, 'feat-widgets');
      await dispatchDaemonPark({ kind: 'park', slug: 'feat-widgets' }, { cwd: root, out: () => {} });
      const out: string[] = [];
      const code = await dispatchDaemonPark(
        { kind: 'unpark', slug: 'feat-widgets' },
        { cwd: root, out: (l) => out.push(l) },
      );
      expect(code).toBe(0);
      expect(await isOperatorParked(root, 'feat-widgets')).toBe(false);
      expect(out.join('\n')).toContain('feat-widgets');
    });

    it('unpark on a slug that was never parked is a graceful no-op', async () => {
      const out: string[] = [];
      const code = await dispatchDaemonPark(
        { kind: 'unpark', slug: 'never-parked' },
        { cwd: root, out: (l) => out.push(l) },
      );
      expect(code).toBe(0);
      expect(await isOperatorParked(root, 'never-parked')).toBe(false);
      expect(out.join('\n')).toContain('was not operator-parked');
    });

    it('unpark on an entirely unknown slug (no plan, no worktree) is still a graceful no-op', async () => {
      const out: string[] = [];
      const code = await dispatchDaemonPark(
        { kind: 'unpark', slug: 'totally-unknown-slug' },
        { cwd: root, out: (l) => out.push(l) },
      );
      expect(code).toBe(0);
      expect(out.join('\n')).toContain('was not operator-parked');
      expect(await isOperatorParked(root, 'totally-unknown-slug')).toBe(false);
    });

    it('reports an error gracefully instead of throwing (e.g. unreadable/missing repo root)', async () => {
      const missingRoot = join(root, 'does-not-exist', 'nested', 'deeper');
      const out: string[] = [];
      // Even a nonexistent nested root should not throw — writeOperatorPark
      // creates the directory chain, so this should actually succeed; to
      // exercise the error path we simulate a failure by pointing at a path
      // that collides with a file (not a directory), which mkdir must reject.
      const { writeFile } = await import('node:fs/promises');
      const collidingFile = join(root, 'blocker');
      await writeFile(collidingFile, 'x');
      const code = await dispatchDaemonPark(
        { kind: 'park', slug: 'my-slug' },
        { cwd: collidingFile, out: (l) => out.push(l) },
      );
      expect(code).toBe(1);
      expect(out.join('\n').length).toBeGreaterThan(0);
    });

    it('rejects an unknown slug (no plan, no worktree) — exit 1, no marker written', async () => {
      const out: string[] = [];
      const code = await dispatchDaemonPark(
        { kind: 'park', slug: 'totally-unknown-slug' },
        { cwd: root, out: (l) => out.push(l) },
      );
      expect(code).toBe(1);
      expect(out.join('\n')).toContain(
        `not found under ${root} (no .docs/plans/totally-unknown-slug.md or .worktrees/totally-unknown-slug)`,
      );
      expect(await isOperatorParked(root, 'totally-unknown-slug')).toBe(false);
    });

    it('not-found message names the searched root, distinguishing it from a wrong-cwd error', async () => {
      const out: string[] = [];
      const code = await dispatchDaemonPark(
        { kind: 'park', slug: 'unknown' },
        { cwd: root, out: (l) => out.push(l) },
      );
      expect(code).toBe(1);
      const joined = out.join('\n');
      expect(joined).toBe(
        `error: slug 'unknown' not found under ${root} (no .docs/plans/unknown.md or .worktrees/unknown)`,
      );
    });

    it('parks successfully when known by plan file only (no worktree)', async () => {
      await mkdir(join(root, '.docs', 'plans'), { recursive: true });
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(root, '.docs', 'plans', 'plan-only-slug.md'), '# plan\n');
      const out: string[] = [];
      const code = await dispatchDaemonPark(
        { kind: 'park', slug: 'plan-only-slug' },
        { cwd: root, out: (l) => out.push(l) },
      );
      expect(code).toBe(0);
      expect(await isOperatorParked(root, 'plan-only-slug')).toBe(true);
    });

    it('parks successfully when known by worktree dir only (no plan)', async () => {
      await makeWorktree(root, 'worktree-only-slug');
      const out: string[] = [];
      const code = await dispatchDaemonPark(
        { kind: 'park', slug: 'worktree-only-slug' },
        { cwd: root, out: (l) => out.push(l) },
      );
      expect(code).toBe(0);
      expect(await isOperatorParked(root, 'worktree-only-slug')).toBe(true);
    });

    it('parks successfully on a fresh checkout with no .daemon/ dir yet', async () => {
      await makeWorktree(root, 'fresh-checkout-slug');
      // no .daemon/ directory has been created in this repo root
      const out: string[] = [];
      const code = await dispatchDaemonPark(
        { kind: 'park', slug: 'fresh-checkout-slug' },
        { cwd: root, out: (l) => out.push(l) },
      );
      expect(code).toBe(0);
      expect(await isOperatorParked(root, 'fresh-checkout-slug')).toBe(true);
    });

    it('unpark resets the no-evidence counter in the worktree (Task 11)', async () => {
      // Initialize real git repo with worktree
      const worktreeDir = await initGitRepoWithWorktree(root, 'counter-reset-slug');

      // Simulate an auto-parked feature: seed the counter in the worktree,
      // then write an auto-park marker at the main root (resolved root).
      const { incrementNoEvidenceAttempts, readNoEvidenceAttempts } = await import(
        '../../src/engine/task-evidence.js'
      );
      const { writeAutoPark, getProvenanceType } = await import('../../src/engine/park-marker.js');

      // Increment counter 3 times in the WORKTREE (where build agent runs)
      await incrementNoEvidenceAttempts(worktreeDir);
      await incrementNoEvidenceAttempts(worktreeDir);
      await incrementNoEvidenceAttempts(worktreeDir);

      // Write an auto-park marker at the main root (daemon's perspective)
      await writeAutoPark(root, 'counter-reset-slug', 'no evidence after 3 attempts');

      // Verify the counter is at 3 in the worktree before unpark
      expect(await readNoEvidenceAttempts(worktreeDir)).toBe(3);

      // Verify the marker is auto-parked
      expect(await getProvenanceType(root, 'counter-reset-slug')).toBe('auto');
      expect(await isOperatorParked(root, 'counter-reset-slug')).toBe(true);

      // Unpark from the worktree directory (where the operator runs conduct)
      const out: string[] = [];
      const code = await dispatchDaemonPark(
        { kind: 'unpark', slug: 'counter-reset-slug' },
        { cwd: worktreeDir, out: (l) => out.push(l) },
      );

      // Verify exit success
      expect(code).toBe(0);

      // Verify counter reset message printed
      const joined = out.join('\n');
      expect(joined.toLowerCase()).toContain('reset');

      // Verify marker removed from main root
      expect(await isOperatorParked(root, 'counter-reset-slug')).toBe(false);

      // Verify counter reset to 0 in the WORKTREE
      expect(await readNoEvidenceAttempts(worktreeDir)).toBe(0);
    });

    it('unpark only resets counter for auto-parked features (not operator-parked)', async () => {
      // Initialize real git repo with worktree
      const worktreeDir = await initGitRepoWithWorktree(root, 'operator-park-slug');

      // Park via operator verb (not auto-park)
      const out1: string[] = [];
      const code1 = await dispatchDaemonPark(
        { kind: 'park', slug: 'operator-park-slug' },
        { cwd: worktreeDir, out: (l) => out1.push(l) },
      );
      expect(code1).toBe(0);

      // Seed a counter in the worktree (simulating failed attempts)
      const { incrementNoEvidenceAttempts, readNoEvidenceAttempts } = await import(
        '../../src/engine/task-evidence.js'
      );
      await incrementNoEvidenceAttempts(worktreeDir);
      await incrementNoEvidenceAttempts(worktreeDir);
      expect(await readNoEvidenceAttempts(worktreeDir)).toBe(2);

      // Unpark the operator-parked feature
      const out2: string[] = [];
      const code2 = await dispatchDaemonPark(
        { kind: 'unpark', slug: 'operator-park-slug' },
        { cwd: worktreeDir, out: (l) => out2.push(l) },
      );
      expect(code2).toBe(0);

      // Verify marker removed
      expect(await isOperatorParked(root, 'operator-park-slug')).toBe(false);

      // Counter should NOT be reset for operator-parked features
      // (no message about counter reset, counter remains at 2)
      const joined = out2.join('\n');
      expect(joined.toLowerCase()).not.toContain('reset');
      expect(await readNoEvidenceAttempts(worktreeDir)).toBe(2);
    });

    it('park from a non-git cwd falls back to cwd-anchored behavior (pre-#486 semantics): exit 0, marker at cwd', async () => {
      // A non-git directory that is NOT part of any git repository
      const nonGitRoot = await mkdtemp(join(tmpdir(), 'non-git-park-'));
      try {
        // Create a worktree-like directory structure in the non-git root
        await mkdir(join(nonGitRoot, '.worktrees', 'non-git-slug'), { recursive: true });

        const out: string[] = [];
        const code = await dispatchDaemonPark(
          { kind: 'park', slug: 'non-git-slug' },
          { cwd: nonGitRoot, out: (l) => out.push(l) },
        );
        expect(code).toBe(0);
        // Marker should be written to the non-git root (cwd), not resolved to a git root
        expect(await isOperatorParked(nonGitRoot, 'non-git-slug')).toBe(true);
        const markerPath = join(nonGitRoot, '.daemon', 'parked', 'non-git-slug');
        expect(out.join('\n')).toContain(markerPath);
      } finally {
        await rm(nonGitRoot, { recursive: true, force: true });
      }
    });

    it('unpark with missing worktree falls back to reset counter at resolved root (Task 12)', async () => {
      // Initialize real git repo with worktree
      const worktreeDir = await initGitRepoWithWorktree(root, 'missing-worktree-slug');

      // Simulate an auto-parked feature: seed the counter in the worktree
      const { incrementNoEvidenceAttempts, readNoEvidenceAttempts } = await import(
        '../../src/engine/task-evidence.js'
      );
      const { writeAutoPark } = await import('../../src/engine/park-marker.js');

      // Increment counter 2 times in the WORKTREE
      await incrementNoEvidenceAttempts(worktreeDir);
      await incrementNoEvidenceAttempts(worktreeDir);

      // Write an auto-park marker at the main root
      await writeAutoPark(root, 'missing-worktree-slug', 'no evidence after 2 attempts');

      // Verify counter is at 2 in worktree before deletion
      expect(await readNoEvidenceAttempts(worktreeDir)).toBe(2);

      // Also seed counter at main root (so fallback can reset it)
      await incrementNoEvidenceAttempts(root);
      expect(await readNoEvidenceAttempts(root)).toBe(1);

      // Delete the worktree directory (simulate missing worktree)
      await rm(worktreeDir, { recursive: true, force: true });

      // Unpark from the main root
      const out: string[] = [];
      const code = await dispatchDaemonPark(
        { kind: 'unpark', slug: 'missing-worktree-slug' },
        { cwd: root, out: (l) => out.push(l) },
      );

      // Verify exit success
      expect(code).toBe(0);

      // Verify fallback message is printed
      const joined = out.join('\n').toLowerCase();
      expect(joined).toContain('fallback');

      // Verify marker removed
      expect(await isOperatorParked(root, 'missing-worktree-slug')).toBe(false);

      // Verify counter was reset at resolved root (fallback location)
      // Since worktree is deleted, counter should be reset at main root
      expect(await readNoEvidenceAttempts(root)).toBe(0);
    });

    it('unpark on operator-parked slug does not touch counter (Task 12)', async () => {
      // Initialize real git repo with worktree
      const worktreeDir = await initGitRepoWithWorktree(root, 'operator-park-manual-slug');

      // Manually write an operator-park marker (not auto-park)
      const { writeOperatorPark } = await import('../../src/engine/park-marker.js');
      await writeOperatorPark(root, 'operator-park-manual-slug');

      // Seed a counter in the worktree (simulating failed attempts)
      const { incrementNoEvidenceAttempts, readNoEvidenceAttempts } = await import(
        '../../src/engine/task-evidence.js'
      );
      await incrementNoEvidenceAttempts(worktreeDir);
      await incrementNoEvidenceAttempts(worktreeDir);
      await incrementNoEvidenceAttempts(worktreeDir);
      expect(await readNoEvidenceAttempts(worktreeDir)).toBe(3);

      // Unpark the operator-parked feature
      const out: string[] = [];
      const code = await dispatchDaemonPark(
        { kind: 'unpark', slug: 'operator-park-manual-slug' },
        { cwd: root, out: (l) => out.push(l) },
      );

      // Verify exit success
      expect(code).toBe(0);

      // Verify marker removed
      expect(await isOperatorParked(root, 'operator-park-manual-slug')).toBe(false);

      // Verify counter was NOT reset (should remain at 3)
      // The output should NOT mention "reset" (for auto-park counter resets)
      const joined = out.join('\n');
      expect(joined.toLowerCase()).not.toContain('reset');
      expect(await readNoEvidenceAttempts(worktreeDir)).toBe(3);
    });

    it('unpark fails when counter reset fails, marker survives for recovery (Task 12)', async () => {
      // Initialize real git repo with worktree
      const worktreeDir = await initGitRepoWithWorktree(root, 'reset-failure-slug');

      // Simulate an auto-parked feature
      const { incrementNoEvidenceAttempts } = await import(
        '../../src/engine/task-evidence.js'
      );
      const { writeAutoPark } = await import('../../src/engine/park-marker.js');

      // Seed counter in worktree
      await incrementNoEvidenceAttempts(worktreeDir);

      // Write an auto-park marker at the main root
      await writeAutoPark(root, 'reset-failure-slug', 'no evidence');

      // Make the .pipeline/ directory unwritable (simulate permission denial)
      const pipelineDir = join(worktreeDir, '.pipeline');
      await mkdir(pipelineDir, { recursive: true });
      await execFile('chmod', ['000', pipelineDir]);

      try {
        // Attempt to unpark (reset will fail due to permission denial)
        const out: string[] = [];
        const code = await dispatchDaemonPark(
          { kind: 'unpark', slug: 'reset-failure-slug' },
          { cwd: root, out: (l) => out.push(l) },
        );

        // Verify exit failure
        expect(code).toBe(1);

        // Verify marker still exists (was NOT removed)
        expect(await isOperatorParked(root, 'reset-failure-slug')).toBe(true);

        // Verify error message mentions the failure
        const joined = out.join('\n');
        expect(joined.toLowerCase()).toContain('could not unpark');
      } finally {
        // Restore permissions so cleanup doesn't fail
        await execFile('chmod', ['755', pipelineDir]);
      }
    });
  });

  describe('validateSlug', () => {
    it('returns false when neither plan nor worktree exists', () => {
      expect(validateSlug('nope', root)).toBe(false);
    });

    it('returns true when only the plan file exists', async () => {
      await mkdir(join(root, '.docs', 'plans'), { recursive: true });
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(root, '.docs', 'plans', 'p.md'), '# p\n');
      expect(validateSlug('p', root)).toBe(true);
    });

    it('returns true when only the worktree dir exists', async () => {
      await makeWorktree(root, 'w');
      expect(validateSlug('w', root)).toBe(true);
    });
  });
});
