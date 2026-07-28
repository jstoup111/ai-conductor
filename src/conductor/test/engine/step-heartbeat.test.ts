import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  writeStepHeartbeat,
  readStepHeartbeat,
  createHeartbeatPulse,
  classifyHeartbeatAge,
  formatHeartbeatAge,
  runWithStallWatchdog,
  heartbeatBelongsToDispatch,
  stepHeartbeatPath,
  type StepHeartbeat,
} from '../../src/engine/step-heartbeat.js';

describe('engine/step-heartbeat', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'heartbeat-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe('writeStepHeartbeat / readStepHeartbeat', () => {
    it('writes a JSON blob with step and an ISO ts, readable back', async () => {
      await writeStepHeartbeat(root, 'build');
      const heartbeat = await readStepHeartbeat(root);
      expect(heartbeat?.step).toBe('build');
      expect(heartbeat?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(Number.isFinite(Date.parse(heartbeat!.ts))).toBe(true);
    });

    it('creates .pipeline/ if absent', async () => {
      await writeStepHeartbeat(root, 'acceptance_specs');
      const raw = await readFile(stepHeartbeatPath(root), 'utf-8');
      expect(JSON.parse(raw).step).toBe('acceptance_specs');
    });

    it('returns null when the file does not exist', async () => {
      expect(await readStepHeartbeat(root)).toBeNull();
    });

    it('returns null when the file is malformed JSON', async () => {
      await mkdir(join(root, '.pipeline'), { recursive: true });
      await writeFile(join(root, '.pipeline', 'step-heartbeat'), 'not json', 'utf-8');
      expect(await readStepHeartbeat(root)).toBeNull();
    });

    it('overwrites on each write (single evolving file, not a log)', async () => {
      await writeStepHeartbeat(root, 'build');
      await writeStepHeartbeat(root, 'ship');
      const heartbeat = await readStepHeartbeat(root);
      expect(heartbeat?.step).toBe('ship');
    });
  });

  describe('createHeartbeatPulse (throttled activity pulse)', () => {
    it('writes on the first pulse', async () => {
      const pulse = createHeartbeatPulse(root, 'build', 5_000);
      pulse();
      // fire-and-forget: give the microtask/IO queue a tick
      await new Promise((r) => setTimeout(r, 20));
      expect(await readStepHeartbeat(root)).not.toBeNull();
    });

    it('does not write again within the throttle window', async () => {
      const pulse = createHeartbeatPulse(root, 'build', 60_000);
      pulse();
      await new Promise((r) => setTimeout(r, 20));
      const first = await readStepHeartbeat(root);
      pulse();
      pulse();
      await new Promise((r) => setTimeout(r, 20));
      const second = await readStepHeartbeat(root);
      expect(second?.ts).toBe(first?.ts);
    });
  });

  describe('classifyHeartbeatAge', () => {
    const base = Date.parse('2026-01-01T00:00:00.000Z');
    const heartbeat: StepHeartbeat = { step: 'build', ts: new Date(base).toISOString() };

    it('reports "none" for a null heartbeat (step just started, no pulse yet)', () => {
      expect(classifyHeartbeatAge(null, base + 1_000, 10_000)).toEqual({ kind: 'none' });
    });

    it('reports "fresh" when age is within the threshold', () => {
      const status = classifyHeartbeatAge(heartbeat, base + 5_000, 10_000);
      expect(status).toEqual({ kind: 'fresh', ageMs: 5_000 });
    });

    it('reports "stale" once age exceeds the threshold', () => {
      const status = classifyHeartbeatAge(heartbeat, base + 15_000, 10_000);
      expect(status.kind).toBe('stale');
      expect((status as { ageMs: number }).ageMs).toBe(15_000);
    });
  });

  describe('formatHeartbeatAge', () => {
    it('renders seconds-only under a minute', () => {
      expect(formatHeartbeatAge(45_000)).toBe('45s');
    });
    it('renders minutes and seconds', () => {
      expect(formatHeartbeatAge(3 * 60_000 + 12_000)).toBe('3m12s');
    });
  });

  describe('runWithStallWatchdog', () => {
    it('resolves normally when the dispatch completes before any stall check fires', async () => {
      const writeHalt = vi.fn(async () => {});
      const outcome = await runWithStallWatchdog(
        {
          worktreePath: root,
          step: 'build',
          thresholdMinutes: 20,
          killRef: {},
          pollIntervalMs: 5,
          writeHalt,
        },
        async () => 'done',
      );
      expect(outcome).toEqual({ stalled: false, value: 'done' });
      expect(writeHalt).not.toHaveBeenCalled();
    });

    it('never flags a step with no heartbeat yet as stalled', async () => {
      // A dispatch that takes a little while, with no heartbeat file ever
      // written — "no heartbeat yet" must not be conflated with staleness.
      const writeHalt = vi.fn(async () => {});
      const outcome = await runWithStallWatchdog(
        {
          worktreePath: root,
          step: 'build',
          thresholdMinutes: 20,
          killRef: {},
          pollIntervalMs: 5,
          readHeartbeat: async () => null,
          writeHalt,
        },
        async () => {
          await new Promise((r) => setTimeout(r, 40));
          return 'ok';
        },
      );
      expect(outcome).toEqual({ stalled: false, value: 'ok' });
      expect(writeHalt).not.toHaveBeenCalled();
    });

    it('does NOT flag a step that is actively heartbeating, even slowly', async () => {
      let ageMs = 0;
      const writeHalt = vi.fn(async () => {});
      const outcome = await runWithStallWatchdog(
        {
          worktreePath: root,
          step: 'build',
          thresholdMinutes: 20,
          killRef: {},
          pollIntervalMs: 5,
          now: () => 0,
          // Heartbeat age stays well under the threshold on every poll.
          readHeartbeat: async () => ({ step: 'build', ts: new Date(0 - ageMs).toISOString() }),
          writeHalt,
        },
        async () => {
          await new Promise((r) => setTimeout(r, 40));
          return 'ok';
        },
      );
      expect(outcome).toEqual({ stalled: false, value: 'ok' });
      expect(writeHalt).not.toHaveBeenCalled();
    });

    it('kills the subprocess and raises a mechanical HALT once heartbeat goes stale past threshold+grace', async () => {
      const writeHalt = vi.fn(async (_reason: string) => {});
      const kill = vi.fn();
      const staleHeartbeat: StepHeartbeat = {
        step: 'build',
        ts: new Date(0).toISOString(),
      };
      const killRef: { kill?: () => void } = { kill };

      // dispatch never resolves on its own — simulates a genuinely wedged
      // provider subprocess. The watchdog must be what settles the race.
      const neverResolves = new Promise<string>(() => {});

      const outcome = await runWithStallWatchdog(
        {
          worktreePath: root,
          step: 'build',
          thresholdMinutes: 1, // 1 minute threshold
          graceMinutes: 0,
          killRef,
          pollIntervalMs: 5,
          now: () => 2 * 60_000, // 2 minutes after the heartbeat's ts
          dispatchStartedAtMs: 0, // this dispatch owns the heartbeat at ts 0
          readHeartbeat: async () => staleHeartbeat,
          writeHalt,
        },
        () => neverResolves,
      );

      expect(outcome.stalled).toBe(true);
      expect(kill).toHaveBeenCalledTimes(1);
      expect(writeHalt).toHaveBeenCalledTimes(1);
      expect(writeHalt.mock.calls[0][0]).toMatch(/heartbeat stalled/i);
    });

    it('ignores a stale heartbeat left behind by a DIFFERENT step (regression: architecture_review_as_built killed 31s in)', async () => {
      const writeHalt = vi.fn(async (_reason: string) => {});
      const kill = vi.fn();
      // The worktree's last dispatch was a `build` that finished hours ago; its
      // heartbeat is still on disk. A freshly re-kicked review step must not
      // inherit that silence as its own.
      const leftover: StepHeartbeat = { step: 'build', ts: new Date(0).toISOString() };

      const outcome = await runWithStallWatchdog(
        {
          worktreePath: root,
          step: 'architecture_review_as_built',
          thresholdMinutes: 1,
          graceMinutes: 0,
          killRef: { kill },
          pollIntervalMs: 5,
          now: () => 214 * 60_000, // 3h34m after the leftover heartbeat's ts
          dispatchStartedAtMs: 214 * 60_000,
          readHeartbeat: async () => leftover,
          writeHalt,
        },
        async () => {
          await new Promise((r) => setTimeout(r, 40));
          return 'ok';
        },
      );

      expect(outcome).toEqual({ stalled: false, value: 'ok' });
      expect(kill).not.toHaveBeenCalled();
      expect(writeHalt).not.toHaveBeenCalled();
    });

    it('ignores a same-step heartbeat stamped before this dispatch started', async () => {
      const writeHalt = vi.fn(async (_reason: string) => {});
      const kill = vi.fn();
      const priorRun: StepHeartbeat = { step: 'build', ts: new Date(0).toISOString() };

      const outcome = await runWithStallWatchdog(
        {
          worktreePath: root,
          step: 'build',
          thresholdMinutes: 1,
          graceMinutes: 0,
          killRef: { kill },
          pollIntervalMs: 5,
          now: () => 60 * 60_000,
          dispatchStartedAtMs: 60 * 60_000, // this run started an hour after that pulse
          readHeartbeat: async () => priorRun,
          writeHalt,
        },
        async () => {
          await new Promise((r) => setTimeout(r, 40));
          return 'ok';
        },
      );

      expect(outcome).toEqual({ stalled: false, value: 'ok' });
      expect(writeHalt).not.toHaveBeenCalled();
    });
  });

  describe('heartbeatBelongsToDispatch', () => {
    it('accepts a heartbeat for this step stamped at or after dispatch start', () => {
      expect(
        heartbeatBelongsToDispatch({ step: 'build', ts: new Date(5_000).toISOString() }, 'build', 5_000),
      ).toBe(true);
    });
    it('rejects a heartbeat naming another step', () => {
      expect(
        heartbeatBelongsToDispatch(
          { step: 'build', ts: new Date(10_000).toISOString() },
          'architecture_review_as_built',
          5_000,
        ),
      ).toBe(false);
    });
    it('rejects a heartbeat stamped before dispatch start', () => {
      expect(
        heartbeatBelongsToDispatch({ step: 'build', ts: new Date(1_000).toISOString() }, 'build', 5_000),
      ).toBe(false);
    });
    it('rejects null and malformed timestamps', () => {
      expect(heartbeatBelongsToDispatch(null, 'build', 0)).toBe(false);
      expect(heartbeatBelongsToDispatch({ step: 'build', ts: 'not-a-date' }, 'build', 0)).toBe(false);
    });
  });
});
