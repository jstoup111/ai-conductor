// `conduct-ts engineer land` owner-gate WIRING (adr-2026-06-30-*, FR-4 write side).
//
// Regression lock: the CLI `land` case must THREAD the target repo's config
// (`spec_owner`) AND a gh runner into landSpec so the committed intake marker is
// stamped `Owner: <id>`. A prior review found landSpec already resolved an owner
// but its ONLY caller passed no owner deps — so no spec was ever stamped. These
// tests exercise dispatchEngineer end-to-end (registry → resolveTargetRepo →
// loadConfig → landSpec) with an injected gh (no network) and assert the marker.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import {
  dispatchEngineer,
  type DispatchEngineerOpts,
} from '../../../src/engine/engineer-cli.js';
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

let workDir: string;
let registryPath: string;
let engineerDir: string;
let repoPath: string;
let defaultBranch: string;

async function git(args: string[], cwd = repoPath): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

/** Read a committed file from a branch tree, or null if absent. */
async function showOnBranch(branch: string, relPath: string): Promise<string | null> {
  try {
    return await git(['show', `${branch}:${relPath}`]);
  } catch {
    return null;
  }
}

/** Seed the pre-written DECIDE artifacts landSpec expects (left untracked under .docs/). */
async function seedDocs(): Promise<void> {
  await mkdir(join(repoPath, '.docs', 'specs'), { recursive: true });
  await mkdir(join(repoPath, '.docs', 'stories'), { recursive: true });
  await mkdir(join(repoPath, '.docs', 'plans'), { recursive: true });
  await writeFile(join(repoPath, '.docs', 'specs', 'dep-bump.md'), '# PRD: dep bump\n\nApproved.\n');
  await writeFile(join(repoPath, '.docs', 'stories', 'dep-bump.md'), ACCEPTED_STORIES);
  await writeFile(join(repoPath, '.docs', 'plans', 'dep-bump.md'), PLAN_WITH_DEPS);
}

/** Write + COMMIT `.ai-conductor/config.yml` (uncommitted config would dirty the tree). */
async function writeConfig(body: string): Promise<void> {
  await mkdir(join(repoPath, '.ai-conductor'), { recursive: true });
  await writeFile(join(repoPath, '.ai-conductor', 'config.yml'), body, 'utf-8');
  await git(['add', '.ai-conductor/config.yml']);
  await git(['commit', '-m', 'config']);
}

async function writeRegistry(): Promise<void> {
  const records = [
    {
      schemaVersion: 1,
      name: 'alpha',
      path: repoPath,
      status: 'registered',
      registeredAt: '2026-06-27T00:00:00.000Z',
    },
  ];
  await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');
}

function captureOpts(extra: Partial<DispatchEngineerOpts>): {
  out: string[];
  err: string[];
  opts: DispatchEngineerOpts;
} {
  const out: string[] = [];
  const err: string[] = [];
  const opts: DispatchEngineerOpts = {
    registryPath,
    engineerDir,
    print: (s) => out.push(s),
    printErr: (s) => err.push(s),
    ...extra,
  };
  return { out, err, opts };
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'cli-land-owner-'));
  registryPath = join(workDir, 'registry.json');
  engineerDir = join(workDir, 'engineer');
  repoPath = join(workDir, 'alpha');
  await mkdir(engineerDir, { recursive: true });
  await mkdir(repoPath, { recursive: true });
  await git(['init', '-q']);
  await git(['config', 'user.email', 'test@test.com']);
  await git(['config', 'user.name', 'Test']);
  await writeFile(join(repoPath, 'README.md'), '# repo\n');
  await git(['add', 'README.md']);
  await git(['commit', '-m', 'init']);
  defaultBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
  await writeRegistry();
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('engineer land — owner-gate wiring (CLI seam)', () => {
  it('does NOT honor a project-config spec_owner (D2 anti-leak) — identity never comes from the repo', async () => {
    // D2 / Story 2: a `spec_owner` committed into the shared PROJECT config is
    // now a hard config-load rejection — it must never source operator identity
    // (that would leak one operator's id to everyone who pulls). The authoring
    // caller swallows the rejected config to `{}` and falls through the identity
    // chain to gh, so the committed 'alice' is IGNORED and gh's login wins.
    // (Full authoring-side user-config sourcing + fail-closed refusal is Slice B.)
    await writeConfig('spec_owner: Alice\n');
    await seedDocs();
    const gh: GhRunner = async () => ({ stdout: 'bob\n' });
    const { out, opts } = captureOpts({ gh });

    const code = await dispatchEngineer({ kind: 'land', project: 'alpha', idea: 'dep bump' }, opts);
    expect(code).toBe(0);
    const result = JSON.parse(out[out.length - 1]) as { slug: string; branch: string };
    const marker = await showOnBranch(result.branch, `.docs/intake/${result.slug}.md`);
    expect(marker).toContain('Owner: bob'); // gh login, NOT the committed 'alice'
    expect(marker).not.toContain('alice'); // the repo-committed identity is never used
  });

  it('threads the gh runner into landSpec → Owner from gh login when config is absent', async () => {
    // No config file at all → loadConfig fails → empty ownerConfig → gh fallback.
    await seedDocs();
    const gh: GhRunner = async () => ({ stdout: 'bob\n' });
    const { out, opts } = captureOpts({ gh });

    const code = await dispatchEngineer({ kind: 'land', project: 'alpha', idea: 'dep bump' }, opts);
    expect(code).toBe(0);
    const result = JSON.parse(out[out.length - 1]) as { slug: string; branch: string };
    const marker = await showOnBranch(result.branch, `.docs/intake/${result.slug}.md`);
    expect(marker).toContain('Owner: bob');
  });

  it('OMITS the Owner line (un-owned, NOT blank) when neither config nor gh resolves', async () => {
    await seedDocs();
    const failingGh: GhRunner = async () => {
      throw new Error('gh unavailable');
    };
    const { out, opts } = captureOpts({ gh: failingGh });

    // A valid sourceRef guarantees a marker is written so we can assert Owner is
    // absent (not merely that no marker exists).
    const code = await dispatchEngineer(
      { kind: 'land', project: 'alpha', idea: 'dep bump', sourceRef: 'acme/app#7' },
      opts,
    );
    expect(code).toBe(0);
    const result = JSON.parse(out[out.length - 1]) as { slug: string; branch: string };
    const marker = await showOnBranch(result.branch, `.docs/intake/${result.slug}.md`);
    expect(marker).toContain('Source-Ref: acme/app#7');
    expect(marker ?? '').not.toContain('Owner:');
  });
});
