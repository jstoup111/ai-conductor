import {
  claimDigest,
  type CoverageBindingEnvelope,
  type CoverageBindingEnvelopeEntry,
} from './coverage-binding-envelope.js';
import type { CoverageBindingClaim } from './coverage-binding-inputs.js';

export interface PendingClaim {
  readonly claim: CoverageBindingClaim;
  readonly claimDigest: string;
}

export interface PlanCoverageBindingBatchesInput {
  readonly claims: readonly CoverageBindingClaim[];
  readonly previous: CoverageBindingEnvelope | null;
  readonly batchSize: number;
}

export interface CoverageBindingBatchPlan {
  readonly entries: CoverageBindingEnvelopeEntry[];
  readonly batches: readonly (readonly PendingClaim[])[];
}

function entryFor(
  claim: CoverageBindingClaim,
  digest: string,
  verdict: CoverageBindingEnvelopeEntry['verdict'],
  missingAssertion?: string,
): CoverageBindingEnvelopeEntry {
  return {
    digest,
    criterion: claim.criterion,
    taskIds: claim.taskIds,
    doneWhen: claim.doneWhen,
    verdict,
    ...(missingAssertion === undefined ? {} : { missingAssertion }),
  };
}

export function planCoverageBindingBatches({
  claims,
  previous,
  batchSize,
}: PlanCoverageBindingBatchesInput): CoverageBindingBatchPlan {
  const cached = new Map(previous?.entries.map((entry) => [entry.digest, entry]) ?? []);
  const entries: CoverageBindingEnvelopeEntry[] = [];
  const pending: PendingClaim[] = [];

  for (const claim of claims) {
    const digest = claimDigest(claim);
    if (claim.applicability === 'not-applicable') {
      entries.push(entryFor(claim, digest, 'not-applicable'));
      continue;
    }

    const hit = cached.get(digest);
    if (hit && hit.verdict !== 'not-applicable') {
      entries.push(entryFor(claim, digest, hit.verdict, hit.missingAssertion));
      continue;
    }

    pending.push({ claim, claimDigest: digest });
  }

  const batches: PendingClaim[][] = [];
  for (let offset = 0; offset < pending.length; offset += batchSize) {
    batches.push(pending.slice(offset, offset + batchSize));
  }
  return { entries, batches };
}
