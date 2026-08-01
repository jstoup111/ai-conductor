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
