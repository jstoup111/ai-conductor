import { describe, expect, it, vi } from 'vitest';
import {
  createProviderLifecycleSupervisor,
  createPreparingProviderLifecycle,
  ProviderPreparationTimeoutError,
  transitionProviderLifecycle,
} from '../../src/engine/provider-lifecycle.js';
import type { ProviderLifecycleEpisodeStore } from '../../src/engine/provider-lifecycle-store.js';

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((resolvePromise) => {
      resolve = resolvePromise;
    }),
    resolve: (value) => resolve(value),
  };
}

describe('provider lifecycle transitions', () => {
  it('persists the first timeout recovery before dispatching its one replacement', async () => {
    vi.useFakeTimers();
    try {
      const events: string[] = [];
      const first = deferred<string>();
      const episodeStore: ProviderLifecycleEpisodeStore = {
        readProviderLifecycleEpisode: vi.fn().mockResolvedValue({ recoveryAuthority: 'fresh' }),
        writeProviderLifecycleEpisode: vi.fn(async (_projectRoot, lifecycle) => {
          events.push(`persist:${lifecycle.phase}:${lifecycle.recoveryCount}`);
        }),
      };
      const supervisor = createProviderLifecycleSupervisor({
        attempt: { logicalStep: 'build', id: 'attempt-1' },
        recoveryCount: 0,
        preparationTimeoutMinutes: 5,
        timer: {
          now: () => 10_000,
          schedule: (callback, delayMilliseconds) => setTimeout(callback, delayMilliseconds),
          cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        },
        recovery: {
          projectRoot: '/project',
          episodeStore,
          createReplacementAttempt: () => ({ logicalStep: 'build', id: 'attempt-2' }),
        },
      });

      const result = supervisor.supervise((lease) => {
        events.push(`candidate:${lease.attempt.id}`);
        return lease.attempt.id === 'attempt-1' ? first.promise : 'replacement-result';
      });

      await vi.advanceTimersByTimeAsync(5 * 60_000);

      expect({ result: await result, events }).toEqual({
        result: 'replacement-result',
        events: [
          'candidate:attempt-1',
          'persist:recovering:1',
          'candidate:attempt-2',
        ],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reloads a consumed recovery count after a daemon restart', async () => {
    const episodeStore: ProviderLifecycleEpisodeStore = {
      readProviderLifecycleEpisode: vi.fn().mockResolvedValue({
        recoveryAuthority: 'persisted',
        lifecycle: {
          phase: 'recovering',
          attempt: { logicalStep: 'build', id: 'attempt-1' },
          recoveryCount: 1,
          reason: 'preparation-timeout',
        },
      }),
      writeProviderLifecycleEpisode: vi.fn(),
    };
    const states: string[] = [];
    const supervisor = createProviderLifecycleSupervisor({
      attempt: { logicalStep: 'build', id: 'attempt-2' },
      recoveryCount: 0,
      preparationTimeoutMinutes: 5,
      timer: { now: () => 10_000, schedule: vi.fn(), cancel: vi.fn() },
      recovery: {
        projectRoot: '/project',
        episodeStore,
        createReplacementAttempt: () => ({ logicalStep: 'build', id: 'attempt-3' }),
      },
      onStateChange: (state) => states.push(`${state.phase}:${state.recoveryCount}`),
    });

    await supervisor.supervise(() => 'replacement-result');

    expect(states).toEqual(['preparing:1']);
  });

  it('propagates the successful replacement result instead of the timed-out result', async () => {
    vi.useFakeTimers();
    try {
      const first = deferred<{ provider: string }>();
      const episodeStore: ProviderLifecycleEpisodeStore = {
        readProviderLifecycleEpisode: vi.fn().mockResolvedValue({ recoveryAuthority: 'fresh' }),
        writeProviderLifecycleEpisode: vi.fn(),
      };
      const supervisor = createProviderLifecycleSupervisor({
        attempt: { logicalStep: 'build', id: 'attempt-1' },
        recoveryCount: 0,
        preparationTimeoutMinutes: 5,
        timer: {
          now: () => 10_000,
          schedule: (callback, delayMilliseconds) => setTimeout(callback, delayMilliseconds),
          cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        },
        recovery: {
          projectRoot: '/project',
          episodeStore,
          createReplacementAttempt: () => ({ logicalStep: 'build', id: 'attempt-2' }),
        },
      });

      const result = supervisor.supervise((lease) => (
        lease.attempt.id === 'attempt-1' ? first.promise : { provider: 'replacement' }
      ));

      await vi.advanceTimersByTimeAsync(5 * 60_000);

      expect(await result).toEqual({ provider: 'replacement' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts preparing and records a five-minute lease before candidate work', async () => {
    const events: string[] = [];
    const scheduled = vi.fn<(callback: () => void, delayMilliseconds: number) => number>((_, delay) => {
      events.push(`deadline:${delay}`);
      return 1;
    });
    const supervisor = createProviderLifecycleSupervisor({
      attempt: { logicalStep: 'build', id: 'attempt-1' },
      recoveryCount: 0,
      preparationTimeoutMinutes: 5,
      timer: {
        now: () => 10_000,
        schedule: scheduled,
        cancel: vi.fn(),
      },
      onStateChange: (state) => events.push(state.phase),
    });

    const result = await supervisor.supervise((lease) => {
      events.push(`candidate:${lease.deadlineAt}:${lease.isCurrent()}`);
      return 'candidate result';
    });

    expect({ result, events }).toEqual({
      result: 'candidate result',
      events: ['preparing', 'deadline:300000', 'candidate:310000:true'],
    });
  });

  it('revokes a timed-out preparation before recovery and suppresses its late result', async () => {
    vi.useFakeTimers();
    try {
      const events: string[] = [];
      const first = deferred<string>();
      const replacement = deferred<string>();
      let isCurrent: (() => boolean) | undefined;
      const supervisor = createProviderLifecycleSupervisor({
        attempt: { logicalStep: 'build', id: 'attempt-1' },
        recoveryCount: 0,
        preparationTimeoutMinutes: 5,
        timer: {
          now: () => 10_000,
          schedule: (callback, delayMilliseconds) => setTimeout(callback, delayMilliseconds),
          cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        },
        onStateChange: (state) => {
          events.push(state.phase);
          if (state.phase === 'recovering') events.push(`revoked:${isCurrent?.()}`);
        },
      });

      const timedOutAttempt = supervisor.supervise((lease) => {
        isCurrent = lease.isCurrent;
        events.push(`candidate:${lease.isCurrent()}`);
        return first.promise.then((result) => {
          events.push(`late:${result}:${lease.isCurrent()}`);
          return result;
        });
      });
      const recovered = timedOutAttempt.catch((error: unknown) => {
        events.push(`recovery:${error instanceof ProviderPreparationTimeoutError}`);
        return replacement.promise;
      });

      await vi.advanceTimersByTimeAsync(5 * 60_000);
      first.resolve('stale-result');
      await Promise.resolve();
      replacement.resolve('replacement-result');

      expect({ result: await recovered, events }).toEqual({
        result: 'replacement-result',
        events: [
          'preparing',
          'candidate:true',
          'recovering',
          'revoked:false',
          'recovery:true',
          'late:stale-result:false',
        ],
      });
    } finally {
      vi.useRealTimers();
    }
  });

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
