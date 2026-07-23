import { describe, it, expect, vi } from 'vitest';
import { applyEngineerSignalsTeardownDecision } from './global-setup.js';
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
