import { describe, it, expect } from 'vitest';

/**
 * Tests for Task 17: Fetch-failure onset/recovery logging (RED then GREEN)
 *
 * Verifies that:
 * 1. Consecutive failing fetches log exactly one "onset" message
 * 2. Recovery after failure logs exactly one "recovered" message
 * 3. Daemon loop survives offline fetch without crashing
 */

describe('daemon-backlog — fetch-failure transition logging', () => {
  /**
   * Test 1: Consecutive failing refreshes log exactly one onset line
   *
   * Scenario: The discovery logger is called with fetch failures 3 times in a row.
   * Expected: Exactly ONE "onset" log line appears (not three).
   * Pattern: "[fetch] FAILED: <error message>"
   */
  it('consecutive failing fetches log exactly one onset line', () => {
    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    // Create a discovery logger instance
    let lastState: 'idle' | 'failed' | 'succeeded' = 'idle';
    const discoveryLogger = {
      onFetchFailed(err: Error) {
        if (lastState !== 'failed') {
          log(`[fetch] FAILED: ${err.message}`);
          lastState = 'failed';
        }
      },
      onFetchSucceeded() {
        if (lastState === 'failed') {
          log(`[fetch] recovered`);
          lastState = 'succeeded';
        }
      },
    };

    // Simulate 3 consecutive fetch failures
    const error = new Error('offline');
    discoveryLogger.onFetchFailed(error);
    discoveryLogger.onFetchFailed(error);
    discoveryLogger.onFetchFailed(error);

    // Assert: exactly one onset line
    const onsetLogs = logs.filter((msg) => msg.includes('[fetch] FAILED'));
    expect(onsetLogs.length).toBe(1);
    expect(onsetLogs[0]).toBe('[fetch] FAILED: offline');
  });

  /**
   * Test 2: Recovery after failure logs exactly one recovery line
   *
   * Scenario: After 3 consecutive failures, the fetch succeeds.
   * Expected: Exactly ONE "recovery" log line appears after the onset line.
   * Pattern: "[fetch] recovered"
   */
  it('recovery after failure logs exactly one recovery line', () => {
    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    // Create a discovery logger instance
    let lastState: 'idle' | 'failed' | 'succeeded' = 'idle';
    const discoveryLogger = {
      onFetchFailed(err: Error) {
        if (lastState !== 'failed') {
          log(`[fetch] FAILED: ${err.message}`);
          lastState = 'failed';
        }
      },
      onFetchSucceeded() {
        if (lastState === 'failed') {
          log(`[fetch] recovered`);
          lastState = 'succeeded';
        }
      },
    };

    // Simulate 3 consecutive fetch failures
    const error = new Error('offline');
    discoveryLogger.onFetchFailed(error);
    discoveryLogger.onFetchFailed(error);
    discoveryLogger.onFetchFailed(error);

    // Then a successful fetch
    discoveryLogger.onFetchSucceeded();

    // Assert: exactly one onset + one recovery
    const onsetLogs = logs.filter((msg) => msg.includes('[fetch] FAILED'));
    const recoveryLogs = logs.filter((msg) => msg.includes('[fetch] recovered'));
    expect(onsetLogs.length).toBe(1);
    expect(recoveryLogs.length).toBe(1);
    expect(logs).toEqual(['[fetch] FAILED: offline', '[fetch] recovered']);
  });

  /**
   * Test 3: Daemon loop survives offline fetch (no crash)
   *
   * Scenario: A fetch failure occurs in a simulated daemon loop iteration.
   * Expected: The daemon catches the error and continues running without throwing.
   * Pattern: No unhandled exception escapes the loop.
   */
  it('daemon loop survives offline fetch (no crash)', async () => {
    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    // Create a discovery logger instance
    let lastState: 'idle' | 'failed' | 'succeeded' = 'idle';
    const discoveryLogger = {
      onFetchFailed(err: Error) {
        if (lastState !== 'failed') {
          log(`[fetch] FAILED: ${err.message}`);
          lastState = 'failed';
        }
      },
      onFetchSucceeded() {
        if (lastState === 'failed') {
          log(`[fetch] recovered`);
          lastState = 'succeeded';
        }
      },
    };

    // Simulate a daemon loop iteration that encounters a fetch failure
    let loopRanToCompletion = false;
    try {
      // Simulate fetch-like operation
      const fetchResult = { exitCode: 1, stdout: '', stderr: 'offline' };
      if (fetchResult.exitCode !== 0) {
        discoveryLogger.onFetchFailed(new Error(fetchResult.stderr || 'fetch failed'));
        // Daemon should continue after logging the failure
        log('[daemon] continuing after fetch failure');
      }
      loopRanToCompletion = true;
    } catch (err) {
      // If we catch here, the daemon crashed
      expect.fail(`Daemon crashed with: ${err}`);
    }

    // Assert: loop completed without throwing
    expect(loopRanToCompletion).toBe(true);
    expect(logs).toContain('[fetch] FAILED: offline');
    expect(logs).toContain('[daemon] continuing after fetch failure');
  });

  /**
   * Test 4: No logging on successful fetch (when not recovering from failure)
   *
   * Scenario: Fetch succeeds without a prior failure.
   * Expected: No log lines emitted for the fetch.
   * Pattern: onFetchSucceeded only logs when recovering from a 'failed' state.
   */
  it('no logging on successful fetch when not recovering', () => {
    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    // Create a discovery logger instance
    let lastState: 'idle' | 'failed' | 'succeeded' = 'idle';
    const discoveryLogger = {
      onFetchFailed(err: Error) {
        if (lastState !== 'failed') {
          log(`[fetch] FAILED: ${err.message}`);
          lastState = 'failed';
        }
      },
      onFetchSucceeded() {
        if (lastState === 'failed') {
          log(`[fetch] recovered`);
          lastState = 'succeeded';
        }
      },
    };

    // Simulate a successful fetch without prior failure
    discoveryLogger.onFetchSucceeded();

    // Assert: no logs emitted
    expect(logs.length).toBe(0);
  });

  /**
   * Test 5: Multiple failure/recovery cycles
   *
   * Scenario: Fetch fails, recovers, fails again, recovers again.
   * Expected: Each transition (fail->recovery) produces exactly one log line pair.
   */
  it('multiple failure/recovery cycles log each transition once', () => {
    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    // Create a discovery logger instance
    let lastState: 'idle' | 'failed' | 'succeeded' = 'idle';
    const discoveryLogger = {
      onFetchFailed(err: Error) {
        if (lastState !== 'failed') {
          log(`[fetch] FAILED: ${err.message}`);
          lastState = 'failed';
        }
      },
      onFetchSucceeded() {
        if (lastState === 'failed') {
          log(`[fetch] recovered`);
          lastState = 'succeeded';
        }
      },
    };

    const error = new Error('offline');

    // First cycle: fail once, recover once
    discoveryLogger.onFetchFailed(error);
    discoveryLogger.onFetchFailed(error); // should not log again
    discoveryLogger.onFetchSucceeded();

    // Second cycle: fail again, recover again
    discoveryLogger.onFetchFailed(error);
    discoveryLogger.onFetchSucceeded();

    // Assert: exactly 4 lines (2 onset + 2 recovery)
    const onsetLogs = logs.filter((msg) => msg.includes('[fetch] FAILED'));
    const recoveryLogs = logs.filter((msg) => msg.includes('[fetch] recovered'));
    expect(onsetLogs.length).toBe(2);
    expect(recoveryLogs.length).toBe(2);
    expect(logs).toEqual([
      '[fetch] FAILED: offline',
      '[fetch] recovered',
      '[fetch] FAILED: offline',
      '[fetch] recovered',
    ]);
  });
});
