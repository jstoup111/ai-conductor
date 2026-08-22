import type { BuildReviewRubricId } from "../types/config.js";
import {
  CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION,
  describeBuildReviewJudgedResultRejection,
  parseBuildReviewDispatchFailure,
  buildReviewFindingReferenceContext,
  parseBuildReviewJudgedResult,
  type BuildReviewJudgedResult,
  type BuildReviewLapId,
  type BuildReviewCoordinatorFailureReason,
  type BuildReviewSkip,
} from "./build-review-domain.js";
import {
  fingerprintBuildReviewRubricPolicy,
  getBuildReviewRubricDescriptor,
} from "./build-review-registry.js";
import {
  classifyBuildReviewCacheLookup,
  type BuildReviewCacheEntry,
  type BuildReviewCacheEntryCandidate,
} from "./build-review-cache.js";
import type { BuildReviewEngineIdentity } from "./build-review-engine-identity.js";
import {
  parseBuildReviewBranchArtifact,
  type BuildReviewBranchArtifact,
} from "./build-review-artifacts.js";
import type { BuildReviewFrozenInputs } from "./build-review-inputs.js";
import {
  deriveBuildReviewRubricProjections,
  type BuildReviewProjectionJson,
  type BuildReviewRubricProjections,
  type BuildReviewRubricProjection,
  type BuildReviewTautologyProjectionInput,
} from "./build-review-projections.js";
import type { TautologyPreflightResult } from "./build-review-tautology-preflight.js";
import { runAuxiliaryGroupBranches } from "./group-core.js";
import type {
  ResolvedBuildReviewConfig,
  ResolvedBuildReviewRubricPolicy,
} from "./resolved-config.js";
import type { ConductorEvent } from "../types/events.js";
import { canonicalizeBuildReviewFindingSet } from "./build-review-finding-identity.js";

const BUILD_REVIEW_RUBRICS: readonly BuildReviewRubricId[] = [
  "tautology",
  "scope",
  "rootCause",
  "completeness",
];

export type BuildReviewRubricIdentity =
  | { readonly kind: "ready"; readonly identity: BuildReviewEngineIdentity }
  | { readonly kind: "unavailable"; readonly path: string };

export type BuildReviewRubricIdentities = Readonly<Record<
  BuildReviewRubricId,
  BuildReviewRubricIdentity
>>;

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
  | {
      readonly kind: "infrastructure-failure";
      readonly rubric: BuildReviewRubricId;
      readonly reason: BuildReviewCoordinatorFailureReason;
      /** Bounded diagnostic (e.g. a raw-output excerpt); never part of routing identity. */
      readonly detail?: string;
    };

export type BuildReviewCoordination =
  | { readonly kind: "gate-disabled" }
  | { readonly kind: "refused"; readonly reason: "no-enabled-rubrics" | "no-valid-judgement" }
  | { readonly kind: "ready"; readonly branches: readonly BuildReviewCoordinatedBranch[] };

export type BuildReviewCandidateCacheDecision =
  | { readonly kind: "cache-hit"; readonly result: BuildReviewJudgedResult }
  | { readonly kind: "miss" }
  | { readonly kind: "infrastructure-failure"; readonly detail?: string };

/**
 * All side effects are injected: snapshots/projections stay engine-owned and
 * a provider receives only its own closed projection, never sibling state or
 * accepted-risk/disposition data.
 */
export interface BuildReviewCoordinationInput {
  readonly config: ResolvedBuildReviewConfig;
  readonly inputs: BuildReviewFrozenInputs;
  readonly lapId: BuildReviewLapId;
  /** Compatibility seam for coordinator-only tests; production omits this so
   * identities are resolved exclusively from prepared candidates. */
  readonly engineIdentity?: BuildReviewRubricIdentities;
  /** Test seam for an engine-held projection corruption at branch settlement. */
  readonly projections?: BuildReviewRubricProjections;
  readonly preflight: () => Promise<TautologyPreflightResult>;
  readonly readCache: (
    branch: BuildReviewDispatchableRubric,
    projection: BuildReviewRubricProjection,
    policyFingerprint: string,
  ) => Promise<BuildReviewCacheEntryCandidate | undefined>;
  readonly dispatchModel: (
    branch: BuildReviewDispatchableRubric,
    projection: BuildReviewRubricProjection,
    onCandidatePrepared: (identity: BuildReviewEngineIdentity) => Promise<BuildReviewCandidateCacheDecision>,
  ) => Promise<unknown | { readonly result: unknown; readonly engineIdentity: BuildReviewEngineIdentity } | { readonly kind: "cache-hit"; readonly result: BuildReviewJudgedResult } | { readonly kind: "infrastructure-failure"; readonly detail?: string }>;
  /** Persist and return the validated, current-lap branch evidence. */
  readonly writeArtifact: (
    artifact: Omit<BuildReviewBranchArtifact, "version">,
  ) => Promise<BuildReviewBranchArtifact>;
  /** Persist one bounded semantic judgement; skips and failures never reach this effect. */
  readonly writeCache: (entry: BuildReviewCacheEntry) => Promise<void>;
  /** Engine-owned occurrence sink; callers connect this to the shared event emitter. */
  readonly emit?: (event: Extract<ConductorEvent, { type:
    | "build_review_rubric_started"
    | "build_review_rubric_result"
    | "build_review_rubric_skipped"
    | "build_review_cache_hit"
    | "build_review_cache_discarded"
    | "build_review_rubric_infrastructure_failure" }>) => Promise<void>;
}

/**
 * Project the preflight into its closed, bounded prompt form. Every field is
 * explicitly named and bounded by construction: the reverted production files
 * travel as a content-free path+blob-sha manifest (the grader recovers bytes
 * with `git show <mergeBase>:<path>`), and the scoped run travels as its
 * exit-code verdict plus a capped failure excerpt — never raw stdout/stderr
 * or merge-base file content, and never the same evidence twice.
 */
function preflightProjection(preflight: TautologyPreflightResult): BuildReviewTautologyProjectionInput {
  if (preflight.classification === "infrastructure-failure") {
    return {
      changedTestSelectors: preflight.changedTestSelectors,
      revertedProductionManifest: [],
      preflightEvidence: {
        classification: preflight.classification,
        reason: preflight.reason,
        changedPaths: preflight.changedPaths,
        changedTestSelectors: preflight.changedTestSelectors,
        sourceIdentities: preflight.sourceIdentities,
        ...(preflight.failureExcerpt !== undefined ? { failureExcerpt: preflight.failureExcerpt } : {}),
      },
    };
  }
  return {
    changedTestSelectors: preflight.changedTestSelectors,
    revertedProductionManifest: preflight.revertedProductionManifest,
    preflightEvidence: {
      classification: preflight.classification,
      ...(preflight.exception !== undefined ? { exception: preflight.exception } : {}),
      changedPaths: preflight.changedPaths,
      changedTestSelectors: preflight.changedTestSelectors,
      ...(preflight.eligibleSelectorRemovals !== undefined
        ? { eligibleSelectorRemovals: preflight.eligibleSelectorRemovals as unknown as BuildReviewProjectionJson }
        : {}),
      sourceIdentities: preflight.sourceIdentities,
      ...(preflight.scopedRun !== undefined
        ? { scopedRun: preflight.scopedRun as unknown as BuildReviewProjectionJson }
        : {}),
    },
  };
}

function infrastructure(rubric: BuildReviewRubricId, reason: BuildReviewCoordinatorFailureReason, detail?: string): BuildReviewCoordinatedBranch {
  return { kind: "infrastructure-failure", rubric, reason, ...(detail === undefined ? {} : { detail }) };
}

/**
 * Reconstruct the envelope from engine-held projection values before the
 * provider result reaches either validation or repair diagnosis. Providers
 * supply only findings, so provider-owned envelope fields must not influence
 * either path.
 */
export function stampBuildReviewDispatchedCandidate(
  candidate: unknown,
  rubric: BuildReviewRubricId,
  projection: BuildReviewRubricProjection,
): unknown {
  const source = typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : undefined;
  return {
    kind: "judged",
    rubric,
    contractVersion: CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION,
    lapId: projection.lapId,
    snapshotDigest: projection.snapshotDigest,
    findings: source?.findings,
    // The relocation audit is provider-owned EVIDENCE, not an envelope field:
    // the tautology contract requires it on fixture-relocation results, the
    // artifact persists it, and the aggregate consumes it. Pass it through and
    // let validation enforce rubric-appropriateness (non-tautology payloads
    // carrying one are rejected with a named problem, never laundered here).
    ...(source?.relocationAudit === undefined ? {} : { relocationAudit: source.relocationAudit }),
  };
}

/**
 * The single authority on whether an engine-stamped dispatched candidate is a
 * usable judged result for this projection. Exported so the dispatch layer's
 * in-session validate-and-repair loop accepts and rejects with exactly the
 * same predicate the coordinator settles branches with.
 */
export function validateBuildReviewDispatchedResult(
  candidate: unknown,
  rubric: BuildReviewRubricId,
  projection: BuildReviewRubricProjection,
): BuildReviewJudgedResult | undefined {
  const result = parseBuildReviewJudgedResult(candidate, buildReviewFindingReferenceContext(projection));
  // Treat the provider list as one boundary value.  Parsing individual
  // findings is insufficient: duplicate/colliding identities would otherwise
  // become two independently persisted branch facts.
  const canonical = result && canonicalizeBuildReviewFindingSet(result.findings.map((finding) => ({
    rubric: result.rubric, contractVersion: result.contractVersion, ...finding,
  })));
  return result && canonical && canonical.length === result.findings.length ? result : undefined;
}

/**
 * Diagnoses the same engine-stamped candidate that dispatch validation sees.
 * Keeping the projection-derived reference context here prevents callers from
 * accidentally diagnosing the raw provider envelope or a weaker parse.
 */
export function describeBuildReviewDispatchedResultRejection(
  candidate: unknown,
  rubric: BuildReviewRubricId,
  projection: BuildReviewRubricProjection,
): string {
  return describeBuildReviewJudgedResultRejection(
    candidate,
    rubric,
    projection,
    buildReviewFindingReferenceContext(projection),
  );
}

function validWrittenArtifact(
  candidate: unknown,
  rubric: BuildReviewRubricId,
  projection: BuildReviewRubricProjection,
): BuildReviewJudgedResult | undefined {
  const artifact = parseBuildReviewBranchArtifact(candidate);
  const result = artifact?.result;
  const projectionBoundResult = result && parseBuildReviewJudgedResult(
    result,
    buildReviewFindingReferenceContext(projection),
  );
  return artifact?.rubric === rubric && artifact.lapId === projection.lapId &&
    artifact.snapshotDigest === projection.snapshotDigest && projectionBoundResult?.kind === "judged" &&
    projectionBoundResult.rubric === rubric && projectionBoundResult.lapId === projection.lapId &&
    projectionBoundResult.snapshotDigest === projection.snapshotDigest ? projectionBoundResult : undefined;
}

/**
 * Coordinates the closed fan-out for exactly one frozen input snapshot. It
 * always waits for every cache miss under the configured cap; a single
 * provider/preflight fault becomes only that rubric's infrastructure result.
 */
export async function coordinateBuildReviewRubrics(
  input: BuildReviewCoordinationInput,
): Promise<BuildReviewCoordination> {
  const classification = classifyBuildReviewRubricBranches(input.config, []);
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
  const projections = input.projections ?? deriveBuildReviewRubricProjections({
    lapId: input.lapId,
    inputs: input.inputs,
    tautology: preflight ? preflightProjection(preflight) : {
      changedTestSelectors: [], revertedProductionManifest: [], preflightEvidence: { classification: "not-requested" },
    },
  });
  const resolved = new Map<BuildReviewRubricId, BuildReviewCoordinatedBranch>();
  const dispatchable: BuildReviewDispatchableRubric[] = [];

  for (const branch of classification.branches) {
    if ("kind" in branch) {
      resolved.set(branch.rubric, branch);
      await input.emit?.({ type: "build_review_rubric_skipped", rubric: branch.rubric, lapId: input.lapId, reason: branch.reason });
      continue;
    }
    const projection = projections[branch.rubric];
    if (projection.rubric !== branch.rubric) {
      resolved.set(branch.rubric, infrastructure(branch.rubric, "projection-rubric-mismatch"));
      await input.emit?.({ type: "build_review_rubric_infrastructure_failure", rubric: branch.rubric, lapId: input.lapId, reason: "projection-rubric-mismatch" });
      continue;
    }
    if (branch.rubric === "tautology" && preflight?.classification === "infrastructure-failure") {
      resolved.set(branch.rubric, infrastructure(branch.rubric, preflight.reason));
      await input.emit?.({
        type: "build_review_rubric_infrastructure_failure",
        rubric: branch.rubric,
        lapId: input.lapId,
        reason: preflight.reason,
        ...(preflight.failureExcerpt !== undefined ? { excerpt: preflight.failureExcerpt } : {}),
      });
      continue;
    }
    dispatchable.push(branch);
  }

  const dispatched = await runAuxiliaryGroupBranches(dispatchable.map((branch) => ({
    memberId: branch.rubric,
    policy: { branch },
  })), input.config.maxParallel,
    async (rubric, { branch }) => {
      const projection = projections[rubric];
      try {
        const settleCandidate = async (identity: BuildReviewEngineIdentity): Promise<BuildReviewCandidateCacheDecision> => {
          const policyFingerprint = fingerprintBuildReviewRubricPolicy(branch.policy);
          let candidate: BuildReviewCacheEntryCandidate | undefined;
          try {
            candidate = await input.readCache(branch, projection, policyFingerprint);
          } catch {
            return { kind: "infrastructure-failure" };
          }
          const cache = classifyBuildReviewCacheLookup(candidate, {
            rubric: branch.rubric, contractVersion: projection.contractVersion,
            projectionVersion: projection.projectionVersion, projectionDigest: projection.digest,
            policyFingerprint, engineIdentity: identity, lapId: input.lapId,
            snapshotDigest: projection.snapshotDigest,
          });
          if (cache.kind !== "hit") {
            if (cache.reason === "engine-version-mismatch" || cache.reason === "skill-digest-mismatch") {
              await input.emit?.({ type: "build_review_cache_discarded", rubric: branch.rubric,
                lapId: input.lapId, reason: cache.reason,
                ...(candidate?.engineIdentity === undefined ? {} : { cachedEngineStamp: candidate.engineIdentity.engineStamp }),
                currentEngineStamp: identity.engineStamp });
            }
            await input.emit?.({ type: "build_review_rubric_started", rubric: branch.rubric, lapId: input.lapId });
            return { kind: "miss" };
          }
          const result = validWrittenArtifact(await input.writeArtifact({ rubric: branch.rubric,
            lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
            result: cache.hit.result, provenance: cache.hit.provenance }), branch.rubric, projection);
          if (!result) return { kind: "infrastructure-failure" };
          await input.emit?.({ type: "build_review_cache_hit", rubric: branch.rubric, lapId: input.lapId });
          await input.emit?.({ type: "build_review_rubric_result", rubric: branch.rubric, lapId: input.lapId, verdict: result.verdict });
          return { kind: "cache-hit", result };
        };
        const legacyIdentity = input.engineIdentity?.[rubric];
        if (legacyIdentity?.kind === "unavailable") {
          return { rubric, branch: infrastructure(rubric, "cache-read-failed", legacyIdentity.path) };
        }
        // Coordinator-only callers have no candidate execution boundary. Keep
        // that explicit compatibility seam isolated from production, where the
        // identity is intentionally absent until preparation.
        const legacyDecision = legacyIdentity?.kind === "ready"
          ? await settleCandidate(legacyIdentity.identity)
          : undefined;
        if (legacyDecision?.kind === "cache-hit") {
          return { rubric, branch: { kind: "cache-hit", rubric, result: legacyDecision.result } as BuildReviewCoordinatedBranch };
        }
        if (legacyDecision?.kind === "infrastructure-failure") {
          return { rubric, branch: infrastructure(rubric, "cache-read-failed", legacyDecision.detail) };
        }
        const dispatched = await input.dispatchModel(branch, projection, settleCandidate);
        const candidateDispatch = dispatched as { kind?: string; result?: BuildReviewJudgedResult; detail?: string } | undefined;
        if (candidateDispatch?.kind === "cache-hit" && candidateDispatch.result !== undefined) {
          return { rubric, branch: { kind: "cache-hit", rubric, result: candidateDispatch.result } as BuildReviewCoordinatedBranch };
        }
        if (candidateDispatch?.kind === "infrastructure-failure") {
          return { rubric, branch: infrastructure(rubric, "cache-read-failed", candidateDispatch.detail) };
        }
        const dispatchedWithIdentity = typeof dispatched === "object" && dispatched !== null &&
          "engineIdentity" in dispatched && "result" in dispatched;
        const dispatchedIdentity = dispatchedWithIdentity
          ? dispatched.engineIdentity as BuildReviewEngineIdentity
          : legacyIdentity?.kind === "ready" ? legacyIdentity.identity : undefined;
        const candidate = stampBuildReviewDispatchedCandidate(
          dispatchedWithIdentity ? dispatched.result : dispatched,
          rubric,
          projection,
        );
        const result = validateBuildReviewDispatchedResult(candidate, rubric, projection);
        if (!result) {
          const failure = parseBuildReviewDispatchFailure(dispatched);
          // No pre-formed dispatch failure: the engine derives the failed
          // requirement itself from the stamped candidate, so the diagnosis
          // is produced by the same validation surface that rejected it.
          const detail = failure?.detail ?? (dispatched === undefined ? undefined : (
            typeof dispatched !== "object" || dispatched === null || Array.isArray(dispatched)
              ? "no parseable JSON object was found in the response"
              : describeBuildReviewDispatchedResultRejection(candidate, rubric, projection)
          ));
          return { rubric, branch: infrastructure(rubric, "invalid-provider-result", detail) };
        }
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
            engineIdentity: dispatchedIdentity!,
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

  for (const outcome of dispatched) {
    if (outcome.branch.kind === "dispatched") {
      await input.emit?.({ type: "build_review_rubric_result", rubric: outcome.rubric, lapId: input.lapId, verdict: outcome.branch.result.verdict });
    } else if (outcome.branch.kind === "infrastructure-failure") {
      await input.emit?.({ type: "build_review_rubric_infrastructure_failure", rubric: outcome.rubric, lapId: input.lapId, reason: outcome.branch.reason });
    }
  }

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
  _entryPoints: readonly string[],
  _hooks: BuildReviewCoordinatorHooks = {},
): BuildReviewClassification {
  if (!config.enabled) return { kind: "gate-disabled" };

  const enabled = BUILD_REVIEW_RUBRICS.filter((rubric) => config.rubrics[rubric].enabled);
  if (enabled.length === 0) return { kind: "refused", reason: "no-enabled-rubrics" };

  const branches = BUILD_REVIEW_RUBRICS.map((rubric): BuildReviewClassifiedBranch => {
    const policy = config.rubrics[rubric];
    if (!policy.enabled) return { kind: "skipped", rubric, reason: "disabled" };

    const descriptor = getBuildReviewRubricDescriptor(rubric);
    return { rubric, skillName: descriptor.skillName, policy };
  });

  if (!branches.some((branch): branch is BuildReviewDispatchableRubric => !("kind" in branch))) {
    return { kind: "refused", reason: "no-valid-judgement" };
  }
  return { kind: "ready", branches };
}
