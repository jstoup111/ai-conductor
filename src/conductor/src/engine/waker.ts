// ─────────────────────────────────────────────────────────────────────────────
// Latched single-shot Waker: pure synchronous/async utility for event-driven
// daemon wake signals. Supports coalescing multiple wake() calls into a single
// awaitable armed() signal. No timers, no state beyond latches.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Waker factory: creates a latched single-shot wake signal.
 *
 * The Waker maintains internal state:
 * - signalHeld: if true, a wake() was called with no pending armed() waiter
 * - resolver: the resolve callback for a pending armed() promise
 * - currentPromise: the promise being returned by armed()
 *
 * Behavior:
 * - wake() captures a signal (or coalesces if already held) and resolves any pending armed()
 * - armed() returns a resolved promise if a signal is held, or a pending promise otherwise
 * - Multiple wake() calls coalesce into a single signal
 *
 * @returns an object with pure synchronous wake() and async armed() methods
 */
export function Waker() {
  let signalHeld = false;
  let resolver: ((value: void) => void) | null = null;
  let currentPromise: Promise<void> | null = null;

  return {
    /**
     * Pure synchronous method that captures a wake signal.
     * - If a waiter is pending on armed(), resolves it immediately
     * - Otherwise, holds the signal for the next armed() call
     * - Multiple calls coalesce: only the first holds the signal
     */
    wake() {
      if (resolver) {
        // Someone is waiting on armed(), resolve them
        resolver();
        resolver = null;
        currentPromise = null;
      } else {
        // No one is waiting, hold the signal
        signalHeld = true;
      }
    },

    /**
     * Returns a promise that resolves when a wake signal is captured.
     * - If a signal is already held, returns an already-resolved promise and clears the signal
     * - Otherwise, returns a pending promise until wake() is called
     * - Resolves to undefined (single-shot, no payload)
     */
    armed(): Promise<void> {
      if (signalHeld) {
        // Signal was already held, resolve immediately
        signalHeld = false;
        return Promise.resolve();
      }

      if (!currentPromise) {
        // Create a new promise for this waiter
        currentPromise = new Promise<void>((resolve) => {
          resolver = resolve;
        });
      } else {
      }

      return currentPromise;
    },
  };
}
