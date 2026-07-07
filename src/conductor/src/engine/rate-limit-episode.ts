/**
 * RateLimitEpisode coordinator — tracks an active rate-limit episode.
 *
 * A rate-limit episode is active when:
 * 1. enter(untilMs) has been called to set a deadline
 * 2. The current time is strictly before that deadline
 *
 * Once the deadline passes or clear() is called, the episode is no longer active.
 */

export interface TimerHandle {
  cancel(): void;
}

export type SetTimer = (fn: () => void, delayMs: number) => void | TimerHandle | undefined;

export interface RateLimitEpisode {
  /**
   * Enter a rate-limit episode, setting a deadline.
   * @param untilMs - Absolute deadline in milliseconds since epoch
   */
  enter(untilMs: number): void;

  /**
   * Check if the rate-limit episode is active.
   * @param nowMs - Current time in milliseconds (defaults to Date.now())
   * @returns true if an episode is active and now < deadline; false otherwise
   */
  active(nowMs?: number): boolean;

  /**
   * Exit the rate-limit episode, clearing the deadline.
   * Returns a promise that resolves when the deadline is reached or the signal aborts.
   * @param signal - Optional AbortSignal to cancel the wait early
   * @returns Promise that resolves when timer fires or signal aborts
   */
  clear(signal?: AbortSignal): Promise<void>;
}

export interface CreateOptions {
  /**
   * Optional function to get the current time (for testing).
   * Defaults to Date.now().
   */
  now?: () => number;

  /**
   * Optional function to set a timer (for testing/injection).
   * Defaults to setTimeout.
   * @param fn - Callback to invoke when timer fires
   * @param delayMs - Delay in milliseconds
   * @returns A handle with a cancel() method, or undefined if timer cannot be cancelled
   */
  setTimer?: SetTimer;
}

/**
 * Create a new RateLimitEpisode coordinator.
 * @param options - Optional configuration with a custom "now" function for testing
 * @returns A coordinator object with enter(), active(), and clear() methods
 */
export function create(options?: CreateOptions): RateLimitEpisode {
  let deadline: number | null = null;
  const getNow = options?.now ?? (() => Date.now());

  // Default setTimer uses setTimeout
  const defaultSetTimer: SetTimer = (fn: () => void, delayMs: number) => {
    const id = setTimeout(fn, delayMs);
    return {
      cancel: () => clearTimeout(id),
    };
  };

  const setTimer = options?.setTimer ?? defaultSetTimer;
  let currentTimerHandle: TimerHandle | void | undefined = undefined;

  return {
    enter(untilMs: number): void {
      // Guard 1: Non-finite values (Infinity, NaN) → clear
      if (!isFinite(untilMs)) {
        deadline = null;
        return;
      }

      // Guard 2: Past or current deadline → clear
      const now = getNow();
      if (untilMs <= now) {
        deadline = null;
        return;
      }

      // Later-deadline-wins: only update if new deadline is later than existing
      if (deadline === null || untilMs > deadline) {
        deadline = untilMs;
      }
      // else: earlier deadline ignored, no-op
    },

    active(nowMs?: number): boolean {
      // No episode has been entered yet
      if (deadline === null) {
        return false;
      }

      // Use provided time or default to current time
      const now = nowMs ?? getNow();

      // Active only if current time is strictly before deadline
      return now < deadline;
    },

    clear(signal?: AbortSignal): Promise<void> {
      // If signal is already aborted, resolve immediately
      if (signal?.aborted) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        // Calculate delay from now until deadline
        const now = getNow();
        const delay = deadline !== null ? deadline - now : 0;

        // Helper to resolve and clean up
        const cleanup = () => {
          // Cancel any pending timer
          if (currentTimerHandle && typeof currentTimerHandle === 'object' && 'cancel' in currentTimerHandle) {
            currentTimerHandle.cancel();
          }
          currentTimerHandle = undefined;
          resolve();
        };

        // If delay <= 0, resolve immediately
        if (delay <= 0) {
          deadline = null;
          resolve();
          return;
        }

        // Arm the timer
        currentTimerHandle = setTimer(() => {
          deadline = null;
          cleanup();
        }, delay);

        // If signal is provided, listen for abort
        if (signal) {
          signal.addEventListener('abort', () => {
            cleanup();
          }, { once: true });
        }

        // Clear the deadline
        deadline = null;
      });
    },
  };
}
