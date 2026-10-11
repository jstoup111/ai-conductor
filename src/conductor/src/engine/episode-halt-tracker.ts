/** Durable tracker for HALTs caused by a rate-limit episode. */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  readEpisodeStamp,
  removeEpisodeStamp,
  writeEpisodeStamp,
} from './halt-marker.js';

export interface EpisodeHaltTrackerOptions {
  /** Parent directory containing feature worktrees, keyed by slug. */
  worktreeBase: string;
  /** Best-effort diagnostic sink; tracker failures must never interrupt parking. */
  log: (message: string) => void;
}

export interface EpisodeHaltTracker {
  /** Persist episode causality for a HALT that was just written. */
  onHaltWritten(slug: string, episodeCaused: boolean, deadlineMs: number): Promise<void>;

  /** Return worktrees whose current, matching stamp has expired. */
  listRecoverable(nowMs: number): Promise<string[]>;
}

/**
 * Create a per-worktree, sidecar-backed episode HALT tracker. A failed stamp
 * is only logged: the existing HALT remains an operator-owned stop.
 */
export function createEpisodeHaltTracker(options: EpisodeHaltTrackerOptions): EpisodeHaltTracker {
  const worktreeFor = (slug: string) => join(options.worktreeBase, slug);

  return {
    async onHaltWritten(slug, episodeCaused, deadlineMs) {
      if (!episodeCaused) return;

      const result = await writeEpisodeStamp(worktreeFor(slug), deadlineMs);
      if (result.status === 'failed') {
        options.log(`[episode-halt-tracker] failed to stamp ${slug}: ${result.reason}`);
      }
    },

    async listRecoverable(nowMs) {
      let entries;
      try {
        entries = await readdir(options.worktreeBase, { withFileTypes: true });
      } catch (error) {
        options.log(`[episode-halt-tracker] failed to list worktrees: ${formatError(error)}`);
        return [];
      }

      const recoverable: string[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const slug = entry.name;
        const worktree = worktreeFor(slug);
        const stamp = await readEpisodeStamp(worktree);
        if (stamp.kind === 'valid') {
          if (stamp.deadlineMs <= nowMs) recoverable.push(slug);
          continue;
        }

        // An invalid stamp describes no live, matching HALT. Remove only the
        // sidecar; never alter the HALT that made validation fail.
        if (stamp.reason === 'absent') continue;
        try {
          await removeEpisodeStamp(worktree);
        } catch (error) {
          options.log(`[episode-halt-tracker] failed to discard stamp for ${slug}: ${formatError(error)}`);
        }
      }
      return recoverable;
    },
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
