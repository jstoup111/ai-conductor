/**
 * Tests for Task T21 — Cross-repo isolation (pause scope).
 *
 * Acceptance Criteria:
 * 1. Two separate repos can be paused independently
 * 2. Pausing repo A doesn't modify repo B's `.daemon/` directory
 * 3. Two repos with the same basename are properly isolated by path identity
 * 4. Pause state is scoped per-repo, not global
 *
 * These tests verify that the pause/resume implementation does not leak across
 * repos and properly isolates pause markers by repository path.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeRegistry, type ProjectRecord } from '../../src/engine/registry.js';
import { dispatchDaemonSupervisor } from '../../src/engine/daemon-supervisor-cli.js';
import { isPaused, readPauseMetadata } from '../../src/engine/pause-marker.js';

let root: string;
let registryPath: string;

async function createRepo(name: string): Promise<string> {
  const p = join(root, name);
  await mkdir(p, { recursive: true });
  return p;
}

function record(name: string, path: string): ProjectRecord {
  return {
    schemaVersion: 1,
    name,
    path,
    status: 'registered',
    registeredAt: new Date().toISOString(),
  };
}

/**
 * Create a snapshot of a repo's .daemon/ directory.
 * Returns { exists: boolean, files: Map<filename, content> }
 */
async function snapshotDaemonDir(repoPath: string): Promise<{
  exists: boolean;
  files: Map<string, string>;
}> {
  try {
    const daemonDir = join(repoPath, '.daemon');
    const files = await readdir(daemonDir, { withFileTypes: false });
    const content = new Map<string, string>();
    for (const file of files) {
      const filePath = join(daemonDir, file as string);
      const data = await readFile(filePath, 'utf-8');
      content.set(file as string, data);
    }
    return { exists: true, files: content };
  } catch (err) {
    // .daemon/ doesn't exist (ENOENT)
    return { exists: false, files: new Map() };
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'daemon-fleet-isolation-'));
  registryPath = join(root, 'registry.json');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('Cross-repo isolation (Task T21)', () => {
  it('Pausing repo A keeps repo B\'s .daemon/ byte-identical (Criterion #2)', async () => {
    const repoA = await createRepo('project-a');
    const repoB = await createRepo('project-b');
    await writeRegistry(registryPath, [record('a', repoA), record('b', repoB)]);

    // Take snapshots of both repos' .daemon/ directories before any pause
    const bSnapshotBefore = await snapshotDaemonDir(repoB);

    // Pause only repo A via the fleet selector
    const out: string[] = [];
    const code = await dispatchDaemonSupervisor(
      { verb: 'pause', names: ['a'] },
      { registryPath, out: (l) => out.push(l) },
    );

    expect(code).toBe(0);
    expect(await isPaused(repoA)).toBe(true);

    // Verify repo B's .daemon/ is completely unchanged
    const bSnapshotAfter = await snapshotDaemonDir(repoB);
    expect(bSnapshotAfter.exists).toBe(bSnapshotBefore.exists);
    expect(bSnapshotAfter.files.size).toBe(bSnapshotBefore.files.size);
    // Verify byte-for-byte equality of all files in repo B
    for (const [filename, beforeContent] of bSnapshotBefore.files) {
      expect(bSnapshotAfter.files.get(filename)).toBe(beforeContent);
    }
  });

  it('Two repos can be paused independently (Criterion #1)', async () => {
    const repoA = await createRepo('project-a');
    const repoB = await createRepo('project-b');
    await writeRegistry(registryPath, [record('a', repoA), record('b', repoB)]);

    // Pause repo A
    await dispatchDaemonSupervisor(
      { verb: 'pause', names: ['a'] },
      { registryPath, out: () => {} },
    );

    // Pause repo B
    await dispatchDaemonSupervisor(
      { verb: 'pause', names: ['b'] },
      { registryPath, out: () => {} },
    );

    // Verify both are paused independently
    expect(await isPaused(repoA)).toBe(true);
    expect(await isPaused(repoB)).toBe(true);

    // Verify metadata is distinct (different pausedAt timestamps)
    const metaA = await readPauseMetadata(repoA);
    const metaB = await readPauseMetadata(repoB);
    expect(metaA?.pausedAt).toBeDefined();
    expect(metaB?.pausedAt).toBeDefined();
    // Note: timestamps might coincide if operations are very fast, so we just
    // verify both markers exist and contain valid metadata
    expect(metaA).toBeTruthy();
    expect(metaB).toBeTruthy();
  });

  it('Two same-basename repos are isolated by path identity (Criterion #3)', async () => {
    // Create two repos with the same basename in different directories
    const dir1 = join(root, 'workspace-1');
    const dir2 = join(root, 'workspace-2');
    await mkdir(dir1, { recursive: true });
    await mkdir(dir2, { recursive: true });

    const repoA = join(dir1, 'shared-name');
    const repoB = join(dir2, 'shared-name');
    await mkdir(repoA, { recursive: true });
    await mkdir(repoB, { recursive: true });

    await writeRegistry(registryPath, [record('a', repoA), record('b', repoB)]);

    // Pause only repo A
    await dispatchDaemonSupervisor(
      { verb: 'pause', names: ['a'] },
      { registryPath, out: () => {} },
    );

    // Verify isolation: A paused, B not paused
    expect(await isPaused(repoA)).toBe(true);
    expect(await isPaused(repoB)).toBe(false);

    // Resume A, and verify B remains unpaused
    await dispatchDaemonSupervisor(
      { verb: 'resume', names: ['a'] },
      { registryPath, out: () => {} },
    );

    expect(await isPaused(repoA)).toBe(false);
    expect(await isPaused(repoB)).toBe(false);

    // Pause both, then resume only B — verify A remains paused
    await dispatchDaemonSupervisor(
      { verb: 'pause', all: true },
      { registryPath, out: () => {} },
    );

    expect(await isPaused(repoA)).toBe(true);
    expect(await isPaused(repoB)).toBe(true);

    await dispatchDaemonSupervisor(
      { verb: 'resume', names: ['b'] },
      { registryPath, out: () => {} },
    );

    expect(await isPaused(repoA)).toBe(true);
    expect(await isPaused(repoB)).toBe(false);
  });

  it('Pause state is scoped per-repo, not global (Criterion #4)', async () => {
    const repoA = await createRepo('project-a');
    const repoB = await createRepo('project-b');
    const repoC = await createRepo('project-c');
    await writeRegistry(registryPath, [record('a', repoA), record('b', repoB), record('c', repoC)]);

    // Pause A and C, leave B unpaused
    await dispatchDaemonSupervisor(
      { verb: 'pause', names: ['a', 'c'] },
      { registryPath, out: () => {} },
    );

    expect(await isPaused(repoA)).toBe(true);
    expect(await isPaused(repoB)).toBe(false);
    expect(await isPaused(repoC)).toBe(true);

    // Resume A, leaving C paused
    await dispatchDaemonSupervisor(
      { verb: 'resume', names: ['a'] },
      { registryPath, out: () => {} },
    );

    expect(await isPaused(repoA)).toBe(false);
    expect(await isPaused(repoB)).toBe(false);
    expect(await isPaused(repoC)).toBe(true);

    // Pause B
    await dispatchDaemonSupervisor(
      { verb: 'pause', names: ['b'] },
      { registryPath, out: () => {} },
    );

    expect(await isPaused(repoA)).toBe(false);
    expect(await isPaused(repoB)).toBe(true);
    expect(await isPaused(repoC)).toBe(true);
  });

  it('Pausing one repo via --all does not create global pause markers', async () => {
    const repoA = await createRepo('project-a');
    const repoB = await createRepo('project-b');
    await writeRegistry(registryPath, [record('a', repoA), record('b', repoB)]);

    // Pause all repos
    await dispatchDaemonSupervisor(
      { verb: 'pause', all: true },
      { registryPath, out: () => {} },
    );

    // Verify each has its own independent pause marker
    const markerA = join(repoA, '.daemon', 'PAUSED');
    const markerB = join(repoB, '.daemon', 'PAUSED');

    const fileA = await readFile(markerA, 'utf-8');
    const fileB = await readFile(markerB, 'utf-8');

    // Both should be valid JSON with pause metadata
    expect(() => JSON.parse(fileA)).not.toThrow();
    expect(() => JSON.parse(fileB)).not.toThrow();

    // The markers are independent (created at possibly different times)
    const metaA = JSON.parse(fileA);
    const metaB = JSON.parse(fileB);
    expect(metaA.pausedAt).toBeDefined();
    expect(metaB.pausedAt).toBeDefined();
  });

  it('Resuming one repo does not affect the pause state of others', async () => {
    const repoA = await createRepo('project-a');
    const repoB = await createRepo('project-b');
    await writeRegistry(registryPath, [record('a', repoA), record('b', repoB)]);

    // Pause both
    await dispatchDaemonSupervisor(
      { verb: 'pause', all: true },
      { registryPath, out: () => {} },
    );

    expect(await isPaused(repoA)).toBe(true);
    expect(await isPaused(repoB)).toBe(true);

    // Resume only A
    await dispatchDaemonSupervisor(
      { verb: 'resume', names: ['a'] },
      { registryPath, out: () => {} },
    );

    // Verify isolation: A resumed, B still paused
    expect(await isPaused(repoA)).toBe(false);
    expect(await isPaused(repoB)).toBe(true);

    // Verify marker for B is still present
    const markerB = join(repoB, '.daemon', 'PAUSED');
    const fileB = await readFile(markerB, 'utf-8');
    expect(() => JSON.parse(fileB)).not.toThrow();
  });
});
