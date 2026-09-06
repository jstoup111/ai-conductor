import { describe, expect, it, vi } from 'vitest';
import { LiveBoundaryCoordinator } from '../../src/engine/self-host/live-boundary-coordinator.js';

describe('LiveBoundaryCoordinator', () => {
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
