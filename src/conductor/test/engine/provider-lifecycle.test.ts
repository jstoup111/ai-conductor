import { describe, expect, it } from 'vitest';
import {
  createPreparingProviderLifecycle,
  transitionProviderLifecycle,
} from '../../src/engine/provider-lifecycle.js';

describe('provider lifecycle transitions', () => {
  it('moves a preparing attempt to running without changing its identity', () => {
    const attempt = { logicalStep: 'build', id: 'attempt-1' };
    const preparing = createPreparingProviderLifecycle(attempt, 0);

    expect(transitionProviderLifecycle(preparing, { phase: 'running' })).toEqual({
      accepted: true,
      state: { phase: 'running', attempt, recoveryCount: 0 },
    });
  });

  it('marks a timed-out preparing attempt as recovering and consumes recovery authority', () => {
    const attempt = { logicalStep: 'build', id: 'attempt-1' };
    const preparing = createPreparingProviderLifecycle(attempt, 0);

    expect(
      transitionProviderLifecycle(preparing, {
        phase: 'recovering',
        reason: 'preparation-timeout',
      }),
    ).toEqual({
      accepted: true,
      state: {
        phase: 'recovering',
        attempt,
        recoveryCount: 1,
        reason: 'preparation-timeout',
      },
    });
  });

  it('settles a running attempt terminally', () => {
    const attempt = { logicalStep: 'build', id: 'attempt-1' };
    const running = transitionProviderLifecycle(
      createPreparingProviderLifecycle(attempt, 0),
      { phase: 'running' },
    );

    expect(
      running.accepted
        ? transitionProviderLifecycle(running.state, { phase: 'settled', outcome: 'completed' })
        : running,
    ).toEqual({
      accepted: true,
      state: { phase: 'settled', attempt, recoveryCount: 0, outcome: 'completed' },
    });
  });

  it('rejects a transition from a stale attempt', () => {
    const preparing = createPreparingProviderLifecycle({ logicalStep: 'build', id: 'attempt-1' }, 0);

    expect(
      transitionProviderLifecycle(preparing, { phase: 'running' }, {
        logicalStep: 'build',
        id: 'attempt-2',
      }),
    ).toEqual({ accepted: false, state: preparing, reason: 'stale-attempt' });
  });

  it('rejects reversed transitions after an attempt is running', () => {
    const attempt = { logicalStep: 'build', id: 'attempt-1' };
    const running = transitionProviderLifecycle(
      createPreparingProviderLifecycle(attempt, 0),
      { phase: 'running' },
    );

    expect(
      running.accepted
        ? transitionProviderLifecycle(running.state, {
            phase: 'recovering',
            reason: 'preparation-timeout',
          })
        : running,
    ).toEqual({
      accepted: false,
      state: { phase: 'running', attempt, recoveryCount: 0 },
      reason: 'illegal-transition',
    });
  });
});
