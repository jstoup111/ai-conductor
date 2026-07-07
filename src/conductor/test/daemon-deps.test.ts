import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, unlink, rename, readFile } from 'node:fs/promises';
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

// ─────────────────────────────────────────────────────────────────────────────
// Task 15: watchHaltCleared appends a `halt_cleared` audit record with
// operator/rekick cause attribution.
// ─────────────────────────────────────────────────────────────────────────────
describe('watchHaltCleared — halt_cleared audit record with cause attribution (Task 15)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-deps-watch-audit-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function readAuditRecords(worktreePath: string): Promise<Array<Record<string, unknown>>> {
    try {
      const content = await readFile(
        join(worktreePath, '.pipeline', 'audit-trail', 'events.jsonl'),
        'utf-8',
      );
      return content
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }

  // AC1: operator deletes .pipeline/HALT directly → cause:'operator'
  it('operator deletes .pipeline/HALT → appends halt_cleared record with cause "operator"', async () => {
    const mod = await load();
    const watchHaltCleared = requireFn(mod, 'watchHaltCleared');

    const slug = 'audit-operator-clear';
    const worktreePath = join(tempDir, slug);
    const pipelineDir = join(worktreePath, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });
    await writeFile(join(pipelineDir, 'HALT'), 'halted\n', 'utf-8');

    let onClearedCalled = false;
    const dispose = watchHaltCleared(tempDir, slug, () => {
      onClearedCalled = true;
    });

    await new Promise((r) => setTimeout(r, 100));
    await unlink(join(pipelineDir, 'HALT'));

    await vi.waitFor(() => expect(onClearedCalled).toBe(true), { timeout: 2000 });

    const records = await readAuditRecords(worktreePath);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ event: 'halt_cleared', cause: 'operator' });
    expect(typeof records[0].at).toBe('number');

    dispose();
  });

  // AC2: rekick renames HALT -> HALT.cleared → cause:'rekick'
  it('rekick renames HALT to HALT.cleared → appends halt_cleared record with cause "rekick"', async () => {
    const mod = await load();
    const watchHaltCleared = requireFn(mod, 'watchHaltCleared');

    const slug = 'audit-rekick-clear';
    const worktreePath = join(tempDir, slug);
    const pipelineDir = join(worktreePath, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });
    const haltPath = join(pipelineDir, 'HALT');
    await writeFile(haltPath, 'halted\n', 'utf-8');

    let onClearedCalled = false;
    const dispose = watchHaltCleared(tempDir, slug, () => {
      onClearedCalled = true;
    });

    await new Promise((r) => setTimeout(r, 100));
    await rename(haltPath, join(pipelineDir, 'HALT.cleared'));

    await vi.waitFor(() => expect(onClearedCalled).toBe(true), { timeout: 2000 });

    const records = await readAuditRecords(worktreePath);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ event: 'halt_cleared', cause: 'rekick' });

    dispose();
  });

  // AC3: worktree removed between unlink and append → loud log, no throw, daemon alive
  it('worktree removed between unlink and append → logs loudly, does not throw, onCleared still fires', async () => {
    const mod = await load();
    const watchHaltCleared = requireFn(mod, 'watchHaltCleared');

    const slug = 'audit-worktree-removed';
    const worktreePath = join(tempDir, slug);
    const pipelineDir = join(worktreePath, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });
    const haltPath = join(pipelineDir, 'HALT');
    await writeFile(haltPath, 'halted\n', 'utf-8');

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    let onClearedCalled = false;
    const dispose = watchHaltCleared(tempDir, slug, () => {
      onClearedCalled = true;
    });

    await new Promise((r) => setTimeout(r, 100));

    // Simulate the worktree vanishing out from under the watcher: remove the
    // whole worktree directory (including HALT) and replace it with a plain
    // file at the same path, so a later `mkdirSync(auditDir, {recursive:
    // true})` cannot recreate `.pipeline/audit-trail` under it (ENOTDIR) —
    // a true "gone" case rather than one recursive mkdir silently repairs.
    await rm(worktreePath, { recursive: true, force: true });
    await writeFile(worktreePath, 'not a directory\n', 'utf-8');

    await vi.waitFor(() => expect(onClearedCalled).toBe(true), { timeout: 2000 });

    // No audit record could be written (dir is gone) — but a loud log was
    // emitted and nothing threw (this test itself proves no throw escaped).
    const wroteFailureLog = stderrSpy.mock.calls.some((call) =>
      String(call[0]).includes('WRITE-FAILED'),
    );
    expect(wroteFailureLog).toBe(true);

    stderrSpy.mockRestore();
    dispose();
  });

  // AC4: watcher on missing dir → no-op dispose, no throw (contract preserved)
  it('missing worktree dir → no-op dispose, no throw, no audit record attempted', async () => {
    const mod = await load();
    const watchHaltCleared = requireFn(mod, 'watchHaltCleared');

    const slug = 'audit-missing-dir';
    const nonExistentBase = join(tempDir, 'does-not-exist');

    let dispose;
    expect(() => {
      dispose = watchHaltCleared(nonExistentBase, slug, () => {
        /* should not be called */
      });
    }).not.toThrow();

    expect(typeof dispose).toBe('function');
    expect(() => dispose()).not.toThrow();
  });
});
