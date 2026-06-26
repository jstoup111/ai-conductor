// Test: cross-repo isolation (Task 21, FR-11)
//
// Verifies that `authorSpec` confines ALL writes to the target repo (A) and
// leaves unrelated repos B (a registered sibling) and C (the engineer's own cwd)
// byte-for-byte unchanged.
//
// Strategy:
//   - Three REAL temp git repos: A (authoring target), B (unrelated registered
//     repo), C (engineer's own working directory).
//   - Snapshot B and C's HEAD SHA, branch list, and working-tree status BEFORE
//     running authorSpec against A.
//   - Run authorSpec against A with a fake provider that writes ONLY into
//     `opts.cwd` (which must be A).
//   - Assert A received the spec branch and committed .docs artifacts.
//   - Assert B and C are byte-for-byte unchanged: same HEAD SHA, same branch
//     list, empty `git status --porcelain`.
//
// The fake provider is constructed to write ONLY into opts.cwd — it never
// references B or C. The test is falsifiable because we pre-capture B/C state
// and compare it after; if authorSpec leaked into B or C the assertions would
// catch it with exact string equality.

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { authorSpec } from '../../../src/engine/engineer/authoring.js';
import type { AuthoringProvider } from '../../../src/engine/engineer/authoring.js';
import type { TargetRepo } from '../../../src/engine/engineer/target.js';
import type { LessonDigest } from '../../../src/engine/engineer/lesson-store.js';

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
// The repo gets a unique suffix so all three repos are distinguishable.
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
// Helper: fake AuthoringProvider — writes ONLY into opts.cwd (A)
// ---------------------------------------------------------------------------
function makeFakeProvider(): AuthoringProvider {
  return {
    async invoke(opts: { cwd: string; idea: string; branch: string }): Promise<void> {
      // Only write into opts.cwd — the exact cwd authorSpec passes (A.canonicalPath).
      // This provider never references B or C.
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
// Helpers
// ---------------------------------------------------------------------------
function emptyDigest(): LessonDigest {
  return { kickbacks: [], halts: [], retryHotspots: [], narrativeRefs: [] };
}

function makeTarget(repoPath: string, name: string): TargetRepo {
  return { name, canonicalPath: repoPath };
}

// ---------------------------------------------------------------------------
// Shared repos — created once for the entire test suite, cleaned up afterAll
// ---------------------------------------------------------------------------
let repoA: { repoPath: string; defaultBranch: string };
let repoB: { repoPath: string; defaultBranch: string };
let repoC: { repoPath: string; defaultBranch: string };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('authorSpec — cross-repo isolation (Task 21, FR-11)', () => {
  // Set up three independent real git repos before any test runs
  // (declared at module scope so afterAll can clean them up)
  let snapshotBefore: { b: RepoSnapshot; c: RepoSnapshot };
  let authoringResult: Awaited<ReturnType<typeof authorSpec>>;

  // Run the full setup + authorSpec exactly once, then individual tests
  // assert different isolation invariants.
  //
  // Vitest guarantees describe-level beforeAll runs before any `it` in this block.
  // We use a manual setup flag instead of beforeAll to keep everything in one
  // describe without nesting, keeping the test file simple.

  it('setup: creates repos A, B, C and runs authorSpec against A only', async () => {
    // Create three independent git repos
    repoA = await makeGitRepo('A');
    repoB = await makeGitRepo('B');
    repoC = await makeGitRepo('C');

    // Snapshot B and C BEFORE authoring — these are the reference states
    snapshotBefore = {
      b: await snapshotRepo(repoB.repoPath),
      c: await snapshotRepo(repoC.repoPath),
    };

    // Run authorSpec ONLY against A — B and C must remain untouched
    const targetA = makeTarget(repoA.repoPath, 'project-alpha');
    const idea = 'add user authentication';
    authoringResult = await authorSpec(targetA, idea, emptyDigest(), makeFakeProvider());

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

  it('A: .docs/specs, .docs/stories, .docs/plans are committed on the spec branch in A', async () => {
    const tree = await git(
      ['ls-tree', '-r', '--name-only', authoringResult.branch],
      repoA.repoPath,
    );
    expect(tree).toContain('.docs/specs/spec.md');
    expect(tree).toContain('.docs/stories/stories.md');
    expect(tree).toContain('.docs/plans/plan.md');
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
