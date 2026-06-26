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
