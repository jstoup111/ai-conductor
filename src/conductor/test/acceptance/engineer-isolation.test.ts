import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'fs/promises';
import { join, relative } from 'path';
import { tmpdir } from 'os';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { createRegistryReader } from '../../src/engine/registry.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for cross-repo isolation in the Phase 9.3 REDESIGN
// authoring path (FR-11, ADR-008, condition C1).
//
// Authoring for repo A must be confined to A: a sibling repo B is left
// byte-for-byte unchanged, and a stale/incorrect registry path for A fails fast
// (no write to cwd or to B). These exercise the redesigned `runAuthoring` seam
// composed with the C1 path-prefix write guard (`authoring-guard.ts`) and
// `resolveTargetRepo`'s fail-fast (`target.ts`).
//
// `runAuthoring` does not exist yet → dynamically imported per-test for RED.
// ─────────────────────────────────────────────────────────────────────────────

const execFile = promisify(execFileCb);
const AUTHORING_MOD = '../../src/engine/engineer/authoring.js';
const TARGET_MOD = '../../src/engine/engineer/target.js';

async function load(modPath: string): Promise<Record<string, unknown>> {
  return (await import(modPath)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: any[]) => any;
}

let workDir: string;
let registryPath: string;
const savedRegistryEnv = { value: process.env.AI_CONDUCTOR_REGISTRY };

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

async function makeRepo(name: string): Promise<string> {
  const repoPath = join(workDir, name);
  await mkdir(repoPath, { recursive: true });
  await execFile('git', ['init', '-q'], { cwd: repoPath });
  await execFile('git', ['config', 'user.email', 'test@test.com'], { cwd: repoPath });
  await execFile('git', ['config', 'user.name', 'Test'], { cwd: repoPath });
  await writeFile(join(repoPath, 'README.md'), `# ${name}\n`);
  await execFile('git', ['add', 'README.md'], { cwd: repoPath });
  await execFile('git', ['commit', '-m', 'init'], { cwd: repoPath });
  return repoPath;
}

function project(path: string, name: string) {
  return {
    schemaVersion: 1,
    name,
    path,
    status: 'registered',
    registeredAt: '2026-06-26T00:00:00.000Z',
  };
}

/** Snapshot a directory tree as {relpath → bytes} for byte-for-byte comparison. */
async function snapshotTree(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      // Skip volatile git internals (locks/indices) — compare refs/HEAD separately.
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        out.set(relative(root, full), await readFile(full, 'utf8').catch(() => '<binary>'));
      }
    }
  }
  await walk(root);
  return out;
}

function approvedDecide() {
  const ACCEPTED_STORIES = '# Stories: idea\n\n**Status:** Accepted\n\n## Story: x\n';
  const PLAN_WITH_DEPS = '# Plan\n\n**Stories:** .docs/stories/idea.md\n\n### Task 1\n**Dependencies:** none\n';
  return async (step: string) => {
    if (step === 'brainstorm') return { approved: true, artifact: '# PRD\n' };
    if (step === 'stories') return { approved: true, artifact: ACCEPTED_STORIES };
    if (step === 'plan') return { approved: true, artifact: PLAN_WITH_DEPS };
    return { approved: true, artifact: '' };
  };
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'engineer-isolation-'));
  registryPath = join(workDir, 'registry.json');
  savedRegistryEnv.value = process.env.AI_CONDUCTOR_REGISTRY;
  process.env.AI_CONDUCTOR_REGISTRY = registryPath;
});

afterEach(async () => {
  process.env.AI_CONDUCTOR_REGISTRY = savedRegistryEnv.value;
  await rm(workDir, { recursive: true, force: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-11 / C1: authoring A leaves sibling B byte-for-byte unchanged.
// ═════════════════════════════════════════════════════════════════════════════
describe('cross-repo isolation: authoring A never touches B (FR-11, C1)', () => {
  it('repo B is byte-for-byte identical (files + refs) before/after authoring A', async () => {
    const a = await makeRepo('alpha');
    const b = await makeRepo('beta');
    await writeFile(registryPath, JSON.stringify([project(a, 'alpha'), project(b, 'beta')]));

    const bTreeBefore = await snapshotTree(b);
    const bRefsBefore = await git(['for-each-ref'], b);
    const bHeadBefore = await git(['rev-parse', 'HEAD'], b);

    const runAuthoring = requireFn(await load(AUTHORING_MOD), 'runAuthoring');
    await runAuthoring({ name: 'alpha', canonicalPath: a }, 'an idea for alpha', {
      decide: approvedDecide(),
    });

    const bTreeAfter = await snapshotTree(b);
    const bRefsAfter = await git(['for-each-ref'], b);
    const bHeadAfter = await git(['rev-parse', 'HEAD'], b);

    expect(bHeadAfter).toBe(bHeadBefore);
    expect(bRefsAfter).toBe(bRefsBefore); // no new branches/refs in B
    // Byte-for-byte tree equality.
    expect([...bTreeAfter.entries()].sort()).toEqual([...bTreeBefore.entries()].sort());
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-11 / C1: a stale/incorrect registry path fails fast — no write to cwd or B.
// ═════════════════════════════════════════════════════════════════════════════
describe('cross-repo isolation: stale path fails fast (FR-11, C1)', () => {
  it('resolveTargetRepo throws TargetPathMissingError for a stale path (no cwd fallback)', async () => {
    const missing = join(workDir, 'does-not-exist');
    await writeFile(registryPath, JSON.stringify([project(missing, 'ghost')]));

    const resolveTargetRepo = requireFn(await load(TARGET_MOD), 'resolveTargetRepo');
    await expect(
      resolveTargetRepo(missing, createRegistryReader({ registryPath })),
    ).rejects.toThrow(/exist|missing|path/i);
  });

  it('authoring against a stale-path target writes NOTHING to cwd or to sibling B', async () => {
    const b = await makeRepo('beta');
    const missing = join(workDir, 'phantom-a'); // registered but absent on disk
    await writeFile(registryPath, JSON.stringify([project(missing, 'phantom'), project(b, 'beta')]));

    const bTreeBefore = await snapshotTree(b);
    const cwdBefore = await snapshotTree(workDir).then((m) => m.size);

    const runAuthoring = requireFn(await load(AUTHORING_MOD), 'runAuthoring');
    // Authoring must fail fast (target path missing) before any write.
    await expect(
      runAuthoring({ name: 'phantom', canonicalPath: missing }, 'idea', { decide: approvedDecide() }),
    ).rejects.toThrow();

    // B is untouched and no stray .docs were written into the working dir.
    const bTreeAfter = await snapshotTree(b);
    expect([...bTreeAfter.entries()].sort()).toEqual([...bTreeBefore.entries()].sort());
    // The phantom dir must not have been fabricated either.
    const phantomFiles = await readdir(missing).catch(() => null);
    expect(phantomFiles).toBeNull();
    // No explosion of stray files in the working dir beyond registry + repo B.
    const cwdAfter = await snapshotTree(workDir).then((m) => m.size);
    expect(cwdAfter).toBe(cwdBefore);
  });
});
