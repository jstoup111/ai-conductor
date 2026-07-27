// Regression: the stale-engine checker was silently disabled because the daemon
// hashed `<projectRoot>/dist/index.js` (nonexistent) instead of the real engine
// at `<projectRoot>/src/conductor/dist/index.js`. captureEngineIdentity returned
// null for the wrong path, so createStaleEngineChecker(null) always reported
// 'current' and no daemon ever auto-restarted. This drives the real wired path
// against a real self-host layout — the seam no prior test exercised (the
// identity primitive was only ever tested against a directly-passed fixture).

import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { engineEntryPathForRepo, readEngineSourceSha } from '../../src/daemon-cli.js';
import { captureEngineIdentity } from '../../src/engine/engine-identity.js';

describe('engineEntryPathForRepo (stale-engine checker wiring)', () => {
  it('resolves <projectRoot>/src/conductor/dist/index.js, not the repo root', () => {
    expect(engineEntryPathForRepo('/repo')).toBe('/repo/src/conductor/dist/index.js');
  });

  it('captureEngineIdentity finds the engine at the wired path in a real self-host layout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'engine-entrypath-'));
    const distDir = join(root, 'src', 'conductor', 'dist');
    await mkdir(distDir, { recursive: true });
    await writeFile(join(distDir, 'index.js'), 'export const engine = 1;\n', 'utf-8');

    const identity = await captureEngineIdentity(engineEntryPathForRepo(root));
    expect(identity).not.toBeNull();
    expect(identity).toMatch(/^[0-9a-f]{64}$/);

    // The pre-fix path (`<root>/dist/index.js`) never exists → capture fails →
    // the checker would be permanently disabled.
    const preFix = await captureEngineIdentity(join(root, 'dist', 'index.js'));
    expect(preFix).toBeNull();
  });
});

describe('readEngineSourceSha (Task 8: boot log carries engine source SHA)', () => {
  it('reads the .engine-source-sha sidecar from the pinned dist-versions/<id> directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'engine-source-sha-'));
    const conductorDir = join(root, 'src', 'conductor');
    const versionDir = join(conductorDir, 'dist-versions', '20260723T000000Z-abc123def456');
    await mkdir(versionDir, { recursive: true });
    await writeFile(join(versionDir, 'index.js'), 'export const engine = 1;\n', 'utf-8');
    await writeFile(join(versionDir, '.engine-source-sha'), 'deadbeef1234567890\n', 'utf-8');
    await symlink(versionDir, join(conductorDir, 'dist'), 'dir');

    const sha = await readEngineSourceSha(engineEntryPathForRepo(root));
    expect(sha).toBe('deadbeef1234567890');
  });

  it('returns "unknown" (no crash) when the sidecar is absent (pre-feature versions)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'engine-source-sha-missing-'));
    const conductorDir = join(root, 'src', 'conductor');
    const versionDir = join(conductorDir, 'dist-versions', '20260723T000000Z-fedcba987654');
    await mkdir(versionDir, { recursive: true });
    await writeFile(join(versionDir, 'index.js'), 'export const engine = 1;\n', 'utf-8');
    await symlink(versionDir, join(conductorDir, 'dist'), 'dir');

    const sha = await readEngineSourceSha(engineEntryPathForRepo(root));
    expect(sha).toBe('unknown');
  });

  it('returns "unknown" (no crash) when dist is not a symlink at all', async () => {
    const root = await mkdtemp(join(tmpdir(), 'engine-source-sha-nolink-'));
    const distDir = join(root, 'src', 'conductor', 'dist');
    await mkdir(distDir, { recursive: true });
    await writeFile(join(distDir, 'index.js'), 'export const engine = 1;\n', 'utf-8');

    const sha = await readEngineSourceSha(engineEntryPathForRepo(root));
    expect(sha).toBe('unknown');
  });
});
