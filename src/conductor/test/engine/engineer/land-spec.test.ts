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
import { landSpec, resolveIdeaFiles } from '../../../src/engine/engineer/land-spec.js';
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
  await git(['init', '-b', 'main', '-q']);
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

  describe('#810: mermaid render hard gate', () => {
    const okGh: GhRunner = async () => ({ stdout: 'bob\n' });
    const seedDiagram = async (worktree: string) => {
      await mkdir(join(worktree, '.docs', 'architecture'), { recursive: true });
      await writeFile(
        join(worktree, '.docs', 'architecture', 'diagram.md'),
        '# Arch\n\n```mermaid\nflowchart TD\n  A --> B\n```\n',
      );
    };
    const deps = (over: Partial<{ hasTool: boolean; ok: boolean; error: string }>) => ({
      hasTool: async () => over.hasTool ?? true,
      writeTemp: async () => '/tmp/check.mmd',
      runMmdc: async () => ({ ok: over.ok ?? true, error: over.error }),
    });

    it('rejects a spec whose mermaid diagram fails to render', async () => {
      const worktree = await seedValidWorktree();
      await seedDiagram(worktree);
      await expect(
        landSpec(target(), 'dep bump', worktree, undefined, {
          ownerConfig: {}, gh: okGh,
          renderDeps: deps({ ok: false, error: 'Parse error on line 2: unexpected token' }),
        }),
      ).rejects.toThrow(/fails to render/);
    });

    it('fail-closed: rejects when diagrams are present but mmdc is unavailable', async () => {
      const worktree = await seedValidWorktree();
      await seedDiagram(worktree);
      await expect(
        landSpec(target(), 'dep bump', worktree, undefined, {
          ownerConfig: {}, gh: okGh, renderDeps: deps({ hasTool: false }),
        }),
      ).rejects.toThrow(/cannot be validated|mmdc.*not installed/i);
    });

    it('lands when every mermaid diagram renders', async () => {
      const worktree = await seedValidWorktree();
      await seedDiagram(worktree);
      const result = await landSpec(target(), 'dep bump', worktree, undefined, {
        ownerConfig: {}, gh: okGh, renderDeps: deps({ ok: true }),
      });
      expect(result.slug).toBeTruthy();
    });

    it('checks only THIS idea’s changed files — an inherited COMMITTED diagram is not re-validated', async () => {
      const worktree = await seedValidWorktree();
      // A pre-existing, COMMITTED diagram carrying a mermaid block — stands in for
      // the target's inherited `.docs/` history. It must NOT be re-litigated.
      await mkdir(join(worktree, '.docs', 'architecture'), { recursive: true });
      await writeFile(
        join(worktree, '.docs', 'architecture', 'legacy.md'),
        '# Legacy\n\n```mermaid\nflowchart TD\n  A --> B\n```\n',
      );
      await execFile('git', ['add', '.docs/architecture/legacy.md'], { cwd: worktree });
      await execFile('git', ['commit', '-m', 'legacy diagram'], { cwd: worktree });

      // renderDeps would FAIL *any* diagram it checks. This idea's own new
      // artifacts carry no mermaid — so a successful land proves the committed
      // legacy diagram was never checked (only changed files are).
      const result = await landSpec(target(), 'dep bump', worktree, undefined, {
        ownerConfig: {}, gh: okGh, renderDeps: deps({ ok: false, error: 'would fail if checked' }),
      });
      expect(result.slug).toBeTruthy();
    });
  });

  it('#505 Task 8: landSpec commits CONDUCT_ENGINE_COMMIT=1 — lands trailer-less under an active commit-msg gate', async () => {
    // Wire the real commit-msg hook + a build-step-active marker WITHOUT
    // using prepareWorktree (it writes .env/.claude/.pipeline files that
    // landSpec's own dirty-guard rejects as untracked). Instead, write the
    // hook scripts to a location OUTSIDE the worktree and point
    // core.hooksPath at it directly — the worktree tree itself stays clean.
    // If landSpec's `git commit` did NOT set CONDUCT_ENGINE_COMMIT=1, this
    // commit would fail closed; the fact it lands proves the marker is set.
    const { PREPARE_COMMIT_MSG_HOOK, COMMIT_MSG_HOOK } = await import('../../../src/engine/git-hook-assets.js');
    const worktree = await seedValidWorktree();

    // Commit the marker BEFORE the hook is wired (so it's tracked-and-clean,
    // and this seed commit itself predates enforcement — untracked files
    // outside .docs/ would otherwise trip landSpec's own dirty-tree guard).
    await mkdir(join(worktree, '.pipeline'), { recursive: true });
    await writeFile(join(worktree, '.pipeline', 'build-step-active'), 'active\n');
    await git(['add', '.pipeline/build-step-active'], worktree);
    await git(['commit', '-m', 'test: seed build-step-active marker'], worktree);

    const hooksDir = await mkdtemp(join(tmpdir(), 'land-spec-task8-hooks-'));
    const prepareCommitMsgPath = join(hooksDir, 'prepare-commit-msg');
    const commitMsgPath = join(hooksDir, 'commit-msg');
    await writeFile(prepareCommitMsgPath, PREPARE_COMMIT_MSG_HOOK, 'utf-8');
    await writeFile(commitMsgPath, COMMIT_MSG_HOOK, 'utf-8');
    await execFile('chmod', ['+x', prepareCommitMsgPath, commitMsgPath]);
    await git(['config', 'extensions.worktreeConfig', 'true'], worktree);
    await git(['config', '--worktree', 'core.hooksPath', hooksDir], worktree);

    const gh: GhRunner = async () => ({ stdout: 'bob\n' });
    const result = await landSpec(target(), 'dep bump', worktree, undefined, { ownerConfig: {}, gh });

    const subject = await git(['log', '-1', '--format=%s'], worktree);
    expect(subject).toContain('spec: land authored artifacts for "dep bump"');
    expect(result.branch).toBeTruthy();

    await rm(hooksDir, { recursive: true, force: true });
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

  it('Story 4 (generalize-source-ref): landSpec with a Jira sourceRef commits the marker with Source-Ref: PROJ-123 verbatim', async () => {
    // Multi-step acceptance flow for a Jira-originated idea: landSpec writes
    // the intake marker, commits it, and the committed content round-trips the
    // Jira key losslessly — today writeIntakeMarker validates via the
    // GitHub-only parseSourceRef (issue-ref.ts), so a Jira ref is treated as
    // "no usable sourceRef" and the Source-Ref: line is silently omitted. This
    // acceptance test is RED until intake-marker.ts switches its validity
    // check to parseWorkRef (Task 7 of the implementation plan).
    const worktree = await seedValidWorktree();
    const gh: GhRunner = async () => ({ stdout: 'bob\n' });

    const result = await landSpec(target(), 'dep bump', worktree, 'PROJ-123', {
      ownerConfig: {},
      gh,
    });

    const { stdout: marker } = await execFile(
      'git',
      ['show', `${result.branch}:.docs/intake/dep-bump.md`],
      { cwd: worktree },
    );
    expect(marker).toContain('Source-Ref: PROJ-123');
    expect(marker).toContain('Owner: bob');
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
});

describe('resolveIdeaFiles (Task 1: idea-scoped artifact attribution)', () => {
  it('returns exactly the committed + untracked idea artifacts, excluding a legacy file on main', async () => {
    // Seed a legacy artifact committed on `main` BEFORE the worktree is created.
    await mkdir(join(repoPath, '.docs', 'plans'), { recursive: true });
    await writeFile(join(repoPath, '.docs', 'plans', 'legacy.md'), '# legacy plan\n');
    await git(['add', '.docs']);
    await git(['commit', '-m', 'legacy plan on main']);

    const idea = 'dep bump';
    const worktree = await createEngineerWorktree(repoPath, idea);
    const dir = worktree.worktreePath;

    // One artifact committed on the idea's spec/<slug> branch.
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await writeFile(join(dir, '.docs', 'plans', 'dep-bump.md'), PLAN_WITH_DEPS);
    await git(['add', '.docs'], dir);
    await git(['commit', '-m', 'idea plan'], dir);

    // Another artifact left untracked in the worktree.
    await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
    await writeFile(join(dir, '.docs', 'stories', 'dep-bump.md'), ACCEPTED_STORIES);

    const ideaFiles = await resolveIdeaFiles(dir, repoPath);

    expect(ideaFiles).toEqual(new Set(['.docs/plans/dep-bump.md', '.docs/stories/dep-bump.md']));
    expect(ideaFiles.has('.docs/plans/legacy.md')).toBe(false);
  });
});

describe('Task 2: idea-scoped track+spec pickers (#488)', () => {
  it('technical-track worktree lands clean even when a legacy DRAFT spec on main is newest-by-mtime', async () => {
    // Legacy spec committed on `main` BEFORE the worktree is created, carrying
    // a DRAFT status line that would trip the C2 content guard if it were ever
    // picked. corpus-wide findNewestFile() would pick this file up once it's
    // touched to be newest; the idea-scoped picker must never even consider it
    // (technical track has no spec candidate in the idea's own attribution set).
    await mkdir(join(repoPath, '.docs', 'specs'), { recursive: true });
    const legacySpecPath = join(repoPath, '.docs', 'specs', 'legacy.md');
    await writeFile(legacySpecPath, '# PRD: legacy\n\n**Status:** DRAFT\n');
    await git(['add', '.docs']);
    await git(['commit', '-m', 'legacy DRAFT spec on main']);

    const idea = 'dep bump';
    const worktree = await createEngineerWorktree(repoPath, idea);
    const dir = worktree.worktreePath;

    await mkdir(join(dir, '.docs', 'track'), { recursive: true });
    await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await writeFile(join(dir, '.docs', 'track', 'dep-bump.md'), '# Track\n\nTrack: technical\n');
    await writeFile(join(dir, '.docs', 'stories', 'dep-bump.md'), ACCEPTED_STORIES);
    await writeFile(join(dir, '.docs', 'plans', 'dep-bump.md'), PLAN_WITH_DEPS);

    // Touch the legacy spec to be newest-by-mtime in .docs/specs/ AFTER the
    // idea's own artifacts were written — a corpus-wide picker would now pick it.
    const newDate = new Date();
    await utimes(legacySpecPath, newDate, newDate);

    const gh: GhRunner = async () => ({ stdout: 'bob\n' });
    const headBefore = await git(['rev-parse', 'HEAD'], dir);

    const result = await landSpec(target(), idea, dir, undefined, { ownerConfig: {}, gh });

    expect(result.branch).toBeTruthy();

    // The commit landSpec made must not touch the legacy spec at all.
    const diffNames = await git(['diff', '--name-only', headBefore, 'HEAD'], dir);
    expect(diffNames.split('\n')).not.toContain('.docs/specs/legacy.md');
  });

  it('idea Track: technical marker wins over a legacy Track: product marker regardless of mtime', async () => {
    // Legacy product-track marker committed on `main` BEFORE the worktree is
    // created — outside the idea's own attribution set, so it must never be
    // picked even though it's a "Track:" file living in the same directory.
    await mkdir(join(repoPath, '.docs', 'track'), { recursive: true });
    const legacyTrackPath = join(repoPath, '.docs', 'track', 'legacy.md');
    await writeFile(legacyTrackPath, '# Track\n\nTrack: product\n');
    await git(['add', '.docs']);
    await git(['commit', '-m', 'legacy product-track marker on main']);

    const idea = 'dep bump';
    const worktree = await createEngineerWorktree(repoPath, idea);
    const dir = worktree.worktreePath;

    await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    // Idea's own technical-track marker.
    await writeFile(join(dir, '.docs', 'track', 'dep-bump.md'), '# Track\n\nTrack: technical\n');
    // Touch the legacy marker (present in the worktree's checkout too, since
    // the branch derived from `main` after it was committed there) to be
    // newest-by-mtime — mtime alone must not let it win.
    const newDate = new Date();
    await utimes(join(dir, '.docs', 'track', 'legacy.md'), newDate, newDate);
    await writeFile(join(dir, '.docs', 'stories', 'dep-bump.md'), ACCEPTED_STORIES);
    await writeFile(join(dir, '.docs', 'plans', 'dep-bump.md'), PLAN_WITH_DEPS);

    const gh: GhRunner = async () => ({ stdout: 'bob\n' });

    // Technical track requires no spec — if the product-track legacy marker
    // won instead, this would throw "spec (product track)" missing.
    const result = await landSpec(target(), idea, dir, undefined, { ownerConfig: {}, gh });

    expect(result.branch).toBeTruthy();
  });

  it('Task 5: missing idea-authored track marker defaults to product — a legacy `Track: technical` file on main cannot loosen the gate', async () => {
    // Legacy technical-track marker committed on `main` BEFORE the worktree is
    // created — outside the idea's own attribution set. If the track picker
    // fell back to a corpus-wide (non-idea-scoped) search, it could pick this
    // up and wrongly treat the land as technical track (no spec required).
    await mkdir(join(repoPath, '.docs', 'track'), { recursive: true });
    const legacyTrackPath = join(repoPath, '.docs', 'track', 'legacy.md');
    await writeFile(legacyTrackPath, '# Track\n\nTrack: technical\n');
    await git(['add', '.docs']);
    await git(['commit', '-m', 'legacy technical-track marker on main']);

    const idea = 'dep bump';
    const worktree = await createEngineerWorktree(repoPath, idea);
    const dir = worktree.worktreePath;

    // No idea-authored track marker at all — only stories + plan, no spec.
    await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await writeFile(join(dir, '.docs', 'stories', 'dep-bump.md'), ACCEPTED_STORIES);
    await writeFile(join(dir, '.docs', 'plans', 'dep-bump.md'), PLAN_WITH_DEPS);

    const gh: GhRunner = async () => ({ stdout: 'bob\n' });

    // Missing idea-authored track marker must default to product track, which
    // requires a spec. The legacy technical-track marker on main must not
    // loosen the gate by making this land as technical (spec-exempt).
    await expect(
      landSpec(target(), idea, dir, undefined, { ownerConfig: {}, gh })
    ).rejects.toThrow(/spec \(product track\)/);
  });
});

describe('Task 3: idea-scoped stories/plan/complexity/conflicts/architecture/decisions pickers', () => {
  it('stories picker: validates the idea\'s stories content, ignoring a newer-mtime legacy stories file on main', async () => {
    // Legacy stories file committed on `main` BEFORE the worktree is created,
    // carrying content that would fail idea-content validation if ever picked
    // (it references a different idea entirely). corpus-wide findNewestFile()
    // would pick this once touched to be newest; the idea-scoped picker must
    // never even consider it.
    await mkdir(join(repoPath, '.docs', 'stories'), { recursive: true });
    const legacyStoriesPath = join(repoPath, '.docs', 'stories', 'legacy.md');
    await writeFile(
      legacyStoriesPath,
      ['# Stories: unrelated legacy idea', '', '**Status:** Accepted', ''].join('\n'),
    );
    await git(['add', '.docs']);
    await git(['commit', '-m', 'legacy stories on main']);

    const idea = 'dep bump';
    const worktree = await createEngineerWorktree(repoPath, idea);
    const dir = worktree.worktreePath;

    await mkdir(join(dir, '.docs', 'specs'), { recursive: true });
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await writeFile(join(dir, '.docs', 'specs', 'dep-bump.md'), '# PRD: dep bump\n\nApproved.\n');
    await writeFile(join(dir, '.docs', 'stories', 'dep-bump.md'), ACCEPTED_STORIES);
    await writeFile(join(dir, '.docs', 'plans', 'dep-bump.md'), PLAN_WITH_DEPS);

    // Touch the legacy stories file to be newest-by-mtime AFTER the idea's own
    // artifacts were written — a corpus-wide picker would now pick it.
    const newDate = new Date();
    await utimes(join(dir, '.docs', 'stories', 'legacy.md'), newDate, newDate);

    const gh: GhRunner = async () => ({ stdout: 'bob\n' });

    // If the legacy stories file were picked, validateArtifactContent('stories', ..., idea)
    // would throw because its content does not reference "dep bump".
    const result = await landSpec(target(), idea, dir, undefined, { ownerConfig: {}, gh });

    expect(result.branch).toBeTruthy();
  });

  it('plan picker + intake marker: keys the marker to the idea\'s own plan stem, ignoring a newer-mtime legacy plan on main', async () => {
    // Legacy plan committed on `main` BEFORE the worktree is created, with a
    // stem that must never become the intake-marker key.
    await mkdir(join(repoPath, '.docs', 'plans'), { recursive: true });
    const legacyPlanPath = join(repoPath, '.docs', 'plans', 'legacy-plan.md');
    await writeFile(legacyPlanPath, PLAN_WITH_DEPS);
    await git(['add', '.docs']);
    await git(['commit', '-m', 'legacy plan on main']);

    const idea = 'dep bump';
    const worktree = await createEngineerWorktree(repoPath, idea);
    const dir = worktree.worktreePath;

    await mkdir(join(dir, '.docs', 'specs'), { recursive: true });
    await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
    await writeFile(join(dir, '.docs', 'specs', 'dep-bump.md'), '# PRD: dep bump\n\nApproved.\n');
    await writeFile(join(dir, '.docs', 'stories', 'dep-bump.md'), ACCEPTED_STORIES);
    await writeFile(join(dir, '.docs', 'plans', 'dep-bump.md'), PLAN_WITH_DEPS);

    // Touch the legacy plan to be newest-by-mtime AFTER the idea's own plan
    // was written — a corpus-wide picker would now pick it (and key the
    // intake marker to "legacy-plan" instead of "dep-bump").
    const newDate = new Date();
    await utimes(join(dir, '.docs', 'plans', 'legacy-plan.md'), newDate, newDate);

    const gh: GhRunner = async () => ({ stdout: 'bob\n' });

    await landSpec(target(), idea, dir, undefined, { ownerConfig: {}, gh });

    // The intake marker must be keyed to the idea's own plan stem ("dep-bump"),
    // never the legacy plan's stem ("legacy-plan").
    const markerContent = await execFile(
      'git',
      ['show', `HEAD:.docs/intake/dep-bump.md`],
      { cwd: dir },
    ).then((r) => r.stdout);
    expect(markerContent).toBeTruthy();

    await expect(
      execFile('git', ['show', `HEAD:.docs/intake/legacy-plan.md`], { cwd: dir }),
    ).rejects.toThrow();
  });

  it('complexity picker: uses the idea\'s own tier, ignoring a newer-mtime legacy non-Small complexity file on main', async () => {
    // Legacy complexity file committed on `main`, declaring a non-Small tier
    // that would demand conflicts/architecture/decisions if ever picked.
    await mkdir(join(repoPath, '.docs', 'complexity'), { recursive: true });
    const legacyComplexityPath = join(repoPath, '.docs', 'complexity', 'legacy.md');
    await writeFile(legacyComplexityPath, '# Complexity\n\nTier: M\n');
    await git(['add', '.docs']);
    await git(['commit', '-m', 'legacy non-Small complexity on main']);

    const idea = 'dep bump';
    const worktree = await createEngineerWorktree(repoPath, idea);
    const dir = worktree.worktreePath;

    await mkdir(join(dir, '.docs', 'specs'), { recursive: true });
    await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await writeFile(join(dir, '.docs', 'specs', 'dep-bump.md'), '# PRD: dep bump\n\nApproved.\n');
    await writeFile(join(dir, '.docs', 'stories', 'dep-bump.md'), ACCEPTED_STORIES);
    await writeFile(join(dir, '.docs', 'plans', 'dep-bump.md'), PLAN_WITH_DEPS);
    // Idea's own complexity file declares Small — no conflicts/architecture/decisions needed.
    await writeFile(join(dir, '.docs', 'complexity', 'dep-bump.md'), '# Complexity\n\nTier: S\n');

    // Touch the legacy complexity file to be newest-by-mtime AFTER the idea's
    // own complexity file was written — a corpus-wide picker would now pick
    // it and (wrongly) demand conflicts/architecture/decisions.
    const newDate = new Date();
    await utimes(join(dir, '.docs', 'complexity', 'legacy.md'), newDate, newDate);

    const gh: GhRunner = async () => ({ stdout: 'bob\n' });

    // If the legacy Tier: M file were picked, this would throw for missing
    // conflicts/architecture/decisions artifacts (none were seeded).
    const result = await landSpec(target(), idea, dir, undefined, { ownerConfig: {}, gh });

    expect(result.branch).toBeTruthy();
  });

  it('conflicts/architecture/decisions pickers: idea-scoped tier-M artifacts satisfy the DECIDE gate, ignoring legacy decoys on main', async () => {
    // Legacy conflicts/architecture/decisions files committed on `main`, newer
    // by mtime than the idea's own — must never satisfy the gate on their own,
    // and the idea's own files (once present) must be what's used.
    await mkdir(join(repoPath, '.docs', 'conflicts'), { recursive: true });
    await mkdir(join(repoPath, '.docs', 'architecture'), { recursive: true });
    await mkdir(join(repoPath, '.docs', 'decisions'), { recursive: true });
    await writeFile(join(repoPath, '.docs', 'conflicts', 'legacy.md'), '# Conflicts\n\nNone.\n');
    await writeFile(join(repoPath, '.docs', 'architecture', 'legacy.md'), '# Architecture\n\nDiagram.\n');
    await writeFile(join(repoPath, '.docs', 'decisions', 'legacy.md'), '# Review\n\nApproved.\n');
    await git(['add', '.docs']);
    await git(['commit', '-m', 'legacy DECIDE artifacts on main']);

    const idea = 'dep bump';
    const worktree = await createEngineerWorktree(repoPath, idea);
    const dir = worktree.worktreePath;

    await mkdir(join(dir, '.docs', 'specs'), { recursive: true });
    await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await mkdir(join(dir, '.docs', 'complexity'), { recursive: true });
    await writeFile(join(dir, '.docs', 'specs', 'dep-bump.md'), '# PRD: dep bump\n\nApproved.\n');
    await writeFile(join(dir, '.docs', 'stories', 'dep-bump.md'), ACCEPTED_STORIES);
    await writeFile(join(dir, '.docs', 'plans', 'dep-bump.md'), PLAN_WITH_DEPS);
    await writeFile(join(dir, '.docs', 'complexity', 'dep-bump.md'), '# Complexity\n\nTier: M\n');

    // Do NOT seed the idea's own conflicts/architecture/decisions files yet —
    // only the legacy ones (newer-mtime) exist in the worktree checkout.
    const newDate = new Date();
    await utimes(join(dir, '.docs', 'conflicts', 'legacy.md'), newDate, newDate);
    await utimes(join(dir, '.docs', 'architecture', 'legacy.md'), newDate, newDate);
    await utimes(join(dir, '.docs', 'decisions', 'legacy.md'), newDate, newDate);

    const gh: GhRunner = async () => ({ stdout: 'bob\n' });

    // The legacy files must NOT satisfy the tier-M DECIDE gate — landSpec
    // must throw for missing conflicts/architecture/decisions even though
    // files exist by those names in those directories (just not the idea's).
    await expect(
      landSpec(target(), idea, dir, undefined, { ownerConfig: {}, gh }),
    ).rejects.toThrow(/conflicts.*architecture.*decisions|complexity tier/i);

    // Now seed the idea's own DECIDE artifacts — landing must succeed and use them.
    await writeFile(join(dir, '.docs', 'conflicts', 'dep-bump.md'), '# Conflicts\n\nNone.\n');
    await writeFile(join(dir, '.docs', 'architecture', 'dep-bump.md'), '# Architecture\n\nDiagram.\n');
    await writeFile(join(dir, '.docs', 'decisions', 'dep-bump.md'), '# Review\n\nApproved.\n');

    const result = await landSpec(target(), idea, dir, undefined, { ownerConfig: {}, gh });
    expect(result.branch).toBeTruthy();
  });
});

describe('Task 6: legacy-only plans dir yields missing-plan rejection (#488)', () => {
  it('rejects a worktree whose .docs/plans/ holds only a legacy plan committed on main', async () => {
    // Legacy plan committed on `main` BEFORE the worktree is created — not
    // attributable to the idea. The idea authors valid stories/complexity but
    // never writes its own plan.
    await mkdir(join(repoPath, '.docs', 'plans'), { recursive: true });
    const legacyPlanPath = join(repoPath, '.docs', 'plans', 'legacy.md');
    await writeFile(legacyPlanPath, PLAN_WITH_DEPS);
    await git(['add', '.docs']);
    await git(['commit', '-m', 'legacy plan on main']);

    const idea = 'dep bump';
    const worktree = await createEngineerWorktree(repoPath, idea);
    const dir = worktree.worktreePath;

    await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
    await writeFile(join(dir, '.docs', 'stories', 'dep-bump.md'), ACCEPTED_STORIES);

    // Touch the legacy plan to be newest-by-mtime — a corpus-wide picker
    // would wrongly treat it as satisfying the plan requirement.
    const newDate = new Date();
    await utimes(legacyPlanPath, newDate, newDate);

    const gh: GhRunner = async () => ({ stdout: 'bob\n' });

    await expect(
      landSpec(target(), idea, dir, undefined, { ownerConfig: {}, gh }),
    ).rejects.toThrow(/\bplan\b/);
  });
});

describe('Task 4: idea-scoped spec requirement on the product track (#488)', () => {
  it('rejects a product-track worktree whose .docs/specs/ holds only a legacy spec committed on main', async () => {
    // Legacy spec committed on `main` BEFORE the worktree is created — not
    // attributable to the idea. Product track defaults (no track marker), so
    // a spec IS required; the idea has none of its own.
    await mkdir(join(repoPath, '.docs', 'specs'), { recursive: true });
    const legacySpecPath = join(repoPath, '.docs', 'specs', 'legacy.md');
    await writeFile(legacySpecPath, '# PRD: legacy\n\nApproved.\n');
    await git(['add', '.docs']);
    await git(['commit', '-m', 'legacy spec on main']);

    const idea = 'dep bump';
    const worktree = await createEngineerWorktree(repoPath, idea);
    const dir = worktree.worktreePath;

    await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await writeFile(join(dir, '.docs', 'stories', 'dep-bump.md'), ACCEPTED_STORIES);
    await writeFile(join(dir, '.docs', 'plans', 'dep-bump.md'), PLAN_WITH_DEPS);

    // Touch the legacy spec to be newest-by-mtime — a corpus-wide picker
    // would wrongly treat it as satisfying the spec requirement.
    const newDate = new Date();
    await utimes(legacySpecPath, newDate, newDate);

    const gh: GhRunner = async () => ({ stdout: 'bob\n' });

    await expect(
      landSpec(target(), idea, dir, undefined, { ownerConfig: {}, gh }),
    ).rejects.toThrow(/spec \(product track\)/);
  });

  it('lands the idea PRD, not a newer-mtime legacy spec on main, on the product track', async () => {
    // Legacy spec committed on `main` BEFORE the worktree is created, made
    // newest-by-mtime after the idea's own spec is written.
    await mkdir(join(repoPath, '.docs', 'specs'), { recursive: true });
    const legacySpecPath = join(repoPath, '.docs', 'specs', 'legacy.md');
    await writeFile(legacySpecPath, '# PRD: legacy\n\nApproved.\n');
    await git(['add', '.docs']);
    await git(['commit', '-m', 'legacy spec on main']);

    const idea = 'dep bump';
    const worktree = await createEngineerWorktree(repoPath, idea);
    const dir = worktree.worktreePath;

    await mkdir(join(dir, '.docs', 'specs'), { recursive: true });
    await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await writeFile(join(dir, '.docs', 'specs', 'dep-bump.md'), '# PRD: dep bump\n\nApproved.\n');
    await writeFile(join(dir, '.docs', 'stories', 'dep-bump.md'), ACCEPTED_STORIES);
    await writeFile(join(dir, '.docs', 'plans', 'dep-bump.md'), PLAN_WITH_DEPS);

    const newDate = new Date();
    await utimes(join(dir, '.docs', 'specs', 'legacy.md'), newDate, newDate);

    const gh: GhRunner = async () => ({ stdout: 'bob\n' });
    const headBefore = await git(['rev-parse', 'HEAD'], dir);

    const result = await landSpec(target(), idea, dir, undefined, { ownerConfig: {}, gh });
    expect(result.branch).toBeTruthy();

    const diffNames = await git(['diff', '--name-only', headBefore, 'HEAD'], dir);
    expect(diffNames.split('\n')).toContain('.docs/specs/dep-bump.md');
    expect(diffNames.split('\n')).not.toContain('.docs/specs/legacy.md');
  });
});

describe('Task 7: idea-scoped resolution preserves content validation and the dirty-worktree guard', () => {
  it('rejects the idea\'s own DRAFT-status stories (stories-not-approved), even though attribution/pickers resolve them cleanly', async () => {
    const idea = 'dep bump';
    const worktree = await createEngineerWorktree(repoPath, idea);
    const dir = worktree.worktreePath;

    await mkdir(join(dir, '.docs', 'specs'), { recursive: true });
    await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await writeFile(join(dir, '.docs', 'specs', 'dep-bump.md'), '# PRD: dep bump\n\nApproved.\n');
    // The idea's OWN stories artifact — untracked, correctly attributed and
    // picked — but still DRAFT. Idea-scoped resolution must not skip content
    // validation just because the file is unambiguously "the idea's own".
    await writeFile(
      join(dir, '.docs', 'stories', 'dep-bump.md'),
      ['# Stories: dep bump', '', '**Status:** DRAFT', '', '## Story: bump', ''].join('\n'),
    );
    await writeFile(join(dir, '.docs', 'plans', 'dep-bump.md'), PLAN_WITH_DEPS);

    const gh: GhRunner = async () => ({ stdout: 'bob\n' });
    const headBefore = await git(['rev-parse', 'HEAD'], dir);

    await expect(
      landSpec(target(), idea, dir, undefined, { ownerConfig: {}, gh }),
    ).rejects.toThrow(/DRAFT.*not been approved|not approved/i);

    const headAfter = await git(['rev-parse', 'HEAD'], dir);
    expect(headAfter).toBe(headBefore);
  });

  it('dirty-worktree guard still rejects a tracked .docs file modified-but-uncommitted, before idea-scoped resolution ever runs', async () => {
    const dir = await seedValidWorktree('dep bump');

    // Commit the idea's own artifacts so they're tracked, then dirty one of
    // them without committing — the dirty-tree guard must fire first,
    // regardless of idea-scoped attribution/content validity.
    await git(['add', '.docs'], dir);
    await git(['commit', '-m', 'seed idea artifacts'], dir);
    await writeFile(join(dir, '.docs', 'stories', 'dep-bump.md'), ACCEPTED_STORIES + '\nmore\n');

    const gh: GhRunner = async () => ({ stdout: 'bob\n' });
    const headBefore = await git(['rev-parse', 'HEAD'], dir);

    await expect(
      landSpec(target(), 'dep bump', dir, undefined, { ownerConfig: {}, gh }),
    ).rejects.toThrow(/dirty|uncommitted/i);

    const headAfter = await git(['rev-parse', 'HEAD'], dir);
    expect(headAfter).toBe(headBefore);
  });
});
