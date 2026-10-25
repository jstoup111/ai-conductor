import { createHash } from "node:crypto";

import type { BuildReviewRubricId } from "../types/config.js";
import type {
  BuildReviewArtifactReviewScope,
  BuildReviewReviewScope,
  ReviewedHunk,
} from "./build-review-artifacts.js";
import type { BuildReviewLapId } from "./build-review-domain.js";
import type {
  BuildReviewCustomFinding,
  BuildReviewFinding,
} from "./build-review-domain.js";
import type {
  BuildReviewCandidateScopeResolutionIndeterminate,
} from "./build-review-domain.js";
import type { ChangedFileReference } from "./build-review-projections.js";
import type { BuildReviewUnresolvedMarker } from "./build-review-inputs.js";
import {
  currentBuildReviewSourceLinks,
  type RemediationCaseRecord,
} from "./remediation-case-store.js";

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
  /** Hunks made safe by the current, policy-compatible evidence view. */
  readonly settledHunks?: readonly ReviewedHunk[];
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
  // A retry at the same lap is a replay, not new evidence.  Keeping the
  // original record also makes cache recovery and disposition-only rejoin
  // idempotent.
  const currentRecord = readablePriorLaps.find((lap) =>
    lap.lapId === input.lapId && lap.reviewScope.mergeBase === input.mergeBase && lap.reviewScope.policyIdentity === input.policyIdentity,
  );
  if (currentRecord !== undefined) return currentRecord.reviewScope;
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

  if (reason === undefined) {
    const settled = new Set((input.settledHunks ?? []).map(hunkKey));
    const deltaHunks = reviewedHunks.filter((hunk) => !settled.has(hunkKey(hunk)));
    return {
      mode: "delta",
      reason: "delta",
      sequence,
      unreadableLapIds: [],
      mergeBase: input.mergeBase,
      headSha: input.headSha,
      policyIdentity: input.policyIdentity,
      predecessorLapId: latestReadable!.lapId,
      reviewedHunks,
      deltaHunks,
      outOfDeltaSourceIds: [],
    };
  }

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

function hunkKey(hunk: ReviewedHunk): string {
  return `${hunk.path}\u0000${hunk.contentHash}`;
}

/** A finding either resolves to concrete changed hunks or conservatively to a path. */
export type BuildReviewFindingHunkTarget =
  | { readonly kind: "hunks"; readonly hunks: readonly ReviewedHunk[] }
  | { readonly kind: "file"; readonly path: string };

function lineIntersectsHunk(
  region: { readonly startLine: number; readonly endLine: number },
  hunk: ChangedFileReference["hunks"][number],
): boolean {
  // A zero-count new side is a deletion.  It has no source line to review, so
  // it deliberately falls through to the conservative file target.
  if (hunk.newCount === 0) return false;
  const start = hunk.newStart;
  const end = start + hunk.newCount - 1;
  return region.startLine <= end && region.endLine >= start;
}

function hasLineRange(
  region: BuildReviewFinding["anchor"]["locus"] | BuildReviewCustomFinding["sourceRegions"][number],
): region is (BuildReviewFinding["anchor"]["locus"] & { readonly startLine: number; readonly endLine: number }) | BuildReviewCustomFinding["sourceRegions"][number] {
  return region.startLine !== undefined && region.endLine !== undefined;
}

/**
 * Maps every source region independently.  The file fallback is intentional:
 * an imprecise anchor must remain in the delta, never silently become settled.
 */
export function mapBuildReviewFindingToHunks(
  finding: BuildReviewFinding | BuildReviewCustomFinding,
  changedFiles: readonly ChangedFileReference[],
): readonly BuildReviewFindingHunkTarget[] {
  const byPath = new Map(changedFiles.map((file) => [file.path, file]));
  const regions = "sourceRegions" in finding
    ? finding.sourceRegions
    : [finding.anchor.locus];
  const targets: BuildReviewFindingHunkTarget[] = [];
  const seen = new Set<string>();
  for (const region of regions) {
    const file = byPath.get(region.path);
    const candidates = file === undefined ? [] : (
      hasLineRange(region)
        ? file.hunks.filter((hunk) => lineIntersectsHunk(region, hunk))
        : file.hunks.filter((hunk) => hunk.contentHash === region.contentHash)
    );
    if (candidates.length === 0) {
      const key = `file\u0000${region.path}`;
      if (!seen.has(key)) {
        seen.add(key);
        targets.push({ kind: "file", path: region.path });
      }
      continue;
    }
    const hunks = [...new Set(candidates.map((hunk) => hunk.contentHash))]
      .map((contentHash) => ({ path: region.path, contentHash }));
    const key = `hunks\u0000${hunks.map(hunkKey).sort().join("\u0001")}`;
    if (!seen.has(key)) {
      seen.add(key);
      targets.push({ kind: "hunks", hunks });
    }
  }
  return targets;
}

export interface BuildReviewSettledHunkFinding {
  readonly sourceId: string;
  readonly finding: BuildReviewFinding | BuildReviewCustomFinding;
}

/** Current act cases that remain a frontier risk, split by applied effect. */
export interface BuildReviewLiveActSourceIds {
  readonly liveSourceIds: ReadonlySet<string>;
  /** Only these sources may force the unmapped-source full-lap fallback. */
  readonly unappliedLiveSourceIds: ReadonlySet<string>;
}

/**
 * Open action work remains live even after an effect has been applied; a
 * failed or reserved action is likewise still a live obligation.  Resolve
 * source ownership first so superseded case links cannot revive old risk.
 */
export function buildReviewLiveActSourceIds(
  cases: readonly RemediationCaseRecord[],
): BuildReviewLiveActSourceIds {
  const liveSourceIds = new Set<string>();
  const unappliedLiveSourceIds = new Set<string>();
  for (const [sourceId, { record }] of currentBuildReviewSourceLinks(cases)) {
    if (record.disposition !== "act") continue;
    const applied = record.effect.kind === "action" && record.effect.status === "applied";
    const live = record.resolution === "open" ||
      (record.effect.kind === "action" && (record.effect.status === "failed" || record.effect.status === "reserved"));
    if (!live) continue;
    liveSourceIds.add(sourceId);
    if (!applied) unappliedLiveSourceIds.add(sourceId);
  }
  return { liveSourceIds, unappliedLiveSourceIds };
}

/**
 * Unknown test-scope facts are modeled as synthetic sources so the frontier
 * uses the same hunk/file mapping as ordinary findings.  They never enter
 * adjudication; their identifiers exist solely to keep uncertainty in scope.
 */
export function buildReviewTestScopeUnknownSources(input: {
  readonly unresolvedMarkers: readonly BuildReviewUnresolvedMarker[];
  readonly indeterminateCandidates: readonly BuildReviewCandidateScopeResolutionIndeterminate[];
}): readonly BuildReviewSettledHunkFinding[] {
  const markerSources = input.unresolvedMarkers.map((marker) => {
    const sourceId = `testQuality:unknown-marker:${createHash("sha256").update(`${marker.selector}\u0000${marker.reference}`).digest("hex")}`;
    return {
      sourceId,
      finding: {
        concernKind: "test-scope-unresolved",
        summary: `Unresolved test marker: ${marker.reference}`,
        evidenceLocations: [],
        anchor: { rubric: "testQuality" as const, locus: { path: marker.selector, contentHash: sourceId, display: marker.reference } },
      },
    } satisfies BuildReviewSettledHunkFinding;
  });
  const candidateSources = input.indeterminateCandidates.map((candidate) => {
    const sourceId = `testQuality:unknown-candidate:${createHash("sha256").update(candidate.candidateId).digest("hex")}`;
    return {
      sourceId,
      finding: {
        concernKind: "test-scope-indeterminate",
        summary: `Indeterminate test candidate: ${candidate.candidateId}`,
        evidenceLocations: [],
        anchor: { rubric: "testQuality" as const, locus: candidate.sourceRegion },
      },
    } satisfies BuildReviewSettledHunkFinding;
  });
  return [...markerSources, ...candidateSources];
}

/**
 * Only an unapplied source can require a full review when its path vanished
 * from the current diff.  An applied open source intentionally does not: its
 * repair's changed hunks are already part of the ordinary unsettled delta.
 */
export function hasUnappliedLiveSourceWithoutCurrentHunk(input: {
  readonly sources: readonly BuildReviewSettledHunkFinding[];
  readonly unappliedLiveSourceIds: ReadonlySet<string>;
  readonly changedFiles: readonly ChangedFileReference[];
}): boolean {
  return input.sources.some((source) => input.unappliedLiveSourceIds.has(source.sourceId) &&
    mapBuildReviewFindingToHunks(source.finding, input.changedFiles).some((target) =>
      target.kind === "file" && !(input.changedFiles.find((file) => file.path === target.path)?.hunks.length),
    ));
}

/** Evidence from one policy-compatible, successfully judged rubric lap. */
export interface BuildReviewSettledHunkLap {
  readonly reviewScope: BuildReviewReviewScope;
  readonly findings: readonly BuildReviewSettledHunkFinding[];
}

export interface SettledBuildReviewHunksInput {
  readonly changedFiles: readonly ChangedFileReference[];
  readonly mergeBase: string;
  readonly policyIdentity: string;
  readonly laps: readonly BuildReviewSettledHunkLap[];
  /** Exact sources made non-blocking by dispositions, cases or thresholds. */
  readonly nonBlockingSourceIds?: ReadonlySet<string>;
  /**
   * A resolved `act` case whose action effect was applied settles every source
   * it owns for frontier purposes.  This is intentionally distinct from
   * `finalizedBuildReviewSourceIds`, which retains its merged-link-only
   * completion semantics.
   */
  readonly resolvedAppliedActSourceIds?: ReadonlySet<string>;
  /** Sources with live/remediation risk always keep their target in delta. */
  readonly liveSourceIds?: ReadonlySet<string>;
  /** Test-quality unresolved candidates are unknown risk, not absence. */
  readonly unknownSourceIds?: ReadonlySet<string>;
  /** Location-bearing unknown test scope facts, keyed by `unknownSourceIds`. */
  readonly unknownSources?: readonly BuildReviewSettledHunkFinding[];
}

/**
 * Settles only hunks backed by current-policy evidence.  A live or unknown
 * source wins over a later clean lap, preventing a repair retry from hiding a
 * defect that still needs action.
 */
export function settledBuildReviewHunks(input: SettledBuildReviewHunksInput): readonly ReviewedHunk[] {
  const current = currentHunks(input.changedFiles);
  const eligible = input.laps.filter((lap) =>
    lap.reviewScope.mergeBase === input.mergeBase && lap.reviewScope.policyIdentity === input.policyIdentity,
  );
  const nonBlocking = input.nonBlockingSourceIds ?? new Set<string>();
  const resolvedAppliedAct = input.resolvedAppliedActSourceIds ?? new Set<string>();
  const live = input.liveSourceIds ?? new Set<string>();
  const unknown = input.unknownSourceIds ?? new Set<string>();
  const unknownSources = input.unknownSources ?? [];
  return current.filter((hunk) => {
    const key = hunkKey(hunk);
    const reviewed = eligible.some((lap) => lap.reviewScope.reviewedHunks.some((candidate) => hunkKey(candidate) === key));
    if (!reviewed) return false;
    if (unknownSources.some((source) => unknown.has(source.sourceId) &&
      mapBuildReviewFindingToHunks(source.finding, input.changedFiles).some((target) =>
        target.kind === "hunks"
          ? target.hunks.some((candidate) => hunkKey(candidate) === key)
          : target.path === hunk.path,
      ))) return false;
    for (const lap of eligible) {
      for (const source of lap.findings) {
        const mapsHere = mapBuildReviewFindingToHunks(source.finding, input.changedFiles).some((target) =>
          target.kind === "hunks"
            ? target.hunks.some((candidate) => hunkKey(candidate) === key)
            : target.path === hunk.path,
        );
        if (!mapsHere) continue;
        if (live.has(source.sourceId) || unknown.has(source.sourceId)) return false;
        if (!nonBlocking.has(source.sourceId) && !resolvedAppliedAct.has(source.sourceId) && !lap.reviewScope.outOfDeltaSourceIds.includes(source.sourceId)) return false;
      }
    }
    return true;
  });
}
