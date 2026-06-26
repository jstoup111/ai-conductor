// Test: runAuthoring — negative-path guards (migrated from authorSpec Task 22, FR-6)
//
// All guards are now enforced by runAuthoring (authorSpec has been deleted).
//
// Covers three guard scenarios:
//   1. DIRTY-TREE GUARD: runAuthoring must fail fast with a clear error when the
//      target repo has uncommitted changes. It must NOT stash, clobber, or
//      silently proceed. The uncommitted changes must still be present afterward
//      (no data loss). Error message must contain 'dirty' or 'uncommitted'.
//
//   2. EXISTING-BRANCH GUARD: when spec/<slug> already exists, runAuthoring must
//      NOT force-overwrite it. It must use a suffix (spec/<slug>-2, etc.) and
//      leave the original branch's tip commit unchanged.
//
//   3. FAILED DECIDE substep — no PR, no impl output.
//      When a DECIDE step returns { approved: false }, runAuthoring must:
//        (a) Propagate an error (reject).
//        (b) Leave NO impl/source files committed on any branch.
//        (c) Leave NO misleading commit — spec/<slug> branch must not exist.
//        (d) Not open any PR — runAuthoring aborts before any artifact commit.
//
// Both use REAL temporary git repos (same pattern as authoring.test.ts).
// Clean up temp dirs in afterEach.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { runAuthoring } from '../../../src/engine/engineer/authoring.js';

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Helper: run a git command in the given directory
// ---------------------------------------------------------------------------
async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// Helper: create a REAL temp git repo with one initial commit
// ---------------------------------------------------------------------------
async function makeGitRepo(): Promise<{ repoPath: string; defaultBranch: string }> {
  const repoPath = await mkdtemp(join(tmpdir(), 'authoring-guards-test-'));
  await execFile('git', ['init', '-q'], { cwd: repoPath });
  await execFile('git', ['config', 'user.email', 'test@test.com'], { cwd: repoPath });
  await execFile('git', ['config', 'user.name', 'Test'], { cwd: repoPath });
  await writeFile(join(repoPath, 'README.md'), 'init\n');
  await execFile('git', ['add', 'README.md'], { cwd: repoPath });
  await execFile('git', ['commit', '-m', 'init'], { cwd: repoPath });
  const defaultBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath);
  return { repoPath, defaultBranch };
}

// ---------------------------------------------------------------------------
// Helpers: makeTarget, approvedDecide
// ---------------------------------------------------------------------------
function makeTarget(repoPath: string) {
  return { name: 'test-project', canonicalPath: repoPath };
}

/** An approving DECIDE seam that returns real artifacts. */
function approvedDecide() {
  return async (step: string) => {
    if (step === 'brainstorm') return { approved: true, artifact: '# PRD: idea\n\nApproved.\n' };
    if (step === 'stories')
      return {
        approved: true,
        artifact: '# Stories: idea\n\n**Status:** Accepted\n\n## Story: x\n\n### AC\n- Given x, when y, then z.\n',
      };
    if (step === 'plan')
      return {
        approved: true,
        artifact: '# Plan: idea\n\n## Tasks\n\n### Task 1\n**Dependencies:** none\n\n## Task Dependency Graph\n```\n1\n```\n',
      };
    return { approved: true, artifact: '' };
  };
}

// ---------------------------------------------------------------------------
// Guard 1: Dirty-tree guard
// ---------------------------------------------------------------------------
describe('runAuthoring — dirty-tree guard (migrated Task 22, FR-6)', () => {
  let repoPath: string;

  beforeEach(async () => {
    ({ repoPath } = await makeGitRepo());
  });

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true });
  });

  it('throws with a clear error when the working tree has uncommitted changes', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add analytics dashboard';

    // Introduce an uncommitted change — modify a tracked file
    await writeFile(join(repoPath, 'README.md'), 'dirty uncommitted content\n');

    await expect(runAuthoring(target, idea, { decide: approvedDecide() })).rejects.toThrow(
      /dirty|uncommitted/i,
    );
  });

  it('error message names at least one of the dirty files', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add analytics dashboard';

    // Introduce a dirty file
    await writeFile(join(repoPath, 'README.md'), 'dirty content\n');

    let errorMessage = '';
    try {
      await runAuthoring(target, idea, { decide: approvedDecide() });
    } catch (e) {
      errorMessage = (e as Error).message;
    }

    // Error must name the dirty file so the user knows what to clean up
    expect(errorMessage).toMatch(/README\.md/);
  });

  it('leaves uncommitted changes intact after the failure (no data loss)', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add analytics dashboard';

    const dirtyContent = 'important uncommitted work\n';
    await writeFile(join(repoPath, 'README.md'), dirtyContent);

    // runAuthoring should throw
    await expect(runAuthoring(target, idea, { decide: approvedDecide() })).rejects.toThrow();

    // The dirty file must still be present and unchanged (no stash, no clobber)
    const { stdout } = await execFile('cat', [join(repoPath, 'README.md')]);
    expect(stdout).toBe(dirtyContent);

    // git status --porcelain must still report the file as modified
    const porcelain = await git(['status', '--porcelain'], repoPath);
    expect(porcelain).toMatch(/README\.md/);
  });

  it('does NOT create an orphan spec branch when the dirty-tree check fires', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add analytics dashboard';
    const expectedSlug = 'add-analytics-dashboard';

    await writeFile(join(repoPath, 'README.md'), 'dirty content\n');

    // Should reject
    await expect(runAuthoring(target, idea, { decide: approvedDecide() })).rejects.toThrow();

    // No spec/<slug> branch should exist — the guard fired before branch creation
    const branchList = await git(['branch', '--list', `spec/${expectedSlug}`], repoPath);
    expect(branchList).toBe('');
  });

  it('succeeds when the working tree is clean (control: guard does not fire on clean repos)', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add analytics dashboard';

    // No dirty files — should succeed
    const result = await runAuthoring(target, idea, { decide: approvedDecide() });
    expect(result.branch).toMatch(/^spec\//);
    expect(result.project).toBe('test-project');
  });

  it('throws on untracked files as well (untracked = dirty for authoring safety)', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add analytics dashboard';

    // Add an untracked file (not yet staged)
    await writeFile(join(repoPath, 'untracked-file.txt'), 'untracked content\n');

    await expect(runAuthoring(target, idea, { decide: approvedDecide() })).rejects.toThrow(
      /dirty|uncommitted/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Guard 2: Existing-branch guard (suffix disambiguation)
// ---------------------------------------------------------------------------
describe('runAuthoring — existing-branch guard (migrated Task 22, FR-6)', () => {
  let repoPath: string;

  beforeEach(async () => {
    ({ repoPath } = await makeGitRepo());
  });

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true });
  });

  it('uses a suffix branch name when spec/<slug> already exists', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add search feature';

    // First authoring run — creates spec/add-search-feature
    const result1 = await runAuthoring(target, idea, { decide: approvedDecide() });
    expect(result1.branch).toBe('spec/add-search-feature');

    // runAuthoring leaves stories as untracked working-tree files — clean them
    // before the next run so the dirty-tree guard doesn't reject us.
    await execFile('git', ['clean', '-fd', '.docs'], { cwd: repoPath });

    // Second authoring run — spec/add-search-feature exists; must use a suffix
    const result2 = await runAuthoring(target, idea, { decide: approvedDecide() });
    expect(result2.branch).toBe('spec/add-search-feature-2');
  });

  it("does NOT force-overwrite the original branch's tip commit", async () => {
    const target = makeTarget(repoPath);
    const idea = 'add search feature';

    // First run — record the resulting branch tip
    const result1 = await runAuthoring(target, idea, { decide: approvedDecide() });
    const originalTip = await git(['rev-parse', result1.branch], repoPath);

    // Clean untracked stories before second run
    await execFile('git', ['clean', '-fd', '.docs'], { cwd: repoPath });

    // Second run with same idea — must NOT touch the first branch
    const result2 = await runAuthoring(target, idea, { decide: approvedDecide() });

    // The original branch's tip must be unchanged
    const tipAfter = await git(['rev-parse', result1.branch], repoPath);
    expect(tipAfter).toBe(originalTip);

    // The second result is a different branch
    expect(result2.branch).not.toBe(result1.branch);
  });

  it('creates a third suffix when both spec/<slug> and spec/<slug>-2 exist', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add search feature';

    const result1 = await runAuthoring(target, idea, { decide: approvedDecide() });
    await execFile('git', ['clean', '-fd', '.docs'], { cwd: repoPath });
    const result2 = await runAuthoring(target, idea, { decide: approvedDecide() });
    await execFile('git', ['clean', '-fd', '.docs'], { cwd: repoPath });
    const result3 = await runAuthoring(target, idea, { decide: approvedDecide() });

    expect(result1.branch).toBe('spec/add-search-feature');
    expect(result2.branch).toBe('spec/add-search-feature-2');
    expect(result3.branch).toBe('spec/add-search-feature-3');

    // All three must exist
    for (const result of [result1, result2, result3]) {
      const listed = await git(['branch', '--list', result.branch], repoPath);
      expect(listed).toBe(result.branch);
    }
  });

  it('all original branch tips remain intact after multiple collision runs', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add search feature';

    const result1 = await runAuthoring(target, idea, { decide: approvedDecide() });
    const tip1 = await git(['rev-parse', result1.branch], repoPath);

    await execFile('git', ['clean', '-fd', '.docs'], { cwd: repoPath });

    const result2 = await runAuthoring(target, idea, { decide: approvedDecide() });
    const tip2 = await git(['rev-parse', result2.branch], repoPath);

    await execFile('git', ['clean', '-fd', '.docs'], { cwd: repoPath });

    await runAuthoring(target, idea, { decide: approvedDecide() });

    // tip1 and tip2 must not have changed
    const tip1After = await git(['rev-parse', result1.branch], repoPath);
    const tip2After = await git(['rev-parse', result2.branch], repoPath);
    expect(tip1After).toBe(tip1);
    expect(tip2After).toBe(tip2);
  });
});

// ---------------------------------------------------------------------------
// Guard 3: Failed DECIDE gate — no PR, no impl output (migrated Task 23, FR-6)
//
// When a DECIDE gate rejects, runAuthoring must:
//   (a) Propagate the error.
//   (b) Leave NO impl/source files committed anywhere.
//   (c) Leave NO misleading commit — spec/<slug> branch must NOT exist.
//   (d) Open NO PR (runAuthoring never opens PRs; aborting before artifact commit
//       means nothing to hand off).
// ---------------------------------------------------------------------------
describe('runAuthoring — failed DECIDE gate: no PR + spec-only output (migrated Task 23, FR-6)', () => {
  let repoPath: string;
  let defaultBranch: string;

  beforeEach(async () => {
    ({ repoPath, defaultBranch } = await makeGitRepo());
  });

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // (a) Error propagation — unapproved gate rejects with an error
  // -------------------------------------------------------------------------
  it('rejects with an error when brainstorm gate is not approved', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add payment gateway';

    const blockingDecide = async (step: string) => {
      if (step === 'brainstorm') return { approved: false, artifact: '' };
      return { approved: true, artifact: '' };
    };

    await expect(runAuthoring(target, idea, { decide: blockingDecide })).rejects.toThrow();
  });

  it('rejects with an error when stories gate is not approved', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add payment gateway';

    const blockingDecide = async (step: string) => {
      if (step === 'brainstorm') return { approved: true, artifact: '# PRD\n' };
      if (step === 'stories') return { approved: false, artifact: '' };
      return { approved: true, artifact: '' };
    };

    await expect(runAuthoring(target, idea, { decide: blockingDecide })).rejects.toThrow();
  });

  it('rejects with an error when plan gate is not approved', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add payment gateway';
    const PLAN = '# Plan\n\n## Task Dependency Graph\n```\n1\n```\n';

    const blockingDecide = async (step: string) => {
      if (step === 'brainstorm') return { approved: true, artifact: '# PRD\n' };
      if (step === 'stories') return { approved: true, artifact: '# Stories\n\n**Status:** Accepted\n' };
      if (step === 'plan') return { approved: false, artifact: '' };
      return { approved: true, artifact: PLAN };
    };

    await expect(runAuthoring(target, idea, { decide: blockingDecide })).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // (b) No impl/source files committed on any branch after gate rejection
  // -------------------------------------------------------------------------
  it('commits no impl/source files on any branch after gate rejection', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add payment gateway';

    // Blocking on stories so brainstorm passed, then gate blocks
    const blockingDecide = async (step: string) => {
      if (step === 'brainstorm') return { approved: true, artifact: '# PRD\n' };
      if (step === 'stories') return { approved: false, artifact: '' };
      return { approved: true, artifact: '' };
    };

    await expect(runAuthoring(target, idea, { decide: blockingDecide })).rejects.toThrow();

    // Inspect all local branches for committed impl files
    const allBranches = await git(['branch', '--format=%(refname:short)'], repoPath);
    const branches = allBranches.split('\n').filter(Boolean);

    for (const branch of branches) {
      const tree = await git(['ls-tree', '-r', '--name-only', branch], repoPath);
      const committedFiles = tree.split('\n').filter(Boolean);

      // No file under src/, lib/, or app/ must appear in any branch's tree
      const implFiles = committedFiles.filter(
        (f) => f.startsWith('src/') || f.startsWith('lib/') || f.startsWith('app/'),
      );
      expect(implFiles).toEqual([]);
    }
  });

  // -------------------------------------------------------------------------
  // (c) No spec branch remains after gate rejection
  // -------------------------------------------------------------------------
  it('no spec branch exists after brainstorm gate rejection (gate fires before branch creation)', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add payment gateway';

    const blockingDecide = async (step: string) => {
      if (step === 'brainstorm') return { approved: false, artifact: '' };
      return { approved: true, artifact: '' };
    };

    await expect(runAuthoring(target, idea, { decide: blockingDecide })).rejects.toThrow();

    // The brainstorm gate fires BEFORE branch creation — so no spec branch was ever created.
    const branchList = await git(['branch', '--list', 'spec/*'], repoPath);
    expect(branchList).toBe('');
  });

  it('leaves no committed spec artifact on default branch after gate rejection', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add payment gateway';

    const blockingDecide = async (step: string) => {
      if (step === 'brainstorm') return { approved: true, artifact: '# PRD\n' };
      if (step === 'stories') return { approved: false, artifact: '' };
      return { approved: true, artifact: '' };
    };

    await expect(runAuthoring(target, idea, { decide: blockingDecide })).rejects.toThrow();

    // The default branch must have ZERO .docs files committed
    const tree = await git(['ls-tree', '-r', '--name-only', defaultBranch], repoPath);
    const committedFiles = tree.split('\n').filter(Boolean);
    const specFiles = committedFiles.filter((f) => f.startsWith('.docs/'));
    expect(specFiles).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // (d) No PR handoff — runAuthoring never returns on failure
  // -------------------------------------------------------------------------
  it('produces no artifact commit that could feed a PR handoff (runAuthoring never returns on rejection)', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add payment gateway';

    const blockingDecide = async (step: string) => {
      if (step === 'brainstorm') return { approved: false, artifact: '' };
      return { approved: true, artifact: '' };
    };

    // runAuthoring must reject — no return value means nothing to pass to a PR opener
    let returnedResult: { branch: string; project: string } | undefined;
    try {
      returnedResult = await runAuthoring(target, idea, { decide: blockingDecide });
    } catch {
      // expected
    }

    expect(returnedResult).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // HEAD state after gate rejection (when branch was created but gate fired after)
  // -------------------------------------------------------------------------
  it('restores HEAD to the default branch after mid-write failure — no dangling HEAD', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add payment gateway';

    // Gate fires at plan step — by then brainstorm and stories passed,
    // but the branch may have been created. Rollback must restore HEAD.
    const blockingDecide = async (step: string) => {
      if (step === 'brainstorm') return { approved: true, artifact: '# PRD\n' };
      if (step === 'stories') return { approved: true, artifact: '# Stories\n\n**Status:** Accepted\n' };
      if (step === 'plan') return { approved: false, artifact: '' };
      return { approved: true, artifact: '' };
    };

    await expect(runAuthoring(target, idea, { decide: blockingDecide })).rejects.toThrow();

    // HEAD must be on defaultBranch — the rollback ran.
    const currentHead = await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath);
    expect(currentHead).toBe(defaultBranch);
  });
});
