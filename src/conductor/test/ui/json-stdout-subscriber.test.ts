import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ConductorEvent } from '../../src/types/index.js';

// Import the subscriber from the plugin directory.
// Path: test/ui/ -> ../../../../plugins/json-stdout-subscriber/index.ts
import { JsonStdoutSubscriber } from '../../../../plugins/json-stdout-subscriber/index.js';

function spyOnStdoutWrite() {
  return vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
}

describe('JsonStdoutSubscriber', () => {
  let subscriber: JsonStdoutSubscriber;
  let stdoutWriteSpy: ReturnType<typeof spyOnStdoutWrite>;

  beforeEach(() => {
    subscriber = new JsonStdoutSubscriber();
    stdoutWriteSpy = spyOnStdoutWrite();
  });

  afterEach(() => {
    subscriber.stop();
    stdoutWriteSpy.mockRestore();
  });

  describe('Task 2 & 3: handle() writes JSON line to stdout', () => {
    it('writes a newline-delimited JSON line when handle() called after start()', () => {
      subscriber.start();

      const event: ConductorEvent = { type: 'step_started', step: 'explore', index: 0 };
      subscriber.handle(event);

      expect(stdoutWriteSpy).toHaveBeenCalledOnce();
      const written = stdoutWriteSpy.mock.calls[0][0] as string;
      expect(written).toMatch(/\n$/);

      const parsed = JSON.parse(written.trimEnd());
      expect(parsed.type).toBe('step_started');
      expect(parsed.step).toBe('explore');
      expect(parsed.index).toBe(0);
    });

    it('includes a ts field with ISO timestamp', () => {
      subscriber.start();

      const before = new Date().toISOString();
      const event: ConductorEvent = { type: 'feature_complete' };
      subscriber.handle(event);
      const after = new Date().toISOString();

      const written = stdoutWriteSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(written.trimEnd());
      expect(parsed.ts).toBeDefined();
      expect(parsed.ts >= before).toBe(true);
      expect(parsed.ts <= after).toBe(true);
    });

    it('preserves all original event fields alongside ts', () => {
      subscriber.start();

      const event: ConductorEvent = {
        type: 'step_failed',
        step: 'build',
        error: 'tsc error',
        retryCount: 2,
      };
      subscriber.handle(event);

      const written = stdoutWriteSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(written.trimEnd());
      expect(parsed.type).toBe('step_failed');
      expect(parsed.step).toBe('build');
      expect(parsed.error).toBe('tsc error');
      expect(parsed.retryCount).toBe(2);
      expect(parsed.ts).toBeDefined();
    });
  });

  describe('Task 4: handle() before start() is a no-op', () => {
    it('does not write to stdout when handle() called before start()', () => {
      const event: ConductorEvent = { type: 'step_started', step: 'explore', index: 0 };
      subscriber.handle(event);

      expect(stdoutWriteSpy).not.toHaveBeenCalled();
    });

    it('does not throw when handle() called before start()', () => {
      const event: ConductorEvent = { type: 'feature_complete' };
      expect(() => subscriber.handle(event)).not.toThrow();
    });
  });

  describe('Task 4: stop() prevents further output', () => {
    it('does not write after stop()', () => {
      subscriber.start();
      subscriber.stop();

      const event: ConductorEvent = { type: 'step_started', step: 'explore', index: 0 };
      subscriber.handle(event);

      expect(stdoutWriteSpy).not.toHaveBeenCalled();
    });
  });

  describe('Task 9: renderer_error event is handled without crash', () => {
    it('writes renderer_error event as JSON line without throwing', () => {
      subscriber.start();

      const event: ConductorEvent = {
        type: 'renderer_error',
        rendererName: 'terminal',
        error: 'render crashed',
      };

      expect(() => subscriber.handle(event)).not.toThrow();
      expect(stdoutWriteSpy).toHaveBeenCalledOnce();
      const written = stdoutWriteSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(written.trimEnd());
      expect(parsed.type).toBe('renderer_error');
      expect(parsed.rendererName).toBe('terminal');
      expect(parsed.error).toBe('render crashed');
    });
  });

  it('renders stale test-suite verification details without declared environment values', () => {
    subscriber.start();

    const declaredEnvironment = 'API_TOKEN=never-expose-this-value';
    subscriber.handle({
      type: 'test_suite_verification',
      freshness: { status: 'STALE', reason: 'environment_changed' },
      declaredEnvironment,
    } as unknown as ConductorEvent);

    const written = stdoutWriteSpy.mock.calls[0][0] as string;
    expect(
      written.includes('STALE') &&
      written.includes('environment_changed') &&
      !written.includes(declaredEnvironment),
    ).toBe(true);
  });
});
