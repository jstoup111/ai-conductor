import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// ─────────────────────────────────────────────────────────────────────────────
// Failing acceptance specs for the NOT-YET-BUILT pause-marker module
// (Phase 2, FR-1/FR-4). Sibling of halt-marker.ts: `.daemon/PAUSED` is the
// single-source, existence-authoritative marker the daemon loop checks before
// dispatching new work. Unlike HALT (plain-text reason), PAUSED carries JSON
// metadata (`{pausedAt, pausedBy}`) that is informational only — a corrupt or
// unreadable marker must still read as paused (fail-closed), just without
// metadata.
// ─────────────────────────────────────────────────────────────────────────────

const MOD_PATH = '../../src/engine/pause-marker.js';

async function load(): Promise<Record<string, unknown>> {
  // Throws (RED) if the module does not exist yet — the intended pre-impl failure.
  return (await import(MOD_PATH)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: any[]) => any;
}

let repoPath: string;

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'pause-marker-'));
});

afterEach(async () => {
  await rm(repoPath, { recursive: true, force: true });
});

describe('pause-marker', () => {
  it('exposes the single-source PAUSE_MARKER path under .daemon/PAUSED', async () => {
    const mod = await load();
    expect(mod.PAUSE_MARKER).toBe('.daemon/PAUSED');
  });

  it('isPaused reports false when the marker does not exist (ENOENT)', async () => {
    const mod = await load();
    const isPaused = requireFn(mod, 'isPaused');
    await expect(isPaused(repoPath)).resolves.toBe(false);
  });

  it('isPaused reports true when the marker exists', async () => {
    const mod = await load();
    const isPaused = requireFn(mod, 'isPaused');
    const writePauseMarker = requireFn(mod, 'writePauseMarker');

    await writePauseMarker(repoPath, { pausedBy: 'operator' });

    await expect(isPaused(repoPath)).resolves.toBe(true);
  });

  it('writePauseMarker creates .daemon/ if needed and records pausedAt/pausedBy metadata', async () => {
    const mod = await load();
    const writePauseMarker = requireFn(mod, 'writePauseMarker');

    await writePauseMarker(repoPath, { pausedBy: 'operator' });

    const raw = await readFile(join(repoPath, '.daemon', 'PAUSED'), 'utf-8');
    const parsed = JSON.parse(raw) as { pausedAt?: string; pausedBy?: string };

    expect(typeof parsed.pausedAt).toBe('string');
    expect(Number.isNaN(Date.parse(parsed.pausedAt as string))).toBe(false);
    expect(parsed.pausedBy).toBe('operator');
  });

  it('writePauseMarker is idempotent — calling it repeatedly does not throw and leaves a valid marker', async () => {
    const mod = await load();
    const writePauseMarker = requireFn(mod, 'writePauseMarker');
    const isPaused = requireFn(mod, 'isPaused');

    await writePauseMarker(repoPath, { pausedBy: 'operator' });
    await writePauseMarker(repoPath, { pausedBy: 'operator-again' });
    await writePauseMarker(repoPath, { pausedBy: 'operator-again' });

    await expect(isPaused(repoPath)).resolves.toBe(true);
    const raw = await readFile(join(repoPath, '.daemon', 'PAUSED'), 'utf-8');
    const parsed = JSON.parse(raw) as { pausedBy?: string };
    expect(parsed.pausedBy).toBe('operator-again');
  });

  it('removePauseMarker deletes the marker', async () => {
    const mod = await load();
    const writePauseMarker = requireFn(mod, 'writePauseMarker');
    const removePauseMarker = requireFn(mod, 'removePauseMarker');
    const isPaused = requireFn(mod, 'isPaused');

    await writePauseMarker(repoPath, { pausedBy: 'operator' });
    await removePauseMarker(repoPath);

    await expect(isPaused(repoPath)).resolves.toBe(false);
  });

  it('removePauseMarker is idempotent — safe to call when no marker exists', async () => {
    const mod = await load();
    const removePauseMarker = requireFn(mod, 'removePauseMarker');
    const isPaused = requireFn(mod, 'isPaused');

    await expect(removePauseMarker(repoPath)).resolves.not.toThrow();
    await expect(removePauseMarker(repoPath)).resolves.not.toThrow();
    await expect(isPaused(repoPath)).resolves.toBe(false);
  });

  it('reading a corrupt marker fails closed: paused=true with metadata undefined', async () => {
    const mod = await load();
    const isPaused = requireFn(mod, 'isPaused');
    const readPauseMetadata = requireFn(mod, 'readPauseMetadata');

    await mkdir(join(repoPath, '.daemon'), { recursive: true });
    await writeFile(join(repoPath, '.daemon', 'PAUSED'), '{not valid json', 'utf-8');

    await expect(isPaused(repoPath)).resolves.toBe(true);
    await expect(readPauseMetadata(repoPath)).resolves.toBeUndefined();
  });
});
