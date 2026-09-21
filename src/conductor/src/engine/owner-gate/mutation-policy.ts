// owner-gate/mutation-policy.ts — authorize one feature mutation from current evidence.
//
// This is deliberately a decision boundary, not a transport wrapper.  Task 6
// composes an authorized decision with the private GitHub transport; keeping
// transport out of this module makes it impossible for a refusal here to run a
// fallback mutation.

import type { GithubOperationName, GithubOperationTarget } from '../github-operations.js';
import { githubTargetsMatch } from '../github-target.js';
import { normalizeOwnerId, type OwnerResolution } from './identity.js';
import {
  readMutationProvenance,
  type MutationProvenanceDiscovery,
  type MutationProvenanceRequest,
} from './mutation-provenance.js';

/** The complete, canonical context for one feature-resource mutation attempt. */
export interface GithubMutationAuthorizationRequest {
  readonly operation: GithubOperationName;
  readonly target: GithubOperationTarget;
  readonly provenance: MutationProvenanceRequest;
}

/** Seams are injected so identity and committed-tree evidence are fresh per attempt. */
export interface GithubMutationAuthorizationDependencies {
  readonly resolveMachineOwner: () => Promise<OwnerResolution>;
  readonly provenanceDiscovery: MutationProvenanceDiscovery;
}

export type GithubMutationAuthorizationRefusalReason =
  | 'other-owner'
  | 'unresolved-actor'
  | 'missing-provenance'
  | 'conflicting-provenance'
  | 'provenance-unreadable'
  | 'provenance-timeout'
  | 'invalid-target';

/** A decision carries its binding rather than a reusable boolean capability. */
export type GithubMutationAuthorization =
  | {
    readonly kind: 'authorized';
    readonly actor: string;
    readonly operation: GithubOperationName;
    readonly target: GithubOperationTarget;
  }
  | {
    readonly kind: 'refused';
    readonly operation: GithubOperationName;
    readonly target: GithubOperationTarget;
    readonly reason: GithubMutationAuthorizationRefusalReason;
  };

function boundTarget(target: GithubOperationTarget): GithubOperationTarget {
  switch (target.kind) {
    case 'issue':
    case 'pull-request':
      return Object.freeze({ repository: target.repository, kind: target.kind, number: target.number });
    case 'label-definition':
      return Object.freeze({ repository: target.repository, kind: target.kind, name: target.name });
    case 'remote-ref':
      return Object.freeze({ repository: target.repository, kind: target.kind, ref: target.ref });
    case 'repository':
      return Object.freeze({ repository: target.repository, kind: target.kind });
  }
}

/**
 * Preserve the requested resource while substituting the provenance repository
 * so the policy relies on the canonical target comparator for this boundary.
 */
function targetInRepository(target: GithubOperationTarget, repository: string): GithubOperationTarget {
  switch (target.kind) {
    case 'issue':
    case 'pull-request':
      return { repository, kind: target.kind, number: target.number };
    case 'label-definition':
      return { repository, kind: target.kind, name: target.name };
    case 'remote-ref':
      return { repository, kind: target.kind, ref: target.ref };
    case 'repository':
      return { repository, kind: target.kind };
  }
}

function refused(
  request: GithubMutationAuthorizationRequest,
  reason: GithubMutationAuthorizationRefusalReason,
): GithubMutationAuthorization {
  return Object.freeze({
    kind: 'refused',
    operation: request.operation,
    target: boundTarget(request.target),
    reason,
  });
}

/**
 * Authorize one exact feature mutation from the operator's current machine
 * identity and its current, authoritative committed ownership record.
 *
 * Nothing is cached: a retry or a different operation/target must call this
 * function again and obtains a new identity and provenance decision.
 */
export async function authorizeGithubMutation(
  request: GithubMutationAuthorizationRequest,
  dependencies: GithubMutationAuthorizationDependencies,
): Promise<GithubMutationAuthorization> {
  const provenanceTarget = request.provenance.target;
  if (!githubTargetsMatch(request.target, targetInRepository(request.target, request.provenance.repository))
    || (provenanceTarget !== undefined && !githubTargetsMatch(request.target, provenanceTarget))) {
    return refused(request, 'invalid-target');
  }

  const resolvedActor = await dependencies.resolveMachineOwner();
  const actor = resolvedActor.resolved ? normalizeOwnerId(resolvedActor.id) : null;
  if (actor === null) return refused(request, 'unresolved-actor');

  const provenance = await readMutationProvenance(request.provenance, dependencies.provenanceDiscovery);
  if (provenance.kind === 'owned') {
    return provenance.owner === actor
      ? Object.freeze({
        kind: 'authorized',
        actor,
        operation: request.operation,
        target: boundTarget(request.target),
      })
      : refused(request, 'other-owner');
  }

  switch (provenance.reason) {
    case 'duplicate-conflicting-owner':
    case 'conflicting-provenance':
      return refused(request, 'conflicting-provenance');
    case 'missing-provenance':
      return refused(request, 'missing-provenance');
    case 'provenance-unreadable':
      return refused(request, 'provenance-unreadable');
    case 'provenance-timeout':
      return refused(request, 'provenance-timeout');
  }
}
