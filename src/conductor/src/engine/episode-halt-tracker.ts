/**
 * Episode-caused HALT tracker — records which HALTs were written during an
 * active rate-limit episode, so they can be recovered when the episode ends.
 *
 * Task 20: HALTs written during an active episode carry a stamp. When the
 * episode ends, stamped HALTs are recovered via the existing rekick path.
 */

/**
 * Create a tracker for episode-caused HALTs.
 * Returns callbacks for onHaltWritten and sweepEpisodeHalts.
 */
export interface EpisodeHaltTracker {
  /**
   * Called when a HALT is written. Records whether it was episode-caused.
   */
  onHaltWritten(slug: string, episodeCaused: boolean): void;

  /**
   * Get all episode-caused HALTs that are still active (not cleared).
   */
  getEpisodeHalts(isHalted: (slug: string) => Promise<boolean>): Promise<string[]>;

  /**
   * Clear the tracker (typically on daemon restart or when episode scope ends).
   */
  clear(): void;
}

export function createEpisodeHaltTracker(): EpisodeHaltTracker {
  // Slugs that had HALTs written during an active episode
  const episodeCausedSlugs = new Set<string>();

  return {
    onHaltWritten(slug: string, episodeCaused: boolean) {
      if (episodeCaused) {
        episodeCausedSlugs.add(slug);
      }
    },

    async getEpisodeHalts(isHalted: (slug: string) => Promise<boolean>): Promise<string[]> {
      const active: string[] = [];
      for (const slug of episodeCausedSlugs) {
        if (await isHalted(slug)) {
          active.push(slug);
        }
      }
      return active;
    },

    clear() {
      episodeCausedSlugs.clear();
    },
  };
}
