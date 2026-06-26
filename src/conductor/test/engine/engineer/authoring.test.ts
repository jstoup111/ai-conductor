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
