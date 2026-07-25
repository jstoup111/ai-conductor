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
import {
  evaluateShipmentEvidence,
  type ShipmentEvidenceDependencies,
  type ShipmentEvidenceResult,
} from './shipment-evidence.js';

export type VerifiedMergedPrResult =
  | { kind: 'not-merged' }
  | { kind: 'verified' }
  | { kind: 'halt'; reason: string };

export interface VerifiedMergedPrDependencies {
  evaluate?: (
    input: {
      repoDir: string;
      slug: string;
      implementationPr: string;
      candidateCommit: string;
      implementationHead: string;
    },
    dependencies?: ShipmentEvidenceDependencies,
  ) => Promise<ShipmentEvidenceResult>;
}

/**
 * Prove that a merged PR carries a valid durable record on its merged commit.
 * This intentionally consults the strict verifier instead of inferring success
 * from the merge state alone. Any unreadable merge metadata or refusal remains
 * a recoverable halt for the caller.
 */
export async function verifyMergedPrShipment(
  runGh: GhRunner,
  cwd: string,
  prUrl: string | undefined,
  slug: string,
  deps: VerifiedMergedPrDependencies = {},
): Promise<VerifiedMergedPrResult> {
  if (!prUrl) return { kind: 'not-merged' };

  let data: { state?: string; mergeCommit?: { oid?: string | null } };
  try {
    const { stdout } = await runGh(
      ['pr', 'view', prUrl, '--json', 'state,mergeCommit'],
      { cwd },
    );
    data = JSON.parse(stdout) as { state?: string; mergeCommit?: { oid?: string | null } };
  } catch (error) {
    return { kind: 'halt', reason: `merge-state-unavailable: ${errorMessage(error)}` };
  }

  if (data.state !== 'MERGED') return { kind: 'not-merged' };
  const commit = data.mergeCommit?.oid;
  if (!commit) return { kind: 'halt', reason: 'merge-state-unavailable: merged commit is absent' };

  const evaluate = deps.evaluate ?? evaluateShipmentEvidence;
  let evidence: ShipmentEvidenceResult;
  try {
    evidence = await evaluate({
      repoDir: cwd,
      slug,
      implementationPr: prUrl,
      candidateCommit: commit,
      implementationHead: commit,
    });
  } catch (error) {
    return { kind: 'halt', reason: `merged-history-unavailable: ${errorMessage(error)}` };
  }
  if (evidence.kind === 'valid') return { kind: 'verified' };
  return {
    kind: 'halt',
    reason: evidence.kind === 'not-applicable' ? evidence.reason : evidence.code,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
