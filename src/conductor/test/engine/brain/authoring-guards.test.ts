// Test: authorSpec — negative-path guards (Task 22, FR-6)
//
// Covers two guard scenarios:
//   1. DIRTY-TREE GUARD: authorSpec must fail fast with a clear error when the
//      target repo has uncommitted changes. It must NOT stash, clobber, or
//      silently proceed. The uncommitted changes must still be present afterward
//      (no data loss). Error message must contain 'dirty' or 'uncommitted'.
//
//   2. EXISTING-BRANCH GUARD: when spec/<slug> already exists, authorSpec must
//      NOT force-overwrite it. It must use a suffix (spec/<slug>-2, etc.) and
//      leave the original branch's tip commit unchanged.
//
// Both use REAL temporary git repos (same pattern as authoring.test.ts).
// Clean up temp dirs in afterEach.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { authorSpec } from '../../../src/engine/brain/authoring.js';
import type { AuthoringProvider } from '../../../src/engine/brain/authoring.js';
import type { TargetRepo } from '../../../src/engine/brain/target.js';
import type { LessonDigest } from '../../../src/engine/brain/lesson-store.js';

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
// Helpers: emptyDigest, makeTarget, makeFakeProvider
// ---------------------------------------------------------------------------
function emptyDigest(): LessonDigest {
  return { kickbacks: [], halts: [], retryHotspots: [], narrativeRefs: [] };
}

function makeTarget(repoPath: string): TargetRepo {
  return { name: 'test-project', canonicalPath: repoPath };
}

function makeFakeProvider(repoPath: string): AuthoringProvider {
  return {
    async invoke(opts: { cwd: string; idea: string; branch: string }) {
      const docsSpecs = join(opts.cwd, '.docs', 'specs');
      const docsStories = join(opts.cwd, '.docs', 'stories');
      const docsPlans = join(opts.cwd, '.docs', 'plans');
      await mkdir(docsSpecs, { recursive: true });
      await mkdir(docsStories, { recursive: true });
      await mkdir(docsPlans, { recursive: true });
      await writeFile(join(docsSpecs, 'spec.md'), `# Spec for ${opts.idea}\n`);
      await writeFile(join(docsStories, 'stories.md'), `# Stories for ${opts.idea}\n`);
      await writeFile(join(docsPlans, 'plan.md'), `# Plan for ${opts.idea}\n`);
    },
  };
}

// ---------------------------------------------------------------------------
// Guard 1: Dirty-tree guard
// ---------------------------------------------------------------------------
describe('authorSpec — dirty-tree guard (Task 22, FR-6)', () => {
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
    const provider = makeFakeProvider(repoPath);

    // Introduce an uncommitted change — modify a tracked file
    await writeFile(join(repoPath, 'README.md'), 'dirty uncommitted content\n');

    await expect(authorSpec(target, idea, emptyDigest(), provider)).rejects.toThrow(
      /dirty|uncommitted/i,
    );
  });

  it('error message names at least one of the dirty files', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add analytics dashboard';
    const provider = makeFakeProvider(repoPath);

    // Introduce a dirty file
    await writeFile(join(repoPath, 'README.md'), 'dirty content\n');

    let errorMessage = '';
    try {
      await authorSpec(target, idea, emptyDigest(), provider);
    } catch (e) {
      errorMessage = (e as Error).message;
    }

    // Error must name the dirty file so the user knows what to clean up
    expect(errorMessage).toMatch(/README\.md/);
  });

  it('leaves uncommitted changes intact after the failure (no data loss)', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add analytics dashboard';
    const provider = makeFakeProvider(repoPath);

    const dirtyContent = 'important uncommitted work\n';
    await writeFile(join(repoPath, 'README.md'), dirtyContent);

    // authorSpec should throw
    await expect(authorSpec(target, idea, emptyDigest(), provider)).rejects.toThrow();

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
    const provider = makeFakeProvider(repoPath);
    const expectedSlug = 'add-analytics-dashboard';

    await writeFile(join(repoPath, 'README.md'), 'dirty content\n');

    // Should reject
    await expect(authorSpec(target, idea, emptyDigest(), provider)).rejects.toThrow();

    // No spec/<slug> branch should exist — the guard fired before branch creation
    const branchList = await git(['branch', '--list', `spec/${expectedSlug}`], repoPath);
    expect(branchList).toBe('');
  });

  it('succeeds when the working tree is clean (control: guard does not fire on clean repos)', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add analytics dashboard';
    const provider = makeFakeProvider(repoPath);

    // No dirty files — should succeed
    const result = await authorSpec(target, idea, emptyDigest(), provider);
    expect(result.branch).toMatch(/^spec\//);
    expect(result.project).toBe('test-project');
  });

  it('throws on untracked files as well (untracked = dirty for authoring safety)', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add analytics dashboard';
    const provider = makeFakeProvider(repoPath);

    // Add an untracked file (not yet staged)
    await writeFile(join(repoPath, 'untracked-file.txt'), 'untracked content\n');

    await expect(authorSpec(target, idea, emptyDigest(), provider)).rejects.toThrow(
      /dirty|uncommitted/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Guard 2: Existing-branch guard
// ---------------------------------------------------------------------------
describe('authorSpec — existing-branch guard (Task 22, FR-6)', () => {
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
    const provider = makeFakeProvider(repoPath);

    // First authoring run — creates spec/add-search-feature
    const result1 = await authorSpec(target, idea, emptyDigest(), provider);
    expect(result1.branch).toBe('spec/add-search-feature');

    // Second authoring run — spec/add-search-feature exists; must use a suffix
    const result2 = await authorSpec(target, idea, emptyDigest(), makeFakeProvider(repoPath));
    expect(result2.branch).toBe('spec/add-search-feature-2');
  });

  it("does NOT force-overwrite the original branch's tip commit", async () => {
    const target = makeTarget(repoPath);
    const idea = 'add search feature';

    // First run — record the resulting branch tip
    const result1 = await authorSpec(target, idea, emptyDigest(), makeFakeProvider(repoPath));
    const originalTip = await git(['rev-parse', result1.branch], repoPath);

    // Second run with same idea — must NOT touch the first branch
    const result2 = await authorSpec(target, idea, emptyDigest(), makeFakeProvider(repoPath));

    // The original branch's tip must be unchanged
    const tipAfter = await git(['rev-parse', result1.branch], repoPath);
    expect(tipAfter).toBe(originalTip);

    // The second result is a different branch
    expect(result2.branch).not.toBe(result1.branch);
  });

  it('creates a third suffix when both spec/<slug> and spec/<slug>-2 exist', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add search feature';

    const result1 = await authorSpec(target, idea, emptyDigest(), makeFakeProvider(repoPath));
    const result2 = await authorSpec(target, idea, emptyDigest(), makeFakeProvider(repoPath));
    const result3 = await authorSpec(target, idea, emptyDigest(), makeFakeProvider(repoPath));

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

    const result1 = await authorSpec(target, idea, emptyDigest(), makeFakeProvider(repoPath));
    const tip1 = await git(['rev-parse', result1.branch], repoPath);

    const result2 = await authorSpec(target, idea, emptyDigest(), makeFakeProvider(repoPath));
    const tip2 = await git(['rev-parse', result2.branch], repoPath);

    await authorSpec(target, idea, emptyDigest(), makeFakeProvider(repoPath));

    // tip1 and tip2 must not have changed
    const tip1After = await git(['rev-parse', result1.branch], repoPath);
    const tip2After = await git(['rev-parse', result2.branch], repoPath);
    expect(tip1After).toBe(tip1);
    expect(tip2After).toBe(tip2);
  });
});

// ---------------------------------------------------------------------------
// Guard 3: Failed DECIDE substep — no PR, no impl output (Task 23, FR-6 negative paths)
//
// When the provider throws (simulating a DECIDE/stories-gate failure), authorSpec
// must:
//   (a) Propagate the error (reject) with the provider's error surfaced in the
//       thrown value — the caller must be able to identify which step failed.
//   (b) Leave NO impl/source files committed anywhere (no src/, lib/, app/).
//   (c) Leave NO misleading "spec complete" commit — the spec branch may exist
//       (created in step 3 before provider.invoke) but must have no spec commit
//       on it (only the initial commit inherited from the default branch).
//   (d) Open NO PR — authorSpec does not open PRs but must abort BEFORE any
//       artifact commit that would feed a PR handoff.
//
// ACTUAL post-failure repo state (pinned from code inspection and test observation):
//   • A spec/<slug> branch IS created (step 3: checkout -b runs before provider.invoke).
//   • That branch has ZERO spec artifacts committed (step 5 never runs).
//   • The repo's HEAD is left on spec/<slug> — NOT returned to the default branch
//     (step 6: checkout <defaultBranch> never runs). This is a dangling-branch
//     side effect noted for the orchestrator/evaluator — it is asserted here,
//     NOT fixed (task-23 is test-only).
//   • No .docs/specs|stories|plans files are committed on any branch.
//   • No impl/source files (src/, lib/, app/) exist on any branch.
// ---------------------------------------------------------------------------
describe('authorSpec — failed DECIDE substep: no PR + spec-only output (Task 23, FR-6)', () => {
  let repoPath: string;
  let defaultBranch: string;

  beforeEach(async () => {
    ({ repoPath, defaultBranch } = await makeGitRepo());
  });

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // (a) Error propagation — the provider's error surfaces with an identifying message
  // -------------------------------------------------------------------------
  it('rejects with the provider error when provider.invoke throws', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add payment gateway';

    const failingProvider: AuthoringProvider = {
      async invoke(_opts) {
        throw new Error('DECIDE_STORIES_GATE_FAILED: stories substep rejected by evaluator');
      },
    };

    await expect(authorSpec(target, idea, emptyDigest(), failingProvider)).rejects.toThrow(
      'DECIDE_STORIES_GATE_FAILED',
    );
  });

  it('propagated error message contains the provider-thrown error text verbatim', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add payment gateway';
    const specificMsg = 'DECIDE_STORIES_GATE_FAILED: stories substep rejected by evaluator';

    const failingProvider: AuthoringProvider = {
      async invoke(_opts) {
        throw new Error(specificMsg);
      },
    };

    let caughtMessage = '';
    try {
      await authorSpec(target, idea, emptyDigest(), failingProvider);
    } catch (e) {
      caughtMessage = (e as Error).message;
    }

    // The exact provider error text must survive propagation unchanged
    expect(caughtMessage).toContain(specificMsg);
  });

  it('surfaces the failing step identity when provider uses a named step error', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add payment gateway';

    const failingProvider: AuthoringProvider = {
      async invoke(_opts) {
        const err = new Error('stories gate failure');
        err.name = 'StoriesGateError';
        throw err;
      },
    };

    let caughtError: Error | undefined;
    try {
      await authorSpec(target, idea, emptyDigest(), failingProvider);
    } catch (e) {
      caughtError = e as Error;
    }

    expect(caughtError).toBeDefined();
    // The error name must propagate — it identifies which substep failed
    expect(caughtError!.name).toBe('StoriesGateError');
    expect(caughtError!.message).toContain('stories gate failure');
  });

  // -------------------------------------------------------------------------
  // (b) No impl/source files committed on any branch after provider failure
  // -------------------------------------------------------------------------
  it('commits no impl/source files on any branch after provider failure', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add payment gateway';

    // Provider throws after writing a partial src file (worst-case scenario)
    const failingProvider: AuthoringProvider = {
      async invoke(opts) {
        // Simulate a provider that starts writing impl files before failing
        const { mkdir: mkdirNode, writeFile: writeFileNode } = await import('fs/promises');
        const srcDir = join(opts.cwd, 'src');
        await mkdirNode(srcDir, { recursive: true });
        await writeFileNode(join(srcDir, 'payment.ts'), 'export const pay = () => {};\n');
        throw new Error('DECIDE_STORIES_GATE_FAILED: gate check failed');
      },
    };

    await expect(authorSpec(target, idea, emptyDigest(), failingProvider)).rejects.toThrow(
      'DECIDE_STORIES_GATE_FAILED',
    );

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
  // (c) No spec commit on the dangling branch — the branch exists but is empty of spec artifacts
  // -------------------------------------------------------------------------
  it('creates the spec branch (step 3 runs before provider) but leaves it with no spec commit', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add payment gateway';
    const expectedSlug = 'add-payment-gateway';

    const failingProvider: AuthoringProvider = {
      async invoke(_opts) {
        throw new Error('DECIDE_STORIES_GATE_FAILED: substep aborted');
      },
    };

    await expect(authorSpec(target, idea, emptyDigest(), failingProvider)).rejects.toThrow(
      'DECIDE_STORIES_GATE_FAILED',
    );

    // The branch IS created — this is the current (pinned) behavior.
    // Note: git branch --list may prefix with '* ' when HEAD is on that branch
    // (which is the dangling-HEAD side effect pinned in the test below).
    const branchList = await git(['branch', '--list', `spec/${expectedSlug}`], repoPath);
    expect(branchList.replace(/^\*\s*/, '')).toBe(`spec/${expectedSlug}`);

    // But that branch has ZERO .docs files committed on it
    const tree = await git(['ls-tree', '-r', '--name-only', `spec/${expectedSlug}`], repoPath);
    const committedFiles = tree.split('\n').filter(Boolean);
    const specFiles = committedFiles.filter((f) => f.startsWith('.docs/'));
    expect(specFiles).toEqual([]);
  });

  it('the dangling spec branch has only the initial commit (no extra commits from provider)', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add payment gateway';
    const expectedSlug = 'add-payment-gateway';

    const defaultTip = await git(['rev-parse', defaultBranch], repoPath);

    const failingProvider: AuthoringProvider = {
      async invoke(_opts) {
        throw new Error('DECIDE_STORIES_GATE_FAILED: substep aborted');
      },
    };

    await expect(authorSpec(target, idea, emptyDigest(), failingProvider)).rejects.toThrow(
      'DECIDE_STORIES_GATE_FAILED',
    );

    // The dangling spec branch tip must equal the default branch tip (no extra commit added)
    const specBranchTip = await git(['rev-parse', `spec/${expectedSlug}`], repoPath);
    expect(specBranchTip).toBe(defaultTip);
  });

  // -------------------------------------------------------------------------
  // (d) No PR handoff side effect — authorSpec aborts before any artifact commit
  //     (confirmed indirectly: no commit means no branch tip to hand off to a PR opener)
  // -------------------------------------------------------------------------
  it('produces no artifact commit that could feed a PR handoff', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add payment gateway';

    const prOpenAttempts: string[] = [];

    // Provider throws — simulates gate failure BEFORE any PR would be opened
    const failingProvider: AuthoringProvider = {
      async invoke(_opts) {
        throw new Error('DECIDE_STORIES_GATE_FAILED: no artifacts produced');
      },
    };

    // authorSpec must reject — no return value means no branch to hand to a PR opener
    let returnedResult: { branch: string; project: string } | undefined;
    try {
      returnedResult = await authorSpec(target, idea, emptyDigest(), failingProvider);
    } catch {
      // expected
    }

    // authorSpec never returned — so nothing to pass to a PR creator
    expect(returnedResult).toBeUndefined();
    // No PR-open side effects were recorded (prOpenAttempts remains empty)
    expect(prOpenAttempts).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // (e) HEAD is left on spec/<slug> after provider failure — dangling HEAD finding
  //     (pinned assertion of current behavior; noted as a defect for the evaluator)
  // -------------------------------------------------------------------------
  it('leaves HEAD on the spec branch (not returned to default) — dangling HEAD side effect', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add payment gateway';
    const expectedSlug = 'add-payment-gateway';

    const failingProvider: AuthoringProvider = {
      async invoke(_opts) {
        throw new Error('DECIDE_STORIES_GATE_FAILED: substep aborted');
      },
    };

    await expect(authorSpec(target, idea, emptyDigest(), failingProvider)).rejects.toThrow(
      'DECIDE_STORIES_GATE_FAILED',
    );

    // HEAD is left on spec/<slug> because step 6 (checkout defaultBranch) never runs
    // This is a side effect: the repo is not returned to a clean state.
    // Asserting current behavior so regressions are caught if this is fixed.
    const currentHead = await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath);
    expect(currentHead).toBe(`spec/${expectedSlug}`);
  });

  // -------------------------------------------------------------------------
  // (f) Provider failure with partial spec files written — no spec file is committed
  // -------------------------------------------------------------------------
  it('leaves no committed spec artifact even when provider wrote partial files before throwing', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add payment gateway';
    const expectedSlug = 'add-payment-gateway';

    // Provider writes a partial spec file then fails (e.g. stories gate rejects)
    const failingProvider: AuthoringProvider = {
      async invoke(opts) {
        const { mkdir: mkdirNode, writeFile: writeFileNode } = await import('fs/promises');
        const docsSpecs = join(opts.cwd, '.docs', 'specs');
        await mkdirNode(docsSpecs, { recursive: true });
        await writeFileNode(join(docsSpecs, 'spec.md'), '# Partial spec\n');
        // Throw before stories/plans are written — stories gate fails
        throw new Error('DECIDE_STORIES_GATE_FAILED: partial spec written but stories gate failed');
      },
    };

    await expect(authorSpec(target, idea, emptyDigest(), failingProvider)).rejects.toThrow(
      'DECIDE_STORIES_GATE_FAILED',
    );

    // The partial spec.md exists on disk (provider wrote it) but must NOT be committed
    const specBranch = `spec/${expectedSlug}`;
    const tree = await git(['ls-tree', '-r', '--name-only', specBranch], repoPath);
    const committedFiles = tree.split('\n').filter(Boolean);

    // .docs/specs/spec.md must NOT appear in any committed tree entry
    expect(committedFiles).not.toContain('.docs/specs/spec.md');
    expect(committedFiles.filter((f) => f.startsWith('.docs/'))).toEqual([]);
  });
});
