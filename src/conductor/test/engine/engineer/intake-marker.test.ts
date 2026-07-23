// Test: intake-origin marker end-to-end (FR-1, FR-3, FR-5).
//
// The originating GitHub issue ref must travel WITH the spec via a committed
// `.docs/intake/<slug>.md` so the daemon — which only reads the merged base-branch
// tree — can later put `Closes owner/repo#N` on the implementation PR.
//
// Covered:
//   - writeIntakeMarker / parseIntakeSourceRef unit behavior (valid/absent/garbled)
//   - runAuthoring (autonomous) commits the marker → discoverBacklog surfaces sourceRef
//   - landSpec (live path) commits the marker
//   - NO marker is written for a hand-authored spec (no sourceRef) or a garbled ref,
//     and the feature is still discoverable (full backward compatibility)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { runAuthoring } from '../../../src/engine/engineer/authoring.js';
import { landSpec } from '../../../src/engine/engineer/land-spec.js';
import type { GhRunner } from '../../../src/engine/owner-gate/identity.js';
import { createEngineerWorktree } from '../../../src/engine/engineer/worktree-authoring.js';
import { writeIntakeMarker } from '../../../src/engine/engineer/intake-marker.js';
import { parseIntakeSourceRef } from '../../../src/engine/artifacts.js';
import { discoverBacklog } from '../../../src/engine/daemon-backlog.js';

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

function approvedDecide() {
  return async (step: string) => {
    if (step === 'brainstorm') return { approved: true, artifact: '# PRD: dep bump\n\nApproved.\n' };
    if (step === 'stories') return { approved: true, artifact: ACCEPTED_STORIES };
    if (step === 'plan') return { approved: true, artifact: PLAN_WITH_DEPS };
    return { approved: true, artifact: '' };
  };
}

let repoPath: string;
let defaultBranch: string;

async function git(args: string[], cwd = repoPath): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'intake-marker-'));
  await git(['init', '-b', 'main', '-q']);
  await git(['config', 'user.email', 'test@test.com']);
  await git(['config', 'user.name', 'Test']);
  await writeFile(join(repoPath, 'README.md'), '# repo\n');
  await git(['add', 'README.md']);
  await git(['commit', '-m', 'init']);
  defaultBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
});

afterEach(async () => {
  await rm(repoPath, { recursive: true, force: true });
});

function target() {
  return { name: 'alpha', canonicalPath: repoPath };
}

/** Read a committed file from a branch tree, or null if absent. */
async function showOnBranch(branch: string, relPath: string): Promise<string | null> {
  try {
    return await git(['show', `${branch}:${relPath}`]);
  } catch {
    return null;
  }
}

describe('parseIntakeSourceRef', () => {
  it('parses a valid Source-Ref line', () => {
    expect(parseIntakeSourceRef('# x\n\nSource-Ref: acme/app#49\n')).toBe('acme/app#49');
  });
  it('returns undefined for absent / null', () => {
    expect(parseIntakeSourceRef(null)).toBeUndefined();
    expect(parseIntakeSourceRef('no marker here')).toBeUndefined();
  });
  it('returns undefined for a garbled ref', () => {
    expect(parseIntakeSourceRef('Source-Ref: not-a-ref')).toBeUndefined();
    expect(parseIntakeSourceRef('Source-Ref: acme/app#abc')).toBeUndefined();
  });
});

describe('writeIntakeMarker', () => {
  it('no-ops (returns null, writes nothing) without a valid sourceRef or owner', async () => {
    expect(await writeIntakeMarker(repoPath, 'slug', undefined)).toBeNull();
    expect(await writeIntakeMarker(repoPath, 'slug', 'garbage')).toBeNull();
    expect(await showOnBranch(defaultBranch, '.docs/intake/slug.md')).toBeNull();
  });

  it('appends "Owner: <id>" to the marker body when ownerIdentity is present (FR-4)', async () => {
    const marker = await writeIntakeMarker(repoPath, 'slug', 'acme/app#7', 'alice');
    expect(marker).not.toBeNull();
    const body = await readFile(join(repoPath, '.docs', 'intake', 'slug.md'), 'utf8');
    expect(body).toContain('Source-Ref: acme/app#7');
    expect(body).toContain('Owner: alice');
  });

  it('OMITS the Owner line entirely (never blank) when owner is null/blank (FR-12)', async () => {
    await writeIntakeMarker(repoPath, 'slug', 'acme/app#7', null);
    const body = await readFile(join(repoPath, '.docs', 'intake', 'slug.md'), 'utf8');
    expect(body).not.toContain('Owner:');

    await writeIntakeMarker(repoPath, 'slug2', 'acme/app#7', '   ');
    const body2 = await readFile(join(repoPath, '.docs', 'intake', 'slug2.md'), 'utf8');
    expect(body2).not.toContain('Owner:');
  });

  it('emits "Source-Ref: PROJ-123" verbatim for a Jira-shaped sourceRef', async () => {
    const marker = await writeIntakeMarker(repoPath, 'jira-slug', 'PROJ-123', null);
    expect(marker).not.toBeNull();
    const body = await readFile(join(repoPath, '.docs', 'intake', 'jira-slug.md'), 'utf8');
    expect(body).toContain('Source-Ref: PROJ-123');
  });

  it('emits no Source-Ref line for an empty/whitespace sourceRef', async () => {
    expect(await writeIntakeMarker(repoPath, 'blank-slug', '', null)).toBeNull();
    expect(await writeIntakeMarker(repoPath, 'blank-slug2', '   ', null)).toBeNull();
  });

  it('writes an owner-only marker when sourceRef is null but owner is present', async () => {
    const marker = await writeIntakeMarker(repoPath, 'owner-only', null, 'alice');
    expect(marker).not.toBeNull();
    const body = await readFile(join(repoPath, '.docs', 'intake', 'owner-only.md'), 'utf8');
    expect(body).toContain('Owner: alice');
    expect(body).not.toContain('Source-Ref:');
  });
});

describe('runAuthoring intake marker (FR-1, FR-3)', () => {
  let fakeHome: string;
  let savedHome: string | undefined;

  beforeEach(async () => {
    // Isolate $HOME so owner resolution (born-owned at authoring, Task 1) is
    // deterministic in CI rather than picking up the real dev machine's
    // ~/.ai-conductor/config.yml spec_owner.
    fakeHome = await mkdtemp(join(tmpdir(), 'intake-marker-home-'));
    await mkdir(join(fakeHome, '.ai-conductor'), { recursive: true });
    await writeFile(join(fakeHome, '.ai-conductor', 'config.yml'), 'spec_owner: fakeowner\n');
    savedHome = process.env.HOME;
    process.env.HOME = fakeHome;
  });

  afterEach(async () => {
    process.env.HOME = savedHome;
    await rm(fakeHome, { recursive: true, force: true });
  });

  it('commits .docs/intake/<slug>.md and discoverBacklog surfaces sourceRef after merge', async () => {
    const result = await runAuthoring(target(), 'dep bump', {
      decide: approvedDecide(),
      sourceRef: 'acme/app#49',
    });

    const marker = await showOnBranch(result.branch, `.docs/intake/${slugOf(result.branch)}.md`);
    expect(marker).toContain('Source-Ref: acme/app#49');

    await git(['checkout', defaultBranch]);
    await git(['merge', '--no-ff', '-m', 'merge', result.branch]);

    const { items } = await discoverBacklog(repoPath, undefined, undefined, { baseBranch: defaultBranch });
    const item = items.find((i) => i.slug === slugOf(result.branch));
    expect(item?.sourceRef).toBe('acme/app#49');
  });

  it('writes a marker with Owner (born-owned) for a hand-authored spec (no sourceRef) — still discoverable', async () => {
    const result = await runAuthoring(target(), 'dep bump', { decide: approvedDecide() });

    const marker = await showOnBranch(result.branch, `.docs/intake/${slugOf(result.branch)}.md`);
    expect(marker).toContain('Owner: fakeowner');
    expect(marker ?? '').not.toContain('Source-Ref:');

    await git(['checkout', defaultBranch]);
    await git(['merge', '--no-ff', '-m', 'merge', result.branch]);
    const { items } = await discoverBacklog(repoPath, undefined, undefined, { baseBranch: defaultBranch });
    const item = items.find((i) => i.slug === slugOf(result.branch));
    expect(item).toBeTruthy();
    expect(item?.sourceRef).toBeUndefined();
  });

  it('writes a marker with Owner (born-owned) for a garbled sourceRef', async () => {
    const result = await runAuthoring(target(), 'dep bump', {
      decide: approvedDecide(),
      sourceRef: 'not-a-valid-ref',
    });
    const marker = await showOnBranch(result.branch, `.docs/intake/${slugOf(result.branch)}.md`);
    expect(marker).toContain('Owner: fakeowner');
    expect(marker ?? '').not.toContain('Source-Ref:');
  });
});

describe('landSpec intake marker (FR-1)', () => {
  it('commits .docs/intake/<slug>.md when given a sourceRef (from the per-idea worktree)', async () => {
    // The live path: create the per-idea worktree, the skills write .docs INTO it,
    // then landSpec commits them on spec/<slug> from within the worktree (FR-1/FR-3).
    const wt = await createEngineerWorktree(repoPath, 'dep bump');
    await mkdir(join(wt.worktreePath, '.docs', 'specs'), { recursive: true });
    await mkdir(join(wt.worktreePath, '.docs', 'stories'), { recursive: true });
    await mkdir(join(wt.worktreePath, '.docs', 'plans'), { recursive: true });
    await writeFile(join(wt.worktreePath, '.docs', 'specs', 'dep-bump.md'), '# PRD: dep bump\n\nApproved.\n');
    await writeFile(join(wt.worktreePath, '.docs', 'stories', 'dep-bump.md'), ACCEPTED_STORIES);
    await writeFile(join(wt.worktreePath, '.docs', 'plans', 'dep-bump.md'), PLAN_WITH_DEPS);

    const result = await landSpec(target(), 'dep bump', wt.worktreePath, 'acme/app#7', {
      ownerConfig: { spec_owner: 'alice' },
    });

    const marker = await showOnBranch(result.branch, `.docs/intake/${result.slug}.md`);
    expect(marker).toContain('Source-Ref: acme/app#7');
  });
});

describe('landSpec owner stamp (FR-4 — every land path, incl. no-remote/local-commit)', () => {
  /** Create the per-idea worktree and seed real .docs into it; returns worktreePath. */
  async function seedWorktree(): Promise<string> {
    const wt = await createEngineerWorktree(repoPath, 'dep bump');
    await mkdir(join(wt.worktreePath, '.docs', 'specs'), { recursive: true });
    await mkdir(join(wt.worktreePath, '.docs', 'stories'), { recursive: true });
    await mkdir(join(wt.worktreePath, '.docs', 'plans'), { recursive: true });
    await writeFile(join(wt.worktreePath, '.docs', 'specs', 'dep-bump.md'), '# PRD: dep bump\n\nApproved.\n');
    await writeFile(join(wt.worktreePath, '.docs', 'stories', 'dep-bump.md'), ACCEPTED_STORIES);
    await writeFile(join(wt.worktreePath, '.docs', 'plans', 'dep-bump.md'), PLAN_WITH_DEPS);
    return wt.worktreePath;
  }

  it('stamps Owner from the configured spec_owner on the (local-commit / no-remote) land path', async () => {
    const worktree = await seedWorktree();
    const result = await landSpec(target(), 'dep bump', worktree, 'acme/app#7', {
      ownerConfig: { spec_owner: 'Alice' },
    });
    const marker = await showOnBranch(result.branch, `.docs/intake/${result.slug}.md`);
    expect(marker).toContain('Owner: alice'); // normalized
    expect(marker).toContain('Source-Ref: acme/app#7');
  });

  it('stamps Owner even without a sourceRef (owner-only marker still committed)', async () => {
    const worktree = await seedWorktree();
    const result = await landSpec(target(), 'dep bump', worktree, undefined, {
      ownerConfig: { spec_owner: 'alice' },
    });
    const marker = await showOnBranch(result.branch, `.docs/intake/${result.slug}.md`);
    expect(marker).toContain('Owner: alice');
    expect(marker ?? '').not.toContain('Source-Ref:');
  });

  it('resolves via gh login when spec_owner is unconfigured', async () => {
    const worktree = await seedWorktree();
    const gh: GhRunner = async () => ({ stdout: 'bob\n' });
    const result = await landSpec(target(), 'dep bump', worktree, 'acme/app#7', { gh });
    const marker = await showOnBranch(result.branch, `.docs/intake/${result.slug}.md`);
    expect(marker).toContain('Owner: bob');
  });

  it('refuses fail-closed with no marker/commit when the owner is unresolved', async () => {
    const worktree = await seedWorktree();
    const failingGh: GhRunner = async () => {
      throw new Error('gh unavailable');
    };
    await expect(landSpec(target(), 'dep bump', worktree, 'acme/app#7', { gh: failingGh })).rejects.toThrow(
      /identity is unresolved/,
    );
  });
});

/** Extract the slug from a `spec/<slug>` branch name. */
function slugOf(branch: string): string {
  return branch.replace(/^spec\//, '');
}
