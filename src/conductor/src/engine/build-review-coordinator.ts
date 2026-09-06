import type { BuildReviewRubricId } from "../types/config.js";
import {
  CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION,
  describeBuildReviewJudgedResultRejection,
  parseBuildReviewCandidateScopeResolutions,
  parseBuildReviewDispatchFailure,
  buildReviewFindingReferenceContext,
  deriveBuildReviewScopeIncompleteFault,
  parseBuildReviewJudgedResult,
  type BuildReviewJudgedResult,
  type BuildReviewLapId,
  type BuildReviewCoordinatorFailureReason,
  type BuildReviewSkip,
  type BuildReviewCandidateScopeCandidate,
  type BuildReviewCandidateScopeResolutionContext,
} from "./build-review-domain.js";
import {
  BUILD_REVIEW_RUBRIC_IDS,
  fingerprintBuildReviewRubricPolicy,
  getBuildReviewRubricDescriptor,
} from "./build-review-registry.js";
import {
  classifyBuildReviewCacheLookup,
  type BuildReviewCacheEntry,
  type BuildReviewCacheEntryCandidate,
  type BuildReviewEngineIdentity,
} from "./build-review-cache.js";
import {
  parseBuildReviewBranchArtifact,
  type BuildReviewBranchArtifact,
} from "./build-review-artifacts.js";
import type { BuildReviewFrozenInputs } from "./build-review-inputs.js";
import {
  deriveBuildReviewRubricProjections,
  type BuildReviewRubricProjections,
  type BuildReviewRubricProjection,
  type BuildReviewTestQualityProjectionInput,
} from "./build-review-projections.js";
import {
  projectTestQualityPreflight,
  type TautologyPreflightResult,
} from "./build-review-test-quality-preflight.js";
import { runAuxiliaryGroupBranches } from "./group-core.js";
import type {
  ResolvedBuildReviewConfig,
  ResolvedBuildReviewRubricPolicy,
} from "./resolved-config.js";
import type { ConductorEvent } from "../types/events.js";
import { canonicalizeBuildReviewFindingSet } from "./build-review-finding-identity.js";

const BUILD_REVIEW_RUBRICS = BUILD_REVIEW_RUBRIC_IDS;
const TEST_QUALITY_RUBRIC: BuildReviewRubricId = "testQuality";

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
  | { kind: "passed"; verdict: "PASS"; reason: "build_review_no_rubrics" }
  | { kind: "refused"; reason: "no-enabled-rubrics" | "no-valid-judgement" }
  | { kind: "ready"; branches: readonly BuildReviewClassifiedBranch[] };

type BuildReviewPassReason = "build_review_no_rubrics" | "test_quality_empty_scope";

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

/**
 * One rubric's resolved skill digest (adr-2026-08-21 D3): `sha256:` over the
 * raw bytes of the installed SKILL.md, or the unreadable path. An unavailable
 * digest is an infrastructure failure for that rubric — never a hit, never a
 * write (amended: reason `cache-read-failed`, detail naming the path).
 */
export type BuildReviewRubricSkillDigest =
  | { readonly kind: "resolved"; readonly digest: string }
  | { readonly kind: "unavailable"; readonly path: string };

/**
 * The judging engine identity, resolved once per build_review dispatch and
 * injected (adr-2026-08-21 D6) so the cache module stays pure.
 */
export interface BuildReviewCoordinationEngineIdentity {
  readonly engineStamp: string;
  readonly skillDigests: Readonly<Partial<Record<BuildReviewRubricId, BuildReviewRubricSkillDigest>>>;
}

export type BuildReviewCoordination =
  | { readonly kind: "gate-disabled" }
  | { readonly kind: "passed"; readonly verdict: "PASS"; readonly reason: BuildReviewPassReason }
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
  /** Test seam for an engine-held projection corruption at branch settlement. */
  readonly projections?: BuildReviewRubricProjections;
  readonly preflight: () => Promise<TautologyPreflightResult>;
  /** Resolved once per dispatch by the caller; never read from the environment here (D6). */
  readonly engineIdentity: BuildReviewCoordinationEngineIdentity;
  readonly readCache: (
    branch: BuildReviewDispatchableRubric,
    projection: BuildReviewRubricProjection,
    policyFingerprint: string,
  ) => Promise<BuildReviewCacheEntryCandidate | undefined>;
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
  /** Engine-owned occurrence sink; callers connect this to the shared event emitter. */
  readonly emit?: (event: Extract<ConductorEvent, { type:
    | "build_review_rubric_started"
    | "build_review_rubric_result"
    | "build_review_rubric_skipped"
    | "build_review_cache_hit"
    | "build_review_cache_discarded"
    | "build_review_rubric_infrastructure_failure"
    | "build_review_scope_incomplete"
    | "build_review_outer_verdict" }>) => Promise<void>;
}

async function emitScopeIncomplete(
  emit: BuildReviewCoordinationInput['emit'],
  result: BuildReviewJudgedResult,
  lapId: BuildReviewLapId,
): Promise<void> {
  const fault = deriveBuildReviewScopeIncompleteFault(result);
  if (!fault) return;
  await emit?.({ type: 'build_review_scope_incomplete', rubric: fault.rubric, lapId, candidates: fault.candidates });
}

/**
 * Project the preflight into its closed, bounded prompt form. Every field is
 * explicitly named and bounded by construction: the reverted production files
 * travel as a content-free path+blob-sha manifest (the grader recovers bytes
 * with `git show <mergeBase>:<path>`), and the scoped run travels as its
 * exit-code verdict plus a capped failure excerpt — never raw stdout/stderr
 * or merge-base file content, and never the same evidence twice.
 */
export function preflightProjection(preflight: TautologyPreflightResult): BuildReviewTestQualityProjectionInput {
  const projectedPreflight = preflight.classification === "nonzero-exit" && preflight.scopedRun
    ? {
        ...projectTestQualityPreflight(preflight),
        exitCode: preflight.scopedRun.exitCode,
        runKind: preflight.scopedRun.runKind,
        ranSelectors: preflight.scopedRun.ranSelectors,
      }
    : projectTestQualityPreflight(preflight);
  if (preflight.classification === "infrastructure-failure") {
    return {
      changedTestSelectors: preflight.changedTestSelectors,
      unresolvedMarkers: [],
      revertedProductionManifest: [],
      preflight: projectedPreflight,
    };
  }
  return {
    runnerSelectors: preflight.counterfactualFileSelectors,
    changedTestSelectors: preflight.changedTestSelectors,
    unresolvedMarkers: [],
    revertedProductionManifest: preflight.revertedProductionManifest,
    preflight: projectedPreflight,
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
    ...(source?.scopeResolutions === undefined ? {} : { scopeResolutions: source.scopeResolutions }),
    // The relocation audit is provider-owned EVIDENCE, not an envelope field:
    // the test-quality contract validates it as typed evidence, the
    // artifact persists it, and the aggregate consumes it. Pass it through and
    // let validation enforce rubric-appropriateness (unexpected payloads
    // carrying one are rejected with a named problem, never laundered here).
    ...(source?.relocationAudit === undefined ? {} : { relocationAudit: source.relocationAudit }),
    ...(source?.counterfactualSensitivity === undefined
      ? {}
      : { counterfactualSensitivity: source.counterfactualSensitivity }),
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/**
 * Extract the exact candidate authority already frozen into v3 `testScope`.
 * The projection remains the only source: no live files, source readers, or
 * second provider call participate in candidate settlement.
 */
export function buildReviewCandidateScopeResolutionContext(projection: BuildReviewRubricProjection): BuildReviewCandidateScopeResolutionContext {
  const scope = record(projection.testScope);
  const rawCandidates = Array.isArray(scope?.candidates) ? scope.candidates : [];
  const evidence = Array.isArray(scope?.evidence) ? scope.evidence : [];
  const candidates: BuildReviewCandidateScopeCandidate[] = [];
  for (const rawCandidate of rawCandidates) {
    const candidate = record(rawCandidate);
    const directRegion = record(candidate?.sourceRegion);
    const declaration = record(candidate?.declaration) ?? record(candidate?.diagnostic);
    const span = record(declaration?.span);
    const matchedEvidence = evidence.map(record).find((entry) => {
      const source = record(entry?.source); const region = record(entry?.region);
      return source?.side === 'head' && region?.start === span?.start && region?.end === span?.end;
    });
    const evidenceSource = record(matchedEvidence?.source);
    const evidenceRegion = record(matchedEvidence?.region);
    const sourceRegion = directRegion
      ? { path: directRegion.path, startLine: directRegion.startLine, endLine: directRegion.endLine, contentHash: directRegion.contentHash, display: directRegion.display }
      : matchedEvidence && evidenceSource && evidenceRegion
        ? {
            path: evidenceSource.fileName,
            startLine: matchedEvidence.startLine,
            endLine: matchedEvidence.endLine,
            contentHash: matchedEvidence.contentHash,
            display: Array.isArray(declaration?.titleChain) && declaration!.titleChain.every((part) => typeof part === 'string')
              ? declaration!.titleChain.join(' > ')
              : typeof declaration?.message === 'string' ? declaration.message : `${evidenceSource.fileName} fallback candidate`,
          }
        : undefined;
    const markerObligations = Array.isArray(candidate?.markers)
      ? candidate!.markers.map(record).flatMap((marker) => {
          const reference = record(marker?.reference);
          return typeof reference?.kind === 'string' && typeof reference.id === 'string' ? [`${reference.kind}:${reference.id}`] : [];
        })
      : [];
    const rawObligations = Array.isArray(candidate?.obligationReferences)
      ? candidate!.obligationReferences
      : [...new Set(markerObligations)];
    const candidateId = typeof candidate?.candidateId === 'string'
      ? candidate.candidateId
      : typeof matchedEvidence?.id === 'string' ? matchedEvidence.id : undefined;
    if (!candidate || !candidateId || !sourceRegion || !Array.isArray(rawObligations)) continue;
    const contextCandidate = {
      candidateId,
      sourceRegion,
      obligationReferences: rawObligations,
    } as unknown as BuildReviewCandidateScopeCandidate;
    const parsed = parseBuildReviewCandidateScopeResolutions([{
      candidateId, status: 'resolved', sourceRegion,
      obligationReferences: rawObligations, associationReason: 'engine candidate shape validation',
    }], { candidates: [contextCandidate] });
    if (!parsed) continue;
    candidates.push(contextCandidate);
  }
  return { candidates: Object.freeze(candidates) };
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
  const scopeContext = buildReviewCandidateScopeResolutionContext(projection);
  const source = record(candidate);
  const scopeResolutions = source?.scopeResolutions === undefined
    ? (scopeContext.candidates.length === 0 ? [] : undefined)
    : parseBuildReviewCandidateScopeResolutions(source.scopeResolutions, scopeContext);
  if (!scopeResolutions) return undefined;
  const result = parseBuildReviewJudgedResult(candidate, buildReviewFindingReferenceContext(projection, scopeResolutions), scopeContext);
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
  const projectionBoundResult = result && validateBuildReviewDispatchedResult(result, rubric, projection);
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
  const testQualityPolicy = input.config.rubrics.testQuality;
  const inScopeTests = input.inputs.sourceSnapshot.testQuality?.inScopeTests ?? [];
  const unresolvedMarkers = input.inputs.sourceSnapshot.testQuality?.unresolvedMarkers ?? [];
  // The source-bound scope is authoritative. Legacy selector fields remain
  // projection compatibility data and must not turn a refactor or note into
  // a review target. A snapshot from before typed scope existed retains its
  // legacy selector behavior solely for compatibility.
  const typedScope = input.inputs.sourceSnapshot.testScope;
  const hasEstablishedTargets = typedScope === undefined
    ? inScopeTests.length > 0
    : (typedScope.targets?.length ?? 0) > 0;
  const hasConcreteCandidates = (typedScope?.candidates?.length ?? 0) > 0;
  if (input.config.enabled && testQualityPolicy?.enabled && !hasEstablishedTargets && !hasConcreteCandidates) {
    await input.emit?.({
      type: "build_review_outer_verdict",
      lapId: input.lapId,
      rawVerdict: "PASS",
      effectiveVerdict: "PASS",
      reason: "test_quality_empty_scope",
      ...(unresolvedMarkers.length > 0 ? { unresolvedMarkers } : {}),
    });
    return { kind: "passed", verdict: "PASS", reason: "test_quality_empty_scope" };
  }

  const classification = classifyBuildReviewRubricBranches(input.config, []);
  if (classification.kind === "passed") {
    await input.emit?.({
      type: "build_review_outer_verdict",
      lapId: input.lapId,
      rawVerdict: "PASS",
      effectiveVerdict: "PASS",
      reason: classification.reason,
      ...(unresolvedMarkers.length > 0 ? { unresolvedMarkers } : {}),
    });
    return classification;
  }
  if (classification.kind !== "ready") return classification;

  const testQualityEnabled = classification.branches.some(
    (branch) => !("kind" in branch) && branch.rubric === TEST_QUALITY_RUBRIC,
  );
  let preflight: TautologyPreflightResult | undefined;
  if (testQualityEnabled) {
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
  const inScopeTestSet = new Set(inScopeTests);
  const projectionInputs: BuildReviewFrozenInputs = {
    ...input.inputs,
    sourceSnapshot: {
      ...input.inputs.sourceSnapshot,
      changedTestTitles: input.inputs.sourceSnapshot.changedTestTitles?.filter(
        (title) => inScopeTestSet.has(title.selector),
      ),
    },
  };
  const derivedProjections = deriveBuildReviewRubricProjections({
    lapId: input.lapId,
    inputs: projectionInputs,
    testQuality: preflight ? {
      ...preflightProjection(preflight),
      runnerSelectors: preflight.classification === "infrastructure-failure"
        ? preflight.changedTestSelectors
        : preflight.counterfactualFileSelectors ?? preflight.scopedRun?.ranSelectors ?? preflight.changedTestSelectors,
      changedTestSelectors: inScopeTests,
      unresolvedMarkers,
    } : {
      runnerSelectors: [], changedTestSelectors: [], unresolvedMarkers, revertedProductionManifest: [], preflight: { classification: "not-requested", excerpt: "" },
    },
  });
  const projections = input.projections ?? derivedProjections;
  const resolved = new Map<BuildReviewRubricId, BuildReviewCoordinatedBranch>();
  const misses: BuildReviewDispatchableRubric[] = [];

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
    if (branch.rubric === TEST_QUALITY_RUBRIC && preflight?.classification === "infrastructure-failure") {
      resolved.set(branch.rubric, infrastructure(branch.rubric, preflight.reason, preflight.failureExcerpt));
      await input.emit?.({
        type: "build_review_rubric_infrastructure_failure",
        rubric: branch.rubric,
        lapId: input.lapId,
        reason: preflight.reason,
        ...(preflight.failureExcerpt !== undefined ? { excerpt: preflight.failureExcerpt } : {}),
      });
      continue;
    }
    const skillDigest = input.engineIdentity.skillDigests[branch.rubric];
    if (skillDigest === undefined || skillDigest.kind === "unavailable") {
      // adr-2026-08-21 D3 (amended): an unreadable rubric SKILL.md is an
      // infrastructure failure — never a hit and never a write.
      const detail = `rubric skill digest unavailable: ${skillDigest?.path ?? `skills/${branch.skillName}/SKILL.md`}`;
      resolved.set(branch.rubric, infrastructure(branch.rubric, "cache-read-failed", detail));
      await input.emit?.({ type: "build_review_rubric_infrastructure_failure", rubric: branch.rubric, lapId: input.lapId, reason: "cache-read-failed", excerpt: detail });
      continue;
    }
    const engineIdentity: BuildReviewEngineIdentity = {
      engineStamp: input.engineIdentity.engineStamp,
      skillDigest: skillDigest.digest,
    };
    const policyFingerprint = fingerprintBuildReviewRubricPolicy(branch.policy);
    let candidate: BuildReviewCacheEntryCandidate | undefined;
    try {
      candidate = await input.readCache(branch, projection, policyFingerprint);
    } catch {
      resolved.set(branch.rubric, infrastructure(branch.rubric, "cache-read-failed"));
      await input.emit?.({ type: "build_review_rubric_infrastructure_failure", rubric: branch.rubric, lapId: input.lapId, reason: "cache-read-failed" });
      continue;
    }
    const cache = classifyBuildReviewCacheLookup(candidate, {
      rubric: branch.rubric,
      contractVersion: projection.contractVersion,
      projectionVersion: projection.projectionVersion,
      projectionDigest: projection.digest,
      policyFingerprint,
      engineIdentity,
      lapId: input.lapId,
      snapshotDigest: projection.snapshotDigest,
    });
    if (cache.kind === "miss" && (cache.reason === "engine-version-mismatch" || cache.reason === "skill-digest-mismatch")) {
      // adr-2026-08-21 D5: only the two engine-identity reasons emit a
      // discard on the spine; ordinary projection/policy misses stay silent.
      await input.emit?.({
        type: "build_review_cache_discarded",
        rubric: branch.rubric,
        lapId: input.lapId,
        reason: cache.reason,
        ...(cache.cachedEngineStamp === undefined ? {} : { cachedEngineStamp: cache.cachedEngineStamp }),
        currentEngineStamp: input.engineIdentity.engineStamp,
      });
    }
    // A semantic cache identity proves only that the frozen input projection
    // matches.  Re-run the same source-bound result predicate used for a
    // fresh provider response before reusing the cached judgement: persisted
    // candidate resolutions and finding anchors are evidence, never cache
    // authority.  An invalid cached result is an ordinary miss so a fresh
    // judgement can settle the current frozen scope.
    const cachedResult = cache.kind === "hit"
      ? validateBuildReviewDispatchedResult(cache.hit.result, branch.rubric, projection)
      : undefined;
    if (cache.kind === "hit" && cachedResult) {
      let result: BuildReviewJudgedResult | undefined;
      try {
        result = validWrittenArtifact(await input.writeArtifact({
          rubric: branch.rubric,
          lapId: projection.lapId,
          snapshotDigest: projection.snapshotDigest,
          result: cachedResult,
          provenance: cache.hit.provenance,
        }), branch.rubric, projection);
        resolved.set(branch.rubric, result
          ? { kind: "cache-hit", rubric: branch.rubric, result }
          : infrastructure(branch.rubric, "artifact-write-failed"));
        await input.emit?.(result
          ? { type: "build_review_cache_hit", rubric: branch.rubric, lapId: input.lapId }
          : { type: "build_review_rubric_infrastructure_failure", rubric: branch.rubric, lapId: input.lapId, reason: "artifact-write-failed" });
      } catch {
        resolved.set(branch.rubric, infrastructure(branch.rubric, "artifact-write-failed"));
        await input.emit?.({ type: "build_review_rubric_infrastructure_failure", rubric: branch.rubric, lapId: input.lapId, reason: "artifact-write-failed" });
      }
      if (result) {
        await input.emit?.({ type: "build_review_rubric_result", rubric: branch.rubric, lapId: input.lapId, verdict: result.verdict });
        await emitScopeIncomplete(input.emit, result, input.lapId);
      }
    } else {
      await input.emit?.({ type: "build_review_rubric_started", rubric: branch.rubric, lapId: input.lapId });
      misses.push(branch);
    }
  }

  const dispatched = await runAuxiliaryGroupBranches(misses.map((branch) => ({ memberId: branch.rubric, policy: branch })), input.config.maxParallel,
    async (rubric, branch) => {
      const projection = projections[rubric];
      try {
        const dispatched = await input.dispatchModel(branch, projection);
        const candidate = stampBuildReviewDispatchedCandidate(dispatched, rubric, projection);
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
        const skillDigest = input.engineIdentity.skillDigests[rubric];
        if (skillDigest === undefined || skillDigest.kind === "unavailable") {
          // Unreachable for dispatched branches (unavailable digests fail
          // before dispatch), kept fail-closed: never write without identity.
          return { rubric, branch: infrastructure(rubric, "cache-write-failed") };
        }
        try {
          await input.writeCache({
            version: 1,
            rubric,
            contractVersion: projection.contractVersion,
            projectionVersion: projection.projectionVersion,
            projectionDigest: projection.digest,
            policyFingerprint: fingerprintBuildReviewRubricPolicy(branch.policy),
            engineIdentity: { engineStamp: input.engineIdentity.engineStamp, skillDigest: skillDigest.digest },
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
      await emitScopeIncomplete(input.emit, outcome.branch.result, input.lapId);
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

  const policies = config.rubrics as unknown as Partial<Record<string, ResolvedBuildReviewRubricPolicy>>;
  const branches = BUILD_REVIEW_RUBRIC_IDS.flatMap((registeredRubric): BuildReviewClassifiedBranch[] => {
    const policy = policies[registeredRubric];
    if (!policy?.enabled) return [];
    const rubric = registeredRubric as unknown as BuildReviewRubricId;
    const descriptor = getBuildReviewRubricDescriptor(registeredRubric);
    return [{ rubric, skillName: descriptor.skillName, policy }];
  });

  if (!branches.some((branch): branch is BuildReviewDispatchableRubric => !("kind" in branch))) {
    return { kind: "passed", verdict: "PASS", reason: "build_review_no_rubrics" };
  }
  return { kind: "ready", branches };
}
