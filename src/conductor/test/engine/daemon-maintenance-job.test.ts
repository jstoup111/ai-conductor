// Covers: task:3
import { describe, expect, it, vi } from 'vitest';
import { MaintenanceJob } from '../../src/engine/daemon-maintenance.js';

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe('MaintenanceJob', () => {
  it('coalesces triggers into one ordered rerun without concurrent steps', async () => {
    const firstRun = deferred<void>();
    const calls: string[] = [];
    let active = 0;
    let maxActive = 0;
    let first = true;
    const step = (name: string) => async () => {
      calls.push(name);
      active++;
      maxActive = Math.max(maxActive, active);
      if (first) {
        first = false;
        await firstRun.promise;
      }
      active--;
    };
    const job = new MaintenanceJob([
      ['dashboard', step('dashboard')],
      ['rekick', step('rekick')],
      ['sweep', step('sweep')],
    ]);

    job.trigger();
    job.trigger();
    job.trigger();

    expect(calls).toEqual(['dashboard']);
    expect(maxActive).toBe(1);

    firstRun.resolve();
    await job.settled();

    expect(calls).toEqual([
      'dashboard', 'rekick', 'sweep',
      'dashboard', 'rekick', 'sweep',
    ]);
    expect(maxActive).toBe(1);
  });

  it('reruns when triggered after the last step settles but before cleanup', async () => {
    const lastStep = deferred<void>();
    const step = vi.fn(async () => {
      if (step.mock.calls.length === 1) await lastStep.promise;
    });
    const job = new MaintenanceJob([['sweep', step]]);

    job.trigger();
    lastStep.resolve();
    // The first turn completes the step; the second passes the run's final
    // loop check but precedes its promise-settlement cleanup.
    await Promise.resolve();
    await Promise.resolve();
    job.trigger();

    await job.settled();
    expect(step).toHaveBeenCalledTimes(2);
  });

  it('honors one trigger that lands during a rerun pass', async () => {
    const firstPass = deferred<void>();
    const rerunPass = deferred<void>();
    const rerunStarted = deferred<void>();
    const step = vi.fn(async () => {
      if (step.mock.calls.length === 1) await firstPass.promise;
      if (step.mock.calls.length === 2) {
        rerunStarted.resolve();
        await rerunPass.promise;
      }
    });
    const job = new MaintenanceJob([['sweep', step]]);

    job.trigger();
    job.trigger();
    firstPass.resolve();
    await rerunStarted.promise;

    job.trigger();
    rerunPass.resolve();

    await job.settled();
    expect(step).toHaveBeenCalledTimes(3);
  });

  it('logs a step error, continues the ordered run, and settles without rejection', async () => {
    const calls: string[] = [];
    const log = vi.fn();
    const job = new MaintenanceJob([
      ['first', async () => { calls.push('first'); }],
      ['second', async () => {
        calls.push('second');
        throw new Error('boom');
      }],
      ['third', async () => { calls.push('third'); }],
    ], log);

    job.trigger();

    await expect(job.settled()).resolves.toBeUndefined();
    expect(calls).toEqual(['first', 'second', 'third']);
    expect(log).toHaveBeenCalledWith('[daemon] second error: boom');
  });

  it('does not start another run after close and settles the in-progress run', async () => {
    const pending = deferred<void>();
    const step = vi.fn(async () => pending.promise);
    const job = new MaintenanceJob([['sweep', step]]);

    job.trigger();
    job.close();
    job.trigger();
    pending.resolve();

    await expect(job.settled()).resolves.toBeUndefined();
    expect(step).toHaveBeenCalledTimes(1);
  });

  it('reopens an aborted close, but a drain close remains terminal until reopened', async () => {
    const step = vi.fn(async () => {});
    const job = new MaintenanceJob([['sweep', step]]);

    // A stale restart requester may decline to fire; its close is reversible.
    job.close();
    job.reopen();
    job.trigger();
    await job.settled();
    expect(step).toHaveBeenCalledTimes(1);

    // A drain owns the boundary, so its close is not reopened by a trigger.
    job.close();
    job.trigger();
    await job.settled();
    expect(step).toHaveBeenCalledTimes(1);
  });
});
