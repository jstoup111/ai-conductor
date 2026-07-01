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
  await git(['init', '-q']);
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

  it('writes an owner-only marker when sourceRef is null but owner is present', async () => {
    const marker = await writeIntakeMarker(repoPath, 'owner-only', null, 'alice');
    expect(marker).not.toBeNull();
    const body = await readFile(join(repoPath, '.docs', 'intake', 'owner-only.md'), 'utf8');
    expect(body).toContain('Owner: alice');
    expect(body).not.toContain('Source-Ref:');
  });
});

describe('runAuthoring intake marker (FR-1, FR-3)', () => {
  it('commits .docs/intake/<slug>.md and discoverBacklog surfaces sourceRef after merge', async () => {
    const result = await runAuthoring(target(), 'dep bump', {
      decide: approvedDecide(),
      sourceRef: 'acme/app#49',
    });

    const marker = await showOnBranch(result.branch, `.docs/intake/${slugOf(result.branch)}.md`);
    expect(marker).toContain('Source-Ref: acme/app#49');

    await git(['checkout', defaultBranch]);
    await git(['merge', '--no-ff', '-m', 'merge', result.branch]);

    const items = await discoverBacklog(repoPath, undefined, undefined, { baseBranch: defaultBranch });
    const item = items.find((i) => i.slug === slugOf(result.branch));
    expect(item?.sourceRef).toBe('acme/app#49');
  });

  it('writes NO marker for a hand-authored spec (no sourceRef) — still discoverable', async () => {
    const result = await runAuthoring(target(), 'dep bump', { decide: approvedDecide() });

    expect(await showOnBranch(result.branch, `.docs/intake/${slugOf(result.branch)}.md`)).toBeNull();

    await git(['checkout', defaultBranch]);
    await git(['merge', '--no-ff', '-m', 'merge', result.branch]);
    const items = await discoverBacklog(repoPath, undefined, undefined, { baseBranch: defaultBranch });
    const item = items.find((i) => i.slug === slugOf(result.branch));
    expect(item).toBeTruthy();
    expect(item?.sourceRef).toBeUndefined();
  });

  it('writes NO marker for a garbled sourceRef', async () => {
    const result = await runAuthoring(target(), 'dep bump', {
      decide: approvedDecide(),
      sourceRef: 'not-a-valid-ref',
    });
    expect(await showOnBranch(result.branch, `.docs/intake/${slugOf(result.branch)}.md`)).toBeNull();
  });
});

describe('landSpec intake marker (FR-1)', () => {
  it('commits .docs/intake/<slug>.md when given a sourceRef', async () => {
    // The live path: skills already wrote the .docs artifacts; landSpec commits them.
    await mkdir(join(repoPath, '.docs', 'specs'), { recursive: true });
    await mkdir(join(repoPath, '.docs', 'stories'), { recursive: true });
    await mkdir(join(repoPath, '.docs', 'plans'), { recursive: true });
    await writeFile(join(repoPath, '.docs', 'specs', 'dep-bump.md'), '# PRD: dep bump\n\nApproved.\n');
    await writeFile(join(repoPath, '.docs', 'stories', 'dep-bump.md'), ACCEPTED_STORIES);
    await writeFile(join(repoPath, '.docs', 'plans', 'dep-bump.md'), PLAN_WITH_DEPS);

    const result = await landSpec(target(), 'dep bump', 'acme/app#7');

    const marker = await showOnBranch(result.branch, `.docs/intake/${result.slug}.md`);
    expect(marker).toContain('Source-Ref: acme/app#7');
  });
});

describe('landSpec owner stamp (FR-4 — every land path, incl. no-remote/local-commit)', () => {
  async function seedDocs() {
    await mkdir(join(repoPath, '.docs', 'specs'), { recursive: true });
    await mkdir(join(repoPath, '.docs', 'stories'), { recursive: true });
    await mkdir(join(repoPath, '.docs', 'plans'), { recursive: true });
    await writeFile(join(repoPath, '.docs', 'specs', 'dep-bump.md'), '# PRD: dep bump\n\nApproved.\n');
    await writeFile(join(repoPath, '.docs', 'stories', 'dep-bump.md'), ACCEPTED_STORIES);
    await writeFile(join(repoPath, '.docs', 'plans', 'dep-bump.md'), PLAN_WITH_DEPS);
  }

  it('stamps Owner from the configured spec_owner on the (local-commit / no-remote) land path', async () => {
    await seedDocs();
    const result = await landSpec(target(), 'dep bump', 'acme/app#7', {
      ownerConfig: { spec_owner: 'Alice' },
    });
    const marker = await showOnBranch(result.branch, `.docs/intake/${result.slug}.md`);
    expect(marker).toContain('Owner: alice'); // normalized
    expect(marker).toContain('Source-Ref: acme/app#7');
  });

  it('stamps Owner even without a sourceRef (owner-only marker still committed)', async () => {
    await seedDocs();
    const result = await landSpec(target(), 'dep bump', undefined, {
      ownerConfig: { spec_owner: 'alice' },
    });
    const marker = await showOnBranch(result.branch, `.docs/intake/${result.slug}.md`);
    expect(marker).toContain('Owner: alice');
    expect(marker ?? '').not.toContain('Source-Ref:');
  });

  it('resolves via gh login when spec_owner is unconfigured', async () => {
    await seedDocs();
    const gh: GhRunner = async () => ({ stdout: 'bob\n' });
    const result = await landSpec(target(), 'dep bump', 'acme/app#7', { gh });
    const marker = await showOnBranch(result.branch, `.docs/intake/${result.slug}.md`);
    expect(marker).toContain('Owner: bob');
  });

  it('OMITS Owner (un-owned, NOT blank/false) when the owner is unresolved', async () => {
    await seedDocs();
    const failingGh: GhRunner = async () => {
      throw new Error('gh unavailable');
    };
    const result = await landSpec(target(), 'dep bump', 'acme/app#7', { gh: failingGh });
    const marker = await showOnBranch(result.branch, `.docs/intake/${result.slug}.md`);
    expect(marker).toContain('Source-Ref: acme/app#7');
    expect(marker ?? '').not.toContain('Owner:');
  });
});

/** Extract the slug from a `spec/<slug>` branch name. */
function slugOf(branch: string): string {
  return branch.replace(/^spec\//, '');
}
