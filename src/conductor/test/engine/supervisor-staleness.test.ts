import { describe, expect, it } from 'vitest';
import { createSupervisorStaleness } from '../../src/engine/supervisor-staleness.js';

describe('supervisor staleness', () => {
  it('measures age from the first stale observation, not a later rebuild', () => {
    let now = 1_000;
    const tracker = createSupervisorStaleness(() => now);
    tracker.observe('boot', 'v2');
    now += 3_600_000;
    tracker.observe('boot', 'v3');

    expect(tracker.firstStaleAtMs).toBe(1_000);
    expect(tracker.ageHours()).toBe(1);
    expect(tracker.capExceeded(1)).toBe(false);
    now += 1;
    expect(tracker.capExceeded(1)).toBe(true);
  });

  it('clears a recovered stale interval and keeps a protocol mismatch sticky', () => {
    const tracker = createSupervisorStaleness(() => 10);
    tracker.observe('boot', 'v2');
    tracker.markProtocolMismatch();
    tracker.observe('boot', 'boot');

    expect(tracker.firstStaleAtMs).toBeUndefined();
    expect(tracker.restartReason).toBe('protocol-mismatch');
  });
});
