/**
 * RateLimitEpisode coordinator — tracks an active rate-limit episode.
 *
 * A rate-limit episode is active when:
 * 1. enter(untilMs) has been called to set a deadline
 * 2. The current time is strictly before that deadline
 *
 * Once the deadline passes or clear() is called, the episode is no longer active.
 */

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
   */
  clear(): void;
}

/**
 * Create a new RateLimitEpisode coordinator.
 * @returns A coordinator object with enter(), active(), and clear() methods
 */
export function create(): RateLimitEpisode {
  let deadline: number | null = null;

  return {
    enter(untilMs: number): void {
      deadline = untilMs;
    },

    active(nowMs?: number): boolean {
      // No episode has been entered yet
      if (deadline === null) {
        return false;
      }

      // Use provided time or default to current time
      const now = nowMs ?? Date.now();

      // Active only if current time is strictly before deadline
      return now < deadline;
    },

    clear(): void {
      deadline = null;
    },
  };
}
