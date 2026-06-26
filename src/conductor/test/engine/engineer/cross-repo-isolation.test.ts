// Test: cross-repo isolation (Task 21, FR-11) — migrated to runAuthoring
//
// Verifies that `runAuthoring` confines ALL writes to the target repo (A) and
// leaves unrelated repos B (a registered sibling) and C (the engineer's own cwd)
// byte-for-byte unchanged.
//
// Strategy:
//   - Three REAL temp git repos: A (authoring target), B (unrelated registered
//     repo), C (engineer's own working directory).
//   - Snapshot B and C's HEAD SHA, branch list, and working-tree status BEFORE
//     running runAuthoring against A.
//   - Run runAuthoring against A with an approving decide seam.
//   - Assert A received the spec branch and committed .docs artifacts.
//   - Assert B and C are byte-for-byte unchanged: same HEAD SHA, same branch
//     list, empty `git status --porcelain`.

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { runAuthoring } from '../../../src/engine/engineer/authoring.js';

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Helper: run a git command in the given directory, return trimmed stdout
// ---------------------------------------------------------------------------
async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// Helper: create a REAL temp git repo with one initial commit
// ---------------------------------------------------------------------------
async function makeGitRepo(suffix: string): Promise<{ repoPath: string; defaultBranch: string }> {
  const repoPath = await mkdtemp(join(tmpdir(), `cross-repo-isolation-${suffix}-`));
  await execFile('git', ['init', '-q'], { cwd: repoPath });
  await execFile('git', ['config', 'user.email', 'test@test.com'], { cwd: repoPath });
  await execFile('git', ['config', 'user.name', 'Test'], { cwd: repoPath });
  // Initial commit so the repo has a default branch and HEAD
  await writeFile(join(repoPath, 'README.md'), `# Repo ${suffix}\n`);
  await execFile('git', ['add', 'README.md'], { cwd: repoPath });
  await execFile('git', ['commit', '-m', `init ${suffix}`], { cwd: repoPath });
  // Derive actual default branch — never hardcode 'main'
  const defaultBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath);
  return { repoPath, defaultBranch };
}

// ---------------------------------------------------------------------------
// Helper: snapshot a repo's observable state (HEAD SHA, branch list, status)
// ---------------------------------------------------------------------------
interface RepoSnapshot {
  headSha: string;
  branchList: string;
  statusPorcelain: string;
}

async function snapshotRepo(repoPath: string): Promise<RepoSnapshot> {
  const headSha = await git(['rev-parse', 'HEAD'], repoPath);
  const branchList = await git(['branch', '--list'], repoPath);
  const statusPorcelain = await git(['status', '--porcelain'], repoPath);
  return { headSha, branchList, statusPorcelain };
}

// ---------------------------------------------------------------------------
// Shared repos — created once for the entire test suite, cleaned up afterAll
// ---------------------------------------------------------------------------
let repoA: { repoPath: string; defaultBranch: string };
let repoB: { repoPath: string; defaultBranch: string };
let repoC: { repoPath: string; defaultBranch: string };

/** An approving DECIDE seam returning real artifacts. */
function approvedDecide() {
  return async (step: string) => {
    if (step === 'brainstorm') return { approved: true, artifact: '# PRD: idea\n\nApproved.\n' };
    if (step === 'stories')
      return {
        approved: true,
        artifact:
          '# Stories: idea\n\n**Status:** Accepted\n\n## Story: x\n\n### AC\n- Given x, when y, then z.\n',
      };
    if (step === 'plan')
      return {
        approved: true,
        artifact:
          '# Plan: idea\n\n## Tasks\n\n### Task 1\n**Dependencies:** none\n\n## Task Dependency Graph\n```\n1\n```\n',
      };
    return { approved: true, artifact: '' };
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runAuthoring — cross-repo isolation (Task 21, FR-11)', () => {
  // Set up three independent real git repos before any test runs
  let snapshotBefore: { b: RepoSnapshot; c: RepoSnapshot };
  let authoringResult: Awaited<ReturnType<typeof runAuthoring>>;

  it('setup: creates repos A, B, C and runs runAuthoring against A only', async () => {
    // Create three independent git repos
    repoA = await makeGitRepo('A');
    repoB = await makeGitRepo('B');
    repoC = await makeGitRepo('C');

    // Snapshot B and C BEFORE authoring — these are the reference states
    snapshotBefore = {
      b: await snapshotRepo(repoB.repoPath),
      c: await snapshotRepo(repoC.repoPath),
    };

    // Run runAuthoring ONLY against A — B and C must remain untouched
    const targetA = { name: 'project-alpha', canonicalPath: repoA.repoPath };
    const idea = 'add user authentication';
    authoringResult = await runAuthoring(targetA, idea, { decide: approvedDecide() });

    // Sanity: authoring completed without throwing
    expect(authoringResult).toBeDefined();
    expect(authoringResult.branch).toMatch(/^spec\//);
    expect(authoringResult.project).toBe('project-alpha');
  });

  // --- A received the spec branch and committed artifacts ---

  it('A: spec branch exists in repo A', async () => {
    const branches = await git(['branch', '--list', authoringResult.branch], repoA.repoPath);
    // Falsifiable: the branch string must equal exactly the branch name
    expect(branches).toBe(authoringResult.branch);
  });

  it('A: .docs artifacts are committed on the spec branch in A', async () => {
    const tree = await git(
      ['ls-tree', '-r', '--name-only', authoringResult.branch],
      repoA.repoPath,
    );
    // runAuthoring commits stories, plans, and specs on the spec branch.
    expect(tree).toMatch(/\.docs\//);
  });

  it('A: the spec branch has a commit beyond the initial one', async () => {
    const log = await git(['log', '--oneline', authoringResult.branch], repoA.repoPath);
    const lines = log.split('\n').filter(Boolean);
    // init commit + spec commit = at least 2
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  // --- B is byte-for-byte unchanged ---

  it('B: HEAD SHA is unchanged after authoring A', async () => {
    const headShaAfter = await git(['rev-parse', 'HEAD'], repoB.repoPath);
    // Falsifiable: exact SHA equality — any write to B would advance HEAD
    expect(headShaAfter).toBe(snapshotBefore.b.headSha);
  });

  it('B: branch list is unchanged after authoring A', async () => {
    const branchListAfter = await git(['branch', '--list'], repoB.repoPath);
    // Falsifiable: any new branch in B would appear here and break equality
    expect(branchListAfter).toBe(snapshotBefore.b.branchList);
  });

  it('B: working tree is clean (no new/modified files) after authoring A', async () => {
    const statusAfter = await git(['status', '--porcelain'], repoB.repoPath);
    // Falsifiable: any untracked or modified file in B shows up in porcelain output
    expect(statusAfter).toBe('');
    // Also matches pre-authoring state (which was already clean)
    expect(statusAfter).toBe(snapshotBefore.b.statusPorcelain);
  });

  // --- C (engineer's own cwd) is likewise unchanged ---

  it('C: HEAD SHA is unchanged after authoring A', async () => {
    const headShaAfter = await git(['rev-parse', 'HEAD'], repoC.repoPath);
    // Falsifiable: exact SHA equality
    expect(headShaAfter).toBe(snapshotBefore.c.headSha);
  });

  it('C: branch list is unchanged after authoring A', async () => {
    const branchListAfter = await git(['branch', '--list'], repoC.repoPath);
    // Falsifiable: any leaked branch in C would break this
    expect(branchListAfter).toBe(snapshotBefore.c.branchList);
  });

  it('C: working tree is clean (no new/modified files) after authoring A', async () => {
    const statusAfter = await git(['status', '--porcelain'], repoC.repoPath);
    // Falsifiable: any leaked file in C shows up in porcelain output
    expect(statusAfter).toBe('');
    expect(statusAfter).toBe(snapshotBefore.c.statusPorcelain);
  });

  // --- Confinement: all writes are in A.canonicalPath only ---

  it('writes are confined to A.canonicalPath: B shows no new commits', async () => {
    // Count commits in B — must equal 1 (the initial "init B" commit only)
    const logB = await git(['log', '--oneline', repoB.defaultBranch], repoB.repoPath);
    const commitCountB = logB.split('\n').filter(Boolean).length;
    expect(commitCountB).toBe(1);
  });

  it('writes are confined to A.canonicalPath: C shows no new commits', async () => {
    // Count commits in C — must equal 1 (the initial "init C" commit only)
    const logC = await git(['log', '--oneline', repoC.defaultBranch], repoC.repoPath);
    const commitCountC = logC.split('\n').filter(Boolean).length;
    expect(commitCountC).toBe(1);
  });

  // Cleanup: remove all three temp repos
  afterAll(async () => {
    if (repoA?.repoPath) await rm(repoA.repoPath, { recursive: true, force: true });
    if (repoB?.repoPath) await rm(repoB.repoPath, { recursive: true, force: true });
    if (repoC?.repoPath) await rm(repoC.repoPath, { recursive: true, force: true });
  });
});
