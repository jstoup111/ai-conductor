import type { BuildReviewRubricId } from "../types/config.js";
import type { BuildReviewSkip } from "./build-review-domain.js";
import { getBuildReviewRubricDescriptor } from "./build-review-registry.js";
import type {
  ResolvedBuildReviewConfig,
  ResolvedBuildReviewRubricPolicy,
} from "./resolved-config.js";

const BUILD_REVIEW_RUBRICS: readonly BuildReviewRubricId[] = [
  "tautology",
  "scope",
  "rootCause",
  "completeness",
  "wiring",
];

/** A rubric that passed deterministic pre-dispatch classification. */
export interface BuildReviewDispatchableRubric {
  rubric: BuildReviewRubricId;
  skillName: string;
  policy: ResolvedBuildReviewRubricPolicy;
}

export type BuildReviewClassifiedBranch = BuildReviewDispatchableRubric | BuildReviewSkip;

/**
 * Future cache/provider stages are injected behind these hooks. Classification
 * intentionally does not call either one: skips are decided before those
 * layers, so they cannot spend a model invocation or create cache state.
 */
export interface BuildReviewCoordinatorHooks {
  lookupCache?: (rubric: BuildReviewDispatchableRubric) => unknown;
  dispatchModel?: (rubric: BuildReviewDispatchableRubric) => unknown;
}

export type BuildReviewClassification =
  | { kind: "gate-disabled" }
  | { kind: "refused"; reason: "no-enabled-rubrics" | "no-valid-judgement" }
  | { kind: "ready"; branches: readonly BuildReviewClassifiedBranch[] };

/**
 * Resolves deterministic skip conditions before any cache or provider work.
 * A disabled whole gate produces no synthetic success; likewise an enabled
 * gate with no possible judgement is refused rather than allowed to pass an
 * empty lap.
 */
export function classifyBuildReviewRubricBranches(
  config: ResolvedBuildReviewConfig,
  entryPoints: readonly string[],
  _hooks: BuildReviewCoordinatorHooks = {},
): BuildReviewClassification {
  if (!config.enabled) return { kind: "gate-disabled" };

  const enabled = BUILD_REVIEW_RUBRICS.filter((rubric) => config.rubrics[rubric].enabled);
  if (enabled.length === 0) return { kind: "refused", reason: "no-enabled-rubrics" };

  const branches = BUILD_REVIEW_RUBRICS.map((rubric): BuildReviewClassifiedBranch => {
    const policy = config.rubrics[rubric];
    if (!policy.enabled) return { kind: "skipped", rubric, reason: "disabled" };

    const descriptor = getBuildReviewRubricDescriptor(rubric);
    if (descriptor.prerequisite === "entry-points" && entryPoints.length === 0) {
      return { kind: "skipped", rubric, reason: "missing-entry-points" };
    }
    return { rubric, skillName: descriptor.skillName, policy };
  });

  if (!branches.some((branch): branch is BuildReviewDispatchableRubric => !("kind" in branch))) {
    return { kind: "refused", reason: "no-valid-judgement" };
  }
  return { kind: "ready", branches };
}
