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
});
