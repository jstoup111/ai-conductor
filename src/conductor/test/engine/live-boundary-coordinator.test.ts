import { describe, expect, it, vi } from 'vitest';
import { LiveBoundaryCoordinator, type OpenAdmittedWindow } from '../../src/engine/self-host/live-boundary-coordinator.js';

describe('LiveBoundaryCoordinator', () => {
  it('queues a dispatch before starting its preparation deadline', async () => {
    vi.useFakeTimers();
    const coordinator = new LiveBoundaryCoordinator();
    const active = await coordinator.openWindow({ contained: false, reason: 'unproven' });
    const mutation = coordinator.runMutation(async () => undefined);
    const prepare = vi.fn(async (openWindow: OpenAdmittedWindow) => {
      const window = openWindow({ contained: true, evidence: 'probe' });
      window.close();
      return 'spawned';
    });
    const queued = coordinator.runDispatch(prepare);
    try {
      await vi.advanceTimersByTimeAsync(11 * 60_000);
      expect(prepare).not.toHaveBeenCalled();
      active.close();
      await mutation;
      await expect(queued).resolves.toBe('spawned');
      expect(prepare).toHaveBeenCalledOnce();
    } finally {
      active.close();
      await Promise.all([mutation, queued]);
      vi.useRealTimers();
    }
  });

  it('lets admitted candidates open windows while a later mutation waits', async () => {
    const coordinator = new LiveBoundaryCoordinator();
    const mutate = vi.fn(async () => undefined);
    let mutation!: Promise<void>;
    let retained!: { close(): void };
    await coordinator.runDispatch(async (openWindow: OpenAdmittedWindow) => {
      mutation = coordinator.runMutation(mutate);
      await Promise.resolve();
      retained = openWindow({ contained: true, evidence: 'probe' });
    });
    expect(mutate).not.toHaveBeenCalled();
    retained.close();
    await mutation;
    expect(mutate).toHaveBeenCalledOnce();
  });

  it('releases failed admissions and refuses late candidate windows', async () => {
    const coordinator = new LiveBoundaryCoordinator();
    let late!: Parameters<Parameters<LiveBoundaryCoordinator['runDispatch']>[0]>[0];
    await expect(coordinator.runDispatch(async (openWindow: OpenAdmittedWindow) => {
      late = openWindow;
      throw new Error('setup failed');
    })).rejects.toThrow('setup failed');
    expect(() => late({ contained: false, reason: 'late' })).toThrow('admission closed');
    await expect(coordinator.runMutation(async () => 'released')).resolves.toBe('released');
  });

  it('serializes a dispatcher mutation after a proven window verifies', async () => {
    const coordinator = new LiveBoundaryCoordinator();
    const window = await coordinator.openWindow({ contained: true, evidence: 'bwrap' });
    const mutate = vi.fn(async () => 'mutated');
    const pending = coordinator.runMutation(mutate);

    await Promise.resolve();
    expect(mutate).not.toHaveBeenCalled();
    window.close();
    await expect(pending).resolves.toBe('mutated');
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('defers a root mutation for an unproven window and releases it when the window closes', async () => {
    const coordinator = new LiveBoundaryCoordinator();
    const window = await coordinator.openWindow({ contained: false, reason: 'probe unavailable' });
    const deferred = vi.fn();
    const mutate = vi.fn(async () => undefined);
    const pending = coordinator.runMutation(mutate, deferred);

    await Promise.resolve();
    expect(mutate).not.toHaveBeenCalled();
    expect(deferred).toHaveBeenCalledWith('unproven-containment');
    window.close();
    await pending;
    expect(mutate).toHaveBeenCalledOnce();
  });

  it('does not let a window open during an active root mutation', async () => {
    const coordinator = new LiveBoundaryCoordinator();
    let releaseMutation!: () => void;
    const mutation = coordinator.runMutation(() => new Promise<void>((resolve) => { releaseMutation = resolve; }));
    await Promise.resolve();
    let opened = false;
    const opening = coordinator.openWindow({ contained: true, evidence: 'bwrap' }).then((window) => {
      opened = true;
      return window;
    });

    await Promise.resolve();
    expect(opened).toBe(false);
    releaseMutation();
    await mutation;
    const window = await opening;
    expect(opened).toBe(true);
    window.close();
  });
});
