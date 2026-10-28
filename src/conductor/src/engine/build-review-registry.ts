import { createHash } from 'node:crypto';
import type { BuildReviewRubricId } from '../types/config.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  BUILD_REVIEW_JUDGED_V4_SCHEMAS,
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

export { BUILD_REVIEW_RUBRIC_IDS } from '../types/config.js';
type RegisteredBuildReviewRubricId = BuildReviewRubricId;

/**
 * Per-rubric default enablement; an explicit `rubrics.<id>.enabled` always
 * wins, both when config is loaded and when it is resolved. Test quality is
 * opt-in: its scoped-run preflight classifies test output with
 * framework-specific patterns, and on frameworks it does not recognize
 * (e.g. RSpec, #1682) every run — pass or fail — becomes an unretriable
 * infrastructure failure, so the rubric can never return a verdict and the
 * gate deadlocks. Projects whose framework the preflight understands enable
 * it explicitly (this repository does, in `.ai-conductor/config.yml`).
 */
export const BUILD_REVIEW_RUBRIC_DEFAULT_ENABLED: Readonly<Record<RegisteredBuildReviewRubricId, boolean>> = Object.freeze({
  testQuality: false,
  security: true,
  implementationQuality: true,
});

type BuildReviewRubricRegistryCatalog = Readonly<Record<
  RegisteredBuildReviewRubricId,
  BuildReviewRubricDescriptor
>>;

/**
 * The live registry boundary validates every descriptor before publishing its
 * id-keyed view to dispatch.  Keep the object shape stable for existing
 * registry consumers while rejecting malformed catalog entries at startup.
 */
export function createBuildReviewRubricRegistry(
  catalog: BuildReviewRubricRegistryCatalog,
): BuildReviewRubricRegistryCatalog {
  resolveBuildReviewContractCatalog(Object.entries(catalog).map(([id, descriptor]) => ({
    id,
    contract: descriptor.contract,
  })));
  return Object.freeze({ ...catalog });
}

/**
 * The closed, auxiliary rubric catalog for the public build_review gate.
 *
 * Rubrics are explicitly not lifecycle steps: their identifiers remain
 * registry identifiers throughout this auxiliary catalog.
 */
const BUILD_REVIEW_RUBRIC_CATALOG = {
  testQuality: Object.freeze({
    skillName: 'build-review-test-quality',
    cachePolicy: 'content-addressed',
    prerequisite: 'none',
    contract: Object.freeze({
      projection: Object.freeze({
        version: 'v4',
        build: (source: BuildReviewProjectionSource) => deriveBuildReviewRubricProjections(source).testQuality,
      }),
      output: Object.freeze({
        version: 'v4',
        jsonSchema: BUILD_REVIEW_JUDGED_V4_SCHEMAS.testQuality,
        parse: parseBuildReviewJudgedResult,
      }),
      identity: Object.freeze({ canonicalize: canonicalizeBuildReviewFindingIdentity }),
    }),
  }),
  security: Object.freeze({
    skillName: 'build-review-security',
    cachePolicy: 'content-addressed',
    prerequisite: 'none',
    contract: Object.freeze({
      projection: Object.freeze({
        version: 'v4',
        build: (source: BuildReviewProjectionSource) => deriveBuildReviewRubricProjections(source).security,
      }),
      output: Object.freeze({
        version: 'v4',
        jsonSchema: BUILD_REVIEW_JUDGED_V4_SCHEMAS.security,
        parse: parseBuildReviewJudgedResult,
      }),
      identity: Object.freeze({ canonicalize: canonicalizeBuildReviewFindingIdentity }),
    }),
  }),
  implementationQuality: Object.freeze({
    skillName: 'build-review-implementation-quality',
    cachePolicy: 'content-addressed',
    prerequisite: 'none',
    contract: Object.freeze({
      projection: Object.freeze({
        version: 'v4',
        build: (source: BuildReviewProjectionSource) => deriveBuildReviewRubricProjections(source).implementationQuality,
      }),
      output: Object.freeze({
        version: 'v4',
        jsonSchema: BUILD_REVIEW_JUDGED_V4_SCHEMAS.implementationQuality,
        parse: parseBuildReviewJudgedResult,
      }),
      identity: Object.freeze({ canonicalize: canonicalizeBuildReviewFindingIdentity }),
    }),
  }),
} as const satisfies BuildReviewRubricRegistryCatalog;

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

/** Read a shipped rubric from its installation directory, not its semantic name. */
export async function readBuildReviewRubricSkill(
  harnessRoot: string,
  rubric: RegisteredBuildReviewRubricId,
): Promise<string> {
  const { skillName } = getBuildReviewRubricDescriptor(rubric);
  return readFile(join(harnessRoot, 'skills', skillName, 'SKILL.md'), 'utf8');
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
    ...(policy.timeout_seconds === undefined ? {} : { timeout_seconds: policy.timeout_seconds }),
    llm_provider: policy.llm_provider,
    model: policy.model,
    effort: policy.effort,
    model_fallback_ladder: policy.model_fallback_ladder,
    max_retries: policy.max_retries,
    escalate: policy.escalate,
  });

  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}
