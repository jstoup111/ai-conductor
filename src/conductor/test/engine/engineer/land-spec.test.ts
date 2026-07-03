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
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
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
});
