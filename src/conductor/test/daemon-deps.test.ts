import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, unlink, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const MOD_PATH = '../src/engine/daemon-deps.js';

async function load(): Promise<Record<string, unknown>> {
  return (await import(MOD_PATH)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: any[]) => any;
}

describe('watchHaltCleared — real filesystem watcher for HALT marker', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-deps-watch-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario (a): create then `rm` `.pipeline/HALT` → `onCleared` fires
  // ───────────────────────────────────────────────────────────────────────────
  it('create then rm .pipeline/HALT → onCleared fires', async () => {
    const mod = await load();
    const watchHaltCleared = requireFn(mod, 'watchHaltCleared');

    const slug = 'test-feature-1';
    const worktreeDir = join(tempDir, slug);
    const pipelineDir = join(worktreeDir, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });

    // Create the HALT marker
    await writeFile(join(pipelineDir, 'HALT'), 'halted\n', 'utf-8');

    // Track if onCleared was called
    let onClearedCalled = false;
    const dispose = watchHaltCleared(tempDir, slug, () => {
      onClearedCalled = true;
    });

    // Give the watcher time to set up
    await new Promise((r) => setTimeout(r, 100));

    // Delete the HALT file
    await unlink(join(pipelineDir, 'HALT'));

    // Wait for the watcher to detect the deletion and call onCleared
    await vi.waitFor(() => expect(onClearedCalled).toBe(true), { timeout: 2000 });

    dispose();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario (b): rename `HALT` → `HALT.cleared` → fires (rekick rename scenario)
  // ───────────────────────────────────────────────────────────────────────────
  it('rename HALT → HALT.cleared → onCleared fires', async () => {
    const mod = await load();
    const watchHaltCleared = requireFn(mod, 'watchHaltCleared');

    const slug = 'test-feature-2';
    const worktreeDir = join(tempDir, slug);
    const pipelineDir = join(worktreeDir, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });

    // Create the HALT marker
    const haltPath = join(pipelineDir, 'HALT');
    await writeFile(haltPath, 'halted\n', 'utf-8');

    // Track if onCleared was called
    let onClearedCalled = false;
    const dispose = watchHaltCleared(tempDir, slug, () => {
      onClearedCalled = true;
    });

    // Give the watcher time to set up
    await new Promise((r) => setTimeout(r, 100));

    // Rename HALT to HALT.cleared (what the rekick flow does)
    await rename(haltPath, join(pipelineDir, 'HALT.cleared'));

    // Wait for the watcher to detect the rename and call onCleared
    await vi.waitFor(() => expect(onClearedCalled).toBe(true), { timeout: 2000 });

    dispose();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario (c): after `dispose()`, subsequent create/rm fires nothing
  // ───────────────────────────────────────────────────────────────────────────
  it('after dispose(), subsequent rm fires nothing', async () => {
    const mod = await load();
    const watchHaltCleared = requireFn(mod, 'watchHaltCleared');

    const slug = 'test-feature-3';
    const worktreeDir = join(tempDir, slug);
    const pipelineDir = join(worktreeDir, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });

    // Create the HALT marker
    const haltPath = join(pipelineDir, 'HALT');
    await writeFile(haltPath, 'halted\n', 'utf-8');

    // Track if onCleared was called
    let onClearedCalled = false;
    const dispose = watchHaltCleared(tempDir, slug, () => {
      onClearedCalled = true;
    });

    // Give the watcher time to set up
    await new Promise((r) => setTimeout(r, 100));

    // Dispose the watcher
    dispose();

    // Give the watcher time to shut down
    await new Promise((r) => setTimeout(r, 100));

    // Delete the HALT file after disposal
    await unlink(haltPath);

    // Wait a bit to be sure the watcher doesn't fire
    await new Promise((r) => setTimeout(r, 500));

    // onCleared should NOT have been called
    expect(onClearedCalled).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario (d): non-existent worktree dir → returns no-op dispose, no throw
  // ───────────────────────────────────────────────────────────────────────────
  it('non-existent worktree dir → returns no-op dispose, no throw', async () => {
    const mod = await load();
    const watchHaltCleared = requireFn(mod, 'watchHaltCleared');

    const slug = 'non-existent-feature';
    const nonExistentBase = join(tempDir, 'does-not-exist');

    // Should not throw
    let dispose;
    expect(() => {
      dispose = watchHaltCleared(nonExistentBase, slug, () => {
        /* should not be called */
      });
    }).not.toThrow();

    // dispose should be a function
    expect(typeof dispose).toBe('function');

    // Calling dispose should not throw
    expect(() => {
      dispose();
    }).not.toThrow();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario (e): `onCleared` NOT fired when HALT still exists (guard re-verification)
  // ───────────────────────────────────────────────────────────────────────────
  it('onCleared NOT fired when HALT still exists (guard re-verification)', async () => {
    const mod = await load();
    const watchHaltCleared = requireFn(mod, 'watchHaltCleared');

    const slug = 'test-feature-5';
    const worktreeDir = join(tempDir, slug);
    const pipelineDir = join(worktreeDir, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });

    // Create the HALT marker
    const haltPath = join(pipelineDir, 'HALT');
    await writeFile(haltPath, 'halted\n', 'utf-8');

    // Track if onCleared was called
    let onClearedCalled = false;
    const dispose = watchHaltCleared(tempDir, slug, () => {
      onClearedCalled = true;
    });

    // Give the watcher time to set up
    await new Promise((r) => setTimeout(r, 100));

    // Create a sibling file in .pipeline to trigger a watcher event
    // but the HALT file still exists
    const otherFile = join(pipelineDir, 'OTHER');
    await writeFile(otherFile, 'other\n', 'utf-8');

    // Wait a bit to see if onCleared fires (it shouldn't)
    await new Promise((r) => setTimeout(r, 300));
    expect(onClearedCalled).toBe(false);

    // Now delete the HALT file
    await unlink(haltPath);

    // Now onCleared should fire
    await vi.waitFor(() => expect(onClearedCalled).toBe(true), { timeout: 2000 });

    dispose();
  });
});
