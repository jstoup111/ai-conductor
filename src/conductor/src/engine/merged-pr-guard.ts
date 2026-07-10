/**
 * Merged-PR guard: thin wrapper over prMergeState that maps verdicts to
 * 'merged' | 'proceed' for the daemon's mid-run guard checks.
 *
 * Design: adr-2026-07-09-mid-run-merged-pr-guard.md
 * Stories: 2026-07-09-daemon-merged-pr-guard-on-retry.md (TS-1/TS-2/TS-5)
 *
 * Single-shot lookup — no retry/poll wrapper. No prUrl → zero gh calls, proceed.
 * Any gh error or non-MERGED verdict → proceed (fail-open, logged at debug).
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { prMergeState, type GhRunner } from './pr-labels.js';

/**
 * Check if the recorded PR is merged, returning a verdict for the daemon's
 * mid-run guard (kickback re-entry, rebase backstop, or rekick play-forward).
 *
 * @param runGh — Injectable gh runner (defaults to production in pr-labels.ts)
 * @param cwd — Working directory for gh invocation
 * @param prUrl — The recorded PR URL; if undefined, returns 'proceed' with zero gh calls
 * @param log — Optional log callback (errors logged at debug level by prMergeState)
 * @returns 'merged' if the PR state is MERGED; 'proceed' on any other verdict or error
 */
export async function checkMergedPrGuard(
  runGh: GhRunner,
  cwd: string,
  prUrl: string | undefined,
  log?: (msg: string) => void,
): Promise<'merged' | 'proceed'> {
  // No prUrl → proceed without any gh call.
  if (!prUrl) {
    return 'proceed';
  }

  // Single call to prMergeState; it handles all errors internally and logs at debug.
  const state = await prMergeState(runGh, cwd, prUrl, log);

  // Map verdict: MERGED → 'merged', anything else → 'proceed' (fail-open).
  if (state.state === 'MERGED') {
    return 'merged';
  }

  return 'proceed';
}

/**
 * Idempotently writes the synthetic verified-ship markers when a recorded PR is
 * detected merged out-of-band. Writes `.pipeline/finish-choice` = `pr` and
 * `.pipeline/DONE`, leaves `conduct-state.json` untouched, and logs the event.
 *
 * @param projectRoot — the worktree root (for constructing `.pipeline` paths)
 * @param headSha — the feature branch's current HEAD (40-char hex SHA)
 * @param log — logging function for audit trail
 *
 * **Idempotent:** multiple invocations write identical content, no error.
 */
export async function writeSyntheticShipMarkers(
  projectRoot: string,
  headSha: string,
  log: (message: string) => void,
): Promise<void> {
  const pipelineDir = join(projectRoot, '.pipeline');
  const finishChoicePath = join(pipelineDir, 'finish-choice');
  const donePath = join(pipelineDir, 'DONE');

  // Ensure .pipeline directory exists
  await mkdir(pipelineDir, { recursive: true });

  // Write finish-choice marker (idempotent: exact same content each time)
  await writeFile(finishChoicePath, 'pr', 'utf-8');

  // Write DONE marker (idempotent: empty file, repeated writes are safe)
  await writeFile(donePath, '', 'utf-8');

  // Log the event with the retained SHA for audit trail
  log(`already shipped out-of-band; local branch retained at ${headSha}`);
}
