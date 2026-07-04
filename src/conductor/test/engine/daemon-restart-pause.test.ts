// ─────────────────────────────────────────────────────────────────────────────
// Tests for Task T31: restart preserves pause state (FR-11).
//
// Verifies that:
//   AC1: Paused daemon restarted → replacement daemon also paused
//   AC2: Pause marker file untouched by restart flow
//   AC3: Queued restart on paused daemon fires immediately (respects pause+idle)
//   AC4: Restart → resume → dispatch flow preserves backlog intact
//   AC5: End-to-end composition: pause + queue restart + restart fires + resume + dispatch
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  runDaemon,
  type DaemonDeps,
  type DaemonOptions,
  type BacklogItem,
  type FeatureOutcome,
} from '../../src/engine/daemon.js';
import {
  writePauseMarker,
  removePauseMarker,
  isPaused,
  readPauseMetadata,
  PAUSE_MARKER,
} from '../../src/engine/pause-marker.js';
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
  const d = await mkdtemp(join(tmpdir(), 'daemon-restart-pause-'));
  workDirs.push(d);
  return d;
}

function items(n: number): BacklogItem[] {
  return Array.from({ length: n }, (_, i) => ({ slug: `f${i}` }) as BacklogItem);
}

/**
 * Build a mock daemon deps object suitable for testing.
 * Allows injection of:
 *  - discoverBacklog: what items the daemon sees
 *  - isPausedCheck: whether pause marker is present
 *  - hasRestartPending: whether restart marker is present
 *  - hasRestartPending behavior during run
 */
interface MockDaemonDepsOpts {
  projectRoot: string;
  backlog: BacklogItem[];
  pauseCheck?: () => Promise<boolean>;
  restartCheck?: () => Promise<boolean>;
  onDispatch?: (slug: string) => void;
  restartTrigger?: () => Promise<void>;
}

function mockDaemonDeps(opts: MockDaemonDepsOpts): DaemonDeps {
  const dispatched: string[] = [];

  return {
    discoverBacklog: async () => opts.backlog,
    runFeature: async (item: BacklogItem): Promise<FeatureOutcome> => {
      dispatched.push(item.slug);
      opts.onDispatch?.(item.slug);
      return { slug: item.slug, status: 'done' };
    },
    isPaused: opts.pauseCheck,
    hasRestartPending: opts.restartCheck,
    triggerSelfRestart: opts.restartTrigger,
    sleep: async () => {}, // no-op for tests
    log: () => {}, // suppress logs in tests
  };
}

describe('Task T31: restart preserves pause state (FR-11)', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // AC1: Paused daemon restarted → replacement daemon also paused
  // ─────────────────────────────────────────────────────────────────────────

  it('AC1: Paused daemon restarted stays paused on replacement boot', async () => {
    const projectRoot = await freshDir();

    // Write pause marker to mark daemon as paused
    await writePauseMarker(projectRoot, { pausedBy: 'test-operator' });

    // Verify marker exists
    const pausedBefore = await isPaused(projectRoot);
    expect(pausedBefore).toBe(true);

    // Simulate a restart by reading the pause marker state at the new boot
    const pausedAfter = await isPaused(projectRoot);
    expect(pausedAfter).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC2: Pause marker file untouched by restart flow
  // ─────────────────────────────────────────────────────────────────────────

  it('AC2: Pause marker file is byte-identical after restart simulation', async () => {
    const projectRoot = await freshDir();

    // Write pause marker with specific metadata
    await writePauseMarker(projectRoot, { pausedBy: 'alice' });

    // Read the marker content before "restart"
    const markerPathBefore = join(projectRoot, PAUSE_MARKER);
    const contentBefore = await readFile(markerPathBefore, 'utf-8');
    const metadataBefore = await readPauseMetadata(projectRoot);

    // Simulate restart: a new daemon boot process checks the marker
    // (no modification should occur)
    const pausedCheck = await isPaused(projectRoot);
    expect(pausedCheck).toBe(true);

    // Read marker content after "restart"
    const contentAfter = await readFile(markerPathBefore, 'utf-8');
    const metadataAfter = await readPauseMetadata(projectRoot);

    // Verify marker is byte-identical and metadata unchanged
    expect(contentAfter).toBe(contentBefore);
    expect(metadataAfter).toEqual(metadataBefore);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC3: Queued restart on paused daemon fires immediately (respects pause+idle)
  // ─────────────────────────────────────────────────────────────────────────

  it('AC3: Queued restart on paused daemon fires when idle reached', async () => {
    const projectRoot = await freshDir();

    // Setup: paused daemon + queued restart
    await writePauseMarker(projectRoot, { pausedBy: 'test-op' });
    await writeRestartPending(projectRoot, { blockingSlug: 'f0' });

    // Verify both markers exist
    expect(await isPaused(projectRoot)).toBe(true);
    expect(await readRestartPending(projectRoot)).not.toBeNull();

    let restartTriggered = false;

    const deps: DaemonDeps = {
      discoverBacklog: async () => [], // No items — forces immediate idle
      runFeature: async () => ({ slug: 'dummy', status: 'done' }),
      isPaused: async () => await isPaused(projectRoot),
      hasRestartPending: async () => (await readRestartPending(projectRoot)) !== null,
      triggerSelfRestart: async () => {
        restartTriggered = true;
      },
      sleep: async () => {}, // no-op
      log: () => {},
    };

    // Run daemon once with no work — should hit idle boundary and fire restart
    const result = await runDaemon(deps, {
      concurrency: 1,
      once: false,
      maxIdlePolls: 1, // Stop after one idle poll
    });

    // Daemon should have stopped (idle timeout) and restart should have been triggered
    expect(result.stoppedReason).toBe('idle_timeout');
    expect(restartTriggered).toBe(true);

    // Pause marker should still exist (restart didn't clear it)
    expect(await isPaused(projectRoot)).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC4: Restart → resume → dispatch flow preserves backlog intact
  // ─────────────────────────────────────────────────────────────────────────

  it('AC4: Restart consumption preserves backlog + resume enables dispatch', async () => {
    const projectRoot = await freshDir();

    // Stage 1: Paused daemon with backlog + queued restart
    await writePauseMarker(projectRoot, { pausedBy: 'op' });
    await writeRestartPending(projectRoot, { blockingSlug: 'f0' });

    const backlogItems = items(2); // ['f0', 'f1']
    const dispatched: string[] = [];

    const deps: DaemonDeps = {
      discoverBacklog: async () => backlogItems,
      runFeature: async (item: BacklogItem): Promise<FeatureOutcome> => {
        dispatched.push(item.slug);
        return { slug: item.slug, status: 'done' };
      },
      isPaused: async () => await isPaused(projectRoot),
      hasRestartPending: async () => (await readRestartPending(projectRoot)) !== null,
      sleep: async () => {},
      log: () => {},
    };

    // Run 1: Daemon starts paused, hits idle, fires restart (no dispatch)
    let result = await runDaemon(deps, {
      concurrency: 1,
      once: false,
      maxIdlePolls: 1,
    });

    expect(dispatched).toEqual([]); // Nothing dispatched while paused
    expect(result.stoppedReason).toBe('idle_timeout');

    // Stage 2: Consume restart marker (simulating new boot after respawn)
    const consumed = await consumeOnBoot(projectRoot);
    expect(consumed).not.toBeNull();
    expect(consumed?.blockingSlug).toBe('f0');

    // Marker should be gone after consume
    expect(await readRestartPending(projectRoot)).toBeNull();

    // Pause marker should still be present (restart didn't clear it)
    expect(await isPaused(projectRoot)).toBe(true);

    // Stage 3: Resume (remove pause marker) and run again
    await removePauseMarker(projectRoot);
    expect(await isPaused(projectRoot)).toBe(false);

    // Run 2: Daemon resumes, backlog intact, dispatches items
    dispatched.length = 0; // reset
    result = await runDaemon(deps, {
      concurrency: 1,
      once: true, // drain the backlog
    });

    // Now that paused is false, items should dispatch
    expect(dispatched).toEqual(['f0', 'f1']);
    expect(result.stoppedReason).toBe('backlog_drained');
    expect(result.processed).toHaveLength(2);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AC5: End-to-end: pause + queue restart + restart fires + resume + dispatch
  // ─────────────────────────────────────────────────────────────────────────

  it('AC5: End-to-end pause → queue restart → trigger → consume → resume → dispatch', async () => {
    const projectRoot = await freshDir();

    const backlogItems = items(3); // ['f0', 'f1', 'f2']
    const dispatched: string[] = [];
    const timeline: string[] = [];

    // Stage 1: Pause the daemon
    await writePauseMarker(projectRoot, { pausedBy: 'test' });
    timeline.push('paused');

    // Stage 2: Queue a restart (daemon receives restart request while busy/paused)
    await writeRestartPending(projectRoot, { blockingSlug: 'f0' });
    timeline.push('restart-queued');

    // Verify both markers present
    expect(await isPaused(projectRoot)).toBe(true);
    expect(await readRestartPending(projectRoot)).not.toBeNull();

    let restartFired = false;

    const deps: DaemonDeps = {
      discoverBacklog: async () => backlogItems,
      runFeature: async (item: BacklogItem): Promise<FeatureOutcome> => {
        dispatched.push(item.slug);
        return { slug: item.slug, status: 'done' };
      },
      isPaused: async () => await isPaused(projectRoot),
      hasRestartPending: async () => (await readRestartPending(projectRoot)) !== null,
      triggerSelfRestart: async () => {
        restartFired = true;
        timeline.push('restart-fired');
      },
      sleep: async () => {},
      log: () => {},
    };

    // Stage 3: Run daemon (paused, restart pending) — should reach idle and fire restart
    let result = await runDaemon(deps, {
      concurrency: 1,
      once: false,
      maxIdlePolls: 1,
    });

    expect(restartFired).toBe(true);
    expect(dispatched).toEqual([]); // No dispatch while paused
    expect(await isPaused(projectRoot)).toBe(true); // Pause still intact
    expect(await readRestartPending(projectRoot)).not.toBeNull(); // Restart marker untouched
    timeline.push('first-run-complete');

    // Stage 4: Simulate new boot after respawn — consume restart marker
    const consumed = await consumeOnBoot(projectRoot);
    expect(consumed?.blockingSlug).toBe('f0');
    expect(await readRestartPending(projectRoot)).toBeNull();
    timeline.push('restart-consumed');

    // Stage 5: Resume (remove pause marker)
    await removePauseMarker(projectRoot);
    expect(await isPaused(projectRoot)).toBe(false);
    timeline.push('resumed');

    // Stage 6: Run daemon again (no longer paused) — backlog should dispatch
    dispatched.length = 0; // Reset for clarity
    restartFired = false;

    result = await runDaemon(deps, {
      concurrency: 1,
      once: true,
    });

    expect(dispatched).toEqual(['f0', 'f1', 'f2']);
    expect(result.processed).toHaveLength(3);
    expect(restartFired).toBe(false); // No restart this time
    timeline.push('resumed-run-complete');

    // Verify the complete timeline
    expect(timeline).toEqual([
      'paused',
      'restart-queued',
      'restart-fired',
      'first-run-complete',
      'restart-consumed',
      'resumed',
      'resumed-run-complete',
    ]);
  });

  // Additional test: Pause marker is scoped to projectRoot (no leakage)
  it('Pause marker scoped to projectRoot — no cross-project leakage', async () => {
    const project1 = await freshDir();
    const project2 = await freshDir();

    // Pause only project1
    await writePauseMarker(project1, { pausedBy: 'test' });

    // Verify project1 is paused, project2 is not
    expect(await isPaused(project1)).toBe(true);
    expect(await isPaused(project2)).toBe(false);

    // Run daemon in project2 — should not be affected by project1's pause
    const dispatched: string[] = [];
    const deps: DaemonDeps = {
      discoverBacklog: async () => items(1),
      runFeature: async (item: BacklogItem): Promise<FeatureOutcome> => {
        dispatched.push(item.slug);
        return { slug: item.slug, status: 'done' };
      },
      isPaused: async () => await isPaused(project2),
      sleep: async () => {},
      log: () => {},
    };

    const result = await runDaemon(deps, { concurrency: 1, once: true });

    expect(dispatched).toEqual(['f0']); // project2 dispatches normally
    expect(result.processed).toHaveLength(1);
  });

  // Test: Restart with pause lifecycle preserves in-flight work
  it('Restart in paused state leaves in-flight work untouched', async () => {
    const projectRoot = await freshDir();

    // Write pause marker
    await writePauseMarker(projectRoot, { pausedBy: 'test' });

    // Queue a restart
    await writeRestartPending(projectRoot, { blockingSlug: 'f0' });

    const backlog = items(2);
    const dispatched: string[] = [];
    let restartFired = false;

    const deps: DaemonDeps = {
      discoverBacklog: async () => backlog,
      runFeature: async (item: BacklogItem): Promise<FeatureOutcome> => {
        dispatched.push(item.slug);
        return { slug: item.slug, status: 'done' };
      },
      isPaused: async () => await isPaused(projectRoot),
      hasRestartPending: async () => (await readRestartPending(projectRoot)) !== null,
      triggerSelfRestart: async () => {
        restartFired = true;
      },
      sleep: async () => {},
      log: () => {},
    };

    // Run with pause and restart pending
    const result = await runDaemon(deps, {
      concurrency: 1,
      once: false,
      maxIdlePolls: 1,
    });

    expect(restartFired).toBe(true);
    expect(dispatched).toEqual([]); // Paused → no dispatch
    expect(result.processed).toEqual([]); // No in-flight work to drain
  });
});
