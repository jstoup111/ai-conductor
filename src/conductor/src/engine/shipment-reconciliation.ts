import type { ShipmentAssociationResult } from './shipment-association.js';
import type { ShipmentEvidenceRefusal, ShipmentEvidenceResult } from './shipment-evidence.js';
import { renderShippedRecord } from './shipped-record.js';

const repairableRecordRefusalCodes = new Set<ShipmentEvidenceRefusal['code']>([
  'shipped-record-missing',
  'shipped-record-malformed',
  'shipped-record-incomplete',
  'shipped-record-slug-mismatch',
  'shipped-record-pr-mismatch',
  'shipped-record-hash-mismatch',
]);

export interface ShipmentReconciliationInput {
  implementationPr: {
    number: number;
    url: string;
  };
  association: ShipmentAssociationResult;
  evidence: ShipmentEvidenceResult;
  expectedRecord: {
    specHash: string;
    shipped: string;
  };
}

export type ShipmentReconciliationPlan =
  | { kind: 'aligned'; writes: [] }
  | { kind: 'repair'; identity: string; writes: [ShipmentRecordWrite] }
  | { kind: 'unresolved'; reason: string; writes: [] };

export interface ShipmentRecordWrite {
  path: string;
  content: string;
}

export const SHIPMENT_REPAIR_STATUS_CONTEXT = 'shipped-record';

export interface ShipmentRepairPublisher {
  /** Create or reuse the deterministic repair branch from protected main. */
  ensureRepairBranch(input: { branch: string; base: 'main' }): Promise<void>;
  /** Commit exactly the planner's one shipped-record write to the repair branch. */
  commitRecordOnly(input: {
    branch: string;
    writes: [ShipmentRecordWrite];
  }): Promise<{ headSha: string }>;
  /** Return an existing open repair PR or create the one deterministic PR. */
  findOrCreateRepairPullRequest(input: {
    branch: string;
    base: 'main';
    identity: string;
    expectedHeadSha: string;
  }): Promise<{ url: string; headSha: string }>;
  /** Strictly evaluate the record at the immutable repair commit before status. */
  verifyRepairHead(input: { headSha: string }): Promise<ShipmentEvidenceResult>;
  /** Publish only the stable required-check context at the exact repair commit. */
  postStatus(input: {
    sha: string;
    context: typeof SHIPMENT_REPAIR_STATUS_CONTEXT;
    state: 'success' | 'failure';
    description: string;
  }): Promise<void>;
}

export type ShipmentRepairPublicationResult =
  | { kind: 'aligned' }
  | { kind: 'unresolved'; reason: string }
  | {
      kind: 'repair-published';
      identity: string;
      branch: string;
      pullRequestUrl: string;
      headSha: string;
      status: 'success' | 'failure';
    };

/**
 * Plans reconciliation only. Publishing the deterministic repair identity is
 * deliberately left to the workflow adapter so this pure decision cannot
 * mutate main, branches, or pull requests.
 */
export function planShipmentReconciliation(
  input: ShipmentReconciliationInput,
): ShipmentReconciliationPlan {
  if (input.association.kind !== 'implementation') {
    return { kind: 'unresolved', reason: input.association.classification, writes: [] };
  }

  const { slug } = input.association;
  if (input.evidence.kind === 'valid') {
    if (
      input.evidence.slug !== slug
      || input.evidence.pr !== input.implementationPr.url
      || input.evidence.recordPath !== `.docs/shipped/${slug}.md`
      || input.evidence.hash !== input.expectedRecord.specHash
    ) {
      return { kind: 'unresolved', reason: 'evidence-identity-mismatch', writes: [] };
    }
    return { kind: 'aligned', writes: [] };
  }

  if (
    input.evidence.kind === 'refusal'
    && repairableRecordRefusalCodes.has(input.evidence.code)
  ) {
    return {
      kind: 'repair',
      identity: `${input.implementationPr.number}/${slug}`,
      writes: [{
        path: `.docs/shipped/${slug}.md`,
        content: renderShippedRecord({
          slug,
          specHash: input.expectedRecord.specHash,
          pr: input.implementationPr.url,
          shipped: input.expectedRecord.shipped,
        }),
      }],
    };
  }

  return {
    kind: 'unresolved',
    reason: input.evidence.kind === 'refusal' ? input.evidence.code : input.evidence.kind,
    writes: [],
  };
}

/**
 * Publish a planned repair through the only allowed external operations. The
 * narrow injected surface intentionally offers neither a generic GitHub client
 * nor a main/approval/review/auto-merge/merge mutation.
 */
export async function publishShipmentRepair(
  plan: ShipmentReconciliationPlan,
  publisher: ShipmentRepairPublisher,
): Promise<ShipmentRepairPublicationResult> {
  if (plan.kind === 'aligned') return { kind: 'aligned' };
  if (plan.kind === 'unresolved') return { kind: 'unresolved', reason: plan.reason };

  assertRecordOnlyRepair(plan.writes);
  const branch = `shipment-repair/${plan.identity}`;
  try {
    await publisher.ensureRepairBranch({ branch, base: 'main' });
  } catch (error) {
    throw new Error(`repair ${plan.identity} branch failed: ${errorMessage(error)}`);
  }
  let expectedHeadSha: string;
  try {
    ({ headSha: expectedHeadSha } = await publisher.commitRecordOnly({ branch, writes: plan.writes }));
  } catch (error) {
    throw new Error(`repair ${plan.identity} record-commit failed: ${errorMessage(error)}`);
  }
  let pullRequestUrl: string;
  let headSha: string;
  try {
    ({ url: pullRequestUrl, headSha } = await publisher.findOrCreateRepairPullRequest({
      branch,
      base: 'main',
      identity: plan.identity,
      expectedHeadSha,
    }));
  } catch (error) {
    throw new Error(`repair ${plan.identity} pull-request failed: ${errorMessage(error)}`);
  }
  const verdict = await publisher.verifyRepairHead({ headSha });
  const status = verdict.kind === 'valid' ? 'success' : 'failure';
  const description = verdict.kind === 'valid'
    ? 'durable shipment evidence valid on repair head'
    : `durable shipment evidence: ${repairFailureDescription(verdict)}`;
  try {
    await publisher.postStatus({
      sha: headSha,
      context: SHIPMENT_REPAIR_STATUS_CONTEXT,
      state: status,
      description,
    });
  } catch (error) {
    throw new Error(`repair ${plan.identity} status failed: ${errorMessage(error)}`);
  }

  return {
    kind: 'repair-published',
    identity: plan.identity,
    branch,
    pullRequestUrl,
    headSha,
    status,
  };
}

function assertRecordOnlyRepair(writes: [ShipmentRecordWrite]): void {
  const [write] = writes;
  if (!write.path.startsWith('.docs/shipped/') || !write.path.endsWith('.md')) {
    throw new Error(`repair write is not a shipped record: ${write.path}`);
  }
}

function repairFailureDescription(verdict: Exclude<ShipmentEvidenceResult, { kind: 'valid' }>): string {
  return verdict.kind === 'refusal' ? verdict.code : verdict.reason;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
