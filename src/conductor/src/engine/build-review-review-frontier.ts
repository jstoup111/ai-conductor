import { createHash } from "node:crypto";

import type { BuildReviewRubricId } from "../types/config.js";
import type {
  BuildReviewArtifactReviewScope,
  BuildReviewReviewScope,
  ReviewedHunk,
} from "./build-review-artifacts.js";
import type { BuildReviewLapId } from "./build-review-domain.js";
import type { ChangedFileReference } from "./build-review-projections.js";

/** Test-quality analysis facts that determine whether a prior lap is reusable. */
export interface BuildReviewTestScopePolicyIdentity {
  readonly analysisVersion: string;
  readonly bindingIdentity: string;
}

/**
 * The resolved policy facts that determine one rubric's review scope.
 *
 * `engineStamp` is deliberately accepted but excluded: an engine rebuild does
 * not change what the policy asks the rubric to review.
 */
export interface BuildReviewPolicyIdentityInputs {
  readonly contractVersion: string;
  readonly projectionVersion: string;
  readonly declarationFingerprint: string;
  readonly effectiveBundleDigest: string;
  readonly provider: string;
  readonly model: string;
  readonly effort: string;
  readonly engineStamp: string;
  readonly testScope?: BuildReviewTestScopePolicyIdentity;
}

/**
 * Canonical, path-free identity for the policy governing one rubric's lap.
 *
 * This is intentionally narrower than a semantic cache key: per-lap review
 * scope must survive a source-diff change and an engine-only rebuild.
 */
export function buildReviewPolicyIdentity(
  rubric: BuildReviewRubricId | string,
  inputs: BuildReviewPolicyIdentityInputs,
): string {
  const canonical = {
    version: 1,
    rubric,
    contractVersion: inputs.contractVersion,
    projectionVersion: inputs.projectionVersion,
    declarationFingerprint: inputs.declarationFingerprint,
    effectiveBundleDigest: inputs.effectiveBundleDigest,
    provider: inputs.provider,
    model: inputs.model,
    effort: inputs.effort,
    ...(rubric === "testQuality" ? {
      testScopeAnalysisVersion: inputs.testScope?.analysisVersion ?? null,
      testScopeBindingIdentity: inputs.testScope?.bindingIdentity ?? null,
    } : {}),
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

/** One readable or unreadable branch-artifact scope from an earlier lap. */
export interface BuildReviewReviewScopePriorLap {
  readonly lapId: BuildReviewLapId;
  readonly reviewScope?: BuildReviewArtifactReviewScope;
}

/** Facts needed to decide one rubric's scope before its projection is built. */
export interface DecideBuildReviewReviewScopeInput {
  readonly lapId: BuildReviewLapId;
  readonly changedFiles: readonly ChangedFileReference[];
  readonly mergeBase: string;
  readonly headSha: string;
  readonly policyIdentity: string;
  readonly priorLaps: readonly BuildReviewReviewScopePriorLap[];
  /** An unapplied open case has no current hunk on its source path. */
  readonly openSourceUnmapped: boolean;
}

function isReadableReviewScope(
  reviewScope: BuildReviewArtifactReviewScope | undefined,
): reviewScope is BuildReviewReviewScope {
  return reviewScope !== undefined && !("kind" in reviewScope);
}

function currentHunks(changedFiles: readonly ChangedFileReference[]): readonly ReviewedHunk[] {
  const seen = new Set<string>();
  const hunks: ReviewedHunk[] = [];
  for (const file of changedFiles) {
    for (const hunk of file.hunks) {
      const key = `${file.path}\u0000${hunk.contentHash}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hunks.push({ path: file.path, contentHash: hunk.contentHash });
    }
  }
  return hunks;
}

/**
 * Decides whether a rubric must judge the complete current diff before any
 * settled-hunk reduction.  Rebase provenance intentionally is not an input:
 * only the durable merge-base identity controls that full-lap boundary.
 */
export function decideBuildReviewReviewScope(
  input: DecideBuildReviewReviewScopeInput,
): BuildReviewReviewScope | undefined {
  const reviewedHunks = currentHunks(input.changedFiles);
  const readablePriorLaps = input.priorLaps.filter((lap) => isReadableReviewScope(lap.reviewScope)) as readonly (BuildReviewReviewScopePriorLap & { readonly reviewScope: BuildReviewReviewScope })[];
  const latestReadable = readablePriorLaps.reduce<(typeof readablePriorLaps)[number] | undefined>(
    (latest, lap) => latest === undefined || lap.reviewScope.sequence > latest.reviewScope.sequence ? lap : latest,
    undefined,
  );
  const sequence = latestReadable === undefined ? 1 : latestReadable.reviewScope.sequence + 1;
  const accountedUnreadableLapIds = new Set(
    readablePriorLaps.flatMap((lap) => lap.reviewScope.unreadableLapIds),
  );
  const unreadableLapIds = input.priorLaps
    .filter((lap) => lap.reviewScope !== undefined && "kind" in lap.reviewScope && !accountedUnreadableLapIds.has(lap.lapId))
    .map((lap) => lap.lapId);
  const reason = unreadableLapIds.length > 0
    ? "record-unreadable"
    : latestReadable === undefined
      ? "first-lap"
      : latestReadable.reviewScope.mergeBase !== input.mergeBase
        ? "merge-base-changed"
        : latestReadable.reviewScope.policyIdentity !== input.policyIdentity
          ? "version-changed"
          : input.openSourceUnmapped
            ? "open-source-unmapped"
            : undefined;

  if (reason === undefined) return undefined;

  return {
    mode: "full",
    reason,
    sequence,
    unreadableLapIds: reason === "record-unreadable" ? unreadableLapIds : [],
    mergeBase: input.mergeBase,
    headSha: input.headSha,
    policyIdentity: input.policyIdentity,
    ...(latestReadable === undefined ? {} : { predecessorLapId: latestReadable.lapId }),
    reviewedHunks,
    deltaHunks: reviewedHunks,
    outOfDeltaSourceIds: [],
  };
}
