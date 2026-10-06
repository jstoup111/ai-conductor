import {
  amendmentClaimDigest,
  claimDigest,
  conflictClaimDigest,
  type CoverageBindingEnvelope,
  type CoverageBindingEnvelopeEntry,
  type CoverageBindingAmendmentEnvelopeEntry,
  type CoverageBindingEntryVerdict,
} from './coverage-binding-envelope.js';
import type { CoverageBindingAmendmentClaim, CoverageBindingClaim } from './coverage-binding-inputs.js';
import type { CoverageBindingConflictClaim } from './coverage-binding-conflict-inputs.js';

type CoverageBindingPlannedClaim = CoverageBindingClaim | CoverageBindingAmendmentClaim | CoverageBindingConflictClaim;

/** Bounds the text sent to one conflict-judgement session. */
export const CONFLICT_BATCH_PROMPT_BYTE_BUDGET = 24 * 1024;

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

function isConflictClaim(claim: CoverageBindingPlannedClaim): claim is CoverageBindingConflictClaim {
  return 'kind' in claim && (claim.kind === 'criterion' || claim.kind === 'adr-decision') && 'text' in claim;
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
  readonly conflictEntries: readonly CoverageBindingEnvelopeEntry[];
  readonly conflictBatches: readonly (readonly PendingConflictClaim[])[];
}

export interface PendingConflictClaim {
  readonly claim: CoverageBindingConflictClaim;
  readonly claimDigest: string;
}

/** Render the closed, task-table-once prompt contract for conflict judging. */
export function renderConflictBatchPrompt(
  batch: readonly PendingConflictClaim[],
  taskTable: readonly CoverageBindingConflictClaim['taskTable'][number][],
  issuedIds: readonly string[],
): string {
  return [
    'Judge each supplied conflict claim against the complete plan task table. A claim conflicts only when satisfying a named task\'s Done when checks necessarily violates it. Do not read files, inspect a diff, or use any transcript.',
    'Return exactly one JSON object with a verdicts array containing one verdict for every supplied claim id. Each verdict is consistent, or conflicts with non-empty taskIds and conflict.',
    JSON.stringify({ taskTable, claims: batch.map(({ claim }, index) => ({ id: issuedIds[index], kind: claim.kind, text: claim.text })) }),
  ].join('\n\n');
}

function conflictEntryFor(claim: CoverageBindingConflictClaim, digest: string, verdict: 'consistent' | 'conflicts' | 'not-applicable' | 'unjudged', details?: { taskIds: readonly string[]; conflict: string }): CoverageBindingEnvelopeEntry {
  return {
    kind: 'conflict', digest, claimKind: claim.kind, claimId: claim.id, verdict,
    ...(verdict === 'conflicts' && details ? { taskIds: details.taskIds, conflict: details.conflict } : {}),
  } as unknown as CoverageBindingEnvelopeEntry;
}

function planConflictBatches({ claims, previous, batchSize }: PlanCoverageBindingBatchesInput) {
  const cached = new Map(previous?.entries.map((entry) => [entry.digest, entry]) ?? []);
  const entries: CoverageBindingEnvelopeEntry[] = [];
  const pending: PendingConflictClaim[] = [];
  for (const claim of claims) {
    if (!isConflictClaim(claim)) continue;
    const digest = conflictClaimDigest(claim);
    if (claim.applicability === 'not-applicable') {
      entries.push(conflictEntryFor(claim, digest, 'not-applicable'));
      continue;
    }
    const hit = cached.get(digest) as { kind?: string; verdict?: string; taskIds?: readonly string[]; conflict?: string } | undefined;
    if (hit?.kind === 'conflict' && hit.verdict !== 'unjudged' && hit.verdict !== undefined) {
      entries.push(conflictEntryFor(claim, digest, hit.verdict as 'consistent' | 'conflicts' | 'not-applicable', hit.verdict === 'conflicts' && hit.taskIds && hit.conflict ? { taskIds: hit.taskIds, conflict: hit.conflict } : undefined));
    } else pending.push({ claim, claimDigest: digest });
  }
  const batches: PendingConflictClaim[][] = [];
  let current: PendingConflictClaim[] = [];
  let bytes = 0;
  for (const item of pending) {
    const itemBytes = Buffer.byteLength(item.claim.text, 'utf8');
    if (current.length > 0 && (current.length >= batchSize || bytes + itemBytes > CONFLICT_BATCH_PROMPT_BYTE_BUDGET)) {
      batches.push(current); current = []; bytes = 0;
    }
    current.push(item); bytes += itemBytes;
    if (itemBytes > CONFLICT_BATCH_PROMPT_BYTE_BUDGET) { batches.push(current); current = []; bytes = 0; }
  }
  if (current.length > 0) batches.push(current);
  return { entries, batches };
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
    if (isConflictClaim(claim)) continue;
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
  const conflict = planConflictBatches({ claims, previous, batchSize });
  return { entries, batches, conflictEntries: conflict.entries, conflictBatches: conflict.batches };
}
