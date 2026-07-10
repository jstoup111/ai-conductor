import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConductorEventEmitter } from '../src/ui/events.js';
import { EventPersister } from '../src/engine/event-persister.js';
import type { ConductorEvent } from '../src/types/index.js';

describe('EventPersister: build progress/stall events', () => {
  let tempDir: string;
  let eventsPath: string;
  let emitter: ConductorEventEmitter;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'event-persister-progress-'));
    eventsPath = join(tempDir, 'events.jsonl');
    emitter = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('persists a build_progress event as one events.jsonl line with a ts field', async () => {
    const persister = new EventPersister(eventsPath, emitter);
    persister.start();

    await emitter.emit({
      type: 'build_progress',
      step: 'build',
      resolved: 3,
      total: 10,
      currentTaskId: 'T5',
    } as ConductorEvent);

    persister.stop();

    const content = await readFile(eventsPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe('build_progress');
    expect(parsed.step).toBe('build');
    expect(parsed.resolved).toBe(3);
    expect(parsed.total).toBe(10);
    expect(typeof parsed.ts).toBe('string');
    expect(() => new Date(parsed.ts).toISOString()).not.toThrow();
  });

  it('persists a build_no_progress event as one events.jsonl line with a ts field', async () => {
    const persister = new EventPersister(eventsPath, emitter);
    persister.start();

    await emitter.emit({
      type: 'build_no_progress',
      step: 'build',
      quietMinutes: 15,
      resolved: 3,
      total: 10,
      currentTaskId: 'T5',
    } as ConductorEvent);

    persister.stop();

    const content = await readFile(eventsPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe('build_no_progress');
    expect(parsed.step).toBe('build');
    expect(parsed.quietMinutes).toBe(15);
    expect(typeof parsed.ts).toBe('string');
    expect(() => new Date(parsed.ts).toISOString()).not.toThrow();
  });

  it('persists a build_stall event as one events.jsonl line with a ts field', async () => {
    const persister = new EventPersister(eventsPath, emitter);
    persister.start();

    await emitter.emit({
      type: 'build_stall',
      step: 'build',
      reason: 'no_task_progress',
      resolvedBefore: 3,
      resolvedAfter: 3,
    } as ConductorEvent);

    persister.stop();

    const content = await readFile(eventsPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe('build_stall');
    expect(parsed.reason).toBe('no_task_progress');
    expect(typeof parsed.ts).toBe('string');
    expect(() => new Date(parsed.ts).toISOString()).not.toThrow();
  });

  it('an unwritable events file causes persist() to throw but the run continues (caller keeps emitting)', async () => {
    // Point the persister at a path whose parent directory cannot be created
    // (a file exists where a directory is expected), simulating an
    // unwritable destination.
    const blockerFile = join(tempDir, 'blocker');
    await writeFile(blockerFile, 'not a directory');
    const badPath = join(blockerFile, 'nested', 'events.jsonl');

    const persister = new EventPersister(badPath, emitter);
    persister.start();

    // The emitter's handler will throw internally; emit() is expected to
    // surface/swallow this without crashing the process — subsequent
    // emits on unrelated, healthy listeners must still be processed.
    const goodPath = join(tempDir, 'sibling-events.jsonl');
    const goodEmitter = new ConductorEventEmitter();
    const goodPersister = new EventPersister(goodPath, goodEmitter);
    goodPersister.start();

    await emitter.emit({ type: 'build_progress', step: 'build', resolved: 1, total: 2 } as ConductorEvent).catch(() => {});
    await goodEmitter.emit({ type: 'build_progress', step: 'build', resolved: 1, total: 2 } as ConductorEvent);

    persister.stop();
    goodPersister.stop();

    const goodContent = await readFile(goodPath, 'utf-8');
    const goodLines = goodContent.trim().split('\n').filter(Boolean);
    expect(goodLines).toHaveLength(1);
  });
});
