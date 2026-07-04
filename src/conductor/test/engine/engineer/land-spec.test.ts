// land-spec.test.ts — Story 2 (Slice B): landSpec fails CLOSED on unresolved
// identity (adr-2026-07-01-machine-scoped-operator-identity, D3).
//
// The interim behavior stamps an un-owned spec (`specOwner = null`, the
// `Owner:` line simply omitted) when neither the injected `ownerConfig` nor
// `gh` resolves an id. Slice B Story 2 REVERSES this: an unresolved identity
// must throw BEFORE any write (writeIntakeMarker / git add / git commit), so a
// spec can never reach the daemon un-owned. This file drives `landSpec`
// directly (the real enforcement point) against a per-idea worktree seeded
// with valid Accepted DECIDE artifacts.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { landSpec } from '../../../src/engine/engineer/land-spec.js';
import { createEngineerWorktree } from '../../../src/engine/engineer/worktree-authoring.js';
import type { GhRunner } from '../../../src/engine/owner-gate/identity.js';

const execFile = promisify(execFileCb);

const ACCEPTED_STORIES = [
  '# Stories: dep bump',
  '',
  '**Status:** Accepted',
  '',
  '## Story: bump',
  '### Acceptance Criteria',
  '- Given X, when Y, then Z.',
  '',
].join('\n');

const PLAN_WITH_DEPS = [
  '# Implementation Plan: dep bump',
  '',
  '**Stories:** .docs/stories/dep-bump.md',
  '',
  '## Task Dependency Graph',
  '```',
  '1 → 2',
  '```',
  '',
].join('\n');

/** Stories artifact with a DRAFT ADR present — an "also invalid" artifact set
 *  (Task 8): stories itself is Accepted (so the stories-approval guard alone
 *  doesn't fire first), but a DRAFT ADR under .docs/decisions/ must still
 *  block the land — proving the identity gate holds even when ANOTHER guard
 *  would also refuse.
 */
const DRAFT_ADR = [
  '# ADR: some decision',
  '',
  '**Status:** DRAFT',
  '',
  'Body.',
  '',
].join('\n');

let repoPath: string;

async function git(args: string[], cwd = repoPath): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

function target() {
  return { name: 'alpha', canonicalPath: repoPath };
}

/** Create the per-idea worktree and seed valid Accepted DECIDE artifacts. */
async function seedValidWorktree(idea = 'dep bump'): Promise<string> {
  const wt = await createEngineerWorktree(repoPath, idea);
  const dir = wt.worktreePath;
  await mkdir(join(dir, '.docs', 'specs'), { recursive: true });
  await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
  await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
  await writeFile(join(dir, '.docs', 'specs', 'dep-bump.md'), '# PRD: dep bump\n\nApproved.\n');
  await writeFile(join(dir, '.docs', 'stories', 'dep-bump.md'), ACCEPTED_STORIES);
  await writeFile(join(dir, '.docs', 'plans', 'dep-bump.md'), PLAN_WITH_DEPS);
  return dir;
}

/** Same as above, but also seeds an invalid (DRAFT) ADR under .docs/decisions/. */
async function seedWorktreeWithDraftAdr(idea = 'dep bump'): Promise<string> {
  const dir = await seedValidWorktree(idea);
  await mkdir(join(dir, '.docs', 'decisions'), { recursive: true });
  await writeFile(join(dir, '.docs', 'decisions', 'adr-draft.md'), DRAFT_ADR);
  return dir;
}

/** gh runner that never resolves a login (simulates unauthenticated/uninjected gh). */
const failingGh: GhRunner = async () => {
  throw new Error('gh: not logged in');
};

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'land-spec-'));
  await git(['init', '-q']);
  await git(['config', 'user.email', 'test@test.com']);
  await git(['config', 'user.name', 'Test']);
  await writeFile(join(repoPath, 'README.md'), '# repo\n');
  await git(['add', 'README.md']);
  await git(['commit', '-m', 'init']);
});

afterEach(async () => {
  await rm(repoPath, { recursive: true, force: true });
});

describe('landSpec fails closed on unresolved identity (Slice B Story 2, D3)', () => {
  it('Task 5: rejects (throws) when identity is unresolved, in a worktree with valid Accepted artifacts', async () => {
    const worktree = await seedValidWorktree();

    await expect(
      landSpec(target(), 'dep bump', worktree, undefined, { ownerConfig: {}, gh: failingGh }),
    ).rejects.toThrow();
  });

  it('Task 5: error message contains BOTH remediation strings verbatim', async () => {
    const worktree = await seedValidWorktree();

    let caught: Error | null = null;
    try {
      await landSpec(target(), 'dep bump', worktree, undefined, { ownerConfig: {}, gh: failingGh });
    } catch (e) {
      caught = e instanceof Error ? e : new Error(String(e));
    }

    expect(caught).not.toBeNull();
    expect(caught!.message).toContain('~/.ai-conductor/config.yml');
    expect(caught!.message).toContain('gh auth login');
  });

  it('Task 7: no-write contract — no marker, nothing staged, no new commit, worktree retained', async () => {
    const worktree = await seedValidWorktree();
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], worktree);
    const headBefore = await git(['rev-parse', 'HEAD'], worktree);
    const logCountBefore = (await git(['log', '--oneline'], worktree)).split('\n').filter(Boolean).length;

    await expect(
      landSpec(target(), 'dep bump', worktree, undefined, { ownerConfig: {}, gh: failingGh }),
    ).rejects.toThrow();

    // No intake marker committed or staged.
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(worktree, '.docs', 'intake', 'dep-bump.md'))).toBe(false);

    // Nothing staged — `git status --porcelain` shows the pre-existing untracked
    // .docs artifacts (allowed pre-land) but no NEW staged/tracked changes.
    const porcelain = await git(['status', '--porcelain'], worktree);
    const stagedLines = porcelain
      .split('\n')
      .filter((l) => l.trim() !== '')
      .filter((l) => l[0] !== ' ' && l[0] !== '?'); // staged/tracked-modified prefixes
    expect(stagedLines).toHaveLength(0);

    // HEAD / commit count on the worktree's branch unchanged — no new commit.
    const headAfter = await git(['rev-parse', 'HEAD'], worktree);
    const logCountAfter = (await git(['log', '--oneline'], worktree)).split('\n').filter(Boolean).length;
    expect(headAfter).toBe(headBefore);
    expect(logCountAfter).toBe(logCountBefore);

    // The worktree directory + its branch are still present (keep-on-failure, FR-6).
    expect(existsSync(worktree)).toBe(true);
    const branches = await git(['branch', '--list', branch], repoPath);
    expect(branches).toContain(branch.replace('spec/', ''));
  });

  it('Task 8: fail-closed ordering — refuses with no writes even when artifacts are ALSO invalid (DRAFT ADR present)', async () => {
    const worktree = await seedWorktreeWithDraftAdr();
    const headBefore = await git(['rev-parse', 'HEAD'], worktree);

    let caught: Error | null = null;
    try {
      await landSpec(target(), 'dep bump', worktree, undefined, { ownerConfig: {}, gh: failingGh });
    } catch (e) {
      caught = e instanceof Error ? e : new Error(String(e));
    }

    // Refuses (some error) — and per the identity-first ordering, the SAME
    // identity remediation text fires, not the ADR-DRAFT guard's message,
    // proving the identity gate runs before/independent of artifact guards.
    expect(caught).not.toBeNull();
    expect(caught!.message).toContain('~/.ai-conductor/config.yml');
    expect(caught!.message).toContain('gh auth login');

    // Same no-write contract as Task 7.
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(worktree, '.docs', 'intake', 'dep-bump.md'))).toBe(false);
    const headAfter = await git(['rev-parse', 'HEAD'], worktree);
    expect(headAfter).toBe(headBefore);
  });

  it('happy-path regression: resolved identity still lands successfully (no regression)', async () => {
    const worktree = await seedValidWorktree();
    const gh: GhRunner = async () => ({ stdout: 'bob\n' });

    const result = await landSpec(target(), 'dep bump', worktree, undefined, { ownerConfig: {}, gh });

    const { stdout: marker } = await execFile(
      'git',
      ['show', `${result.branch}:.docs/intake/dep-bump.md`],
      { cwd: worktree },
    );
    expect(marker).toContain('Owner: bob');
  });

  it('Task 4: no-source-ref variant still owner-stamps the marker under the plan stem (not the idea slug)', async () => {
    // Idea text slugifies to "dep-bump", but the plan artifact's filename stem
    // is "2026-07-03-feature" — a chat/CLI idea whose slug diverges from the
    // plan file name. planStem(planFile) must win regardless.
    const idea = 'dep bump';
    const worktree = await seedValidWorktree(idea);
    await writeFile(join(worktree, '.docs', 'plans', 'dep-bump.md'), '');
    await rm(join(worktree, '.docs', 'plans', 'dep-bump.md'), { force: true });
    await writeFile(join(worktree, '.docs', 'plans', '2026-07-03-feature.md'), PLAN_WITH_DEPS);

    const gh: GhRunner = async () => ({ stdout: 'carol\n' });

    // sourceRef is explicitly undefined — the no-source-ref (chat/CLI idea) variant.
    const result = await landSpec(target(), idea, worktree, undefined, { ownerConfig: {}, gh });

    const { stdout: marker } = await execFile(
      'git',
      ['show', `${result.branch}:.docs/intake/2026-07-03-feature.md`],
      { cwd: worktree },
    );
    expect(marker).toContain('Owner: carol');
    expect(marker).not.toContain('Source-Ref:');
  });

  it('Task 7 (negative): multi-plan worktree keys the marker to the NEWEST resolved plan only', async () => {
    // Two plans exist under .docs/plans/: an older one that must NOT win, and
    // a newer one (backdated the older, not the newer) that findNewestFile()
    // must select. planStem(planFile) then keys the marker to that newest
    // plan's stem — proving the newest-plan resolution composes correctly
    // even when another plan is present to create ambiguity.
    const idea = 'this idea';
    const worktree = await seedValidWorktree(idea);

    // Replace the default same-named plan with two explicitly-dated plans.
    // (seedValidWorktree always seeds specs/stories/plans under a fixed
    // "dep-bump" filename regardless of the idea text.)
    await rm(join(worktree, '.docs', 'plans', 'dep-bump.md'), { force: true });

    const olderPlanPath = join(worktree, '.docs', 'plans', 'other-idea.md');
    await writeFile(olderPlanPath, PLAN_WITH_DEPS);
    const oldDate = new Date('2020-01-01T00:00:00Z');
    await utimes(olderPlanPath, oldDate, oldDate);

    const newerPlanPath = join(worktree, '.docs', 'plans', '2026-07-03-this-idea.md');
    await writeFile(newerPlanPath, PLAN_WITH_DEPS);
    const newDate = new Date();
    await utimes(newerPlanPath, newDate, newDate);

    const gh: GhRunner = async () => ({ stdout: 'dana\n' });

    const result = await landSpec(target(), idea, worktree, 'acme/widgets#42', { ownerConfig: {}, gh });

    // Marker lands ONLY at the newest plan's stem.
    const { stdout: marker } = await execFile(
      'git',
      ['show', `${result.branch}:.docs/intake/2026-07-03-this-idea.md`],
      { cwd: worktree },
    );
    expect(marker).toContain('Owner: dana');
    expect(marker).toContain('Source-Ref: acme/widgets#42');

    // The older plan's stem must NOT have a marker of its own.
    await expect(
      execFile('git', ['show', `${result.branch}:.docs/intake/other-idea.md`], { cwd: worktree }),
    ).rejects.toThrow();
  });

  it('Task 5: retry preserves pre-existing Source-Ref under the new plan-stem key', async () => {
    const worktree = await seedValidWorktree();
    await mkdir(join(worktree, '.docs', 'intake'), { recursive: true });
    await writeFile(
      join(worktree, '.docs', 'intake', 'dep-bump.md'),
      ['# Intake origin: dep-bump', '', 'Source-Ref: owner/repo#9', ''].join('\n'),
    );
    const gh: GhRunner = async () => ({ stdout: 'bob\n' });

    const result = await landSpec(target(), 'dep bump', worktree, undefined, { ownerConfig: {}, gh });

    const { stdout: marker } = await execFile(
      'git',
      ['show', `${result.branch}:.docs/intake/dep-bump.md`],
      { cwd: worktree },
    );
    expect(marker).toContain('Source-Ref: owner/repo#9');
    expect(marker).toContain('Owner: bob');
  });

  it('Task 6 (negative): no plan file → landSpec throws loudly and creates NO marker under any name', async () => {
    // Seed a worktree with .docs/stories/ and .docs/specs/ but deliberately
    // omit .docs/plans/ entirely (not even the directory exists) — the C2
    // guard (line ~197) must reject before writeIntakeMarker() ever runs.
    const idea = 'dep bump';
    const worktree = await createEngineerWorktree(repoPath, idea);
    const dir = worktree.worktreePath;
    await mkdir(join(dir, '.docs', 'specs'), { recursive: true });
    await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
    await writeFile(join(dir, '.docs', 'specs', 'dep-bump.md'), '# PRD: dep bump\n\nApproved.\n');
    await writeFile(join(dir, '.docs', 'stories', 'dep-bump.md'), ACCEPTED_STORIES);
    // No .docs/plans/ directory at all.

    const headBefore = await git(['rev-parse', 'HEAD'], dir);
    const logCountBefore = (await git(['log', '--oneline'], dir)).split('\n').filter(Boolean).length;
    const gh: GhRunner = async () => ({ stdout: 'bob\n' });

    let caught: Error | null = null;
    try {
      await landSpec(target(), idea, dir, undefined, { ownerConfig: {}, gh });
    } catch (e) {
      caught = e instanceof Error ? e : new Error(String(e));
    }

    // Fails loudly — throws, does not silently pass.
    expect(caught).not.toBeNull();
    expect(caught!.message.toLowerCase()).toContain('plan');

    // No marker file under EITHER naming scheme (plan-stem or idea-slug).
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(dir, '.docs', 'intake', 'dep-bump.md'))).toBe(false);
    expect(existsSync(join(dir, '.docs', 'intake'))).toBe(false);

    // No git commits created — fails before any write.
    const headAfter = await git(['rev-parse', 'HEAD'], dir);
    const logCountAfter = (await git(['log', '--oneline'], dir)).split('\n').filter(Boolean).length;
    expect(headAfter).toBe(headBefore);
    expect(logCountAfter).toBe(logCountBefore);
  });

  it('T18: all artifacts already checkpoint-committed → land succeeds idempotently with no new commit', async () => {
    const worktree = await seedValidWorktree();
    const gh: GhRunner = async () => ({ stdout: 'bob\n' });

    // Simulate the T16 checkpoint having already committed the full .docs tree
    // (including the intake marker land would otherwise write) onto this branch.
    const { writeIntakeMarker } = await import('../../../src/engine/engineer/intake-marker.js');
    const { AuthoringGuard } = await import('../../../src/engine/engineer/authoring-guard.js');
    const guard = new AuthoringGuard(repoPath);
    await writeIntakeMarker(worktree, 'dep-bump', undefined, 'bob', guard);
    await git(['add', '.docs'], worktree);
    await git(['commit', '-m', 'checkpoint: T16 pre-commit .docs artifacts'], worktree);

    const headBefore = await git(['rev-parse', 'HEAD'], worktree);
    const logCountBefore = (await git(['log', '--oneline'], worktree)).split('\n').filter(Boolean).length;

    const result = await landSpec(target(), 'dep bump', worktree, undefined, { ownerConfig: {}, gh });

    const headAfter = await git(['rev-parse', 'HEAD'], worktree);
    const logCountAfter = (await git(['log', '--oneline'], worktree)).split('\n').filter(Boolean).length;

    // No new commit was created — land detected everything was already staged/committed.
    expect(headAfter).toBe(headBefore);
    expect(logCountAfter).toBe(logCountBefore);

    // The result is still the same well-formed JSON shape as a fresh land.
    expect(result.slug).toBe('dep-bump');
    expect(result.repoPath).toBe(worktree);

    const { stdout: marker } = await execFile(
      'git',
      ['show', `${result.branch}:.docs/intake/dep-bump.md`],
      { cwd: worktree },
    );
    expect(marker).toContain('Owner: bob');
  });

  it('T18: partial checkpoint → land commits exactly the remainder', async () => {
    const worktree = await seedValidWorktree();
    const gh: GhRunner = async () => ({ stdout: 'bob\n' });

    // Simulate T16 having checkpoint-committed only the specs/stories artifacts,
    // leaving the plan artifact (and the intake marker) to be committed by land.
    await git(['add', '.docs/specs', '.docs/stories'], worktree);
    await git(['commit', '-m', 'checkpoint: T16 pre-commit specs+stories'], worktree);

    const logCountBefore = (await git(['log', '--oneline'], worktree)).split('\n').filter(Boolean).length;

    const result = await landSpec(target(), 'dep bump', worktree, undefined, { ownerConfig: {}, gh });

    const logCountAfter = (await git(['log', '--oneline'], worktree)).split('\n').filter(Boolean).length;

    // Exactly one new commit lands the remainder (plan + intake marker).
    expect(logCountAfter).toBe(logCountBefore + 1);

    // No dirty/staged changes remain after landing.
    const porcelain = await git(['status', '--porcelain'], worktree);
    expect(porcelain.trim()).toBe('');

    // The plan and the marker are both present at HEAD on the landed branch.
    const { stdout: plan } = await execFile(
      'git',
      ['show', `${result.branch}:.docs/plans/dep-bump.md`],
      { cwd: worktree },
    );
    expect(plan).toContain('Implementation Plan: dep bump');

    const { stdout: marker } = await execFile(
      'git',
      ['show', `${result.branch}:.docs/intake/dep-bump.md`],
      { cwd: worktree },
    );
    expect(marker).toContain('Owner: bob');
  });
});
