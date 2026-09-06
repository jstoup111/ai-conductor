import type { ContainmentVerdict } from './live-containment.js';

/** A single self-host provider-dispatch fingerprint window. */
export interface LiveBoundaryWindow {
  /** Closes the window after its existing boundary verification has completed. */
  close(): void;
}

/**
 * Serializes dispatcher mutations with provider fingerprint windows.
 *
 * A mutation never overlaps a window: this is the conservative attribution
 * strategy. It keeps unproven containment fail-closed (there is no mutation to
 * excuse) and lets a proven window verify the exact snapshot it captured.
 */
export class LiveBoundaryCoordinator {
  private readonly windows = new Map<number, ContainmentVerdict>();
  private nextWindowId = 0;
  private mutationTail: Promise<void> = Promise.resolve();
  private waiters: Array<() => void> = [];

  /** Wait for an already-started root mutation, then register a new window. */
  async openWindow(containment: ContainmentVerdict): Promise<LiveBoundaryWindow> {
    await this.mutationTail;
    const id = this.nextWindowId++;
    this.windows.set(id, containment);
    let closed = false;
    return {
      close: () => {
        if (closed) return;
        closed = true;
        this.windows.delete(id);
        if (this.windows.size === 0) {
          const waiters = this.waiters;
          this.waiters = [];
          for (const wake of waiters) wake();
        }
      },
    };
  }

  /**
   * Run a dispatcher-owned root mutation only between fingerprint windows.
   * `onDeferred` is intentionally a callback to the existing daemon logger;
   * no second telemetry channel or durable sidecar is introduced.
   */
  runMutation<T>(
    work: () => Promise<T>,
    onDeferred?: (reason: 'unproven-containment' | 'open-window') => void,
  ): Promise<T> {
    const run = this.mutationTail.then(async () => {
      if (this.windows.size > 0) {
        onDeferred?.(this.hasUnprovenWindow() ? 'unproven-containment' : 'open-window');
        await new Promise<void>((resolve) => this.waiters.push(resolve));
      }
      return work();
    });
    this.mutationTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private hasUnprovenWindow(): boolean {
    for (const containment of this.windows.values()) {
      if (!containment.contained) return true;
    }
    return false;
  }
}
