// Test: authorSpec — subprocess DECIDE authoring runner (Task 20, FR-6 happy path)
// Test: runAuthoring — real DECIDE seam → Status:Accepted artifacts (Task 32, 33, FR-6, C2)
//
// authorSpec(target, idea, digest, provider) runs the DECIDE authoring as a
// subprocess with the TARGET repo as cwd (via an injectable AuthoringProvider),
// creates a spec/<slug> branch off the repo's DEFAULT branch (never 'main'
// hardcoded — derived via `git rev-parse --abbrev-ref HEAD` for local repos
// with no remote), writes .docs/specs|stories|plans artifacts, commits them on
// that branch, and returns { branch, project } to the caller.
//
// runAuthoring(target, idea, deps) is the redesign: no subprocess, no stub,
// no DRAFT — uses injected deps.decide for each DECIDE step and commits real
// human-gated artifacts onto spec/<slug>.
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
import { vi } from 'vitest';
import { authorSpec, runAuthoring } from '../../../src/engine/engineer/authoring.js';
import type { AuthoringProvider, AuthoringResult } from '../../../src/engine/engineer/authoring.js';
import type { TargetRepo } from '../../../src/engine/engineer/target.js';
import type { LessonDigest } from '../../../src/engine/engineer/lesson-store.js';
import { discoverBacklog } from '../../../src/engine/daemon-backlog.js';

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

// ---------------------------------------------------------------------------
// Task 32: runAuthoring happy path — real DECIDE → Status:Accepted artifacts
// ---------------------------------------------------------------------------

// Real human-gated artifacts the DECIDE seam returns.
const ACCEPTED_STORIES_UNIT = [
  '# Stories: CSV export',
  '',
  '**Status:** Accepted',
  '',
  '## Story: Export rows to CSV',
  '',
  '### Acceptance Criteria',
  '- Given rows, when I export, then a CSV is produced.',
  '',
].join('\n');

const PLAN_WITH_DEPS_UNIT = [
  '# Implementation Plan: CSV export',
  '',
  '**Stories:** .docs/stories/csv-export.md',
  '',
  '## Tasks',
  '',
  '### Task 1: writer',
  '**Dependencies:** none',
  '',
  '## Task Dependency Graph',
  '```',
  '1 → 2',
  '```',
  '',
].join('\n');

function approvedDecide() {
  return async (step: string) => {
    if (step === 'brainstorm') return { approved: true, artifact: '# PRD: CSV export\n\nApproved.\n' };
    if (step === 'stories') return { approved: true, artifact: ACCEPTED_STORIES_UNIT };
    if (step === 'plan') return { approved: true, artifact: PLAN_WITH_DEPS_UNIT };
    return { approved: true, artifact: '' };
  };
}

describe('runAuthoring — happy path (Task 32, FR-6)', () => {
  let repoPath: string;
  let defaultBranch: string;

  beforeEach(async () => {
    ({ repoPath, defaultBranch } = await makeGitRepo());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(repoPath, { recursive: true, force: true });
  });

  it('returns { branch: spec/<slug>, project } from approved DECIDE steps', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    const result = await runAuthoring(target, 'CSV export', { decide: approvedDecide() });

    expect(result.branch).toMatch(/^spec\//);
    expect(result.project).toBe('alpha');
  });

  it('commits Status:Accepted stories on the spec branch', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    const result = await runAuthoring(target, 'CSV export', { decide: approvedDecide() });

    // Checkout branch and read stories
    const execFileFn = promisify(execFileCb);
    await execFileFn('git', ['checkout', result.branch], { cwd: repoPath });

    const storiesDir = join(repoPath, '.docs', 'stories');
    const { stdout: ls } = await execFileFn('ls', [storiesDir]);
    const file = ls.trim().split('\n')[0];
    const text = await readFile(join(storiesDir, file), 'utf8');

    expect(text).toMatch(/\bstatus\b[\s*:]*\baccepted\b/i);
    expect(text).not.toMatch(/\bstatus\b[\s*:]*\bdraft\b/i);
    expect(text).not.toContain('_Generated by engineer._');
  });

  it('commits a plan with a dependency tree on the spec branch (daemon build-ready)', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    const result = await runAuthoring(target, 'CSV export', { decide: approvedDecide() });

    const execFileFn = promisify(execFileCb);
    await execFileFn('git', ['checkout', result.branch], { cwd: repoPath });

    // discoverBacklog should see > 0 items (Status:Accepted + dependency tree)
    const backlog = await discoverBacklog(repoPath);
    expect(backlog.length).toBeGreaterThan(0);
  });

  it('calls decide in order: brainstorm → stories → plan', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    const steps: string[] = [];
    const trackingDecide = async (step: string) => {
      steps.push(step);
      return (await approvedDecide()(step));
    };

    await runAuthoring(target, 'CSV export', { decide: trackingDecide });
    expect(steps).toEqual(['brainstorm', 'stories', 'plan']);
  });

  it('creates the spec branch in the target repo', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    const result = await runAuthoring(target, 'CSV export', { decide: approvedDecide() });

    const execFileFn = promisify(execFileCb);
    const { stdout } = await execFileFn('git', ['branch', '--list', 'spec/*'], { cwd: repoPath });
    expect(stdout).toMatch(/spec\//);
    expect(result.branch).toMatch(/^spec\//);
  });

  it('does NOT spawn claude (injected spawn spy is never called for claude)', async () => {
    const spawnSpy = vi.fn().mockReturnValue({ pid: 1, unref: () => {} });
    const target = { name: 'alpha', canonicalPath: repoPath };

    await runAuthoring(target, 'CSV export', { decide: approvedDecide(), spawn: spawnSpy });

    // No call may be to 'claude'
    for (const call of spawnSpy.mock.calls) {
      const cmd = String(call[0] ?? '');
      const args = (call[1] as unknown[] | undefined)?.map(String) ?? [];
      expect(cmd).not.toMatch(/(^|\/)claude$/);
      expect([cmd, ...args].join(' ')).not.toMatch(/\bclaude\b\s+-p\b/);
    }
  });
});

// ---------------------------------------------------------------------------
// Task 33: runAuthoring regression guards — no stub/DRAFT/subprocess (FR-6, C2)
// ---------------------------------------------------------------------------

describe('runAuthoring — regression guards (Task 33, FR-6, C2)', () => {
  let repoPath: string;
  let defaultBranch: string;

  beforeEach(async () => {
    ({ repoPath, defaultBranch } = await makeGitRepo());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(repoPath, { recursive: true, force: true });
  });

  it('never writes the stub "_Generated by engineer." string', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    const result = await runAuthoring(target, 'CSV export', { decide: approvedDecide() });

    const execFileFn = promisify(execFileCb);
    await execFileFn('git', ['checkout', result.branch], { cwd: repoPath });

    const storiesDir = join(repoPath, '.docs', 'stories');
    const { stdout: ls } = await execFileFn('ls', [storiesDir]);
    const file = ls.trim().split('\n')[0];
    const text = await readFile(join(storiesDir, file), 'utf8');
    expect(text).not.toContain('_Generated by engineer._');
  });

  it('never writes Status:DRAFT in stories', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    const result = await runAuthoring(target, 'CSV export', { decide: approvedDecide() });

    const execFileFn = promisify(execFileCb);
    await execFileFn('git', ['checkout', result.branch], { cwd: repoPath });

    const storiesDir = join(repoPath, '.docs', 'stories');
    const { stdout: ls } = await execFileFn('ls', [storiesDir]);
    const file = ls.trim().split('\n')[0];
    const text = await readFile(join(storiesDir, file), 'utf8');
    expect(text).not.toMatch(/\bstatus\b[\s*:]*\bdraft\b/i);
  });

  it('never spawns claude or claude -p (injected spawn spy)', async () => {
    const spawnSpy = vi.fn().mockReturnValue({ pid: 1, unref: () => {} });
    const target = { name: 'alpha', canonicalPath: repoPath };

    await runAuthoring(target, 'CSV export', { decide: approvedDecide(), spawn: spawnSpy });

    for (const call of spawnSpy.mock.calls) {
      const cmd = String(call[0] ?? '');
      const args = (call[1] as unknown[] | undefined)?.map(String) ?? [];
      expect(cmd).not.toMatch(/(^|\/)claude$/);
      expect([cmd, ...args].join(' ')).not.toMatch(/\bclaude\b\s+-p\b/);
    }
  });

  it('an UNAPPROVED stories step throws and fabricates no plan file', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    const blockingDecide = async (step: string) => {
      if (step === 'brainstorm') return { approved: true, artifact: '# PRD\n' };
      if (step === 'stories') return { approved: false, artifact: '' };
      // plan must never be reached
      return { approved: true, artifact: PLAN_WITH_DEPS_UNIT };
    };

    await expect(
      runAuthoring(target, 'CSV export', { decide: blockingDecide }),
    ).rejects.toThrow();

    // No plan files fabricated
    const execFileFn = promisify(execFileCb);
    await execFileFn('git', ['checkout', defaultBranch], { cwd: repoPath }).catch(() => undefined);
    const { stdout: planFiles } = await execFileFn('ls', [join(repoPath, '.docs', 'plans')]).catch(
      () => ({ stdout: '' }),
    );
    expect(planFiles.trim()).toBe('');
  });

  it('an UNAPPROVED brainstorm step throws immediately', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    const blockingDecide = async (step: string) => {
      if (step === 'brainstorm') return { approved: false, artifact: '' };
      return { approved: true, artifact: '' };
    };

    await expect(
      runAuthoring(target, 'CSV export', { decide: blockingDecide }),
    ).rejects.toThrow();
  });

  it('a missing target path throws TargetPathMissingError before any write', async () => {
    const missingPath = join(repoPath, 'does-not-exist');
    const target = { name: 'ghost', canonicalPath: missingPath };

    await expect(
      runAuthoring(target, 'some idea', { decide: approvedDecide() }),
    ).rejects.toThrow(/exist|missing|path/i);
  });
});
