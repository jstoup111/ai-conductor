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
import { authorizeGithubMutation } from './owner-gate/mutation-policy.js';
import type { GithubMutationExecutionContext } from './tracker-client.js';

/** Explicit operator intake is the one pre-provenance creation path. */
export interface GithubExplicitIntakeCreationAuthority {
  readonly resolveActor: () => Promise<OwnerResolution>;
  readonly intent: { readonly kind: 'explicit-intake'; readonly repository: string };
}

// The symbol and slot map deliberately stay module-private. An object that
// merely looks like `{ kind: 'authorized-feature', repository }` cannot enter
// this boundary: only the factory below installs its private slot after current
// committed provenance has authorized this exact issue creation.
const featureCreationAuthorityBrand: unique symbol = Symbol('feature-creation-authority');
const featureCreationAuthoritySlots = new WeakMap<object, {
  readonly actor: string;
  readonly repository: string;
  consumed: boolean;
}>();

/** Opaque, one-shot authority for creation from an already-owned feature. */
export type GithubFeatureIssueCreationAuthority = {
  readonly [featureCreationAuthorityBrand]: never;
};

/** The two ADR D3 paths; feature authority is capability, not caller data. */
export type GithubIssueCreationAuthority =
  | GithubExplicitIntakeCreationAuthority
  | GithubFeatureIssueCreationAuthority;

/**
 * Mint the only feature-creation capability after the normal mutation policy
 * reads current machine identity and committed feature provenance.
 */
export async function authorizeGithubFeatureIssueCreation(input: {
  readonly repository: string;
  readonly mutation: GithubMutationExecutionContext;
}): Promise<GithubFeatureIssueCreationAuthority | undefined> {
  if (!input?.mutation || typeof input.repository !== 'string' || input.repository === '') return undefined;
  const decision = await authorizeGithubMutation({
    operation: 'issue.create',
    target: { repository: input.repository, kind: 'repository' },
    provenance: input.mutation.provenance,
  }, input.mutation.dependencies).catch(() => undefined);
  if (!decision || decision.kind !== 'authorized') return undefined;

  const authority = Object.freeze({}) as GithubFeatureIssueCreationAuthority;
  featureCreationAuthoritySlots.set(authority, {
    actor: decision.actor,
    repository: input.repository,
    consumed: false,
  });
  return authority;
}

/** Resolve actor/repository without exposing a feature capability's binding. */
export async function resolveGithubIssueCreationAuthority(
  authority: GithubIssueCreationAuthority,
): Promise<{ readonly actor: string; readonly repository: string } | undefined> {
  const feature = authority && typeof authority === 'object'
    ? featureCreationAuthoritySlots.get(authority)
    : undefined;
  if (feature && !feature.consumed) return { actor: feature.actor, repository: feature.repository };
  if (!authority || typeof authority !== 'object' || !('intent' in authority)
    || authority.intent?.kind !== 'explicit-intake'
    || typeof authority.intent.repository !== 'string'
    || typeof authority.resolveActor !== 'function') return undefined;
  try {
    const resolution = await authority.resolveActor();
    const actor = resolution.resolved ? normalizeOwnerId(resolution.id) : null;
    return actor === null ? undefined : { actor, repository: authority.intent.repository };
  } catch {
    return undefined;
  }
}

/** Current machine identity and the destination-specific reason for creation. */
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
  const feature = authority && typeof authority === 'object'
    ? featureCreationAuthoritySlots.get(authority)
    : undefined;
  const claimedFeature = authority && typeof authority === 'object'
    && (authority as unknown as { intent?: { kind?: unknown } }).intent?.kind === 'authorized-feature';
  const bound = await resolveGithubIssueCreationAuthority(authority);
  if (!bound) return refusal(feature || claimedFeature ? 'explicit-authorization-required' : 'unresolved-actor');
  if (creation.operation !== 'issue.create' || creation.target.kind !== 'repository') {
    return refusal('invalid-target');
  }
  if (bound.repository !== creation.target.repository) {
    return refusal('explicit-authorization-required');
  }
  if (normalizeOwnerId(creation.context.actor) !== bound.actor) return refusal('explicit-authorization-required');
  if (feature) feature.consumed = true;
  return Object.freeze({ actor: bound.actor, repository: creation.target.repository });
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
