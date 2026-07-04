/**
 * Tests for Task T30: Bare-Run Pending Restart — Clean Exit
 *
 * When a daemon runs in bare-run mode (no supervisor, no session hosting) and
 * reaches idle with a restart marker, it should:
 * 1. Log "restart-pending honored" or equivalent
 * 2. Consume the marker atomically
 * 3. Exit cleanly (return with appropriate stop reason)
 *
 * This is distinct from the supervisor case (T28) where triggerSelfRestart is
 * injected to fire the respawn. In bare-run, no respawn callback is available,
 * so the marker is consumed and the daemon exits.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runDaemon, type BacklogItem, type DaemonDeps } from '../../src/engine/daemon.js';
import { writeRestartPending, consumeOnBoot } from '../../src/engine/restart-marker.js';

let workDirs: string[] = [];

beforeEach(() => {
  workDirs = [];
});

afterEach(async () => {
  await Promise.all(workDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function freshDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'daemon-bare-run-restart-'));
  workDirs.push(d);
  return d;
}

function items(n: number): BacklogItem[] {
  return Array.from({ length: n }, (_, i) => ({ slug: `f${i}` }));
}

describe('Task T30 — Bare-Run Pending Restart — Clean Exit', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // AC1: Bare-run daemon (no supervisor) reaching idle with restart marker
  // should log restart-pending honored and exit cleanly
  // ─────────────────────────────────────────────────────────────────────────

  it('AC1: Bare-run daemon at idle with restart marker logs honored and exits cleanly', async () => {
    const projectRoot = await freshDir();

    // Setup: write restart marker before daemon boots
    await writeRestartPending(projectRoot, {
      blockingSlug: 'feature-a',
      requestedBy: 'test-user',
    });

    const logs: string[] = [];
    let markerConsumed = false;

    const deps: DaemonDeps = {
      // No backlog — daemon will reach idle immediately
      discoverBacklog: async () => [],
      runFeature: async (item) => ({ slug: item.slug, status: 'done' }),
      log: (msg) => logs.push(msg),
      sleep: async () => {}, // no real waiting

      // Bare-run deps: hasRestartPending is injected, but triggerSelfRestart is NOT
      // (that's the key difference from supervisor mode)
      hasRestartPending: async () => {
        // Just check if marker exists, don't consume yet
        const intent = await import('../../src/engine/restart-marker.js').then((m) =>
          m.readRestartPending(projectRoot),
        );
        return intent !== null;
      },
      // Bare-run consume function (injected, not supervisor)
      consumeRestartPending: async () => {
        const intent = await consumeOnBoot(projectRoot);
        if (intent) {
          markerConsumed = true;
        }
        return intent;
      },
      // triggerSelfRestart is deliberately absent (bare-run = no supervisor)
    };

    const result = await runDaemon(deps, {
      concurrency: 1,
      once: true,
    });

    // Verify the marker was consumed
    expect(markerConsumed).toBe(true);

    // Verify the result indicates clean exit with restart honored
    expect(result.stoppedReason).toBe('backlog_drained');

    // Verify a log message about restart-pending was produced
    const restartLog = logs.find((msg) => msg.includes('restart-pending'));
    expect(restartLog).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC2: Bare-run daemon with no marker should operate normally (no early exit)
  // ─────────────────────────────────────────────────────────────────────────

  it('AC2: Bare-run daemon with no restart marker operates normally', async () => {
    const projectRoot = await freshDir();

    // No marker written — clean start
    const dispatched: string[] = [];
    const logs: string[] = [];

    const deps: DaemonDeps = {
      discoverBacklog: async () => items(1),
      runFeature: async (item) => {
        dispatched.push(item.slug);
        return { slug: item.slug, status: 'done' };
      },
      log: (msg) => logs.push(msg),
      sleep: async () => {},

      hasRestartPending: async () => {
        const { readRestartPending } = await import('../../src/engine/restart-marker.js');
        const intent = await readRestartPending(projectRoot);
        return intent !== null;
      },
      consumeRestartPending: async () => consumeOnBoot(projectRoot),
      // No triggerSelfRestart (bare-run)
    };

    const result = await runDaemon(deps, {
      concurrency: 1,
      once: true,
    });

    // Normal completion: backlog was processed
    expect(dispatched).toEqual(['f0']);
    expect(result.processed.length).toBe(1);
    expect(result.stoppedReason).toBe('backlog_drained');

    // No restart log (no marker present)
    const restartLog = logs.find((msg) => msg.includes('restart-pending'));
    expect(restartLog).toBeUndefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC3: Bare-run with active work in-flight then marker at idle
  // should drain in-flight work, then honor restart at boundary
  // ─────────────────────────────────────────────────────────────────────────

  it('AC3: In-flight work drains before bare-run restart at idle boundary', async () => {
    const projectRoot = await freshDir();

    let resolveFeature: (() => void) | undefined;
    const dispatched: string[] = [];
    const completed: string[] = [];
    const logs: string[] = [];
    let writeMarkerNow = false;
    let markerConsumed = false;

    const deps: DaemonDeps = {
      discoverBacklog: async () => {
        // After first dispatch, no more backlog
        return dispatched.length === 0 ? items(1) : [];
      },
      runFeature: async (item) => {
        dispatched.push(item.slug);
        // On start, signal to write the marker (simulating a concurrent restart request)
        writeMarkerNow = true;
        // Wait for the test to resolve this feature
        await new Promise<void>((resolve) => {
          resolveFeature = resolve;
        });
        completed.push(item.slug);
        return { slug: item.slug, status: 'done' };
      },
      log: (msg) => logs.push(msg),
      sleep: async () => {},

      hasRestartPending: async () => {
        if (writeMarkerNow) {
          // Simulate marker appearing while feature is in-flight
          await writeRestartPending(projectRoot, { blockingSlug: 'f0' });
          writeMarkerNow = false;
        }
        const { readRestartPending } = await import('../../src/engine/restart-marker.js');
        const intent = await readRestartPending(projectRoot);
        return intent !== null;
      },
      consumeRestartPending: async () => {
        const intent = await consumeOnBoot(projectRoot);
        if (intent) {
          markerConsumed = true;
        }
        return intent;
      },
    };

    const runPromise = runDaemon(deps, { concurrency: 1, once: true });

    // Let the feature start and the marker get written
    await new Promise((r) => setTimeout(r, 10));
    expect(dispatched).toEqual(['f0']);

    // Release the in-flight feature so it completes
    resolveFeature?.();

    const result = await runPromise;

    // Feature was completed
    expect(completed).toEqual(['f0']);
    expect(result.processed.length).toBe(1);

    // At the idle boundary after in-flight work drained, the marker was consumed
    expect(markerConsumed).toBe(true);

    // Restart was honored
    const restartLog = logs.find((msg) => msg.includes('restart-pending'));
    expect(restartLog).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC4: Marker present but supervisor DOES exist (T28 path) — should use
  // supervisor callback, NOT bare-run path. Verify that triggerSelfRestart
  // takes precedence when both deps are present.
  // ─────────────────────────────────────────────────────────────────────────

  it('AC4: When triggerSelfRestart is injected (supervisor), use it instead of bare-run path', async () => {
    const projectRoot = await freshDir();

    // Write a restart marker
    await writeRestartPending(projectRoot, { blockingSlug: 'f0' });

    const logs: string[] = [];
    let triggerCalled = false;
    let consumeCalled = false;

    const deps: DaemonDeps = {
      discoverBacklog: async () => [],
      runFeature: async (item) => ({ slug: item.slug, status: 'done' }),
      log: (msg) => logs.push(msg),
      sleep: async () => {},

      hasRestartPending: async () => {
        // Just check if marker exists, don't consume
        const { readRestartPending } = await import('../../src/engine/restart-marker.js');
        const intent = await readRestartPending(projectRoot);
        return intent !== null;
      },

      consumeRestartPending: async () => {
        // If bare-run path runs, this would be called
        consumeCalled = true;
        return await consumeOnBoot(projectRoot);
      },

      // BOTH deps present: supervisor case (T28)
      triggerSelfRestart: async () => {
        triggerCalled = true;
        // Supervisor-injected callback handles the respawn
      },
    };

    const result = await runDaemon(deps, {
      concurrency: 1,
      once: true,
    });

    // T28 path (supervisor) should have been taken
    expect(triggerCalled).toBe(true);

    // Bare-run consume should NOT have been called (supervisor took precedence)
    expect(consumeCalled).toBe(false);

    // Supervisor path was used (logged "firing trigger")
    const logContent = logs.join('\n');
    expect(logContent).toContain('self-restart marker found');
    expect(logContent).toContain('firing trigger');
  });
});
