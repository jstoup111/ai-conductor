import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { ConductorEventEmitter } from '../../src/ui/events.js';
import { openDaemonLog } from '../../src/engine/daemon-log.js';
import { runDaemonStatus } from '../../src/engine/daemon-observe-cli.js';
import type { ProjectRecord } from '../../src/engine/registry.js';
import type { ConductorEvent } from '../../src/types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for issue #347 / adr-2026-07-10-intra-step-build-progress-events
// (.docs/stories/emit-intra-step-build-progress-and-stall-as-events.md).
//
// Two genuinely cross-component flows this feature's stories call out by name
// as needing an integration-level test (not covered by any single module's
// own unit tests):
//
//  1. Story "build_progress emitted when the build advances" — Done When:
//     "A daemon-mode integration test observes >=1 build_progress on the bus
//     when the fake build flips a task row." Drives the real, not-yet-existing
//     `BuildProgressWatcher` against a real `ConductorEventEmitter` and real
//     `.pipeline/task-status.json` mutations — the watcher module does not
//     exist yet, so this fails on module resolution today (acceptable
//     pre-implementation RED per /writing-system-tests).
//
//  2. Story "daemon.log renders progress, no-progress, and stall lines" —
//     Done When: "An integration test tails a daemon.log written through
//     DaemonLogSink and finds the N/M heartbeat line after a simulated task
//     flip," plus the "lastActivity shows that progress line" happy-path
//     criterion. Drives the REAL, already-existing `openDaemonLog` +
//     `renderDaemonEvent` + `runDaemonStatus`/`computeStatusRow` chain with
//     hand-built ConductorEvent payloads whose shape is pinned exactly by
//     ADR Decision 1 — independent of the not-yet-existing watcher that will
//     produce these events in production.
//
// Everything else in the stories (config validation, heartbeat/quiet-episode
// timing, watcher lifecycle teardown, OTel mapping, EventPersister, the
// json-stdout/TTY renderer switches) is single-module and is covered by the
// TDD tasks' own unit tests (plan Tasks 1-18), not duplicated here.
// ─────────────────────────────────────────────────────────────────────────────

describe('BuildProgressWatcher emits build_progress on the real event bus (S1)', () => {
  let dir: string;
  let emitter: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-progress-watcher-e2e-'));
    emitter = new ConductorEventEmitter();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });

  async function writeTaskStatus(resolved: number, total: number): Promise<void> {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const tasks = Array.from({ length: total }, (_, i) => ({
      id: i + 1,
      status: i < resolved ? 'completed' : 'pending',
    }));
    await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({ tasks }));
  }

  it('flipping task-status.json mid-build emits a real build_progress event on the bus with resolved/total/featureSlug', async () => {
    await writeTaskStatus(5, 21);

    // Real production entry point per the ADR: the watcher module, not a
    // hand-rolled emitter. Does not exist yet — this import/instantiation is
    // the expected pre-implementation failure point.
    const { BuildProgressWatcher } = await import('../../src/engine/build-progress-watcher.js');

    const received: ConductorEvent[] = [];
    emitter.on('build_progress', (e) => received.push(e));

    const watcher = new BuildProgressWatcher({
      projectRoot: dir,
      events: emitter,
      step: 'build',
      featureSlug: 'emit-intra-step-build-progress-and-stall-as-events',
    });

    watcher.start();

    // Simulate the fake build advancing one task while the step is "running".
    await writeTaskStatus(6, 21);

    // Default poll cadence is 30s (ADR D-7) — advance the real bus's clock
    // past one tick without depending on the watcher's internal scheduling
    // mechanism beyond the documented `.unref()'d setInterval` (ADR D-3).
    await vi.advanceTimersByTimeAsync(31_000);

    watcher.stop();

    const progress = received.find((e) => e.type === 'build_progress');
    expect(progress).toBeDefined();
    if (progress?.type === 'build_progress') {
      expect(progress.resolved).toBe(6);
      expect(progress.total).toBe(21);
      expect(progress.featureSlug).toBe('emit-intra-step-build-progress-and-stall-as-events');
    }
  });
});

describe('daemon.log renders build progress/no-progress/stall; daemon status freshness reflects it (S5)', () => {
  let repoPath: string;
  let registryDir: string;
  let registryPath: string;

  beforeEach(async () => {
    repoPath = await mkdtemp(join(tmpdir(), 'build-progress-daemon-log-'));
    registryDir = await mkdtemp(join(tmpdir(), 'build-progress-registry-'));
    registryPath = join(registryDir, 'registry.json');
  });

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true });
    await rm(registryDir, { recursive: true, force: true });
  });

  function record(name: string, path: string): ProjectRecord {
    return {
      schemaVersion: 1,
      name,
      path,
      status: 'active' as ProjectRecord['status'],
      registeredAt: new Date().toISOString(),
    };
  }

  async function writeRegistry(records: ProjectRecord[]): Promise<void> {
    await writeFile(registryPath, JSON.stringify(records), 'utf-8');
  }

  it('a real DaemonLogSink write through renderDaemonEvent produces distinct progress/no-progress/stall lines', async () => {
    // Real production entry point per ADR D-5: not-yet-handled event kinds
    // dispatched through the ACTUAL renderDaemonEvent switch and the ACTUAL
    // append-only log sink — no mocking of either.
    const { renderDaemonEvent } = await import('../../src/daemon-cli.js');
    const sink = await openDaemonLog(repoPath);

    const progressEvent: ConductorEvent = {
      type: 'build_progress',
      step: 'build',
      resolved: 20,
      total: 21,
      currentTaskId: '21',
      currentTaskName: 'Wire watcher into conductor',
      featureSlug: 'emit-intra-step-build-progress-and-stall-as-events',
    };
    const noProgressEvent: ConductorEvent = {
      type: 'build_no_progress',
      step: 'build',
      quietMinutes: 15,
      resolved: 20,
      total: 21,
      currentTaskId: '21',
      featureSlug: 'emit-intra-step-build-progress-and-stall-as-events',
    };
    const stallEvent: ConductorEvent = {
      type: 'build_stall',
      step: 'build',
      reason: 'no_task_progress',
      resolvedBefore: 2,
      resolvedAfter: 2,
    };

    renderDaemonEvent(progressEvent, (line) => sink.write(line));
    renderDaemonEvent(noProgressEvent, (line) => sink.write(line));
    renderDaemonEvent(stallEvent, (line) => sink.write(line));
    await sink.close();

    const content = await readFile(join(repoPath, '.daemon/daemon.log'), 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    // One line per event — today's renderDaemonEvent switch has no cases for
    // these three kinds, so nothing is written and this fails on length.
    expect(lines.length).toBeGreaterThanOrEqual(3);

    const progressLine = lines.find((l) => l.includes('20/21'));
    expect(progressLine).toBeDefined();
    expect(progressLine).toContain('emit-intra-step-build-progress-and-stall-as-events');

    const noProgressLine = lines.find((l) => l.includes('15'));
    expect(noProgressLine).toBeDefined();
    // Warning line must be visually distinct from the plain progress heartbeat line.
    expect(noProgressLine).not.toBe(progressLine);

    const stallLine = lines.find((l) => l.includes('no_task_progress'));
    expect(stallLine).toBeDefined();
    expect(stallLine).toContain('2');
  });

  it('daemon status lastActivity shows the build_progress line via the real log-tail path', async () => {
    const { renderDaemonEvent } = await import('../../src/daemon-cli.js');
    const sink = await openDaemonLog(repoPath);

    const progressEvent: ConductorEvent = {
      type: 'build_progress',
      step: 'build',
      resolved: 20,
      total: 21,
      currentTaskId: '21',
      featureSlug: 'emit-intra-step-build-progress-and-stall-as-events',
    };
    renderDaemonEvent(progressEvent, (line) => sink.write(line));
    await sink.close();

    await writeRegistry([record('repo-a', repoPath)]);

    const { rows } = await runDaemonStatus({ registryPath, out: () => {} });

    expect(rows).toHaveLength(1);
    // Fails today: no line was ever written (renderDaemonEvent drops the
    // event), so lastActivity is undefined rather than containing "20/21".
    expect(rows[0].lastActivity).toBeDefined();
    expect(rows[0].lastActivity).toContain('20/21');
  });
});
