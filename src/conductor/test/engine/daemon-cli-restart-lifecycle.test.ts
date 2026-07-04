// ─────────────────────────────────────────────────────────────────────────────
// Tests: daemon-cli restart lifecycle consume-once semantics (Task T29).
//
// Verifies that:
// 1. Restart marker present at daemon boot → consumed and logged as fulfilled
// 2. Marker absent at boot → no consume, loop runs normally
// 3. Multiple writes to marker while daemon busy → only one fire at idle
// 4. Marker consumption happens exactly once per boot
// 5. Consume operation is idempotent (safe to call multiple times)
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  writeRestartPending,
  consumeOnBoot,
  readRestartPending,
  RESTART_MARKER,
} from '../../src/engine/restart-marker.js';

let workDirs: string[] = [];

beforeEach(() => {
  workDirs = [];
});

afterEach(async () => {
  await Promise.all(workDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function freshDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'daemon-cli-restart-'));
  workDirs.push(d);
  return d;
}

describe('Task T29 — consume-once restart marker at boot', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // AC1: Restart marker present at daemon boot → consumed and logged as fulfilled
  // ─────────────────────────────────────────────────────────────────────────

  it('AC1: Boot with marker present → consumed and logged', async () => {
    const projectRoot = await freshDir();

    // Write a restart marker to simulate a pending restart from before this boot
    await writeRestartPending(projectRoot, {
      blockingSlug: 'feature-a',
      requestedBy: 'test-user',
    });

    // Verify marker exists before consume
    const markerBefore = await readRestartPending(projectRoot);
    expect(markerBefore).not.toBeNull();
    expect(markerBefore?.blockingSlug).toBe('feature-a');

    // Simulate boot-time consumption (what daemon-cli will do)
    const consumedIntent = await consumeOnBoot(projectRoot);

    // Verify marker was consumed
    expect(consumedIntent).not.toBeNull();
    expect(consumedIntent?.blockingSlug).toBe('feature-a');
    expect(consumedIntent?.requestedBy).toBe('test-user');

    // Verify marker no longer exists (consumed, not just read)
    const markerAfter = await readRestartPending(projectRoot);
    expect(markerAfter).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC2: Marker absent at boot → no consume, loop runs normally
  // ─────────────────────────────────────────────────────────────────────────

  it('AC2: Boot with no marker present → consume returns null, no-op', async () => {
    const projectRoot = await freshDir();

    // No marker written — projectRoot is clean

    // Consume on boot should return null (no marker to consume)
    const consumedIntent = await consumeOnBoot(projectRoot);
    expect(consumedIntent).toBeNull();

    // No side effects: no marker created, filesystem untouched
    try {
      await readFile(join(projectRoot, RESTART_MARKER), 'utf-8');
      throw new Error('marker should not exist');
    } catch (e) {
      // Expected: marker does not exist
      expect((e as NodeJS.ErrnoException).code).toBe('ENOENT');
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC3: Multiple writes to marker while daemon busy → only one fire at idle
  // ─────────────────────────────────────────────────────────────────────────

  it('AC3: Multiple marker writes → one logical intent, one consume at boot', async () => {
    const projectRoot = await freshDir();

    // Simulate two rapid requests while daemon is busy (not yet booted)
    await writeRestartPending(projectRoot, {
      blockingSlug: 'feature-a',
      requestedBy: 'alice',
    });
    await writeRestartPending(projectRoot, {
      blockingSlug: 'feature-b', // Updated slug from second request
      requestedBy: 'bob',
    });

    // Verify only one marker exists (idempotent write)
    const entries = await mkdir(join(projectRoot, '.daemon'), { recursive: true })
      .then(() => require('node:fs/promises').readdir(join(projectRoot, '.daemon')))
      .catch(() => []);
    expect(entries).toEqual(['RESTART-PENDING']);

    // Boot and consume: one logical intent fired (latest values)
    const consumedIntent = await consumeOnBoot(projectRoot);
    expect(consumedIntent).not.toBeNull();
    expect(consumedIntent?.blockingSlug).toBe('feature-b'); // Latest write wins
    expect(consumedIntent?.requestedBy).toBe('bob');

    // Marker removed (consumed, not re-fired)
    const markerAfter = await readRestartPending(projectRoot);
    expect(markerAfter).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC4: Marker consumption happens exactly once per boot
  // ─────────────────────────────────────────────────────────────────────────

  it('AC4: Second consume after boot returns null — never fires twice', async () => {
    const projectRoot = await freshDir();

    // Write marker before boot
    await writeRestartPending(projectRoot, {
      blockingSlug: 'feature-a',
      requestedBy: 'alice',
    });

    // First consume at boot
    const firstConsume = await consumeOnBoot(projectRoot);
    expect(firstConsume).not.toBeNull();
    expect(firstConsume?.blockingSlug).toBe('feature-a');

    // Second consume (simulating another call later in same boot) returns null
    const secondConsume = await consumeOnBoot(projectRoot);
    expect(secondConsume).toBeNull();

    // Marker stays gone
    const markerAfter = await readRestartPending(projectRoot);
    expect(markerAfter).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC5: Consume operation is idempotent (safe to call multiple times)
  // ─────────────────────────────────────────────────────────────────────────

  it('AC5: Consume is idempotent — multiple calls on absent marker never error', async () => {
    const projectRoot = await freshDir();

    // Call consume multiple times on absent marker (should not throw)
    const first = await consumeOnBoot(projectRoot);
    const second = await consumeOnBoot(projectRoot);
    const third = await consumeOnBoot(projectRoot);

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(third).toBeNull();

    // No exceptions, filesystem still clean
    try {
      await readFile(join(projectRoot, RESTART_MARKER), 'utf-8');
      throw new Error('marker should not exist');
    } catch (e) {
      expect((e as NodeJS.ErrnoException).code).toBe('ENOENT');
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC5 extended: Consume is idempotent on corrupted marker
  // ─────────────────────────────────────────────────────────────────────────

  it('AC5+: Corrupted marker is consumed (not left dangling) and idempotent', async () => {
    const projectRoot = await freshDir();

    // Write a good marker, then corrupt it
    await writeRestartPending(projectRoot, { blockingSlug: 'f0' });
    await writeFile(join(projectRoot, RESTART_MARKER), '{invalid json', 'utf-8');

    // First consume: removes corrupted marker, returns partial intent
    const firstConsume = await consumeOnBoot(projectRoot);
    expect(firstConsume).not.toBeNull();
    expect(firstConsume?.requestedAt).toBeDefined();

    // Marker should be gone (consumed)
    const markerAfter = await readRestartPending(projectRoot);
    expect(markerAfter).toBeNull();

    // Second consume: marker is gone, returns null
    const secondConsume = await consumeOnBoot(projectRoot);
    expect(secondConsume).toBeNull();
  });
});
