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

  /**
   * Calculate the next wait interval with escalation.
   * On first call: returns baseSeconds (or default 60s)
   * On re-entry before grace period expires: escalates (baseSeconds * 2^counter)
   * After grace period: resets counter and returns baseSeconds
   * @param baseSeconds - Optional base wait time in seconds (defaults to 60)
   * @returns Next wait interval in seconds
   */
  nextWaitSeconds(baseSeconds?: number): number;
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

  /**
   * Optional random number generator for jitter (returns [0, 1)).
   * Defaults to Math.random().
   * Used to stagger waiter resumption and prevent thundering herd.
   */
  rng?: () => number;
}

// Default constants for escalation
const DEFAULT_BASE_WAIT = 60; // seconds
const DEFAULT_ESCALATION_CAP = 3600; // seconds (1 hour)
const GRACE_PERIOD = 60; // seconds after deadline
const MAX_JITTER_MS = 500; // milliseconds — max jitter to prevent thundering herd

/**
 * Create a new RateLimitEpisode coordinator.
 * @param options - Optional configuration with a custom "now" function for testing
 * @returns A coordinator object with enter(), active(), and clear() methods
 */
export function create(options?: CreateOptions): RateLimitEpisode {
  let deadline: number | null = null;
  let escalationStartDeadline: number | null = null; // Track deadline when escalation started
  let escalationCounter = 0;
  const escalationCap = DEFAULT_ESCALATION_CAP;
  const gracePeriod = GRACE_PERIOD * 1000; // Convert to milliseconds
  const getNow = options?.now ?? (() => Date.now());

  // Default setTimer uses setTimeout
  const defaultSetTimer: SetTimer = (fn: () => void, delayMs: number) => {
    const id = setTimeout(fn, delayMs);
    return {
      cancel: () => clearTimeout(id),
    };
  };

  const setTimer = options?.setTimer ?? defaultSetTimer;
  const getRandom = options?.rng ?? (() => Math.random());
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
        // If we're setting a new deadline and escalation is active, track it for grace period
        if (escalationCounter > 0 && escalationStartDeadline === null) {
          escalationStartDeadline = untilMs; // Track the new deadline for grace period
        }
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
      // Reset escalation counter and tracking when clearing
      escalationCounter = 0;
      escalationStartDeadline = null;

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

        // Apply jitter to delay: add random jitter up to MAX_JITTER_MS
        // This staggers waiter resumption to prevent thundering herd
        const jitterMs = getRandom() * MAX_JITTER_MS;
        const jitteredDelay = delay + jitterMs;

        // Arm the timer with jittered delay
        currentTimerHandle = setTimer(() => {
          deadline = null;
          cleanup();
        }, jitteredDelay);

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

    nextWaitSeconds(baseSeconds?: number): number {
      // Guard: normalize baseSeconds (non-positive or NaN → use default)
      let base = baseSeconds ?? DEFAULT_BASE_WAIT;
      if (!isFinite(base) || base <= 0) {
        base = DEFAULT_BASE_WAIT;
      }

      const now = getNow();

      // Check if we're past the grace period
      // If escalationStartDeadline is set and grace period has expired, reset
      if (escalationStartDeadline !== null && now > escalationStartDeadline + gracePeriod) {
        escalationCounter = 0;
        escalationStartDeadline = null;
      }

      // On first call (escalationCounter === 0), return base and track the deadline
      if (escalationCounter === 0) {
        escalationCounter = 1; // Prepare for next call
        // If there's an active deadline, use it for grace period tracking
        if (deadline !== null) {
          escalationStartDeadline = deadline;
        }
        return base;
      }

      // Calculate escalated wait: base * 2^(escalationCounter - 1)
      // because we've already incremented it
      const exponent = escalationCounter;
      let waitSeconds = base * Math.pow(2, exponent);

      // Clamp at cap
      waitSeconds = Math.min(waitSeconds, escalationCap);

      // Increment counter for next call
      escalationCounter += 1;

      return waitSeconds;
    },
  };
}
