import { createHash } from 'node:crypto';

import {
  BUILD_REVIEW_JUDGED_V3_SCHEMAS,
  parseBuildReviewJudgedResult,
} from './build-review-domain.js';
import {
  resolveBuildReviewContractCatalog,
  type RubricContractDescriptor,
} from './build-review-contract.js';
import { canonicalizeBuildReviewFindingIdentity } from './build-review-finding-identity.js';
import {
  deriveBuildReviewRubricProjections,
  type BuildReviewProjectionSource,
  type BuildReviewRubricProjection,
} from './build-review-projections.js';
import type { ResolvedBuildReviewRubricPolicy } from './resolved-config.js';

export type BuildReviewRubricCachePolicy = 'content-addressed';
export type BuildReviewRubricPrerequisite = 'none';

export interface BuildReviewRubricDescriptor {
  readonly skillName: string;
  readonly cachePolicy: BuildReviewRubricCachePolicy;
  readonly prerequisite: BuildReviewRubricPrerequisite;
  readonly contract: RubricContractDescriptor<
    BuildReviewProjectionSource,
    BuildReviewRubricProjection
  >;
}

export const BUILD_REVIEW_RUBRIC_IDS = ['testQuality', 'security'] as const;

type RegisteredBuildReviewRubricId = (typeof BUILD_REVIEW_RUBRIC_IDS)[number];

type BuildReviewRubricRegistryCatalogMember = {
  readonly id: RegisteredBuildReviewRubricId;
  readonly descriptor: BuildReviewRubricDescriptor;
};

/**
 * The live registry boundary validates every descriptor before publishing its
 * id-keyed view to dispatch.  Keep the object shape stable for existing
 * registry consumers while rejecting malformed catalog entries at startup.
 */
export function createBuildReviewRubricRegistry(
  members: readonly BuildReviewRubricRegistryCatalogMember[],
): Readonly<Record<RegisteredBuildReviewRubricId, BuildReviewRubricDescriptor>> {
  const validated = resolveBuildReviewContractCatalog(members.map(({ id, descriptor }) => ({
    id,
    contract: descriptor.contract,
  })));
  return Object.freeze(Object.fromEntries(validated.map(({ id }, index) => [id, members[index]!.descriptor]))) as Readonly<
    Record<RegisteredBuildReviewRubricId, BuildReviewRubricDescriptor>
  >;
}

/**
 * The closed, auxiliary rubric catalog for the public build_review gate.
 *
 * Rubrics are explicitly not lifecycle steps: their identifiers remain
 * registry identifiers throughout this auxiliary catalog.
 */
const BUILD_REVIEW_RUBRIC_CATALOG: readonly BuildReviewRubricRegistryCatalogMember[] = [
  {
    id: 'testQuality',
    descriptor: Object.freeze({
    skillName: 'build-review-test-quality',
    cachePolicy: 'content-addressed',
    prerequisite: 'none',
    contract: Object.freeze({
      projection: Object.freeze({
        version: 'v3',
        build: (source: BuildReviewProjectionSource) => deriveBuildReviewRubricProjections(source).testQuality,
      }),
      output: Object.freeze({
        version: 'v3',
        jsonSchema: BUILD_REVIEW_JUDGED_V3_SCHEMAS.testQuality,
        parse: parseBuildReviewJudgedResult,
      }),
      identity: Object.freeze({ canonicalize: canonicalizeBuildReviewFindingIdentity }),
    }),
    }),
  },
  {
    id: 'security',
    descriptor: Object.freeze({
    skillName: 'build-review-security',
    cachePolicy: 'content-addressed',
    prerequisite: 'none',
    contract: Object.freeze({
      projection: Object.freeze({
        version: 'v3',
        build: (source: BuildReviewProjectionSource) => deriveBuildReviewRubricProjections(source).security,
      }),
      output: Object.freeze({
        version: 'v3',
        jsonSchema: BUILD_REVIEW_JUDGED_V3_SCHEMAS.security,
        parse: parseBuildReviewJudgedResult,
      }),
      identity: Object.freeze({ canonicalize: canonicalizeBuildReviewFindingIdentity }),
    }),
    }),
  },
];

export const BUILD_REVIEW_RUBRIC_REGISTRY = createBuildReviewRubricRegistry(
  BUILD_REVIEW_RUBRIC_CATALOG,
);

export function isRegisteredRubric(rubric: string): rubric is RegisteredBuildReviewRubricId {
  return Object.hasOwn(BUILD_REVIEW_RUBRIC_REGISTRY, rubric);
}

export function getBuildReviewRubricDescriptor(
  rubric: RegisteredBuildReviewRubricId,
): BuildReviewRubricDescriptor {
  return BUILD_REVIEW_RUBRIC_REGISTRY[rubric];
}

/**
 * Content-addressed policy identity for a judged rubric result.
 *
 * `enabled` is deliberately excluded: disabled rubrics short-circuit to a
 * deterministic skip before cache lookup, so it cannot alter a judged result.
 * Ordered provider and model fallback arrays retain their order because that
 * order changes execution semantics.
 */
export function fingerprintBuildReviewRubricPolicy(
  policy: ResolvedBuildReviewRubricPolicy,
): string {
  const canonical = JSON.stringify({
    llm_provider: policy.llm_provider,
    model: policy.model,
    effort: policy.effort,
    model_fallback_ladder: policy.model_fallback_ladder,
    max_retries: policy.max_retries,
    escalate: policy.escalate,
  });

  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}
