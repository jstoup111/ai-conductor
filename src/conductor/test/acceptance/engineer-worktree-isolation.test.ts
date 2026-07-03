// engineer-worktree-isolation.test.ts — the isolation invariants (FR-2, FR-5..FR-11),
// exercised against REAL git repos (the external-git contract cannot be trusted to an
// injected-runner argv test alone — injected-runner-needs-real-binary lesson).
//
// Covers:
//   - FR-7 strict-abort: an unborn-HEAD repo (no derivable default branch) aborts with a
//     clear message and makes ZERO mutation to the primary tree — no seed commit.
//   - FR-2 primary-tree-untouched: HEAD ref + `git status --porcelain` are byte-equal
//     before/after a successful cycle, a failed land, and an abort.
//   - FR-6 keep-on-failure / FR-5 remove-on-success (+ branch reachable).
//   - FR-8 concurrent actors: two per-idea worktrees → each spec commit is idea-scoped.
//   - FR-10 sibling repos byte-for-byte unchanged.
//   - FR-11 leftover reconcile (reused / attached-dangling-branch / dirty-surfaced).
//   - A real-git smoke test of the full create→land→handoff(no-remote)→remove lifecycle.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import {
  createEngineerWorktree,
  removeEngineerWorktree,
  engineerWorktreePath,
} from '../../src/engine/engineer/worktree-authoring.js';
import { landSpec } from '../../src/engine/engineer/land-spec.js';
import { openSpecPr } from '../../src/engine/engineer/handoff.js';

const execFile = promisify(execFileCb);

// Owner-identity opts for landSpec (fail-closed slice B): a configured owner so
// the identity gate resolves and each test still exercises its own concern.
const OWNER_OPTS = { ownerConfig: { spec_owner: 'test-owner' } };

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'wt-isolation-'));
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

/** A repo with one commit on main, gitignoring `.worktrees/` (the harness convention). */
async function makeRepo(name: string): Promise<string> {
  const repo = join(workDir, name);
  await mkdir(repo, { recursive: true });
  await git(['init', '-b', 'main'], repo);
  await git(['config', 'user.email', 't@t.t'], repo);
  await git(['config', 'user.name', 't'], repo);
  await writeFile(join(repo, 'README.md'), `# ${name}\n`);
  await writeFile(join(repo, '.gitignore'), '.worktrees/\n');
  await git(['add', '-A'], repo);
  await git(['commit', '-m', 'init'], repo);
  return repo;
}

/** An empty repo with an UNBORN HEAD (no commits) — no derivable default branch. */
async function makeEmptyRepo(name: string): Promise<string> {
  const repo = join(workDir, name);
  await mkdir(repo, { recursive: true });
  await git(['init', '-b', 'main'], repo);
  await git(['config', 'user.email', 't@t.t'], repo);
  await git(['config', 'user.name', 't'], repo);
  return repo;
}

const slugOf = (idea: string) =>
  idea.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);

async function writeDocs(dir: string, idea: string): Promise<void> {
  const slug = slugOf(idea);
  for (const d of ['specs', 'stories', 'plans']) {
    await mkdir(join(dir, '.docs', d), { recursive: true });
  }
  await writeFile(join(dir, '.docs', 'specs', `${slug}.md`), `# PRD: ${idea}\n\nApproved.\n`);
  await writeFile(
    join(dir, '.docs', 'stories', `${slug}.md`),
    `# Stories: ${idea}\n\n**Status:** Accepted\n\n## Story: s\n\n### AC\n- Given a, when b, then c.\n`,
  );
  await writeFile(join(dir, '.docs', 'plans', `${slug}.md`), `# Plan: ${idea}\n\n### Task 1\n**Dependencies:** none\n`);
}

/** A byte-comparable snapshot of the primary tree's git identity. */
async function snapshot(repo: string): Promise<{ head: string; refs: string; status: string }> {
  const head = await git(['rev-parse', 'HEAD'], repo).catch(() => '<unborn>');
  const refs = await git(['show-ref'], repo).catch(() => '');
  const status = await git(['status', '--porcelain'], repo).catch(() => '');
  return { head, refs, status };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

const target = (repo: string) => ({ name: 'target', canonicalPath: repo });

// ── FR-7: strict abort ──────────────────────────────────────────────────────────

describe('FR-7 strict abort — no primary-tree mutation', () => {
  it('unborn HEAD (zero commits) → aborts with a clear message, seeds NO commit', async () => {
    const repo = await makeEmptyRepo('empty');
    const before = await snapshot(repo);

    await expect(createEngineerWorktree(repo, 'first idea')).rejects.toThrow(
      /abort|worktree|default branch|derive|commit/i,
    );

    // Byte-for-byte unchanged: still unborn, no branch seeded, no worktree dir.
    expect(await snapshot(repo)).toEqual(before);
    expect(await git(['branch', '--list'], repo)).toBe('');
    expect(await pathExists(engineerWorktreePath(repo, 'first-idea'))).toBe(false);
  });
});

// ── FR-2: primary tree untouched across success / failure / abort ────────────────

describe('FR-2 primary working tree is invariant', () => {
  it('is byte-equal (HEAD + refs + status) after a full successful cycle', async () => {
    const repo = await makeRepo('r');
    const before = await snapshot(repo);

    const wt = await createEngineerWorktree(repo, 'add auth');
    await writeDocs(wt.worktreePath, 'add auth');
    await landSpec(target(repo), 'add auth', wt.worktreePath, undefined, OWNER_OPTS);
    // no-remote handoff (openSpecPr detects it) then remove-on-success.
    const res = await openSpecPr(target(repo), wt.branch, {
      worktreePath: wt.worktreePath,
      runner: async () => {
        throw new Error('no git remotes found');
      },
      ledgerOpts: { engineerDir: join(workDir, 'eng') },
    });
    expect(res.kind).toBe('pr-skipped');
    await removeEngineerWorktree(repo, wt.worktreePath);

    const after = await snapshot(repo);
    // The spec branch was added (a ref), but HEAD, the primary branch, and the working
    // tree are unchanged. Compare HEAD + status exactly; refs gain only spec/add-auth.
    expect(after.head).toBe(before.head);
    expect(after.status).toBe(before.status);
    expect(await git(['rev-parse', '--abbrev-ref', 'HEAD'], repo)).toBe('main');
    // The branch persists and is reachable (FR-5).
    expect(await git(['rev-parse', '--verify', 'spec/add-auth'], repo)).toMatch(/^[0-9a-f]{40}$/);
  });

  it('is byte-equal after a FAILED land (worktree kept, FR-6)', async () => {
    const repo = await makeRepo('r');
    const before = await snapshot(repo);
    const wt = await createEngineerWorktree(repo, 'bad idea'); // no docs authored
    await expect(landSpec(target(repo), 'bad idea', wt.worktreePath, undefined, OWNER_OPTS)).rejects.toThrow();

    const after = await snapshot(repo);
    expect(after.head).toBe(before.head);
    // `.worktrees/` is gitignored, so the kept worktree does not dirty the primary tree.
    expect(after.status).toBe(before.status);
    // Keep-on-failure: worktree remains for inspection.
    expect(await pathExists(wt.worktreePath)).toBe(true);
  });

  it('is byte-for-byte unchanged after an abort (unborn HEAD)', async () => {
    const repo = await makeEmptyRepo('e');
    const before = await snapshot(repo);
    await expect(createEngineerWorktree(repo, 'x')).rejects.toThrow();
    expect(await snapshot(repo)).toEqual(before);
  });
});

// ── FR-8 + FR-9: concurrent actors, idea-scoped commits ─────────────────────────

describe('FR-8/FR-9 concurrent per-idea worktrees are idea-scoped', () => {
  it('two overlapping worktrees each commit ONLY their own idea (no cross-bleed)', async () => {
    const repo = await makeRepo('r');
    const a = await createEngineerWorktree(repo, 'idea alpha');
    const b = await createEngineerWorktree(repo, 'idea beta');
    await writeDocs(a.worktreePath, 'idea alpha');
    await writeDocs(b.worktreePath, 'idea beta');

    await landSpec(target(repo), 'idea alpha', a.worktreePath, undefined, OWNER_OPTS);
    await landSpec(target(repo), 'idea beta', b.worktreePath, undefined, OWNER_OPTS);

    const aFiles = await git(['ls-tree', '-r', '--name-only', 'spec/idea-alpha'], repo);
    const bFiles = await git(['ls-tree', '-r', '--name-only', 'spec/idea-beta'], repo);
    // Each spec commit carries its own slug's artifacts and NOT the other's.
    expect(aFiles).toMatch(/idea-alpha\.md/);
    expect(aFiles).not.toMatch(/idea-beta\.md/);
    expect(bFiles).toMatch(/idea-beta\.md/);
    expect(bFiles).not.toMatch(/idea-alpha\.md/);
  });

  it('a coexisting DAEMON worktree survives a full engineer cycle untouched (FR-8 daemon path)', async () => {
    const repo = await makeRepo('r');
    // Stand up a daemon-style worktree exactly as daemon-deps.createWorktree would:
    // `.worktrees/<slug>` on `feat/daemon-<slug>`, disjoint from the engineer's
    // `.worktrees/engineer-<slug>`. Give it in-progress build state to detect any bleed.
    const daemonPath = join(repo, '.worktrees', 'shipping-thing');
    await git(['worktree', 'add', '-b', 'feat/daemon-shipping-thing', daemonPath, 'main'], repo);
    await writeFile(join(daemonPath, 'build-artifact.txt'), 'daemon mid-build\n');
    const daemonHeadBefore = await git(['rev-parse', 'HEAD'], daemonPath);
    const daemonStatusBefore = await git(['status', '--porcelain'], daemonPath);
    const primaryBefore = await snapshot(repo);

    // Run a FULL engineer cycle for an unrelated idea in the SAME repo.
    const wt = await createEngineerWorktree(repo, 'add feature');
    await writeDocs(wt.worktreePath, 'add feature');
    await landSpec(target(repo), 'add feature', wt.worktreePath, undefined, OWNER_OPTS);
    await openSpecPr(target(repo), wt.branch, {
      worktreePath: wt.worktreePath,
      runner: async () => {
        throw new Error('no git remotes found');
      },
      ledgerOpts: { engineerDir: join(workDir, 'eng') },
    });
    await removeEngineerWorktree(repo, wt.worktreePath);

    // The daemon's worktree, its branch, and its in-progress build state are untouched.
    expect(await pathExists(daemonPath)).toBe(true);
    expect(await git(['rev-parse', 'HEAD'], daemonPath)).toBe(daemonHeadBefore);
    expect(await git(['status', '--porcelain'], daemonPath)).toBe(daemonStatusBefore);
    expect(await git(['rev-parse', '--abbrev-ref', 'HEAD'], daemonPath)).toBe('feat/daemon-shipping-thing');
    // …and the primary tree is byte-equal.
    const primaryAfter = await snapshot(repo);
    expect(primaryAfter.head).toBe(primaryBefore.head);
    expect(primaryAfter.status).toBe(primaryBefore.status);
  });
});

// ── FR-10: sibling repos untouched ──────────────────────────────────────────────

describe('FR-10 sibling repos are byte-for-byte unchanged', () => {
  it('a full cycle on repo A leaves sibling B identical, incl. after abort', async () => {
    const a = await makeRepo('A');
    const b = await makeRepo('B');
    const bBefore = await snapshot(b);

    const wt = await createEngineerWorktree(a, 'feature');
    await writeDocs(wt.worktreePath, 'feature');
    await landSpec(target(a), 'feature', wt.worktreePath, undefined, OWNER_OPTS);
    expect(await snapshot(b)).toEqual(bBefore);

    // The worktree path stays inside A.
    expect(wt.worktreePath.startsWith(a)).toBe(true);

    // An abort on a fresh empty sibling-adjacent repo also leaves B untouched.
    const empty = await makeEmptyRepo('C');
    await expect(createEngineerWorktree(empty, 'z')).rejects.toThrow();
    expect(await snapshot(b)).toEqual(bBefore);
  });
});

// ── FR-11: leftover reconcile ───────────────────────────────────────────────────

describe('FR-11 leftover worktree/branch reconcile', () => {
  it('reuses an existing clean worktree and reports reconcile=reused', async () => {
    const repo = await makeRepo('r');
    const first = await createEngineerWorktree(repo, 'retry idea');
    expect(first.reconcile).toBe('created');
    const second = await createEngineerWorktree(repo, 'retry idea');
    expect(second.reconcile).toBe('reused');
    expect(second.worktreePath).toBe(first.worktreePath);
  });

  it('reattaches a dangling branch whose worktree was removed (reconcile=attached)', async () => {
    const repo = await makeRepo('r');
    const first = await createEngineerWorktree(repo, 'dangling idea');
    // Remove the worktree dir registration but keep the branch (dangling-branch case).
    await removeEngineerWorktree(repo, first.worktreePath);
    expect(await git(['rev-parse', '--verify', 'spec/dangling-idea'], repo)).toMatch(/^[0-9a-f]{40}$/);

    const again = await createEngineerWorktree(repo, 'dangling idea');
    expect(again.reconcile).toBe('attached');
    expect(await pathExists(again.worktreePath)).toBe(true);
  });

  it('surfaces a DIRTY leftover worktree rather than silently reusing stale artifacts', async () => {
    const repo = await makeRepo('r');
    const wt = await createEngineerWorktree(repo, 'dirty leftover');
    // Dirty a tracked file in the leftover worktree.
    await writeFile(join(wt.worktreePath, 'README.md'), '# tampered\n');

    await expect(createEngineerWorktree(repo, 'dirty leftover')).rejects.toThrow(/dirty|stale|remove/i);
  });
});

// ── Real-git smoke: the full lifecycle end-to-end ───────────────────────────────

describe('real-git smoke: create → land → handoff(no-remote) → remove', () => {
  it('leaves the worktree gone, spec/<slug> reachable, primary tree untouched', async () => {
    const repo = await makeRepo('smoke');
    const before = await snapshot(repo);
    const idea = 'smoke feature';

    const wt = await createEngineerWorktree(repo, idea);
    await writeDocs(wt.worktreePath, idea);
    const landed = await landSpec(target(repo), idea, wt.worktreePath, undefined, OWNER_OPTS);
    expect(landed.branch).toBe('spec/smoke-feature');

    const res = await openSpecPr(target(repo), wt.branch, {
      worktreePath: wt.worktreePath,
      runner: async () => {
        throw new Error('no git remotes found');
      },
      ledgerOpts: { engineerDir: join(workDir, 'eng') },
    });
    expect(res.kind).toBe('pr-skipped'); // no-remote local-commit fallback

    await removeEngineerWorktree(repo, wt.worktreePath);

    // Worktree gone.
    expect(await pathExists(wt.worktreePath)).toBe(false);
    // spec/<slug> commit still reachable (removing a worktree never orphans its branch).
    expect(await git(['rev-parse', '--verify', 'spec/smoke-feature'], repo)).toMatch(/^[0-9a-f]{40}$/);
    expect(await git(['log', '--oneline', 'spec/smoke-feature'], repo)).toMatch(/engineer\/land/);
    // Primary tree untouched.
    const after = await snapshot(repo);
    expect(after.head).toBe(before.head);
    expect(after.status).toBe(before.status);
    expect(await git(['rev-parse', '--abbrev-ref', 'HEAD'], repo)).toBe('main');
  });
});
