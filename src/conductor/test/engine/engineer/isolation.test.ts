// Test: A-untouched-by-B + stale path fail-fast (Task 35, FR-11, C1)
//
// Verifies two complementary isolation properties at the GUARD primitive level:
//
//   1. GUARD REJECTION: AuthoringGuard for repo A rejects any write path that
//      resolves outside A's prefix — even before any filesystem mutation. Repo B
//      is left byte-for-byte unchanged because the guard blocks the write.
//
//   2. STALE PATH FAIL-FAST: A stale/incorrect/nonexistent target path causes
//      `resolveTargetRepo` to throw `TargetPathMissingError` before any write
//      is attempted. No stray writes appear in cwd or in sibling repos.
//
// These tests focus on the PRIMITIVE level (AuthoringGuard + resolveTargetRepo)
// as building blocks for the higher-level `runAuthoring` seam (Task 32).
// They are falsifiable: pre/post snapshots use byte-for-byte file content.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'fs/promises';
import { join, relative } from 'path';
import { tmpdir } from 'os';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { AuthoringGuard, PathEscapeError } from '../../../src/engine/engineer/authoring-guard.js';
import { resolveTargetRepo, TargetPathMissingError } from '../../../src/engine/engineer/target.js';
import { createRegistryReader } from '../../../src/engine/registry.js';

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeRepo(parent: string, name: string): Promise<string> {
  const repoPath = join(parent, name);
  await mkdir(repoPath, { recursive: true });
  await execFile('git', ['init', '-q'], { cwd: repoPath });
  await execFile('git', ['config', 'user.email', 'test@test.com'], { cwd: repoPath });
  await execFile('git', ['config', 'user.name', 'Test'], { cwd: repoPath });
  await writeFile(join(repoPath, 'README.md'), `# ${name}\n`);
  await execFile('git', ['add', 'README.md'], { cwd: repoPath });
  await execFile('git', ['commit', '-m', 'init'], { cwd: repoPath });
  return repoPath;
}

/** Snapshot a directory tree as {relpath → content} for byte-for-byte comparison. */
async function snapshotTree(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        const content = await readFile(full, 'utf8').catch(() => '<binary>');
        out.set(relative(root, full), content);
      }
    }
  }
  await walk(root);
  return out;
}

function makeRegistryRecord(path: string, name: string) {
  return {
    schemaVersion: 1,
    name,
    path,
    status: 'registered' as const,
    registeredAt: '2026-06-26T00:00:00.000Z',
  };
}

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'isolation-test-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

// =============================================================================
// 1. GUARD REJECTION: authoring targeted at A rejects writes that escape A
// =============================================================================

describe('AuthoringGuard: A-untouched-by-B at guard primitive level (Task 35, FR-11, C1)', () => {
  it('guard for repo A rejects a write path targeting repo B', async () => {
    const a = await makeRepo(workDir, 'alpha');
    const b = await makeRepo(workDir, 'beta');

    const guard = new AuthoringGuard(a);

    // A write path inside B — must be rejected before any filesystem mutation.
    const escapingPath = join(b, '.docs', 'stories', 'story.md');
    expect(() => guard.assertWriteAllowed(escapingPath)).toThrow(PathEscapeError);
  });

  it('guard for repo A blocks B write — B is byte-for-byte identical before and after', async () => {
    const a = await makeRepo(workDir, 'alpha');
    const b = await makeRepo(workDir, 'beta');

    const bBefore = await snapshotTree(b);

    const guard = new AuthoringGuard(a);
    const escapingPath = join(b, 'injected.md');

    // The guard throws — no write to B happens.
    expect(() => guard.assertWriteAllowed(escapingPath)).toThrow(PathEscapeError);

    // B is completely unchanged.
    const bAfter = await snapshotTree(b);
    expect([...bAfter.entries()].sort()).toEqual([...bBefore.entries()].sort());
  });

  it('guard for repo A allows writes within A (normal operation)', async () => {
    const a = await makeRepo(workDir, 'alpha');
    const guard = new AuthoringGuard(a);

    // Writes into A's subdirectories must not throw.
    expect(() => guard.assertWriteAllowed(join(a, '.docs', 'stories', 'idea.md'))).not.toThrow();
    expect(() => guard.assertWriteAllowed(join(a, '.docs', 'plans', 'plan.md'))).not.toThrow();
    expect(() => guard.assertWriteAllowed(join(a, 'README.md'))).not.toThrow();
  });

  it('guard rejects a dotdot traversal that would escape A into parent workDir', async () => {
    const a = await makeRepo(workDir, 'alpha');
    const guard = new AuthoringGuard(a);

    // alpha/../beta/file.md resolves outside alpha
    const escapingPath = join(a, '..', 'beta', 'file.md');
    expect(() => guard.assertWriteAllowed(escapingPath)).toThrow(PathEscapeError);
  });

  it('guard rejects write path with prefix collision (alphaX is not alpha)', async () => {
    const a = await makeRepo(workDir, 'alpha');
    // alphaX shares string prefix "alpha" but is a different directory.
    const alphaX = join(workDir, 'alphaX');
    await mkdir(alphaX, { recursive: true });

    const guard = new AuthoringGuard(a);
    expect(() => guard.assertWriteAllowed(join(alphaX, 'file.md'))).toThrow(PathEscapeError);
  });
});

// =============================================================================
// 2. STALE PATH FAIL-FAST: stale/missing canonicalPath → error before any write
// =============================================================================

describe('resolveTargetRepo: stale path fail-fast (Task 35, FR-11, C1)', () => {
  it('throws TargetPathMissingError for a path that does not exist on disk', async () => {
    const missing = join(workDir, 'does-not-exist');
    const registryPath = join(workDir, 'registry.json');
    await writeFile(
      registryPath,
      JSON.stringify([makeRegistryRecord(missing, 'phantom')]),
    );

    const reader = createRegistryReader({ registryPath });
    await expect(resolveTargetRepo(missing, reader)).rejects.toThrow(TargetPathMissingError);
  });

  it('TargetPathMissingError message contains the stale path', async () => {
    const missing = join(workDir, 'phantom-a');
    const registryPath = join(workDir, 'registry.json');
    await writeFile(
      registryPath,
      JSON.stringify([makeRegistryRecord(missing, 'phantom')]),
    );

    const reader = createRegistryReader({ registryPath });
    await expect(resolveTargetRepo(missing, reader)).rejects.toThrow(/phantom-a|exist|missing/i);
  });

  it('stale path: sibling repo B is byte-for-byte unchanged after failed resolve', async () => {
    const b = await makeRepo(workDir, 'beta');
    const missing = join(workDir, 'phantom-a');
    const registryPath = join(workDir, 'registry.json');
    await writeFile(
      registryPath,
      JSON.stringify([
        makeRegistryRecord(missing, 'phantom'),
        makeRegistryRecord(b, 'beta'),
      ]),
    );

    const bBefore = await snapshotTree(b);

    const reader = createRegistryReader({ registryPath });
    // resolveTargetRepo must throw — no write is permitted to happen.
    await expect(resolveTargetRepo(missing, reader)).rejects.toThrow(TargetPathMissingError);

    // B is byte-for-byte unchanged — the failed resolve wrote nothing.
    const bAfter = await snapshotTree(b);
    expect([...bAfter.entries()].sort()).toEqual([...bBefore.entries()].sort());
  });

  it('stale path: the phantom directory is NOT created on disk', async () => {
    const missing = join(workDir, 'phantom-a');
    const registryPath = join(workDir, 'registry.json');
    await writeFile(
      registryPath,
      JSON.stringify([makeRegistryRecord(missing, 'phantom')]),
    );

    const reader = createRegistryReader({ registryPath });
    await expect(resolveTargetRepo(missing, reader)).rejects.toThrow(TargetPathMissingError);

    // The phantom directory must not have been fabricated.
    const phantomExists = await readdir(missing).catch(() => null);
    expect(phantomExists).toBeNull();
  });

  it('resolves successfully when path exists (no false positive)', async () => {
    const a = await makeRepo(workDir, 'alpha');
    const registryPath = join(workDir, 'registry.json');
    await writeFile(
      registryPath,
      JSON.stringify([makeRegistryRecord(a, 'alpha')]),
    );

    const reader = createRegistryReader({ registryPath });
    const target = await resolveTargetRepo(a, reader);

    expect(target.canonicalPath).toBe(a);
    expect(target.name).toBe('alpha');
  });
});

// =============================================================================
// 3. COMBINED: guard + stale-path — no stray write anywhere
// =============================================================================

describe('combined isolation: guard + stale-path — zero stray writes (Task 35, FR-11, C1)', () => {
  it('stale target + sibling B: workDir file count unchanged after failed resolve', async () => {
    const b = await makeRepo(workDir, 'beta');
    const missing = join(workDir, 'phantom-a');
    const registryPath = join(workDir, 'registry.json');
    await writeFile(
      registryPath,
      JSON.stringify([
        makeRegistryRecord(missing, 'phantom'),
        makeRegistryRecord(b, 'beta'),
      ]),
    );

    const cwdBefore = await snapshotTree(workDir).then((m) => m.size);

    const reader = createRegistryReader({ registryPath });
    await expect(resolveTargetRepo(missing, reader)).rejects.toThrow(TargetPathMissingError);

    // No new files appear anywhere in the working directory.
    const cwdAfter = await snapshotTree(workDir).then((m) => m.size);
    expect(cwdAfter).toBe(cwdBefore);
  });

  it('guard rejects cross-repo escape: PathEscapeError name is correct', () => {
    const guard = new AuthoringGuard('/repo/alpha');
    try {
      guard.assertWriteAllowed('/repo/beta/file.md');
      expect.fail('should have thrown PathEscapeError');
    } catch (err) {
      expect(err).toBeInstanceOf(PathEscapeError);
      expect((err as PathEscapeError).name).toBe('PathEscapeError');
    }
  });

  it('TargetPathMissingError name is correct', async () => {
    const missing = join(workDir, 'gone');
    const registryPath = join(workDir, 'registry.json');
    await writeFile(
      registryPath,
      JSON.stringify([makeRegistryRecord(missing, 'gone')]),
    );

    const reader = createRegistryReader({ registryPath });
    await expect(resolveTargetRepo(missing, reader)).rejects.toMatchObject({
      name: 'TargetPathMissingError',
    });
  });
});
