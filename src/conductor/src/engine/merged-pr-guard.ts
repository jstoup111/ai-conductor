import type { GhRunner } from './pr-labels.js';
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
