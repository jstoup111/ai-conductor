import type { BuildReviewRubricId } from "../types/config.js";
import {
  parseBuildReviewJudgedResult,
  type BuildReviewJudgedResult,
  type BuildReviewLapId,
  type BuildReviewSkip,
} from "./build-review-domain.js";
import {
  fingerprintBuildReviewRubricPolicy,
  getBuildReviewRubricDescriptor,
} from "./build-review-registry.js";
import {
  classifyBuildReviewCacheLookup,
  type BuildReviewCacheEntry,
} from "./build-review-cache.js";
import {
  parseBuildReviewBranchArtifact,
  type BuildReviewBranchArtifact,
} from "./build-review-artifacts.js";
import type { BuildReviewFrozenInputs } from "./build-review-inputs.js";
import {
  deriveBuildReviewRubricProjections,
  type BuildReviewProjectionJson,
  type BuildReviewRubricProjection,
} from "./build-review-projections.js";
import type { TautologyPreflightResult } from "./build-review-tautology-preflight.js";
import { runAuxiliaryGroupBranches } from "./group-core.js";
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

export type BuildReviewCoordinatedBranch =
  | BuildReviewSkip
  | { readonly kind: "cache-hit"; readonly rubric: BuildReviewRubricId; readonly result: BuildReviewJudgedResult }
  | { readonly kind: "dispatched"; readonly rubric: BuildReviewRubricId; readonly result: BuildReviewJudgedResult }
  | { readonly kind: "infrastructure-failure"; readonly rubric: BuildReviewRubricId; readonly reason: string };

export type BuildReviewCoordination =
  | { readonly kind: "gate-disabled" }
  | { readonly kind: "refused"; readonly reason: "no-enabled-rubrics" | "no-valid-judgement" }
  | { readonly kind: "ready"; readonly branches: readonly BuildReviewCoordinatedBranch[] };

/**
 * All side effects are injected: snapshots/projections stay engine-owned and
 * a provider receives only its own closed projection, never sibling state or
 * accepted-risk/disposition data.
 */
export interface BuildReviewCoordinationInput {
  readonly config: ResolvedBuildReviewConfig;
  readonly inputs: BuildReviewFrozenInputs;
  readonly lapId: BuildReviewLapId;
  readonly preflight: () => Promise<TautologyPreflightResult>;
  readonly readCache: (
    branch: BuildReviewDispatchableRubric,
    projection: BuildReviewRubricProjection,
    policyFingerprint: string,
  ) => Promise<BuildReviewCacheEntry | undefined>;
  readonly dispatchModel: (
    branch: BuildReviewDispatchableRubric,
    projection: BuildReviewRubricProjection,
  ) => Promise<unknown>;
  /** Persist and return the validated, current-lap branch evidence. */
  readonly writeArtifact: (
    artifact: Omit<BuildReviewBranchArtifact, "version">,
  ) => Promise<BuildReviewBranchArtifact>;
  /** Persist one bounded semantic judgement; skips and failures never reach this effect. */
  readonly writeCache: (entry: BuildReviewCacheEntry) => Promise<void>;
}

function preflightProjection(preflight: TautologyPreflightResult): {
  readonly changedTestSelectors: readonly string[];
  readonly revertedProductionPatch: string;
  readonly preflightEvidence: BuildReviewProjectionJson;
} {
  return {
    changedTestSelectors: preflight.changedTestSelectors,
    revertedProductionPatch: "revertedProductionPatch" in preflight
      ? JSON.stringify(preflight.revertedProductionPatch)
      : "[]",
    preflightEvidence: preflight as unknown as BuildReviewProjectionJson,
  };
}

function infrastructure(rubric: BuildReviewRubricId, reason: string): BuildReviewCoordinatedBranch {
  return { kind: "infrastructure-failure", rubric, reason };
}

function validCurrentResult(
  candidate: unknown,
  rubric: BuildReviewRubricId,
  projection: BuildReviewRubricProjection,
): BuildReviewJudgedResult | undefined {
  const result = parseBuildReviewJudgedResult(candidate);
  return result && result.rubric === rubric && result.lapId === projection.lapId &&
    result.snapshotDigest === projection.snapshotDigest ? result : undefined;
}

function validWrittenArtifact(
  candidate: unknown,
  rubric: BuildReviewRubricId,
  projection: BuildReviewRubricProjection,
): BuildReviewJudgedResult | undefined {
  const artifact = parseBuildReviewBranchArtifact(candidate);
  const result = artifact?.result;
  return artifact?.rubric === rubric && artifact.lapId === projection.lapId &&
    artifact.snapshotDigest === projection.snapshotDigest && result?.kind === "judged" &&
    result.rubric === rubric && result.lapId === projection.lapId &&
    result.snapshotDigest === projection.snapshotDigest ? result : undefined;
}

/**
 * Coordinates the closed fan-out for exactly one frozen input snapshot. It
 * always waits for every cache miss under the configured cap; a single
 * provider/preflight fault becomes only that rubric's infrastructure result.
 */
export async function coordinateBuildReviewRubrics(
  input: BuildReviewCoordinationInput,
): Promise<BuildReviewCoordination> {
  const classification = classifyBuildReviewRubricBranches(input.config, input.inputs.entryPoints ?? []);
  if (classification.kind !== "ready") return classification;

  const tautologyEnabled = classification.branches.some(
    (branch) => !("kind" in branch) && branch.rubric === "tautology",
  );
  let preflight: TautologyPreflightResult | undefined;
  if (tautologyEnabled) {
    try {
      preflight = await input.preflight();
    } catch {
      preflight = {
        classification: "infrastructure-failure", reason: "scoped-run-failed",
        changedPaths: [], changedTestSelectors: [],
        sourceIdentities: { mergeBase: input.inputs.sourceSnapshot.mergeBase, headSha: input.inputs.sourceSnapshot.headSha },
      };
    }
  }
  const projections = deriveBuildReviewRubricProjections({
    lapId: input.lapId,
    inputs: input.inputs,
    tautology: preflight ? preflightProjection(preflight) : {
      changedTestSelectors: [], revertedProductionPatch: "[]", preflightEvidence: { classification: "not-requested" },
    },
    wiring: { relocationEvidence: [], scaffoldingDeclarations: [] },
  });
  const resolved = new Map<BuildReviewRubricId, BuildReviewCoordinatedBranch>();
  const misses: BuildReviewDispatchableRubric[] = [];

  for (const branch of classification.branches) {
    if ("kind" in branch) {
      resolved.set(branch.rubric, branch);
      continue;
    }
    if (branch.rubric === "tautology" && preflight?.classification === "infrastructure-failure") {
      resolved.set(branch.rubric, infrastructure(branch.rubric, preflight.reason));
      continue;
    }
    const projection = projections[branch.rubric];
    const policyFingerprint = fingerprintBuildReviewRubricPolicy(branch.policy);
    let candidate: BuildReviewCacheEntry | undefined;
    try {
      candidate = await input.readCache(branch, projection, policyFingerprint);
    } catch {
      resolved.set(branch.rubric, infrastructure(branch.rubric, "cache-read-failed"));
      continue;
    }
    const cache = classifyBuildReviewCacheLookup(candidate, {
      rubric: branch.rubric,
      contractVersion: projection.contractVersion,
      projectionVersion: projection.projectionVersion,
      projectionDigest: projection.digest,
      policyFingerprint,
      lapId: input.lapId,
      snapshotDigest: projection.snapshotDigest,
    });
    if (cache.kind === "hit") {
      try {
        const result = validWrittenArtifact(await input.writeArtifact({
          rubric: branch.rubric,
          lapId: projection.lapId,
          snapshotDigest: projection.snapshotDigest,
          result: cache.hit.result,
          provenance: cache.hit.provenance,
        }), branch.rubric, projection);
        resolved.set(branch.rubric, result
          ? { kind: "cache-hit", rubric: branch.rubric, result }
          : infrastructure(branch.rubric, "artifact-write-failed"));
      } catch {
        resolved.set(branch.rubric, infrastructure(branch.rubric, "artifact-write-failed"));
      }
    } else {
      misses.push(branch);
    }
  }

  const dispatched = await runAuxiliaryGroupBranches(misses.map((branch) => ({ memberId: branch.rubric, policy: branch })), input.config.maxParallel,
    async (rubric, branch) => {
      const projection = projections[rubric];
      try {
        const result = validCurrentResult(await input.dispatchModel(branch, projection), rubric, projection);
        if (!result) return { rubric, branch: infrastructure(rubric, "invalid-provider-result") };
        let written: BuildReviewJudgedResult | undefined;
        try {
          written = validWrittenArtifact(await input.writeArtifact({
            rubric,
            lapId: projection.lapId,
            snapshotDigest: projection.snapshotDigest,
            result,
            provenance: { kind: "fresh" },
          }), rubric, projection);
        } catch {
          return { rubric, branch: infrastructure(rubric, "artifact-write-failed") };
        }
        if (!written) return { rubric, branch: infrastructure(rubric, "artifact-write-failed") };
        try {
          await input.writeCache({
            version: 1,
            rubric,
            contractVersion: projection.contractVersion,
            projectionVersion: projection.projectionVersion,
            projectionDigest: projection.digest,
            policyFingerprint: fingerprintBuildReviewRubricPolicy(branch.policy),
            result: written,
          });
        } catch {
          return { rubric, branch: infrastructure(rubric, "cache-write-failed") };
        }
        return { rubric, branch: { kind: "dispatched", rubric, result: written } as BuildReviewCoordinatedBranch };
      } catch {
        return { rubric, branch: infrastructure(rubric, "provider-error") };
      }
    });
  for (const outcome of dispatched) resolved.set(outcome.rubric, outcome.branch);

  return {
    kind: "ready",
    branches: BUILD_REVIEW_RUBRICS.map((rubric) => resolved.get(rubric) ?? infrastructure(rubric, "missing-settlement")),
  };
}

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
