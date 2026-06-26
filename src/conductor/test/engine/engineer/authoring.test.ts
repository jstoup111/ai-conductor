// Test: authorSpec — subprocess DECIDE authoring runner (Task 20, FR-6 happy path)
//
// authorSpec(target, idea, digest, provider) runs the DECIDE authoring as a
// subprocess with the TARGET repo as cwd (via an injectable AuthoringProvider),
// creates a spec/<slug> branch off the repo's DEFAULT branch (never 'main'
// hardcoded — derived via `git rev-parse --abbrev-ref HEAD` for local repos
// with no remote), writes .docs/specs|stories|plans artifacts, commits them on
// that branch, and returns { branch, project } to the caller.
//
// Fixture: a REAL temporary git repo (os.tmpdir(), git init, initial commit) so
// the default branch is whatever `git init` produced — we READ it, never
// hardcode 'main'.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { authorSpec } from '../../../src/engine/engineer/authoring.js';
import type { AuthoringProvider, AuthoringResult } from '../../../src/engine/engineer/authoring.js';
import type { TargetRepo } from '../../../src/engine/engineer/target.js';
import type { LessonDigest } from '../../../src/engine/engineer/lesson-store.js';

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Helper: run a git command in the given directory
// ---------------------------------------------------------------------------
async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// Helper: create a REAL temp git repo with one initial commit so HEAD/branch exists
// ---------------------------------------------------------------------------
async function makeGitRepo(): Promise<{ repoPath: string; defaultBranch: string }> {
  const repoPath = await mkdtemp(join(tmpdir(), 'authoring-test-'));
  await execFile('git', ['init', '-q'], { cwd: repoPath });
  // Set a user so commits work in CI
  await execFile('git', ['config', 'user.email', 'test@test.com'], { cwd: repoPath });
  await execFile('git', ['config', 'user.name', 'Test'], { cwd: repoPath });
  // Initial commit so the repo has a default branch and HEAD
  await writeFile(join(repoPath, 'README.md'), 'init\n');
  await execFile('git', ['add', 'README.md'], { cwd: repoPath });
  await execFile('git', ['commit', '-m', 'init'], { cwd: repoPath });
  // Read the actual default branch — never hardcode 'main'
  const defaultBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath);
  return { repoPath, defaultBranch };
}

// ---------------------------------------------------------------------------
// Helpers: emptyDigest, makeTarget
// ---------------------------------------------------------------------------
function emptyDigest(): LessonDigest {
  return { kickbacks: [], halts: [], retryHotspots: [], narrativeRefs: [] };
}

function makeTarget(repoPath: string): TargetRepo {
  return { name: 'test-project', canonicalPath: repoPath };
}

// ---------------------------------------------------------------------------
// Fake AuthoringProvider: writes spec/stories/plans files, returns branch info
// ---------------------------------------------------------------------------
function makeFakeProvider(repoPath: string): AuthoringProvider {
  return {
    async invoke(opts: { cwd: string; idea: string; branch: string }) {
      // The provider receives the cwd (target.canonicalPath) and the branch
      // that was created for it. It simulates DECIDE writing artifacts.
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
// Tests
// ---------------------------------------------------------------------------

describe('authorSpec — happy path (Task 20, FR-6)', () => {
  let repoPath: string;
  let defaultBranch: string;

  beforeEach(async () => {
    ({ repoPath, defaultBranch } = await makeGitRepo());
  });

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true });
  });

  // (a) spec/<slug> branch exists off the default branch
  it('creates a spec/<slug> branch that exists in the target repo', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add real-time notifications';
    const provider = makeFakeProvider(repoPath);

    const result = await authorSpec(target, idea, emptyDigest(), provider);

    // Branch must start with spec/
    expect(result.branch).toMatch(/^spec\//);

    // The branch must exist in the repo — falsifiable via git show-ref
    const branches = await git(['branch', '--list', result.branch], repoPath);
    expect(branches).toBe(result.branch);
  });

  // (b) .docs/specs|stories|plans files exist AND are committed on that branch
  it('commits .docs/specs, .docs/stories, and .docs/plans on the spec branch', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add real-time notifications';
    const provider = makeFakeProvider(repoPath);

    const result = await authorSpec(target, idea, emptyDigest(), provider);

    // Falsifiable: verify the exact committed paths via git ls-tree on the branch
    const tree = await git(['ls-tree', '-r', '--name-only', result.branch], repoPath);
    expect(tree).toContain('.docs/specs/spec.md');
    expect(tree).toContain('.docs/stories/stories.md');
    expect(tree).toContain('.docs/plans/plan.md');

    // git log must show a commit on this branch beyond the initial one
    const log = await git(['log', '--oneline', result.branch], repoPath);
    const lines = log.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2); // init + spec commit
  });

  // (c) default branch is whatever the repo actually had — NOT hardcoded
  it('derives the default branch from the repo — NOT hardcoded as main', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add real-time notifications';
    const provider = makeFakeProvider(repoPath);

    // This assertion is falsifiable: if someone hardcoded 'main' and the repo's
    // HEAD is 'master' (or any other name), the spec branch would be wrong.
    // We check the spec branch was created from the ACTUAL default branch.
    const result = await authorSpec(target, idea, emptyDigest(), provider);

    // The merge-base of spec/<slug> and defaultBranch should be the tip of defaultBranch
    const specTip = await git(['rev-parse', result.branch], repoPath);
    const defaultTip = await git(['rev-parse', defaultBranch], repoPath);
    const mergeBase = await git(['merge-base', result.branch, defaultBranch], repoPath);

    // The spec branch's parent is the default branch's tip — not a detached/empty state
    expect(mergeBase).toBe(defaultTip);
    // The spec branch has moved forward from the default tip (spec commit on top)
    expect(specTip).not.toBe(defaultTip);
  });

  // (d) slug collision: second call with same idea produces a distinct branch name
  it('produces a distinct branch name when slug collides with an existing branch', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add real-time notifications';

    const result1 = await authorSpec(target, idea, emptyDigest(), makeFakeProvider(repoPath));
    const result2 = await authorSpec(target, idea, emptyDigest(), makeFakeProvider(repoPath));

    // Must be distinct branch names — not the same string
    expect(result1.branch).not.toBe(result2.branch);

    // Both must exist in the repo
    const branches1 = await git(['branch', '--list', result1.branch], repoPath);
    const branches2 = await git(['branch', '--list', result2.branch], repoPath);
    expect(branches1).toBe(result1.branch);
    expect(branches2).toBe(result2.branch);
  });

  // (e) result carries the project name
  it('returns the project name in the result', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add search feature';
    const provider = makeFakeProvider(repoPath);

    const result = await authorSpec(target, idea, emptyDigest(), provider);
    expect(result.project).toBe('test-project');
  });

  // Negative-path: provider is called with the target's canonicalPath as cwd
  it('calls the provider with cwd equal to target.canonicalPath', async () => {
    const target = makeTarget(repoPath);
    const idea = 'add search feature';
    const invocations: Array<{ cwd: string }> = [];

    const spyProvider: AuthoringProvider = {
      async invoke(opts) {
        invocations.push({ cwd: opts.cwd });
        // Still write the files so the commit succeeds
        const docsSpecs = join(opts.cwd, '.docs', 'specs');
        const docsStories = join(opts.cwd, '.docs', 'stories');
        const docsPlans = join(opts.cwd, '.docs', 'plans');
        await mkdir(docsSpecs, { recursive: true });
        await mkdir(docsStories, { recursive: true });
        await mkdir(docsPlans, { recursive: true });
        await writeFile(join(docsSpecs, 'spec.md'), 'spec\n');
        await writeFile(join(docsStories, 'stories.md'), 'stories\n');
        await writeFile(join(docsPlans, 'plan.md'), 'plan\n');
      },
    };

    await authorSpec(target, idea, emptyDigest(), spyProvider);

    expect(invocations).toHaveLength(1);
    // Falsifiable: exact path, not a prefix or approximation
    expect(invocations[0].cwd).toBe(repoPath);
  });
});
