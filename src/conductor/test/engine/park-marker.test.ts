import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import {
  writeAutoPark,
  isOperatorParked,
  getProvenanceType,
  writeOperatorPark,
  resolveMainRepoRoot,
  removeOperatorPark,
  listOperatorParkedSlugs,
  __resetResolveCacheForTests,
} from '../../src/engine/park-marker';

const execFile = promisify(execFileCb);

let repoPath: string;

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'park-marker-'));
});

afterEach(async () => {
  await rm(repoPath, { recursive: true, force: true });
});

describe('park-marker auto-park provenance (Task 22)', () => {
  it('writeAutoPark() creates .daemon/parked/<slug> with auto-parked: <reason> body', async () => {
    const slug = 'my-feature';
    const reason = 'No evidence after 3 attempts';

    await writeAutoPark(repoPath, slug, reason);

    const content = await readFile(join(repoPath, '.daemon', 'parked', slug), 'utf-8');
    expect(content).toContain('auto-parked: No evidence after 3 attempts');
  });

  it('writeAutoPark() includes ISO-8601 timestamp in marker body', async () => {
    const slug = 'my-feature';
    const reason = 'No evidence after 3 attempts';

    await writeAutoPark(repoPath, slug, reason);

    const content = await readFile(join(repoPath, '.daemon', 'parked', slug), 'utf-8');
    expect(content).toContain('timestamp:');

    // Verify it's a valid ISO-8601 timestamp
    const timestampMatch = content.match(/timestamp:\s*(.+)/);
    expect(timestampMatch).toBeTruthy();
    if (timestampMatch) {
      const timestamp = timestampMatch[1].trim();
      expect(() => new Date(timestamp)).not.toThrow();
      expect(Number.isNaN(Date.parse(timestamp))).toBe(false);
    }
  });

  it('isOperatorParked() returns true for auto-parked marker (backward compatible)', async () => {
    const slug = 'my-feature';

    await writeAutoPark(repoPath, slug, 'No evidence after 3 attempts');

    const isParked = await isOperatorParked(repoPath, slug);
    expect(isParked).toBe(true);
  });

  it('getProvenanceType() returns "auto" for auto-parked markers', async () => {
    const slug = 'my-feature';

    await writeAutoPark(repoPath, slug, 'No evidence after 3 attempts');

    const provenance = await getProvenanceType(repoPath, slug);
    expect(provenance).toBe('auto');
  });

  it('getProvenanceType() returns "operator" for operator-parked markers', async () => {
    const slug = 'my-feature';

    await writeOperatorPark(repoPath, slug);

    const provenance = await getProvenanceType(repoPath, slug);
    expect(provenance).toBe('operator');
  });

  it('getProvenanceType() returns null when marker does not exist', async () => {
    const slug = 'nonexistent';

    const provenance = await getProvenanceType(repoPath, slug);
    expect(provenance).toBe(null);
  });

  it('writeAutoPark() is idempotent — same reason twice produces identical file', async () => {
    const slug = 'my-feature';
    const reason = 'No evidence after 3 attempts';

    await writeAutoPark(repoPath, slug, reason);
    const firstWrite = await readFile(join(repoPath, '.daemon', 'parked', slug), 'utf-8');

    // Small delay to ensure any timestamp would differ
    await new Promise((resolve) => setTimeout(resolve, 10));

    await writeAutoPark(repoPath, slug, reason);
    const secondWrite = await readFile(join(repoPath, '.daemon', 'parked', slug), 'utf-8');

    expect(firstWrite).toBe(secondWrite);
  });

  it('writeAutoPark() with different reason overwrites on idempotent re-write attempt', async () => {
    const slug = 'my-feature';

    await writeAutoPark(repoPath, slug, 'First reason');
    const firstContent = await readFile(join(repoPath, '.daemon', 'parked', slug), 'utf-8');

    // Try to write with a different reason — should be idempotent (no change)
    await writeAutoPark(repoPath, slug, 'Second reason');
    const secondContent = await readFile(join(repoPath, '.daemon', 'parked', slug), 'utf-8');

    // Content should be identical (idempotent)
    expect(secondContent).toBe(firstContent);
    expect(secondContent).toContain('First reason');
    expect(secondContent).not.toContain('Second reason');
  });
});

describe('resolveMainRepoRoot (Task 1)', () => {
  let mainRoot: string;

  async function g(args: string[], cwd?: string) {
    return execFile('git', args, { cwd: cwd || mainRoot });
  }

  /** Create a real git repo at mainRoot with a real linked worktree. */
  async function initRepoWithWorktree(slug: string): Promise<string> {
    await g(['init', '-q', '-b', 'main']);
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);
    await g(['config', 'commit.gpgsign', 'false']);
    await writeFile(join(mainRoot, 'README.md'), '# base\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);
    await mkdir(join(mainRoot, '.worktrees'), { recursive: true });
    const worktreeDir = join(mainRoot, '.worktrees', slug);
    await g(['worktree', 'add', '-b', `spec/${slug}`, worktreeDir, 'main']);
    return worktreeDir;
  }

  beforeEach(async () => {
    mainRoot = await mkdtemp(join(tmpdir(), 'resolve-main-root-'));
    __resetResolveCacheForTests?.();
  });

  afterEach(async () => {
    await rm(mainRoot, { recursive: true, force: true });
    __resetResolveCacheForTests?.();
  });

  it('resolveMainRepoRoot(mainRoot) returns mainRoot when called from main repo root', async () => {
    await initRepoWithWorktree('test-feat');
    const resolved = await resolveMainRepoRoot(mainRoot);
    expect(resolved).toBe(mainRoot);
  });

  it('resolveMainRepoRoot(worktreeDir) returns mainRoot when called from a linked worktree', async () => {
    const worktreeDir = await initRepoWithWorktree('test-feat');
    const resolved = await resolveMainRepoRoot(worktreeDir);
    expect(resolved).toBe(mainRoot);
  });

  it('resolveMainRepoRoot caches results per startDir to avoid repeated git calls', async () => {
    const worktreeDir = await initRepoWithWorktree('test-feat');

    // First call resolves the worktree to main root
    const first = await resolveMainRepoRoot(worktreeDir);
    expect(first).toBe(mainRoot);

    // Second call returns the same cached promise
    const second = await resolveMainRepoRoot(worktreeDir);
    expect(second).toBe(mainRoot);

    // Both calls should return identical results
    expect(first).toBe(second);

    // Verify cache is populated by checking another directory uses different cache entry
    const tmpDir = await mkdtemp(join(tmpdir(), 'cache-test-'));
    try {
      const third = await resolveMainRepoRoot(tmpDir);
      // Non-git dir returns itself
      expect(third).toBe(tmpDir);
      // Different result from first call
      expect(third).not.toBe(first);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('resolveMainRepoRoot invokes git runner exactly once per unique directory', async () => {
    const worktreeDir = await initRepoWithWorktree('test-feat');

    // Create a counting runner that tracks invocation count
    let callCount = 0;
    const countingRunner = async (args: string[], cwd: string) => {
      callCount++;
      return execFile('git', args, { cwd });
    };

    // First call to worktreeDir — should invoke git runner once
    const first = await resolveMainRepoRoot(worktreeDir, countingRunner);
    expect(first).toBe(mainRoot);
    expect(callCount).toBe(1);

    // Second call to same worktreeDir — should NOT invoke git runner again (cached)
    const second = await resolveMainRepoRoot(worktreeDir, countingRunner);
    expect(second).toBe(mainRoot);
    expect(callCount).toBe(1); // Still 1, not 2

    // Call to a different directory — should invoke git runner again
    const tmpDir = await mkdtemp(join(tmpdir(), 'unique-dir-'));
    try {
      const third = await resolveMainRepoRoot(tmpDir, countingRunner);
      expect(third).toBe(tmpDir); // Falls back to tmpDir (not a git repo)
      expect(callCount).toBe(2); // Now invoked for the new directory
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('resolveMainRepoRoot(nonGitDir) returns nonGitDir as fallback', async () => {
    const nonGitDir = await mkdtemp(join(tmpdir(), 'non-git-'));
    try {
      const resolved = await resolveMainRepoRoot(nonGitDir);
      expect(resolved).toBe(nonGitDir);
    } finally {
      await rm(nonGitDir, { recursive: true, force: true });
    }
  });

  it('resolveMainRepoRoot logs errors via onResolveError callback when provided', async () => {
    const nonGitDir = await mkdtemp(join(tmpdir(), 'non-git-error-'));
    const errors: Error[] = [];

    try {
      const resolved = await resolveMainRepoRoot(nonGitDir, undefined, (err) => {
        errors.push(err);
      });
      expect(resolved).toBe(nonGitDir);
      // Error should have been logged
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      await rm(nonGitDir, { recursive: true, force: true });
    }
  });

  it('resolveMainRepoRoot falls back to startDir when injected gitRunner throws', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'injected-runner-error-'));
    const errors: Error[] = [];
    const failingRunner = async () => {
      throw new Error('Injected git failure');
    };

    try {
      const resolved = await resolveMainRepoRoot(testDir, failingRunner, (err) => {
        errors.push(err);
      });
      expect(resolved).toBe(testDir);
      // Error should have been logged via callback
      expect(errors.length).toBe(1);
      expect(errors[0]?.message).toBe('Injected git failure');
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it('resolveMainRepoRoot handles nonexistent paths without throwing', async () => {
    const nonExistentPath = '/tmp/this-path-definitely-does-not-exist-12345-67890';
    const errors: Error[] = [];

    // Should not throw, should return input path as fallback
    const resolved = await resolveMainRepoRoot(nonExistentPath, undefined, (err) => {
      errors.push(err);
    });
    expect(resolved).toBe(nonExistentPath);
    // Error should be logged (git command failed)
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('write/read primitives converge on main root (Task 4)', () => {
  let mainRoot: string;

  async function g(args: string[], cwd?: string) {
    return execFile('git', args, { cwd: cwd || mainRoot });
  }

  /** Create a real git repo at mainRoot with a real linked worktree. */
  async function initRepoWithWorktree(slug: string): Promise<string> {
    await g(['init', '-q', '-b', 'main']);
    await g(['config', 'user.email', 't@t.com']);
    await g(['config', 'user.name', 'T']);
    await g(['config', 'commit.gpgsign', 'false']);
    await writeFile(join(mainRoot, 'README.md'), '# base\n');
    await g(['add', '.']);
    await g(['commit', '-q', '-m', 'init']);
    await mkdir(join(mainRoot, '.worktrees'), { recursive: true });
    const worktreeDir = join(mainRoot, '.worktrees', slug);
    await g(['worktree', 'add', '-b', `spec/${slug}`, worktreeDir, 'main']);
    return worktreeDir;
  }

  beforeEach(async () => {
    mainRoot = await mkdtemp(join(tmpdir(), 'task4-convergence-'));
    __resetResolveCacheForTests?.();
  });

  afterEach(async () => {
    await rm(mainRoot, { recursive: true, force: true });
    __resetResolveCacheForTests?.();
  });

  it('writeAutoPark(worktreeDir) writes marker to main root, not worktree', async () => {
    const worktreeDir = await initRepoWithWorktree('feature-a');
    const slug = 'my-auto-park';
    const reason = 'No evidence after 3 attempts';

    await writeAutoPark(worktreeDir, slug, reason);

    // Marker should exist at MAIN root, not worktree
    const mainMarkerPath = join(mainRoot, '.daemon', 'parked', slug);
    const worktreeMarkerPath = join(worktreeDir, '.daemon', 'parked', slug);

    const mainContent = await readFile(mainMarkerPath, 'utf-8');
    expect(mainContent).toContain('auto-parked: No evidence after 3 attempts');

    // Worktree should NOT have a .daemon/parked directory
    try {
      await readFile(worktreeMarkerPath);
      throw new Error('worktree marker should not exist');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  });

  it('writeOperatorPark(worktreeDir) writes marker to main root, not worktree', async () => {
    const worktreeDir = await initRepoWithWorktree('feature-b');
    const slug = 'my-operator-park';

    await writeOperatorPark(worktreeDir, slug);

    // Marker should exist at MAIN root, not worktree
    const mainMarkerPath = join(mainRoot, '.daemon', 'parked', slug);
    const worktreeMarkerPath = join(worktreeDir, '.daemon', 'parked', slug);

    const mainContent = await readFile(mainMarkerPath, 'utf-8');
    expect(mainContent).toContain('parked by operator');

    // Worktree should NOT have a .daemon/parked directory
    try {
      await readFile(worktreeMarkerPath);
      throw new Error('worktree marker should not exist');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  });

  it('isOperatorParked(worktreeDir) returns true for auto-parked marker at main root', async () => {
    const worktreeDir = await initRepoWithWorktree('feature-c');
    const slug = 'my-auto-park-2';

    await writeAutoPark(worktreeDir, slug, 'Test reason');

    // Both roots should see the marker as parked
    const fromWorktree = await isOperatorParked(worktreeDir, slug);
    const fromMain = await isOperatorParked(mainRoot, slug);

    expect(fromWorktree).toBe(true);
    expect(fromMain).toBe(true);
  });

  it('isOperatorParked(worktreeDir) returns true for operator-parked marker at main root', async () => {
    const worktreeDir = await initRepoWithWorktree('feature-d');
    const slug = 'my-operator-park-2';

    await writeOperatorPark(worktreeDir, slug);

    // Both roots should see the marker as parked
    const fromWorktree = await isOperatorParked(worktreeDir, slug);
    const fromMain = await isOperatorParked(mainRoot, slug);

    expect(fromWorktree).toBe(true);
    expect(fromMain).toBe(true);
  });

  it('getProvenanceType(worktreeDir) returns "auto" for auto-parked marker', async () => {
    const worktreeDir = await initRepoWithWorktree('feature-e');
    const slug = 'my-auto-provenance';

    await writeAutoPark(worktreeDir, slug, 'Auto-park test');

    // Both roots should see the same provenance
    const fromWorktree = await getProvenanceType(worktreeDir, slug);
    const fromMain = await getProvenanceType(mainRoot, slug);

    expect(fromWorktree).toBe('auto');
    expect(fromMain).toBe('auto');
  });

  it('getProvenanceType(worktreeDir) returns "operator" for operator-parked marker', async () => {
    const worktreeDir = await initRepoWithWorktree('feature-f');
    const slug = 'my-operator-provenance';

    await writeOperatorPark(worktreeDir, slug);

    // Both roots should see the same provenance
    const fromWorktree = await getProvenanceType(worktreeDir, slug);
    const fromMain = await getProvenanceType(mainRoot, slug);

    expect(fromWorktree).toBe('operator');
    expect(fromMain).toBe('operator');
  });

  it('listOperatorParkedSlugs(worktreeDir) includes markers from main root', async () => {
    const worktreeDir = await initRepoWithWorktree('feature-g');
    const slug1 = 'slug-1';
    const slug2 = 'slug-2';

    await writeAutoPark(worktreeDir, slug1, 'reason 1');
    await writeOperatorPark(mainRoot, slug2);

    // Both roots should list both slugs
    const fromWorktree = await listOperatorParkedSlugs(worktreeDir);
    const fromMain = await listOperatorParkedSlugs(mainRoot);

    expect(fromWorktree).toContain(slug1);
    expect(fromWorktree).toContain(slug2);
    expect(fromMain).toContain(slug1);
    expect(fromMain).toContain(slug2);
  });

  it('removeOperatorPark(worktreeDir) removes marker from main root', async () => {
    const worktreeDir = await initRepoWithWorktree('feature-h');
    const slug = 'my-removable-park';

    await writeOperatorPark(worktreeDir, slug);
    expect(await isOperatorParked(worktreeDir, slug)).toBe(true);

    await removeOperatorPark(worktreeDir, slug);
    expect(await isOperatorParked(mainRoot, slug)).toBe(false);
  });

  it('import: removeOperatorPark is exported for use in tests', async () => {
    // This is a placeholder to ensure removeOperatorPark is importable
    expect(typeof removeOperatorPark).toBe('function');
  });

  it('concurrent writes from worktree + main produce exactly one marker (race-safe)', async () => {
    const worktreeDir = await initRepoWithWorktree('feature-concurrent');
    const slug = 'concurrent-race-test';
    const reasonA = 'Attempt limit from worktree';
    const reasonB = 'Attempt limit from main';

    // Race two writes from different roots concurrently
    const results = await Promise.all([
      writeAutoPark(worktreeDir, slug, reasonA),
      writeAutoPark(mainRoot, slug, reasonB),
    ]);

    // Both should resolve without throwing
    expect(results).toHaveLength(2);

    // Exactly one marker should exist at the main root
    const mainMarkerPath = join(mainRoot, '.daemon', 'parked', slug);
    const markerContent = await readFile(mainMarkerPath, 'utf-8');

    // One of the two reasons should win; both produce valid auto-park format
    expect(markerContent).toContain('auto-parked:');
    expect(markerContent).toContain('timestamp:');

    // No marker should exist at the worktree
    const worktreeMarkerPath = join(worktreeDir, '.daemon', 'parked', slug);
    try {
      await readFile(worktreeMarkerPath);
      throw new Error('worktree marker should not exist');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }

    // Both roots should see exactly one marker
    const fromWorktree = await isOperatorParked(worktreeDir, slug);
    const fromMain = await isOperatorParked(mainRoot, slug);
    expect(fromWorktree).toBe(true);
    expect(fromMain).toBe(true);

    // Provenance should be 'auto' from both roots
    const provenanceWorktree = await getProvenanceType(worktreeDir, slug);
    const provenanceMain = await getProvenanceType(mainRoot, slug);
    expect(provenanceWorktree).toBe('auto');
    expect(provenanceMain).toBe('auto');
  });

  it('concurrent mixed writes (auto + operator) from different roots produce exactly one marker', async () => {
    const worktreeDir = await initRepoWithWorktree('feature-mixed-concurrent');
    const slug = 'mixed-race-test';

    // Race writeAutoPark from worktree against writeOperatorPark from main
    const results = await Promise.all([
      writeAutoPark(worktreeDir, slug, 'Auto reason'),
      writeOperatorPark(mainRoot, slug),
    ]);

    // Both should resolve without throwing
    expect(results).toHaveLength(2);

    // Exactly one marker should exist at the main root
    const mainMarkerPath = join(mainRoot, '.daemon', 'parked', slug);
    const markerContent = await readFile(mainMarkerPath, 'utf-8');
    expect(markerContent).toBeTruthy();

    // No marker at worktree
    const worktreeMarkerPath = join(worktreeDir, '.daemon', 'parked', slug);
    try {
      await readFile(worktreeMarkerPath);
      throw new Error('worktree marker should not exist');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }

    // Both roots see exactly one marker
    const fromWorktree = await isOperatorParked(worktreeDir, slug);
    const fromMain = await isOperatorParked(mainRoot, slug);
    expect(fromWorktree).toBe(true);
    expect(fromMain).toBe(true);
  });
});
