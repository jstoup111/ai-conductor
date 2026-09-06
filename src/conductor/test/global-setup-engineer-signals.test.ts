import { describe, it, expect, vi } from 'vitest';
import {
  applyEngineerSignalsTeardownDecision,
  applyRunRootSweepDecision,
} from './global-setup.js';
import type { EngineerSignalsDiff } from './signals-leak-guard.js';

describe('applyEngineerSignalsTeardownDecision', () => {
  it('throws naming the delta when test-project lines leaked into the real store', () => {
    const diff: EngineerSignalsDiff = { addedTestProjectLines: 3 };

    expect(() => applyEngineerSignalsTeardownDecision(diff)).toThrowError(/3/);
    expect(() => applyEngineerSignalsTeardownDecision(diff)).toThrowError(/#861/);
  });

  it('does not throw or warn when no test-project lines leaked', () => {
    const diff: EngineerSignalsDiff = { addedTestProjectLines: 0 };
    const logger = vi.fn();

    expect(() => applyEngineerSignalsTeardownDecision(diff, logger)).not.toThrow();
    expect(logger).not.toHaveBeenCalled();
  });
});

describe('applyRunRootSweepDecision', () => {
  it('reports all reaped roots in one previous-interrupted-run line', () => {
    const logger = vi.fn();

    applyRunRootSweepDecision(
      { reaped: ['ai-conductor-vitest-run-one', 'ai-conductor-vitest-run-two'], retained: [], failures: [] },
      '/tmp',
      logger
    );

    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining('swept 2 stale run root(s)')
    );
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('/tmp/ai-conductor-vitest-run-one'));
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('/tmp/ai-conductor-vitest-run-two'));
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('previous interrupted run'));
  });

  it('reports failures separately and stays non-throwing, even if its logger fails', () => {
    const logger = vi.fn();
    const error = new Error('simulated EBUSY');

    expect(() =>
      applyRunRootSweepDecision(
        { reaped: [], retained: [], failures: [{ name: 'ai-conductor-vitest-run-one', error }] },
        '/tmp',
        logger
      )
    ).not.toThrow();
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('ai-conductor-vitest-run-one'));
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('simulated EBUSY'));
    expect(() =>
      applyRunRootSweepDecision(
        { reaped: ['ai-conductor-vitest-run-one'], retained: [], failures: [] },
        '/tmp',
        () => {
          throw new Error('logger failed');
        }
      )
    ).not.toThrow();
  });

  it('stays silent about retained roots on an ordinary run that reaps nothing', () => {
    const logger = vi.fn();

    applyRunRootSweepDecision(
      {
        reaped: [],
        retained: [
          { name: 'ai-conductor-vitest-run-own', reason: 'own-root', windowMs: 900_000 },
          { name: 'ai-conductor-vitest-run-recent', reason: 'unmarked-recent', windowMs: 86_400_000 },
        ],
        failures: [],
      },
      '/tmp',
      logger
    );

    expect(logger).not.toHaveBeenCalled();
  });

  it('reports each retained root with its reason and deciding window under the staleness override', () => {
    const logger = vi.fn();

    applyRunRootSweepDecision(
      {
        reaped: [],
        retained: [
          { name: 'ai-conductor-vitest-run-own', reason: 'own-root', windowMs: 0 },
          { name: 'ai-conductor-vitest-run-bad', reason: 'marker-unreadable', windowMs: 0 },
        ],
        failures: [],
      },
      '/tmp',
      logger,
      { reportRetained: true }
    );

    expect(logger).toHaveBeenCalledTimes(2);
    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining('retained run root /tmp/ai-conductor-vitest-run-own — own-root (staleness window 0ms)')
    );
    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining('retained run root /tmp/ai-conductor-vitest-run-bad — marker-unreadable (staleness window 0ms)')
    );
  });

  it('is silent for an empty sweep result', () => {
    const logger = vi.fn();

    applyRunRootSweepDecision({ reaped: [], retained: [], failures: [] }, '/tmp', logger);

    expect(logger).not.toHaveBeenCalled();
  });
});
