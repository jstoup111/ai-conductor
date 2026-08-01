import { describe, expect, it, vi } from 'vitest';

const writeHaltMarker = vi.hoisted(() => vi.fn());

vi.mock('../../src/engine/halt-marker.js', () => ({ writeHaltMarker }));

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
  it('halts needs-human after the replacement preparation also times out', async () => {
    vi.useFakeTimers();
    const first = deferred<string>();
    const replacement = deferred<string>();
    try {
      const attempts: string[] = [];
      let now = 10_000;
      const episodeStore: ProviderLifecycleEpisodeStore = {
        readProviderLifecycleEpisode: vi.fn().mockResolvedValue({ recoveryAuthority: 'fresh' }),
        writeProviderLifecycleEpisode: vi.fn(),
      };
      const supervisor = createProviderLifecycleSupervisor({
        attempt: { logicalStep: 'build', id: 'attempt-1' },
        recoveryCount: 0,
        preparationTimeoutMinutes: 5,
        timer: {
          now: () => now,
          schedule: (callback, delayMilliseconds) => setTimeout(() => {
            now += delayMilliseconds + 30_123;
            callback();
          }, delayMilliseconds),
          cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        },
        recovery: {
          projectRoot: '/project',
          episodeStore,
          createReplacementAttempt: () => ({ logicalStep: 'build', id: 'attempt-2' }),
        },
      });

      const result = supervisor.supervise((lease) => {
        attempts.push(lease.attempt.id);
        return lease.attempt.id === 'attempt-1' ? first.promise : replacement.promise;
      });
      const settled = result.then(
        (value) => ({ kind: 'fulfilled' as const, value }),
        (error: unknown) => ({ kind: 'rejected' as const, error }),
      );

      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await vi.advanceTimersByTimeAsync(5 * 60_000);

      expect(await settled).toEqual({
        kind: 'fulfilled',
        value: {
          kind: 'halted',
          reason: 'preparation-timeout-exhausted',
          attempt: { logicalStep: 'build', id: 'attempt-2' },
          elapsedMilliseconds: 330_123,
          recoveryCount: 1,
        },
      });
      expect(attempts).toEqual(['attempt-1', 'attempt-2']);
      expect(writeHaltMarker).toHaveBeenCalledWith(
        '/project',
        [
          'Provider preparation exhausted.',
          'step: build',
          'phase: preparing',
          'attempt: attempt-2',
          'elapsed_ms: 330123',
          'recovery_count: 1',
          '',
        ].join('\n'),
        'needs-human',
      );
    } finally {
      first.resolve('stale-first-result');
      replacement.resolve('stale-replacement-result');
      await Promise.all([first.promise, replacement.promise]);
      vi.useRealTimers();
    }
  });

  it('persists the first timeout recovery before dispatching its one replacement', async () => {
    vi.useFakeTimers();
    const first = deferred<string>();
    try {
      const events: string[] = [];
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
      first.resolve('stale-first-result');
      await first.promise;
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

  it('clears a persisted recovery episode only after the current attempt settles successfully', async () => {
    const candidateStarted = deferred<void>();
    const candidateCompletion = deferred<string>();
    const events: string[] = [];
    const clearProviderLifecycleEpisode = vi.fn(async () => {
      events.push('episode-cleared');
    });
    const episodeStore: ProviderLifecycleEpisodeStore & {
      clearProviderLifecycleEpisode: typeof clearProviderLifecycleEpisode;
    } = {
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
      clearProviderLifecycleEpisode,
    };
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
    });

    const result = supervisor.supervise((lease) => {
      events.push(`candidate-started:${lease.attempt.id}`);
      candidateStarted.resolve();
      return candidateCompletion.promise.then((value) => {
        events.push('candidate-completed');
        return value;
      });
    });

    await candidateStarted.promise;
    const clearCallsBeforeSettlement = clearProviderLifecycleEpisode.mock.calls.length;
    candidateCompletion.resolve('provider-result');

    expect({
      result: await result,
      clearCallsBeforeSettlement,
      events,
    }).toEqual({
      result: 'provider-result',
      clearCallsBeforeSettlement: 0,
      events: ['candidate-started:attempt-2', 'candidate-completed', 'episode-cleared'],
    });
  });

  it('preserves recovery evidence when a superseded attempt later settles', async () => {
    vi.useFakeTimers();
    const first = deferred<string>();
    const replacement = deferred<string>();
    const clearProviderLifecycleEpisode = vi.fn();
    const episodeStore: ProviderLifecycleEpisodeStore & {
      clearProviderLifecycleEpisode: typeof clearProviderLifecycleEpisode;
    } = {
      readProviderLifecycleEpisode: vi.fn().mockResolvedValue({ recoveryAuthority: 'fresh' }),
      writeProviderLifecycleEpisode: vi.fn(),
      clearProviderLifecycleEpisode,
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

    try {
      const result = supervisor.supervise((lease) => (
        lease.attempt.id === 'attempt-1' ? first.promise : replacement.promise
      ));

      await vi.advanceTimersByTimeAsync(5 * 60_000);
      first.resolve('stale-first-result');
      await first.promise;

      expect(clearProviderLifecycleEpisode).not.toHaveBeenCalled();

      replacement.resolve('authoritative-replacement-result');
      await expect(result).resolves.toBe('authoritative-replacement-result');
      expect(clearProviderLifecycleEpisode).toHaveBeenCalledWith('/project', 'build');
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears a recovered episode when its current attempt fails ordinarily', async () => {
    const failure = new Error('provider exited');
    const clearProviderLifecycleEpisode = vi.fn();
    const episodeStore: ProviderLifecycleEpisodeStore & {
      clearProviderLifecycleEpisode: typeof clearProviderLifecycleEpisode;
    } = {
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
      clearProviderLifecycleEpisode,
    };
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
    });

    await expect(supervisor.supervise(() => Promise.reject(failure))).rejects.toBe(failure);
    expect(clearProviderLifecycleEpisode).toHaveBeenCalledWith('/project', 'build');
  });

  it('clears one recovered episode after candidate fallback succeeds in its active attempt', async () => {
    const clearProviderLifecycleEpisode = vi.fn();
    const episodeStore: ProviderLifecycleEpisodeStore & {
      clearProviderLifecycleEpisode: typeof clearProviderLifecycleEpisode;
    } = {
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
      clearProviderLifecycleEpisode,
    };
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
    });

    await expect(supervisor.supervise(() => ({ provider: 'fallback', success: true }))).resolves.toEqual({
      provider: 'fallback',
      success: true,
    });
    expect(clearProviderLifecycleEpisode).toHaveBeenCalledTimes(1);
    expect(clearProviderLifecycleEpisode).toHaveBeenCalledWith('/project', 'build');
  });

  it('keeps the next logical step recovery episode isolated from a settled step', async () => {
    const clearProviderLifecycleEpisode = vi.fn();
    const episodeStore: ProviderLifecycleEpisodeStore & {
      clearProviderLifecycleEpisode: typeof clearProviderLifecycleEpisode;
    } = {
      readProviderLifecycleEpisode: vi.fn(async (_projectRoot, logicalStep) => (
        logicalStep === 'build'
          ? { recoveryAuthority: 'persisted' as const, lifecycle: {
            phase: 'recovering' as const,
            attempt: { logicalStep: 'build', id: 'build-attempt-1' },
            recoveryCount: 1,
            reason: 'preparation-timeout' as const,
          } }
          : { recoveryAuthority: 'persisted' as const, lifecycle: {
            phase: 'recovering' as const,
            attempt: { logicalStep: 'build_review', id: 'review-attempt-1' },
            recoveryCount: 1,
            reason: 'preparation-timeout' as const,
          } }
      )),
      writeProviderLifecycleEpisode: vi.fn(),
      clearProviderLifecycleEpisode,
    };
    const createSupervisor = (logicalStep: 'build' | 'build_review', states: string[]) => (
      createProviderLifecycleSupervisor({
        attempt: { logicalStep, id: `${logicalStep}-attempt-2` },
        recoveryCount: 0,
        preparationTimeoutMinutes: 5,
        timer: { now: () => 10_000, schedule: vi.fn(), cancel: vi.fn() },
        recovery: {
          projectRoot: '/project',
          episodeStore,
          createReplacementAttempt: () => ({ logicalStep, id: `${logicalStep}-attempt-3` }),
        },
        onStateChange: (state) => states.push(`${state.attempt.logicalStep}:${state.recoveryCount}`),
      })
    );
    const buildStates: string[] = [];
    const reviewStates: string[] = [];

    await createSupervisor('build', buildStates).supervise(() => 'build-result');
    await createSupervisor('build_review', reviewStates).supervise(() => 'review-result');

    expect({ buildStates, reviewStates, clears: clearProviderLifecycleEpisode.mock.calls }).toEqual({
      buildStates: ['build:1'],
      reviewStates: ['build_review:1'],
      clears: [
        ['/project', 'build'],
        ['/project', 'build_review'],
      ],
    });
  });

  it('propagates the successful replacement result instead of the timed-out result', async () => {
    vi.useFakeTimers();
    const first = deferred<{ provider: string }>();
    try {
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
      first.resolve({ provider: 'stale' });
      await first.promise;
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
