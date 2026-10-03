import type { FinishChoice } from './artifacts.js';
import type { GitRunner } from './rebase.js';

export type PrDisposition = 'opened' | 'none' | 'unrecorded';

/** Classify the terminal PR state without conflating no PR with no record. */
export function resolvePrDisposition({
  prUrl,
  finishChoice,
}: {
  prUrl?: string;
  finishChoice?: FinishChoice;
}): PrDisposition {
  if (prUrl) return 'opened';
  if (finishChoice === 'keep') return 'none';
  return 'unrecorded';
}

/** Resolve the current worktree HEAD without allowing provenance failure to block a run. */
export async function resolveHeadSha(git: GitRunner): Promise<string | undefined> {
  try {
    const result = await git(['rev-parse', 'HEAD']);
    const headSha = result.stdout.trim();
    return result.exitCode === 0 && headSha ? headSha : undefined;
  } catch {
    return undefined;
  }
}
