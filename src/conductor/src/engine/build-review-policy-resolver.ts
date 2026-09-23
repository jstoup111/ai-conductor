import type {
  InstalledReviewSkill,
  InstalledReviewSkillAvailability,
  ReviewPolicyDeclaration,
  ReviewPolicyResolution,
} from './build-review-policy.js';
import type { RubricContractDescriptor } from './build-review-contract.js';
import {
  BUILD_REVIEW_CUSTOM_V1_SCHEMA,
  parseBuildReviewCustomReviewerPayload,
  type BuildReviewCustomReviewerPayload,
} from './build-review-domain.js';
import {
  canonicalizeBuildReviewCustomFindingIdentity,
  type BuildReviewCustomFindingIdentity,
} from './build-review-finding-identity.js';
import type { BuildReviewFrozenInputScope } from './build-review-containment.js';

/** One engine-owned contract shared by every resolved custom-v1 rubric. */
export const BUILD_REVIEW_CUSTOM_V1_CONTRACT = Object.freeze({
  projection: Object.freeze({
    version: 'v1',
    // Custom review receives the frozen-input view already built by the
    // containment boundary; it must not synthesize a second projection.
    build: (scope: BuildReviewFrozenInputScope) => scope,
  }),
  output: Object.freeze({
    version: 'v1',
    jsonSchema: BUILD_REVIEW_CUSTOM_V1_SCHEMA,
    parse: parseBuildReviewCustomReviewerPayload,
  }),
  identity: Object.freeze({ canonicalize: canonicalizeBuildReviewCustomFindingIdentity }),
}) satisfies RubricContractDescriptor<
  BuildReviewFrozenInputScope,
  BuildReviewFrozenInputScope,
  BuildReviewCustomReviewerPayload,
  BuildReviewCustomFindingIdentity
>;

/** Add the common custom contract while preserving a resolved member's fields. */
export function resolveBuildReviewCustomContract<Member extends { readonly kind: 'custom' }>(
  member: Member,
): Member & { readonly contract: typeof BUILD_REVIEW_CUSTOM_V1_CONTRACT } {
  return Object.freeze({ ...member, contract: BUILD_REVIEW_CUSTOM_V1_CONTRACT });
}

export type ReviewPolicyCatalogFailureCode =
  | 'partial'
  | 'error'
  | 'malformed'
  | 'unsupported'
  | 'unreadable'
  | 'timeout'
  | 'cancelled';

/** A discovery failure is policy loading, never provider/model unavailability. */
export class ReviewPolicyCatalogError extends Error {
  readonly provider: 'codex' | 'claude';
  readonly code: ReviewPolicyCatalogFailureCode;

  constructor(
    provider: 'codex' | 'claude',
    code: ReviewPolicyCatalogFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReviewPolicyCatalogError';
    this.provider = provider;
    this.code = code;
  }
}

export interface ReviewPolicyCatalogLoadFailure {
  readonly code: 'policy-load';
  readonly provider: 'codex' | 'claude';
  readonly reason: ReviewPolicyCatalogFailureCode;
  readonly message: string;
}

export type CatalogAwareReviewPolicyResolution =
  | ReviewPolicyResolution
  | { readonly kind: 'failure'; readonly failure: ReviewPolicyCatalogLoadFailure };

export type {
  InstalledReviewSkill,
  ReviewPolicyDeclaration,
  ReviewPolicyResolution,
} from './build-review-policy.js';

interface ParsedReviewPolicyReference {
  readonly semanticName: string;
  readonly pluginId?: string;
}

function parseReviewPolicyReference(skill: string): ParsedReviewPolicyReference {
  const separator = skill.indexOf(':');
  if (separator === -1) return { semanticName: skill };

  return {
    pluginId: skill.slice(0, separator),
    semanticName: skill.slice(separator + 1),
  };
}

function compareOrigin(
  left: InstalledReviewSkill,
  right: InstalledReviewSkill,
): number {
  return left.installationOrigin.localeCompare(right.installationOrigin);
}

type UnavailableReviewSkillAvailability = Exclude<InstalledReviewSkillAvailability, 'available'>;

function isUnavailable(
  policy: InstalledReviewSkill,
): policy is InstalledReviewSkill & { readonly availability: UnavailableReviewSkillAvailability } {
  return policy.availability !== 'available';
}

/**
 * Select exactly one locally installed policy without interpreting its
 * contents. Host adapters own discovery; this boundary owns semantic
 * qualification, origin deduplication, and refusal to guess between copies.
 */
export function resolveInstalledReviewPolicy(
  declaration: ReviewPolicyDeclaration,
  catalog: readonly InstalledReviewSkill[],
): ReviewPolicyResolution {
  const reference = parseReviewPolicyReference(declaration.skill);
  // A listing-only plugin has no enumerable skills, so its plugin-wide
  // descriptor answers every selection qualified by that plugin. It can only
  // yield a typed unavailable diagnosis, never a resolved policy.
  const matching = catalog.filter((policy) => (
    (declaration.source === undefined || policy.source === declaration.source)
    && (reference.pluginId === undefined || policy.plugin?.id === reference.pluginId)
    && (
      policy.semanticName === reference.semanticName
      || (policy.pluginWide === true && reference.pluginId !== undefined && policy.availability !== 'available')
    )
  ));

  if (matching.length === 0) {
    return {
      kind: 'failure',
      failure: {
        code: 'absent',
        skill: declaration.skill,
        ...(declaration.source === undefined ? {} : { source: declaration.source }),
      },
    };
  }

  // The catalog may expose a symlink under multiple paths. Origin is the
  // canonical installation identity, so first-seen metadata is preserved and
  // package bytes never participate in selection.
  const byOrigin = new Map<string, InstalledReviewSkill>();
  for (const policy of matching) {
    byOrigin.set(policy.installationOrigin, byOrigin.get(policy.installationOrigin) ?? policy);
  }
  const deduplicated = [...byOrigin.values()].sort(compareOrigin);
  const available = deduplicated.filter((policy) => policy.availability === 'available');

  if (available.length === 0) {
    const failure = deduplicated.find(isUnavailable)!;
    return {
      kind: 'failure',
      failure: {
        code: failure.availability,
        skill: declaration.skill,
        ...(declaration.source === undefined ? {} : { source: declaration.source }),
      },
    };
  }

  if (available.length === 1) {
    return { kind: 'resolved', policy: available[0]! };
  }

  return {
    kind: 'failure',
    failure: {
      code: 'ambiguous',
      skill: declaration.skill,
      origins: available.map((policy) => policy.installationOrigin),
    },
  };
}

/**
 * Preserve catalog failure as an explicit policy-loading outcome. Callers must
 * stop this candidate here; it is not an absent skill or provider fallback.
 */
export function resolveInstalledReviewPolicyCatalog(
  declaration: ReviewPolicyDeclaration,
  catalog: readonly InstalledReviewSkill[] | ReviewPolicyCatalogError,
): CatalogAwareReviewPolicyResolution {
  if (catalog instanceof ReviewPolicyCatalogError) {
    return {
      kind: 'failure',
      failure: {
        code: 'policy-load',
        provider: catalog.provider,
        reason: catalog.code,
        message: catalog.message,
      },
    };
  }
  return resolveInstalledReviewPolicy(declaration, catalog);
}
