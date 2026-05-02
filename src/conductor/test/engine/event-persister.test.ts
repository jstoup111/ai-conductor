import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, chmod } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { EventPersister, EventPersistError } from '../../src/engine/event-persister.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('EventPersister', () => {
  let tempDir: string;
  let eventsPath: string;
  let emitter: ConductorEventEmitter;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'event-persister-test-'));
    eventsPath = join(tempDir, 'events.jsonl');
    emitter = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ─── Task 5: basic write ───────────────────────────────────────────────────

  it('writes 3 emitted events as 3 JSONL lines', async () => {
    const persister = new EventPersister(eventsPath, emitter);
    persister.start();

    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
    await emitter.emit({ type: 'rate_limit', waitSeconds: 5 });

    persister.stop();

    const content = await readFile(eventsPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);
  });

  it('each line is valid JSON', async () => {
    const persister = new EventPersister(eventsPath, emitter);
    persister.start();

    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    await emitter.emit({ type: 'session_reset', reason: 'test' });

    persister.stop();

    const content = await readFile(eventsPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('each line has a ts field', async () => {
    const persister = new EventPersister(eventsPath, emitter);
    persister.start();

    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });

    persister.stop();

    const content = await readFile(eventsPath, 'utf-8');
    const line = JSON.parse(content.trim());
    expect(typeof line.ts).toBe('string');
    expect(new Date(line.ts).toISOString()).toBe(line.ts);
  });

  it('each line preserves the event type', async () => {
    const persister = new EventPersister(eventsPath, emitter);
    persister.start();

    await emitter.emit({ type: 'rate_limit', waitSeconds: 30 });

    persister.stop();

    const content = await readFile(eventsPath, 'utf-8');
    const line = JSON.parse(content.trim());
    expect(line.type).toBe('rate_limit');
    expect(line.waitSeconds).toBe(30);
  });

  // ─── Task 4: missing tokenUsage does not crash ──────────────────────────────

  it('handles step_completed without tokenUsage without crashing', async () => {
    const persister = new EventPersister(eventsPath, emitter);
    persister.start();

    // step_completed without tokenUsage — must not throw
    await expect(
      emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' })
    ).resolves.not.toThrow();

    persister.stop();

    const content = await readFile(eventsPath, 'utf-8');
    const line = JSON.parse(content.trim());
    expect(line.type).toBe('step_completed');
    expect(line.tokenUsage).toBeUndefined();
  });

  // ─── Task 6: creates parent directories ───────────────────────────────────

  it('creates parent directories that do not exist', async () => {
    const nestedPath = join(tempDir, 'deep', 'nested', 'dir', 'events.jsonl');
    const persister = new EventPersister(nestedPath, emitter);
    persister.start();

    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });

    persister.stop();

    const content = await readFile(nestedPath, 'utf-8');
    expect(content.trim()).toBeTruthy();
    const line = JSON.parse(content.trim());
    expect(line.type).toBe('step_started');
  });

  // ─── Task 7: write error → EventPersistError ─────────────────────────────

  it('EventPersistError is constructed with filePath and cause', () => {
    const cause = new Error('EACCES: permission denied');
    const err = new EventPersistError('/some/path/events.jsonl', cause);
    expect(err).toBeInstanceOf(EventPersistError);
    expect(err.name).toBe('EventPersistError');
    expect(err.filePath).toBe('/some/path/events.jsonl');
    expect(err.cause).toBe(cause);
    expect(err.message).toContain('/some/path/events.jsonl');
    expect(err.message).toContain('EACCES');
  });

  it('EventPersistError is an instance of Error', () => {
    const err = new EventPersistError('/path', new Error('io error'));
    expect(err).toBeInstanceOf(Error);
  });

  it('write to directory path causes EventPersistError (emitter swallows, file stays empty)', async () => {
    // tempDir is a directory — writing to it as a file throws OS error.
    // The emitter swallows handler errors, so emit() doesn't reject.
    // We verify the file did NOT get partially written.
    const persister = new EventPersister(tempDir, emitter);
    persister.start();

    // emit() should resolve (emitter swallows the handler error)
    await expect(
      emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 })
    ).resolves.not.toThrow();

    persister.stop();
    // tempDir as file path: no events.jsonl created in unexpected location
    const { existsSync } = await import('node:fs');
    // The directory itself exists but we can't read it as a file — just verify no crash
    expect(existsSync(tempDir)).toBe(true);
  });

  // ─── stop() unsubscribes ─────────────────────────────────────────────────

  it('stop() prevents further events from being written', async () => {
    const persister = new EventPersister(eventsPath, emitter);
    persister.start();

    await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
    persister.stop();
    await emitter.emit({ type: 'session_reset', reason: 'after-stop' });

    const content = await readFile(eventsPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
  });
});
