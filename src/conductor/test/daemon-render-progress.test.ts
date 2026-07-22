import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import chalk from 'chalk';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// daemon-cli transitively imports the provider layer (execa); stub it so this
// pure-formatting test doesn't pull a live process dependency.
vi.mock('execa', () => ({ execa: vi.fn() }));

import { renderDaemonEvent } from '../src/daemon-cli.js';
import type { ConductorEvent } from '../src/types/index.js';
import { openDaemonLog, formatDaemonLogLine } from '../src/engine/daemon-log.js';
import { computeStatusRow } from '../src/engine/daemon-observe-cli.js';

// ─────────────────────────────────────────────────────────────────────────────
// Task 11: daemon.log renders the three intra-step build kinds
// (adr-2026-07-10-intra-step-build-progress-events).
// ─────────────────────────────────────────────────────────────────────────────

function lines(event: ConductorEvent): string[] {
  const out: string[] = [];
  renderDaemonEvent(event, (m) => out.push(m));
  return out;
}

const originalLevel = chalk.level;
afterEach(() => {
  chalk.level = originalLevel;
});

describe('renderDaemonEvent: build_progress / build_no_progress / build_stall', () => {
  beforeEach(() => {
    chalk.level = 0;
  });

  it('renders build_progress with step, N/total, current task, and feature slug', () => {
    const [line] = lines({
      type: 'build_progress',
      step: 'build',
      resolved: 20,
      total: 21,
      currentTaskId: '21',
      currentTaskName: 'Wire watcher into conductor',
      featureSlug: 'emit-intra-step-build-progress-and-stall-as-events',
    });

    expect(line).toBeDefined();
    expect(line).toContain('build');
    expect(line).toContain('21/21');
    expect(line).toContain('Wire watcher into conductor');
    expect(line).toContain('emit-intra-step-build-progress-and-stall-as-events');
  });

  it('renders a minimal build_progress event (no currentTaskName/featureSlug) without throwing', () => {
    const [line] = lines({ type: 'build_progress', step: 'build', resolved: 5, total: 21 });
    expect(line).toContain('5/21');
  });

  it('renders the first in-progress task as 1/N, never 0/N (Story 1.1)', () => {
    const [line] = lines({
      type: 'build_progress',
      step: 'build',
      resolved: 0,
      total: 18,
      currentTaskId: '1',
    });
    expect(line).toContain('1/18');
    expect(line).not.toContain('0/18');
  });

  it('renders an all-done build as N/N, not N+1/N, when there is no current task (Story 2.1)', () => {
    const [line] = lines({ type: 'build_progress', step: 'build', resolved: 18, total: 18 });
    expect(line).toContain('18/18');
    expect(line).not.toContain('19/18');
  });

  it('renders a plain resolved count unincremented when there is no current task (Story 2.2)', () => {
    const [line] = lines({ type: 'build_progress', step: 'build', resolved: 5, total: 21 });
    expect(line).toContain('5/21');
  });

  it('does not mutate the input event object (Story 2.3)', () => {
    const event: ConductorEvent = {
      type: 'build_progress',
      step: 'build',
      resolved: 0,
      total: 18,
      currentTaskId: '1',
    };
    const originalResolved = event.resolved;
    lines(event);
    expect(event.resolved).toBe(originalResolved);
  });

  it('renders build_no_progress as a visually distinct warning line with quiet minutes', () => {
    const progressLine = lines({
      type: 'build_progress',
      step: 'build',
      resolved: 20,
      total: 21,
      featureSlug: 'emit-intra-step-build-progress-and-stall-as-events',
    })[0];

    const [noProgressLine] = lines({
      type: 'build_no_progress',
      step: 'build',
      quietMinutes: 15,
      resolved: 20,
      total: 21,
      currentTaskId: '21',
      featureSlug: 'emit-intra-step-build-progress-and-stall-as-events',
    });

    expect(noProgressLine).toBeDefined();
    expect(noProgressLine).toContain('15');
    expect(noProgressLine).toContain('21/21');
    expect(noProgressLine).not.toBe(progressLine);
  });

  it('renders build_no_progress with a 1-based parenthetical count when a current task is set (Story 1.4)', () => {
    const [line] = lines({
      type: 'build_no_progress',
      step: 'build',
      quietMinutes: 15,
      resolved: 0,
      total: 18,
      currentTaskId: '1',
    });
    expect(line).toContain('1/18');
    expect(line).not.toContain('0/18');
  });

  it('marks build_no_progress with a distinct warning glyph under color', () => {
    chalk.level = 1;
    const [line] = lines({
      type: 'build_no_progress',
      step: 'build',
      quietMinutes: 15,
      resolved: 20,
      total: 21,
    });
    expect(line).toContain('⚠');
  });

  it('renders build_stall with reason and before/after resolved counts', () => {
    const [line] = lines({
      type: 'build_stall',
      step: 'build',
      reason: 'no_task_progress',
      resolvedBefore: 2,
      resolvedAfter: 2,
    });

    expect(line).toBeDefined();
    expect(line).toContain('no_task_progress');
    expect(line).toContain('2');
  });

  it('produces no line for an unhandled kind (unchanged behavior)', () => {
    expect(lines({ type: 'dashboard_refresh' })).toEqual([]);
  });

  it('a throwing renderer body does not crash the caller', () => {
    // Simulate a malformed event whose fields don't match its declared type
    // (e.g. a future producer bug) — the switch body would throw formatting
    // it, but renderDaemonEvent must swallow that and simply drop the line.
    const malformed = {
      type: 'build_progress',
      step: 'build',
      get resolved(): number {
        throw new Error('boom');
      },
      total: 21,
    } as unknown as ConductorEvent;

    expect(() => renderDaemonEvent(malformed, () => {})).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 12: end-to-end seam — event → renderDaemonEvent → DaemonLogSink →
// daemon.log → tailDaemonLog → computeStatusRow's lastActivity
// (adr-2026-07-10-intra-step-build-progress-events).
// ─────────────────────────────────────────────────────────────────────────────

describe('daemon status freshness integration: build_progress heartbeat', () => {
  let root: string;

  beforeEach(async () => {
    chalk.level = 0;
    root = await mkdtemp(join(tmpdir(), 'daemon-status-freshness-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("computeStatusRow's lastActivity surfaces the line rendered for a build_progress event, written through the real DaemonLogSink path", async () => {
    const repo = join(root, 'repo');
    await mkdir(repo, { recursive: true });

    const event: ConductorEvent = {
      type: 'build_progress',
      step: 'build',
      resolved: 20,
      total: 21,
      currentTaskId: '21',
      currentTaskName: 'Wire watcher into conductor',
      featureSlug: 'emit-intra-step-build-progress-and-stall-as-events',
    };

    // Mirrors runDaemonMode's log() sink: renderDaemonEvent produces the line,
    // formatDaemonLogLine stamps it, DaemonLogSink appends it to daemon.log.
    const sink = await openDaemonLog(repo);
    let renderedLine: string | undefined;
    renderDaemonEvent(event, (m) => {
      renderedLine = m;
      sink.write(formatDaemonLogLine(`[daemon] ${m}`));
    });
    await sink.close();

    expect(renderedLine).toBeDefined();

    const record = {
      schemaVersion: 1 as const,
      name: 'repo',
      path: repo,
      status: 'registered' as const,
      registeredAt: '2026-07-10T00:00:00.000Z',
    };
    const row = await computeStatusRow(record);

    expect(row.lastActivity).toBeDefined();
    expect(row.lastActivity).toContain(renderedLine!);
    expect(row.lastActivityAt).toBeDefined();
  });
});
