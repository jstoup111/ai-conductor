// Test: runAuthoring — real DECIDE seam → Status:Accepted artifacts (Task 32, 33, FR-6, C2)
//
// runAuthoring(target, idea, deps) is the redesigned gated seam: no subprocess, no stub,
// no DRAFT — uses injected deps.decide for each DECIDE step and commits real
// human-gated artifacts onto spec/<slug>.
//
// Fixture: a REAL temporary git repo (os.tmpdir(), git init, initial commit) so
// the default branch is whatever `git init` produced — we READ it, never
// hardcode 'main'.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { vi } from 'vitest';
import { runAuthoring } from '../../../src/engine/engineer/authoring.js';
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
  await execFile('git', ['init', '-b', 'main', '-q'], { cwd: repoPath });
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
    if (step === 'explore') return { approved: true, artifact: '# Explore\n\napproaches\n' };
    if (step === 'prd') return { approved: true, artifact: '# PRD: CSV export\n\nApproved.\n' };
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

  it('plan becomes daemon-build-ready only once the spec branch is MERGED into the base branch', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    const result = await runAuthoring(target, 'CSV export', { decide: approvedDecide() });

    const execFileFn = promisify(execFileCb);

    // FR-24: authoring lands artifacts on spec/<slug>, NOT the base branch — so
    // the daemon must NOT see it yet (the operator's merge is the build signal).
    const { items: before } = await discoverBacklog(repoPath, undefined, undefined, {
      baseBranch: defaultBranch,
    });
    expect(before).toEqual([]);

    // Merge the spec branch into the base branch (the operator's action).
    await execFileFn('git', ['checkout', defaultBranch], { cwd: repoPath });
    await execFileFn('git', ['merge', '--no-ff', '-m', 'merge spec', result.branch], {
      cwd: repoPath,
    });

    // Now (Status:Accepted + dependency tree, on the base branch) it is build-ready.
    const { items: after } = await discoverBacklog(repoPath, undefined, undefined, {
      baseBranch: defaultBranch,
    });
    expect(after.length).toBeGreaterThan(0);
  });

  it('calls decide in order: explore → prd → stories → plan', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    const steps: string[] = [];
    const trackingDecide = async (step: string) => {
      steps.push(step);
      return (await approvedDecide()(step));
    };

    await runAuthoring(target, 'CSV export', { decide: trackingDecide });
    expect(steps).toEqual(['explore', 'prd', 'stories', 'plan']);
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

  it('#505 Task 8: runAuthoring commits CONDUCT_ENGINE_COMMIT=1 — lands trailer-less under an active commit-msg gate', async () => {
    // Wire the real hook scripts (from a location outside repoPath, so the
    // main tree's dirty-guard check stays clean) and a build-step-active
    // marker committed BEFORE the hook is wired (a pre-enforcement commit).
    // If runAuthoring's spec-branch `git commit` did NOT set
    // CONDUCT_ENGINE_COMMIT=1, this would be rejected trailer-less.
    const { PREPARE_COMMIT_MSG_HOOK, COMMIT_MSG_HOOK } = await import('../../../src/engine/git-hook-assets.js');
    const execFileFn = promisify(execFileCb);

    await mkdirForMarker(repoPath);
    await writeFile(join(repoPath, '.pipeline', 'build-step-active'), 'active\n');
    await execFileFn('git', ['add', '.pipeline/build-step-active'], { cwd: repoPath });
    await execFileFn('git', ['commit', '-m', 'test: seed build-step-active marker'], { cwd: repoPath });

    const hooksDir = await mkdtemp(join(tmpdir(), 'authoring-task8-hooks-'));
    const prepareCommitMsgPath = join(hooksDir, 'prepare-commit-msg');
    const commitMsgPath = join(hooksDir, 'commit-msg');
    await writeFile(prepareCommitMsgPath, PREPARE_COMMIT_MSG_HOOK, 'utf-8');
    await writeFile(commitMsgPath, COMMIT_MSG_HOOK, 'utf-8');
    await execFileFn('chmod', ['+x', prepareCommitMsgPath, commitMsgPath]);
    await execFileFn('git', ['config', 'core.hooksPath', hooksDir], { cwd: repoPath });

    const target = { name: 'alpha', canonicalPath: repoPath };
    const result = await runAuthoring(target, 'CSV export', { decide: approvedDecide() });

    await execFileFn('git', ['checkout', result.branch], { cwd: repoPath });
    const { stdout: subject } = await execFileFn('git', ['log', '-1', '--format=%s'], { cwd: repoPath });
    expect(subject.trim()).toContain('spec: author artifacts for "CSV export"');

    await rm(hooksDir, { recursive: true, force: true });
  });
});

async function mkdirForMarker(repoPath: string): Promise<void> {
  const { mkdir } = await import('fs/promises');
  await mkdir(join(repoPath, '.pipeline'), { recursive: true });
}

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
      if (step === 'explore') return { approved: true, artifact: '# Explore\n' };
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

  it('stories approved by DECIDE but lacking "Status: Accepted" throws before any write/commit', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    // DECIDE reports approved=true, but the stories artifact carries NO status
    // marker — the exact gap that would commit a spec the daemon skips forever.
    const noStatusDecide = async (step: string) => {
      if (step === 'explore') return { approved: true, artifact: '# Explore\n' };
      if (step === 'stories')
        return {
          approved: true,
          artifact: '# Stories\n\n## Story: main\n\n### AC\n- Given x, when y, then z.\n',
        };
      return { approved: true, artifact: PLAN_WITH_DEPS_UNIT };
    };

    await expect(
      runAuthoring(target, 'CSV export', { decide: noStatusDecide }),
    ).rejects.toThrow(/not approved|Status: Accepted/i);

    // No spec branch left dangling and no artifacts fabricated.
    const branchList = await git(['branch', '--list', 'spec/*'], repoPath);
    expect(branchList).toBe('');
    const execFileFn = promisify(execFileCb);
    const { stdout: storyFiles } = await execFileFn('ls', [
      join(repoPath, '.docs', 'stories'),
    ]).catch(() => ({ stdout: '' }));
    expect(storyFiles.trim()).toBe('');
  });

  it('default (no assessComplexity seam) runs only explore → prd → stories → plan (Small)', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    const steps: string[] = [];
    const trackingDecide = async (step: string) => {
      steps.push(step);
      return await approvedDecide()(step);
    };
    await runAuthoring(target, 'CSV export', { decide: trackingDecide });
    expect(steps).toEqual(['explore', 'prd', 'stories', 'plan']);
  });

  it('an UNAPPROVED explore step throws immediately', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    const blockingDecide = async (step: string) => {
      if (step === 'explore') return { approved: false, artifact: '' };
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

  // dirty-tree guard (ported from authorSpec guard tests — now enforced by runAuthoring)
  it('dirty-tree guard: throws and names a dirty file before any DECIDE step or branch creation', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    const idea = 'add analytics dashboard';

    // Introduce an uncommitted change — modify a tracked file
    await writeFile(join(repoPath, 'README.md'), 'dirty uncommitted content\n');

    let errorMessage = '';
    try {
      await runAuthoring(target, idea, { decide: approvedDecide() });
    } catch (e) {
      errorMessage = (e as Error).message;
    }

    // Error must mention dirty/uncommitted
    expect(errorMessage).toMatch(/dirty|uncommitted/i);
    // Error must name at least one dirty file
    expect(errorMessage).toMatch(/README\.md/);

    // No spec branch must have been created
    const branchList = await git(['branch', '--list', 'spec/*'], repoPath);
    expect(branchList).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Full DECIDE phase: complexity assessment + tier-conditional conflict/architecture
// ---------------------------------------------------------------------------

const ACCEPTED_STORIES_FULL = ACCEPTED_STORIES_UNIT;
const PLAN_WITH_DEPS_FULL = PLAN_WITH_DEPS_UNIT;
const APPROVED_ADR = [
  '# Architecture Review: CSV export',
  '',
  '## ADR-001: Use a streaming writer',
  '**Status:** APPROVED',
  '',
  'Decision rationale.',
  '',
].join('\n');

/** A decide seam that approves every DECIDE step with realistic artifacts. */
function fullDecide(reviewArtifact: string = APPROVED_ADR) {
  return async (step: string) => {
    switch (step) {
      case 'explore':
        return { approved: true, artifact: '# Explore\n\napproaches\n' };
      case 'prd':
        return { approved: true, artifact: '# PRD: CSV export\n\nApproved.\n' };
      case 'stories':
        return { approved: true, artifact: ACCEPTED_STORIES_FULL };
      case 'conflict_check':
        return { approved: true, artifact: '# Conflict Check\n\nNo blocking conflicts.\n' };
      case 'architecture_diagram':
        return { approved: true, artifact: '# Architecture\n\n```mermaid\nflowchart TD\n```\n' };
      case 'architecture_review':
        return { approved: true, artifact: reviewArtifact };
      case 'plan':
        return { approved: true, artifact: PLAN_WITH_DEPS_FULL };
      default:
        return { approved: true, artifact: '' };
    }
  };
}

const approveTier = (tier: 'S' | 'M' | 'L') => async () => ({ approved: true, tier });

describe('runAuthoring — full DECIDE phase (tier-aware)', () => {
  let repoPath: string;
  let defaultBranch: string;

  beforeEach(async () => {
    ({ repoPath, defaultBranch } = await makeGitRepo());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(repoPath, { recursive: true, force: true });
  });

  it('Medium tier runs all seven DECIDE steps in canonical order', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    const steps: string[] = [];
    const trackingDecide = async (step: string) => {
      steps.push(step);
      return await fullDecide()(step);
    };
    await runAuthoring(target, 'CSV export', {
      decide: trackingDecide,
      assessComplexity: approveTier('M'),
    });
    expect(steps).toEqual([
      'explore',
      'prd',
      'architecture_diagram',
      'architecture_review',
      'stories',
      'conflict_check',
      'plan',
    ]);
  });

  it('Medium tier commits the full artifact set + a Tier: M marker', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    const result = await runAuthoring(target, 'CSV export', {
      decide: fullDecide(),
      assessComplexity: approveTier('M'),
    });

    await git(['checkout', result.branch], repoPath);
    const read = (rel: string) => readFile(join(repoPath, rel), 'utf8');

    // Complexity marker keyed by the plan stem (slug), carrying the tier.
    const complexity = await read('.docs/complexity/csv-export.md');
    expect(complexity).toMatch(/Tier:\s*M/);

    // Tier-conditional dirs exist on the branch.
    const { stdout: tracked } = await execFile('git', ['ls-files', '.docs'], { cwd: repoPath });
    expect(tracked).toMatch(/\.docs\/conflicts\//);
    expect(tracked).toMatch(/\.docs\/architecture\//);
    expect(tracked).toMatch(/\.docs\/decisions\/architecture-review-/);
    expect(tracked).toMatch(/\.docs\/specs\//);
    expect(tracked).toMatch(/\.docs\/stories\//);
    expect(tracked).toMatch(/\.docs\/plans\//);
  });

  it('Small tier skips conflict-check + architecture (only explore/prd/stories/plan run)', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    const steps: string[] = [];
    const trackingDecide = async (step: string) => {
      steps.push(step);
      return await fullDecide()(step);
    };
    const result = await runAuthoring(target, 'CSV export', {
      decide: trackingDecide,
      assessComplexity: approveTier('S'),
    });
    expect(steps).toEqual(['explore', 'prd', 'stories', 'plan']);

    await git(['checkout', result.branch], repoPath);
    const { stdout: tracked } = await execFile('git', ['ls-files', '.docs'], { cwd: repoPath });
    // The complexity marker is always written; the heavy DECIDE dirs are not.
    expect(tracked).toMatch(/\.docs\/complexity\/csv-export\.md/);
    expect(tracked).not.toMatch(/\.docs\/conflicts\//);
    expect(tracked).not.toMatch(/\.docs\/architecture\//);
    expect(tracked).not.toMatch(/\.docs\/decisions\//);
  });

  it('a DRAFT ADR in architecture-review throws and creates no spec branch', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    const draftReview = APPROVED_ADR.replace('**Status:** APPROVED', '**Status:** DRAFT');
    await expect(
      runAuthoring(target, 'CSV export', {
        decide: fullDecide(draftReview),
        assessComplexity: approveTier('M'),
      }),
    ).rejects.toThrow(/DRAFT ADR|APPROVED/i);

    const branchList = await git(['branch', '--list', 'spec/*'], repoPath);
    expect(branchList).toBe('');
  });

  it('an unapproved complexity assessment throws before any write', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    await expect(
      runAuthoring(target, 'CSV export', {
        decide: fullDecide(),
        assessComplexity: async () => ({ approved: false, tier: 'M' }),
      }),
    ).rejects.toThrow(/complexity/i);

    const branchList = await git(['branch', '--list', 'spec/*'], repoPath);
    expect(branchList).toBe('');
    const { stdout: storyFiles } = await execFile('ls', [join(repoPath, '.docs', 'stories')]).catch(
      () => ({ stdout: '' }),
    );
    expect(storyFiles.trim()).toBe('');
  });

  it('the Medium-tier spec becomes daemon-build-ready with Tier: M after merge', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    const result = await runAuthoring(target, 'CSV export', {
      decide: fullDecide(),
      assessComplexity: approveTier('M'),
    });

    await execFile('git', ['checkout', defaultBranch], { cwd: repoPath });
    await execFile('git', ['merge', '--no-ff', '-m', 'merge spec', result.branch], {
      cwd: repoPath,
    });

    const { items: after } = await discoverBacklog(repoPath, undefined, undefined, {
      baseBranch: defaultBranch,
    });
    expect(after.length).toBeGreaterThan(0);
    expect(after[0].tier).toBe('M');
  });
});

// ---------------------------------------------------------------------------
// Owner-gate: runAuthoring stamps the resolved owner on the intake marker
// (retro A-1, adr-2026-06-30-*, FR-4 write side). Mirrors landSpec (Task 16):
// configured spec_owner → gh login → un-owned (Owner line OMITTED, not blank).
// Assert against the COMMITTED marker on the spec branch, like the CLI test.
// ---------------------------------------------------------------------------

import type { GhRunner } from '../../../src/engine/owner-gate/identity.js';

/** Read a committed file from a branch tree, or null if absent. */
async function showOnBranch(
  branch: string,
  relPath: string,
  cwd: string,
): Promise<string | null> {
  try {
    return await git(['show', `${branch}:${relPath}`], cwd);
  } catch {
    return null;
  }
}

describe('runAuthoring — owner-gate marker stamping (retro A-1, FR-4)', () => {
  let repoPath: string;

  beforeEach(async () => {
    ({ repoPath } = await makeGitRepo());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(repoPath, { recursive: true, force: true });
  });

  it('stamps Owner from configured spec_owner (gh not consulted)', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    // A throwing gh proves the configured owner won without a login fallback.
    const failingGh: GhRunner = async () => {
      throw new Error('gh should not be consulted when spec_owner is configured');
    };
    const result = await runAuthoring(target, 'dep bump', {
      decide: approvedDecide(),
      ownerConfig: { spec_owner: 'Alice' },
      gh: failingGh,
    });

    const marker = await showOnBranch(result.branch, `.docs/intake/dep-bump.md`, repoPath);
    expect(marker).toContain('Owner: alice'); // normalized (trim + lowercase)
  });

  it('stamps Owner from gh login when spec_owner is absent', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    const gh: GhRunner = async () => ({ stdout: 'bob\n' });
    const result = await runAuthoring(target, 'dep bump', {
      decide: approvedDecide(),
      gh,
    });

    const marker = await showOnBranch(result.branch, `.docs/intake/dep-bump.md`, repoPath);
    expect(marker).toContain('Owner: bob');
  });

  it('OMITS the Owner line (un-owned, NOT blank) when neither config nor gh resolves', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    const failingGh: GhRunner = async () => {
      throw new Error('gh unavailable');
    };
    // A valid sourceRef guarantees a marker is written so Owner's ABSENCE is
    // observable (not merely that no marker exists).
    const result = await runAuthoring(target, 'dep bump', {
      decide: approvedDecide(),
      sourceRef: 'acme/app#7',
      gh: failingGh,
    });

    const marker = await showOnBranch(result.branch, `.docs/intake/dep-bump.md`, repoPath);
    expect(marker).toContain('Source-Ref: acme/app#7');
    expect(marker ?? '').not.toContain('Owner:');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Covers: FR-1 (Story 1 — owner-stamped-at-authoring, #721)
//
// RED acceptance specs: `runAuthoring` with an EMPTY/ABSENT `ownerConfig` must
// fall back to `readMachineOwnerConfig()` (the `~/.ai-conductor/config.yml`
// `spec_owner` → `gh` login chain) exactly like `conductor.ts`/`loop.ts`
// already do. Today it does not: `deps.ownerConfig ?? {}` feeds an EMPTY object
// straight into `resolveDaemonOwner`, which never reads machine config — a
// resolvable machine identity is silently dropped and the marker ships
// un-owned. These specs drive the REAL `runAuthoring` entry point (not the
// identity helpers directly) with a fake `$HOME` carrying a real
// `~/.ai-conductor/config.yml`, mirroring the established technique in
// `loop.test.ts` ("Owner-gate: autonomous authoring threads owner deps into
// runAuthoring"), and assert against the COMMITTED intake marker.
// ─────────────────────────────────────────────────────────────────────────────

describe('runAuthoring — born owned from machine identity when ownerConfig is empty (Story 1, FR-1)', () => {
  let repoPath: string;

  beforeEach(async () => {
    ({ repoPath } = await makeGitRepo());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(repoPath, { recursive: true, force: true });
  });

  /** Create an isolated fake $HOME carrying `~/.ai-conductor/config.yml` (or none). */
  async function makeUserHome(body?: string): Promise<string> {
    const home = await mkdtemp(join(tmpdir(), 'authoring-user-home-'));
    if (body !== undefined) {
      const { mkdir } = await import('fs/promises');
      await mkdir(join(home, '.ai-conductor'), { recursive: true });
      await writeFile(join(home, '.ai-conductor', 'config.yml'), body, 'utf-8');
    }
    return home;
  }

  /** Run `fn` with process.env.HOME pointed at `home`; always restores it. */
  async function withHome<T>(home: string, fn: () => Promise<T>): Promise<T> {
    const saved = process.env.HOME;
    process.env.HOME = home;
    try {
      return await fn();
    } finally {
      process.env.HOME = saved;
    }
  }

  it('falls back to machine identity (~/.ai-conductor/config.yml spec_owner) when ownerConfig is absent and gh is not consulted', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    const fakeHome = await makeUserHome('spec_owner: carol\n');
    try {
      await withHome(fakeHome, async () => {
        // A throwing gh proves machine config won without a login fallback —
        // mirrors the "configured owner" test above, one seam earlier in the chain.
        const failingGh: GhRunner = async () => {
          throw new Error('gh should not be consulted when machine spec_owner resolves');
        };
        const result = await runAuthoring(target, 'dep bump', {
          decide: approvedDecide(),
          gh: failingGh,
          // No ownerConfig injected — this is exactly the autonomous-authoring gap.
        });

        const marker = await showOnBranch(result.branch, `.docs/intake/dep-bump.md`, repoPath);
        // Fails today: authoring.ts feeds `{}` into resolveDaemonOwner and never
        // reads machine config, so this marker ships un-owned instead.
        expect(marker ?? '').toContain('Owner: carol');
      });
    } finally {
      await rm(fakeHome, { recursive: true, force: true });
    }
  });

  it('falls back to gh login when ownerConfig is absent AND machine config has no spec_owner (chain continues past machine identity)', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    const fakeHome = await makeUserHome(); // no config.yml at all
    try {
      await withHome(fakeHome, async () => {
        const gh: GhRunner = async () => ({ stdout: 'dave\n' });
        const result = await runAuthoring(target, 'dep bump', {
          decide: approvedDecide(),
          gh,
        });

        const marker = await showOnBranch(result.branch, `.docs/intake/dep-bump.md`, repoPath);
        // Fails today for the wrong reason if it ever passes: current code
        // already reaches gh in this case (empty ownerConfig also falls through
        // to gh), so this pins that the machine-identity fallback is additive,
        // not a regression of the existing gh path.
        expect(marker).toContain('Owner: dave');
      });
    } finally {
      await rm(fakeHome, { recursive: true, force: true });
    }
  });

  it('never writes a BLANK Owner: line when identity is genuinely unresolvable (un-owned = omitted, never blank)', async () => {
    const target = { name: 'alpha', canonicalPath: repoPath };
    const fakeHome = await makeUserHome(); // no config.yml → machine identity unresolved
    try {
      await withHome(fakeHome, async () => {
        const failingGh: GhRunner = async () => {
          throw new Error('gh unavailable');
        };
        const result = await runAuthoring(target, 'dep bump', {
          decide: approvedDecide(),
          sourceRef: 'acme/app#7', // guarantees a marker is written
          gh: failingGh,
        });

        const marker = await showOnBranch(result.branch, `.docs/intake/dep-bump.md`, repoPath);
        expect(marker).toContain('Source-Ref: acme/app#7');
        expect(marker ?? '').not.toMatch(/^Owner:\s*$/m); // never a blank Owner: line
        expect(marker ?? '').not.toContain('Owner:'); // un-owned = omitted entirely
      });
    } finally {
      await rm(fakeHome, { recursive: true, force: true });
    }
  });
});
