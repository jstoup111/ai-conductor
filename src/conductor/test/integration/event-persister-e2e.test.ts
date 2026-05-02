import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import type { ConductorEvent } from '../../src/types/index.js';

// All known ConductorEvent types (for validation in Task 15)
const KNOWN_EVENT_TYPES = new Set<string>([
  'step_started', 'step_completed', 'step_failed', 'step_retry',
  'checkpoint_reached', 'recovery_needed', 'gate_blocked', 'tier_skip',
  'config_skip', 'navigation_back', 'rate_limit', 'session_reset',
  'feature_complete', 'dashboard_refresh', 'auto_heal', 'mode_skip',
  'build_stall', 'renderer_error', 'when_skip', 'parallel_started',
  'parallel_completed', 'parallel_failure',
]);

describe('Integration: EventPersister e2e', () => {
  let tempDir: string;
  let eventsPath: string;
  let emitter: ConductorEventEmitter;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'event-persister-e2e-'));
    eventsPath = join(tempDir, 'events.jsonl');
    emitter = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ─── Task 15: full conductor run produces valid events.jsonl ───────────────

  it('all lines parse as valid JSON with ts and type in ConductorEvent union', async () => {
    const persister = new EventPersister(eventsPath, emitter);
    persister.start();

    const eventsToEmit: ConductorEvent[] = [
      { type: 'step_started', step: 'bootstrap', index: 0 },
      { type: 'step_completed', step: 'bootstrap', status: 'done' },
      { type: 'rate_limit', waitSeconds: 30 },
      { type: 'session_reset', reason: 'token limit' },
      { type: 'step_retry', step: 'stories', attempt: 1, maxAttempts: 3, reason: 'rate limit' },
    ];

    for (const evt of eventsToEmit) {
      await emitter.emit(evt);
    }

    persister.stop();

    const content = await readFile(eventsPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    expect(lines).toHaveLength(eventsToEmit.length);

    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      // Each line is valid JSON
      expect(parsed).toBeDefined();
      // Each line has ts field
      expect(typeof parsed.ts).toBe('string');
      expect(() => new Date(parsed.ts as string).toISOString()).not.toThrow();
      // type is in the ConductorEvent union
      expect(KNOWN_EVENT_TYPES.has(parsed.type as string)).toBe(true);
    }
  });

  it('events contain the original event fields', async () => {
    const persister = new EventPersister(eventsPath, emitter);
    persister.start();

    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done', tokenUsage: { input: 100, output: 50 } });

    persister.stop();

    const content = await readFile(eventsPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    const started = JSON.parse(lines[0]);
    expect(started.type).toBe('step_started');
    expect(started.step).toBe('bootstrap');
    expect(started.index).toBe(0);

    const completed = JSON.parse(lines[1]);
    expect(completed.type).toBe('step_completed');
    expect(completed.tokenUsage?.input).toBe(100);
    expect(completed.tokenUsage?.output).toBe(50);
  });

  // ─── Task 16: events before stop() are parseable (interrupt resilience) ────

  it('exactly 5 events are written after emitting 5 and calling stop()', async () => {
    const persister = new EventPersister(eventsPath, emitter);
    persister.start();

    const count = 5;
    for (let i = 0; i < count; i++) {
      await emitter.emit({ type: 'step_started', step: 'bootstrap', index: i });
    }

    persister.stop();

    const content = await readFile(eventsPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(count);

    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('no partial writes — all lines are complete JSON after stop()', async () => {
    const persister = new EventPersister(eventsPath, emitter);
    persister.start();

    for (let i = 0; i < 5; i++) {
      await emitter.emit({ type: 'rate_limit', waitSeconds: i });
    }

    persister.stop();

    // After stop, even if we emit more events they shouldn't appear
    await emitter.emit({ type: 'session_reset', reason: 'after-stop' });

    const content = await readFile(eventsPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    // Only the 5 events before stop() should be in the file
    expect(lines).toHaveLength(5);

    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(parsed.type).toBe('rate_limit');
    }
  });

  it('events after stop() are not written to file', async () => {
    const persister = new EventPersister(eventsPath, emitter);
    persister.start();

    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    persister.stop();

    // Emit after stop
    await emitter.emit({ type: 'session_reset', reason: 'should-not-appear' });

    const content = await readFile(eventsPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);

    const line = JSON.parse(lines[0]);
    expect(line.type).toBe('step_started');
  });
});
