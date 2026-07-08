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

/**
 * Create the per-idea worktree and seed the pre-written DECIDE artifacts landSpec
 * expects INTO it (the engineer authors in the worktree). Returns the worktree path
 * to pass as `--worktree`. Call AFTER any writeConfig so the worktree's base includes
 * the committed config.
 */
async function seedWorktree(): Promise<string> {
  const wt = await createEngineerWorktree(repoPath, 'dep bump');
  const dir = wt.worktreePath;
  await mkdir(join(dir, '.docs', 'specs'), { recursive: true });
  await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
  await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
  await writeFile(join(dir, '.docs', 'specs', 'dep-bump.md'), '# PRD: dep bump\n\nApproved.\n');
  await writeFile(join(dir, '.docs', 'stories', 'dep-bump.md'), ACCEPTED_STORIES);
  await writeFile(join(dir, '.docs', 'plans', 'dep-bump.md'), PLAN_WITH_DEPS);
  return dir;
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

/**
 * Create an isolated fake $HOME carrying `~/.ai-conductor/config.yml` (or no
 * config file at all when `body` is omitted), so tests exercise
 * `readMachineOwnerConfig()`'s real default (`readUserConfig()` → `homedir()`)
 * WITHOUT ever touching the operator's actual home directory (Slice B D1 seam).
 */
async function makeUserHome(body?: string): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'user-home-'));
  if (body !== undefined) {
    await mkdir(join(home, '.ai-conductor'), { recursive: true });
    await writeFile(join(home, '.ai-conductor', 'config.yml'), body, 'utf-8');
  }
  return home;
}

/** Run `fn` with process.env.HOME pointed at `home`; always restores it. */
async function withHome<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const saved = process.env.HOME;
  process.env.HOME = home;
  try {
    return await fn();
  } finally {
    process.env.HOME = saved;
  }
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'cli-land-owner-'));
  registryPath = join(workDir, 'registry.json');
  engineerDir = join(workDir, 'engineer');
  repoPath = join(workDir, 'alpha');
  await mkdir(engineerDir, { recursive: true });
  await mkdir(repoPath, { recursive: true });
  await git(['init', '-b', 'main', '-q']);
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
  it('does NOT honor a project-config spec_owner (D2 anti-leak) — identity comes from the USER config instead', async () => {
    // SLICE B TASK 3 — TEST A: Negative path covering "project alice + user bob → bob"
    //
    // Contract (D2 anti-leak): operator identity MUST come from the USER's machine config
    // (~/.ai-conductor/config.yml), never from the project config which is shared/committed.
    // A `spec_owner` in the project config is ignored entirely.
    //
    // Identity chain priority (Story 1 D1): user-config > gh-login > unresolved
    // When both user config and gh are available, user config wins.
    //
    // Setup:
    // 1. Commit project config with spec_owner: Alice (shared, adversarial input)
    // 2. Set up user config with spec_owner: bob (machine-scoped)
    // 3. Mock gh runner (available, would return ghlogin)
    //
    // Expected: land succeeds, marker stamped "Owner: bob" (user config priority)
    // NOT: alice (project config ignored), NOT: ghlogin (user config beats gh)
    //
    // This test FAILS (RED) because current code reads project config instead of user config.

    await writeConfig('spec_owner: Alice\n');
    const worktree = await seedWorktree();

    // gh runner is available but should be ignored because user config is set
    const gh: GhRunner = async (args, opts) => ({ stdout: 'ghlogin\n' });

    // User config takes priority: bob is machine-scoped operator identity
    const fakeHome = await makeUserHome('spec_owner: bob\n');

    await withHome(fakeHome, async () => {
      const { out, opts } = captureOpts({ gh });

      const code = await dispatchEngineer({ kind: 'land', project: 'alpha', idea: 'dep bump', worktree }, opts);
      expect(code).toBe(0);
      const result = JSON.parse(out[out.length - 1]) as { slug: string; branch: string };
      const marker = await showOnBranch(result.branch, `.docs/intake/${result.slug}.md`);

      // Verify: user config (bob) is used, project config (alice) and gh (ghlogin) are NOT
      expect(marker).toContain('Owner: bob');
      expect(marker).not.toMatch(/alice/i);
      expect(marker).not.toContain('ghlogin');
    });

    await rm(fakeHome, { recursive: true, force: true });
  });

  it('fallback to gh login when no user config (ignoring project config, no silent swallow)', async () => {
    // SLICE B TASK 3 — TEST B: Negative path covering "project alice + no user + gh ghlogin → ghlogin"
    //
    // Contract: when user config is absent, identity chain falls back to gh-login.
    // Project config spec_owner is ignored (D2 anti-leak).
    // Config-load failures are never silent — the identity chain completes, the marker
    // is written, no degradation without a signal.
    //
    // Setup:
    // 1. Commit project config with spec_owner: Alice (shared, adversarial input — ignored)
    // 2. NO user config set (~/.ai-conductor/config.yml does not exist)
    // 3. Mock gh runner to return ghlogin (available, is used as fallback)
    //
    // Expected: land succeeds, marker stamped "Owner: ghlogin" (gh fallback after user-config fails)
    // NOT: alice (project config ignored entirely)
    //
    // This test FAILS (RED) because current code reads project config, not user config.
    // When user config is absent, it should fall through to gh, not use alice from project.

    await writeConfig('spec_owner: Alice\n');
    const worktree = await seedWorktree();

    // gh runner available: fallback after user config is absent
    const gh: GhRunner = async (args, opts) => ({ stdout: 'ghlogin\n' });

    // No user config file at all: chain falls through to gh
    const fakeHome = await makeUserHome();

    await withHome(fakeHome, async () => {
      const { out, opts } = captureOpts({ gh });

      const code = await dispatchEngineer({ kind: 'land', project: 'alpha', idea: 'dep bump', worktree }, opts);
      expect(code).toBe(0);
      const result = JSON.parse(out[out.length - 1]) as { slug: string; branch: string };
      const marker = await showOnBranch(result.branch, `.docs/intake/${result.slug}.md`);

      // Verify: gh login is used, project config is ignored
      expect(marker).not.toBeNull();
      expect(marker).toContain('Owner: ghlogin');
      expect(marker).not.toMatch(/alice/i);
    });

    await rm(fakeHome, { recursive: true, force: true });
  });

  it('unresolved identity at the CLI land entry refuses BEFORE landSpec is entered (Slice B Story 1 fail-fast)', async () => {
    // No user config, gh unauthenticated → identity chain fully unresolved.
    // `dispatchEngineer` must exit non-zero BEFORE `landSpec` runs: no marker
    // committed, no new commit on the worktree's branch.
    const worktree = await seedWorktree();
    const headBefore = await git(['rev-parse', 'HEAD'], worktree);
    const failingGh: GhRunner = async (args: string[]) => {
      if (args[0] === 'api') throw new Error('gh: not logged in');
      return { stdout: '' };
    };
    const fakeHome = await makeUserHome(); // no ~/.ai-conductor/config.yml

    await withHome(fakeHome, async () => {
      const { out, err, opts } = captureOpts({ gh: failingGh });

      const code = await dispatchEngineer(
        { kind: 'land', project: 'alpha', idea: 'dep bump', worktree },
        opts,
      );

      expect(code).not.toBe(0);
      // No commit made in the worktree (landSpec never entered).
      const headAfter = await git(['rev-parse', 'HEAD'], worktree);
      expect(headAfter).toBe(headBefore);
      // No JSON land result printed on stdout.
      expect(out.join('\n')).not.toMatch(/"slug"/);
      // Actionable remediation — both paths named verbatim (Story 2 error text).
      const combined = out.join('\n') + err.join('\n');
      expect(combined).toMatch(/~\/\.ai-conductor\/config\.yml/);
      expect(combined).toMatch(/gh auth login/);
    });

    await rm(fakeHome, { recursive: true, force: true });
  });

  it('threads the gh runner into landSpec → Owner from gh login when config is absent', async () => {
    // No config file at all → loadConfig fails → empty ownerConfig → gh fallback.
    // Hermetic HOME: the operator's real ~/.ai-conductor/config.yml (spec_owner)
    // must not leak in and shadow the injected gh fake.
    const worktree = await seedWorktree();
    const gh: GhRunner = async (args, opts) => ({ stdout: 'bob\n' });
    const { out, opts } = captureOpts({ gh });
    const fakeHome = await makeUserHome();

    const code = await withHome(fakeHome, () =>
      dispatchEngineer({ kind: 'land', project: 'alpha', idea: 'dep bump', worktree }, opts),
    );
    expect(code).toBe(0);
    const result = JSON.parse(out[out.length - 1]) as { slug: string; branch: string };
    const marker = await showOnBranch(result.branch, `.docs/intake/${result.slug}.md`);
    expect(marker).toContain('Owner: bob');

    await rm(fakeHome, { recursive: true, force: true });
  });

  // REMOVED: Interim test for un-owned stamp behavior (now throws fail-closed per Story 2).
  // Replaced by Task 3 tests: "does NOT honor project config" and "fallback to gh login".
});
