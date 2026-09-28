import {
  amendmentClaimDigest,
  claimDigest,
  type CoverageBindingEnvelope,
  type CoverageBindingEnvelopeEntry,
  type CoverageBindingAmendmentEnvelopeEntry,
  type CoverageBindingEntryVerdict,
} from './coverage-binding-envelope.js';
import type { CoverageBindingAmendmentClaim, CoverageBindingClaim } from './coverage-binding-inputs.js';

type CoverageBindingPlannedClaim = CoverageBindingClaim | CoverageBindingAmendmentClaim;

/**
 * Batch consumers historically read criterion fields directly. Keep those
 * fields visible while amendment batches are introduced; Task 11 narrows on
 * `kind` before dispatching the amendment-specific schema.
 */
export interface CoverageBindingPendingClaim {
  readonly kind?: 'amendment';
  readonly criterion: string;
  readonly taskIds: readonly string[];
  readonly doneWhen: readonly (readonly string[])[];
  readonly quote?: string;
  readonly applicability?: 'applicable' | 'not-applicable';
  readonly artifactPath?: string;
  readonly amendment?: string;
}

function isAmendmentClaim(claim: CoverageBindingPlannedClaim): claim is CoverageBindingAmendmentClaim {
  return 'kind' in claim && claim.kind === 'amendment';
}

export interface PendingClaim {
  readonly claim: CoverageBindingPendingClaim;
  readonly claimDigest: string;
}

export interface PlanCoverageBindingBatchesInput {
  readonly claims: readonly CoverageBindingPlannedClaim[];
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
  verdict: CoverageBindingEntryVerdict,
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

function amendmentEntryFor(
  claim: CoverageBindingAmendmentClaim,
  digest: string,
  hit: CoverageBindingAmendmentEnvelopeEntry,
): CoverageBindingEnvelopeEntry {
  return {
    kind: 'amendment', digest, artifactPath: claim.artifactPath, amendment: claim.amendment,
    taskIds: claim.taskIds, doneWhen: claim.doneWhen,
    verdict: hit.verdict,
    ...(hit.verdict === 'not-carried' ? { missingObligation: hit.missingObligation } : {}),
  } as unknown as CoverageBindingEnvelopeEntry;
}

export function planCoverageBindingBatches({
  claims,
  previous,
  batchSize,
}: PlanCoverageBindingBatchesInput): CoverageBindingBatchPlan {
  const cached = new Map(previous?.entries.map((entry) => [entry.digest, entry]) ?? []);
  const entries: CoverageBindingEnvelopeEntry[] = [];
  const pendingCriterion: PendingClaim[] = [];
  const pendingAmendment: PendingClaim[] = [];

  for (const claim of claims) {
    if (isAmendmentClaim(claim)) {
      const digest = amendmentClaimDigest(claim);
      const hit = cached.get(digest) as CoverageBindingAmendmentEnvelopeEntry | undefined;
      if (hit?.kind === 'amendment' && hit.verdict !== 'unjudged') {
        entries.push(amendmentEntryFor(claim, digest, hit));
      } else {
        pendingAmendment.push({ claim: { ...claim, criterion: claim.amendment }, claimDigest: digest });
      }
      continue;
    }
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

    pendingCriterion.push({ claim, claimDigest: digest });
  }

  const batches: PendingClaim[][] = [];
  for (const pending of [pendingCriterion, pendingAmendment]) {
    for (let offset = 0; offset < pending.length; offset += batchSize) {
      batches.push(pending.slice(offset, offset + batchSize));
    }
  }
  return { entries, batches };
}
