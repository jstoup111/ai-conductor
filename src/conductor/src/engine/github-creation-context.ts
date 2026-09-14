// github-creation-context.ts — short-lived authority for one issue creation transaction.
//
// A new issue has no committed provenance yet.  This boundary is the narrow
// exception: it admits a creation already authorized by an explicit intake
// action or feature workflow, then permits metadata only on the canonical
// issue returned by that one creation.  It deliberately exports no reusable
// post-creation capability.

import type {
  GithubCreateOperationRequest,
  GithubFeatureWriteOperationRequest,
  GithubIssueTarget,
  GithubOperationName,
  GithubOperationRefusalReason,
  GithubOperationRunner,
  GithubOperationRunnerRefusal,
  GithubOperationRunnerResponse,
} from './github-operations.js';
import { normalizeOwnerId, type OwnerResolution } from './owner-gate/identity.js';

/** The two pre-provenance paths approved by ADR D3; no generic bypass exists. */
export type GithubIssueCreationIntent =
  | { readonly kind: 'explicit-intake'; readonly repository: string }
  | { readonly kind: 'authorized-feature'; readonly repository: string };

/** Current machine identity and the destination-specific reason for creation. */
export interface GithubIssueCreationAuthority {
  /** Resolved for each transaction; a prior run's identity is never reused. */
  resolveActor(): Promise<OwnerResolution>;
  readonly intent: GithubIssueCreationIntent;
}

/** All writes covered by a context are supplied together and cannot escape it. */
export interface GithubIssueCreationTransaction {
  readonly authority: GithubIssueCreationAuthority;
  readonly creation: GithubCreateOperationRequest;
  readonly metadata?: readonly GithubFeatureWriteOperationRequest[];
}

type GithubMetadataFailure = {
  readonly operation: GithubOperationName;
  readonly error: string;
};

export type GithubIssueCreationTransactionResult =
  | {
    readonly kind: 'executed';
    readonly operation: 'issue.create';
    readonly created: GithubIssueTarget;
  }
  | {
    readonly kind: 'partial';
    readonly operation: 'issue.create';
    /** Omitted when the remote create may have succeeded but identified no one issue. */
    readonly created?: GithubIssueTarget;
    readonly metadataFailures: readonly GithubMetadataFailure[];
  }
  | {
    readonly kind: 'refused';
    readonly operation: 'issue.create';
    readonly reason: GithubOperationRefusalReason;
  }
  | {
    readonly kind: 'failed';
    readonly operation: 'issue.create';
    readonly error: string;
  };

interface BoundCreationContext {
  readonly actor: string;
  readonly repository: string;
}

function isRefusal(
  response: GithubOperationRunnerResponse | GithubOperationRunnerRefusal,
): response is GithubOperationRunnerRefusal {
  return 'kind' in response && response.kind === 'refused';
}

function refusal(reason: GithubOperationRefusalReason): GithubIssueCreationTransactionResult {
  return Object.freeze({ kind: 'refused', operation: 'issue.create', reason });
}

function failure(error: unknown): GithubIssueCreationTransactionResult {
  return Object.freeze({
    kind: 'failed',
    operation: 'issue.create',
    error: error instanceof Error ? error.message : String(error),
  });
}

async function bindContext(
  authority: GithubIssueCreationAuthority,
  creation: GithubCreateOperationRequest,
): Promise<BoundCreationContext | GithubIssueCreationTransactionResult> {
  let resolution: OwnerResolution;
  try {
    resolution = await authority.resolveActor();
  } catch {
    return refusal('unresolved-actor');
  }
  const actor = resolution.resolved ? normalizeOwnerId(resolution.id) : null;
  if (actor === null) return refusal('unresolved-actor');
  if (creation.operation !== 'issue.create' || creation.target.kind !== 'repository') {
    return refusal('invalid-target');
  }
  if (authority.intent.repository !== creation.target.repository) {
    return refusal('explicit-authorization-required');
  }
  if (normalizeOwnerId(creation.context.actor) !== actor) return refusal('explicit-authorization-required');
  return Object.freeze({ actor, repository: creation.target.repository });
}

function metadataIsPreauthorized(
  request: GithubFeatureWriteOperationRequest,
  context: BoundCreationContext,
): boolean {
  return request.target.kind === 'issue'
    && request.target.repository === context.repository
    && normalizeOwnerId(request.context.actor) === context.actor
    && (request.operation === 'issue.label.add'
      || request.operation === 'issue.label.remove'
      || request.operation === 'issue.dependency.add'
      || request.operation === 'issue.dependency.remove');
}

function canonicalCreatedIssue(
  created: GithubOperationRunnerResponse['created'],
  context: BoundCreationContext,
): GithubIssueTarget | undefined {
  if (created?.kind !== 'issue'
    || created.repository !== context.repository
    || !Number.isSafeInteger(created.number)
    || created.number < 1) return undefined;
  return Object.freeze({ repository: context.repository, kind: 'issue', number: created.number });
}

function metadataError(response: GithubOperationRunnerResponse | GithubOperationRunnerRefusal): string | undefined {
  if (isRefusal(response)) return `GitHub operation refused: ${response.reason}`;
  if (response.metadataFailures?.length) return response.metadataFailures.map((item) => item.error).join('; ');
  return undefined;
}

/**
 * Execute one short-lived issue creation transaction.
 *
 * The private context is bound before the first remote call, consumed by this
 * function, and never returned.  Therefore a target from this result cannot
 * grant an unrelated mutation, a second transaction, or a later-run write.
 */
export async function executeGithubIssueCreationTransaction(
  transaction: GithubIssueCreationTransaction,
  runner: GithubOperationRunner,
): Promise<GithubIssueCreationTransactionResult> {
  const context = await bindContext(transaction.authority, transaction.creation);
  if ('kind' in context) return context;

  const metadata = transaction.metadata ?? [];
  if (metadata.some((request) => !metadataIsPreauthorized(request, context))) {
    return refusal('invalid-target');
  }

  let creationResponse: GithubOperationRunnerResponse | GithubOperationRunnerRefusal;
  try {
    creationResponse = await runner.run(transaction.creation);
  } catch (error) {
    return failure(error);
  }
  if (isRefusal(creationResponse)) return refusal(creationResponse.reason);

  const created = canonicalCreatedIssue(creationResponse.created, context);
  if (!created) {
    return Object.freeze({
      kind: 'partial',
      operation: 'issue.create',
      metadataFailures: [{
        operation: 'issue.create',
        error: 'GitHub creation response did not identify one canonical issue; no metadata was written.',
      }] satisfies readonly GithubMetadataFailure[],
    });
  }

  const metadataFailures: GithubMetadataFailure[] = [...(creationResponse.metadataFailures ?? [])];
  for (const request of metadata) {
    const target = request.target;
    if (target.kind !== 'issue' || target.number !== created.number) {
      metadataFailures.push({
        operation: request.operation,
        error: 'Creation metadata target does not match the canonical created issue.',
      });
      continue;
    }
    try {
      const response = await runner.run(request);
      const error = metadataError(response);
      if (error) metadataFailures.push({ operation: request.operation, error });
    } catch (error) {
      metadataFailures.push({
        operation: request.operation,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return metadataFailures.length === 0
    ? Object.freeze({ kind: 'executed', operation: 'issue.create', created })
    : Object.freeze({ kind: 'partial', operation: 'issue.create', created, metadataFailures });
}
