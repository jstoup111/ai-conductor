import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  classifyBuildReviewRubricBranches,
  coordinateBuildReviewRubrics,
  stampBuildReviewDispatchedCandidate,
  type BuildReviewCoordinationInput,
  validateBuildReviewDispatchedResult,
} from "../../src/engine/build-review-coordinator.js";
import {
  mapBuildReviewCoordinatorFailureReason,
  parseBuildReviewInfrastructureFailure,
  parseBuildReviewLapId,
  type BuildReviewInfrastructureFailureReason,
} from "../../src/engine/build-review-domain.js";
import type { BuildReviewFrozenInputs } from "../../src/engine/build-review-inputs.js";
import type {
  ResolvedBuildReviewConfig,
  ResolvedBuildReviewRubricPolicy,
} from "../../src/engine/resolved-config.js";

const policy: ResolvedBuildReviewRubricPolicy = {
  enabled: true,
  llm_provider: "claude",
  model: "sonnet",
  effort: "medium",
  model_fallback_ladder: ["sonnet"],
  max_retries: 1,
  escalate: false,
};

function config(testQualityEnabled: boolean): ResolvedBuildReviewConfig {
  // The test-quality config key is introduced after the legacy resolved type.
  // The coordinator's registry, not that retired type, owns runnable membership.
  return {
    enabled: true,
    perTaskFloor: true,
    scopeContainmentEnforced: false,
    maxParallel: 1,
    rubrics: { testQuality: { ...policy, enabled: testQualityEnabled } },
  } as unknown as ResolvedBuildReviewConfig;
}

function inputs(): BuildReviewFrozenInputs {
  const sourceContent = {
    diff: "diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts",
    planBody: "# Plan\n",
    repairContext: [],
    removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] },
  };
  return {
    ...sourceContent,
    mergeBase: "base",
    baseRef: "origin/main",
    baseKind: "remote",
    trackingRefSha: "base",
    remoteHeadSha: "base",
    fresh: true,
    testSuiteProof: { provenanceHeadSha: "head", outcome: "PASS" } as never,
    sourceSnapshot: {
      digest: "sha256:snapshot",
      contentDigest: `sha256:${createHash("sha256").update(JSON.stringify(sourceContent)).digest("hex")}`,
      baseRef: "origin/main",
      mergeBase: "base",
      headSha: "head",
      ...sourceContent,
      testQuality: { inScopeTests: ["test/a.test.ts"], unresolvedMarkers: [] },
    },
  };
}

function coordinationInput(
  testQualityEnabled: boolean,
  overrides: Partial<BuildReviewCoordinationInput> = {},
): BuildReviewCoordinationInput {
  return {
    config: config(testQualityEnabled),
    inputs: inputs(),
    lapId: parseBuildReviewLapId("lap-current")!,
    engineIdentity: { engineStamp: "8e7daae72ad7", skillDigests: { testQuality: { kind: "resolved", digest: "sha256:skill-a" } } },
    preflight: vi.fn(),
    readCache: vi.fn(async () => undefined),
    dispatchModel: vi.fn(async () => undefined),
    writeArtifact: vi.fn(async (artifact) => ({ version: 1, ...artifact })),
    writeCache: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("build-review coordinator: registered dispatch", () => {
  it("keeps a disabled whole gate distinct from an empty enabled container", () => {
    expect(classifyBuildReviewRubricBranches({ ...config(false), enabled: false }, [])).toEqual({
      kind: "gate-disabled",
    });
  });

  it("passes an enabled container with no enabled registered rubric without dispatching", async () => {
    const emit = vi.fn(async () => undefined);
    const input = coordinationInput(false, { emit });

    const result = await coordinateBuildReviewRubrics(input);

    expect(result).toEqual({
      kind: "passed",
      verdict: "PASS",
      reason: "build_review_no_rubrics",
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      kind: "passed",
      verdict: "PASS",
      reason: "build_review_no_rubrics",
    });
    expect(input.preflight).not.toHaveBeenCalled();
    expect(input.readCache).not.toHaveBeenCalled();
    expect(input.dispatchModel).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith({
      type: "build_review_outer_verdict",
      lapId: "lap-current",
      rawVerdict: "PASS",
      effectiveVerdict: "PASS",
      reason: "build_review_no_rubrics",
    });
  });

  it("passes test-quality's empty frozen scope without preflight or grader dispatch", async () => {
    const frozenInputs = inputs();
    const input = coordinationInput(true, {
      inputs: {
        ...frozenInputs,
        sourceSnapshot: {
          ...frozenInputs.sourceSnapshot,
          testQuality: { inScopeTests: [], unresolvedMarkers: [] },
        },
      },
    });

    const result = await coordinateBuildReviewRubrics(input);

    expect(result).toEqual({
      kind: "passed",
      verdict: "PASS",
      reason: "test_quality_empty_scope",
    });
    expect(input.preflight).toHaveBeenCalledTimes(0);
    expect(input.dispatchModel).not.toHaveBeenCalled();
    expect(input.readCache).not.toHaveBeenCalled();
  });

  it("excludes a relocated refactor-preserving test from the grader and rejects a finding anchored there", async () => {
    const inScopeTest = "test/feature-behavior.test.ts";
    const relocatedTest = "test/relocated-legacy.test.ts";
    const inScopeTitle = "feature behavior remains sensitive";
    const relocatedTitle = "legacy behavior remains preserved after relocation";
    const frozenInputs = inputs();
    const dispatchModel = vi.fn(async () => ({
      findings: [{
        concernKind: "test-insensitive",
        summary: "The relocated preservation test is insensitive.",
        evidenceLocations: [`${relocatedTest}:12`],
        anchor: {
          rubric: "testQuality",
          locus: {
            path: relocatedTest,
            contentHash: `sha256:${createHash("sha256").update(relocatedTitle).digest("hex")}`,
            display: relocatedTitle,
          },
        },
      }],
    }));
    const result = await coordinateBuildReviewRubrics(coordinationInput(true, {
      inputs: {
        ...frozenInputs,
        sourceSnapshot: {
          ...frozenInputs.sourceSnapshot,
          changedTestTitles: [
            { selector: inScopeTest, titleText: inScopeTitle, staticExtractionFallback: false },
            { selector: relocatedTest, titleText: relocatedTitle, staticExtractionFallback: false },
          ],
          testQuality: { inScopeTests: [inScopeTest], unresolvedMarkers: [] },
        },
      },
      preflight: vi.fn(async () => ({
        classification: "stayed-green",
        cacheable: true,
        cacheProvenance: "miss",
        changedPaths: ["src/feature.ts", inScopeTest, relocatedTest],
        changedTestSelectors: [inScopeTest, relocatedTest],
        revertedProductionManifest: [],
        sourceIdentities: { mergeBase: "base", headSha: "head" },
        scopedRun: { exitCode: 0, runKind: "passed", ranSelectors: [inScopeTest, relocatedTest], failureExcerpt: "" },
      } as const)),
      dispatchModel,
    }));

    expect(dispatchModel).toHaveBeenCalledWith(
      expect.objectContaining({ rubric: "testQuality" }),
      expect.objectContaining({
        changedTestSelectors: [inScopeTest],
        changedTestTitles: [{ selector: inScopeTest, titleText: inScopeTitle, staticExtractionFallback: false }],
      }),
    );
    expect(result).toMatchObject({
      kind: "ready",
      branches: [{ kind: "infrastructure-failure", rubric: "testQuality", reason: "invalid-provider-result" }],
    });
  });

  it("dispatches exactly the enabled registered test-quality rubric", async () => {
    const lapId = parseBuildReviewLapId("lap-current")!;
    const frozenInputs = inputs();
    const dispatchModel = vi.fn(async () => undefined);
    const result = await coordinateBuildReviewRubrics(coordinationInput(true, {
      inputs: frozenInputs,
      lapId,
      projections: {
        testQuality: {
          rubric: "testQuality",
          contractVersion: "v3",
          projectionVersion: "v2",
          lapId,
          snapshotDigest: frozenInputs.sourceSnapshot.digest,
          digest: "sha256:test-quality",
        },
      } as never,
      dispatchModel,
    }));

    expect(classifyBuildReviewRubricBranches(config(true), [])).toMatchObject({
      kind: "ready",
      branches: [{ rubric: "testQuality", skillName: "build-review-test-quality" }],
    });
    expect(dispatchModel).toHaveBeenCalledTimes(1);
    expect(dispatchModel).toHaveBeenCalledWith(
      expect.objectContaining({ rubric: "testQuality" }),
      expect.objectContaining({ rubric: "testQuality" }),
    );
    expect(result).toMatchObject({ kind: "ready" });
  });
});

const IN_SCOPE_TEST = "test/a.test.ts";
const IN_SCOPE_TITLE = "a stays sensitive to its subject";
const IN_SCOPE_HASH = `sha256:${createHash("sha256").update(IN_SCOPE_TITLE).digest("hex")}`;

/** Frozen inputs whose in-scope test carries a title region a finding can anchor to. */
function titledInputs(): BuildReviewFrozenInputs {
  const frozenInputs = inputs();
  return {
    ...frozenInputs,
    sourceSnapshot: {
      ...frozenInputs.sourceSnapshot,
      changedTestTitles: [{ selector: IN_SCOPE_TEST, titleText: IN_SCOPE_TITLE, staticExtractionFallback: false }],
    },
  };
}

function testQualityFinding(summary = "The changed test passes against the reverted production code.") {
  return {
    concernKind: "test-insensitive",
    summary,
    evidenceLocations: [`${IN_SCOPE_TEST}:1`],
    anchor: { rubric: "testQuality", locus: { path: IN_SCOPE_TEST, contentHash: IN_SCOPE_HASH, display: IN_SCOPE_TITLE } },
  };
}

function testQualityBranch(result: Awaited<ReturnType<typeof coordinateBuildReviewRubrics>>) {
  return result.kind === "ready" ? result.branches.find((branch) => branch.rubric === "testQuality") : undefined;
}

describe("build-review coordinator: frozen fan-out", () => {
  it("emits each rubric occurrence exactly once in branch settlement order", async () => {
    const emit = vi.fn(async (_event: Parameters<NonNullable<BuildReviewCoordinationInput["emit"]>>[0]) => undefined);

    const result = await coordinateBuildReviewRubrics(coordinationInput(true, {
      dispatchModel: vi.fn(async () => ({ findings: [] })),
      emit,
    }));

    expect(result).toMatchObject({ kind: "ready", branches: [{ kind: "dispatched", rubric: "testQuality" }] });
    // A disabled rubric is dropped at classification, so no skip occurrence is reachable.
    expect(emit.mock.calls.map(([event]) => event)).toEqual([
      { type: "build_review_rubric_started", rubric: "testQuality", lapId: "lap-current" },
      { type: "build_review_rubric_result", rubric: "testQuality", lapId: "lap-current", verdict: "PASS" },
    ]);
  });

  it("materializes a fresh result into both current-lap evidence stores before returning it", async () => {
    const input = coordinationInput(true, { dispatchModel: vi.fn(async () => ({ findings: [] })) });

    const result = await coordinateBuildReviewRubrics(input);

    expect(input.writeArtifact).toHaveBeenCalledTimes(1);
    expect(input.writeArtifact).toHaveBeenCalledWith({
      rubric: "testQuality", lapId: "lap-current", snapshotDigest: "sha256:snapshot", provenance: { kind: "fresh" },
      result: { kind: "judged", rubric: "testQuality", contractVersion: "v3", lapId: "lap-current", snapshotDigest: "sha256:snapshot", findings: [], verdict: "PASS" },
    });
    expect(input.writeCache).toHaveBeenCalledTimes(1);
    expect(input.writeCache).toHaveBeenCalledWith(expect.objectContaining({
      version: 1, rubric: "testQuality", contractVersion: "v3", projectionVersion: expect.any(String),
      projectionDigest: expect.stringMatching(/^sha256:/), policyFingerprint: expect.any(String),
      result: expect.objectContaining({ kind: "judged", rubric: "testQuality", lapId: "lap-current", verdict: "PASS" }),
    }));
    expect(testQualityBranch(result)).toMatchObject({ kind: "dispatched", rubric: "testQuality", result: { kind: "judged", verdict: "PASS" } });
  });

  it.each([
    ["throws", vi.fn(async () => { throw new Error("disk full"); })],
    ["returns an artifact that fails validation", vi.fn(async () => ({}) as never)],
  ])("turns an artifact write that %s into an owning infrastructure result and never caches it", async (_shape, writeArtifact) => {
    const input = coordinationInput(true, { dispatchModel: vi.fn(async () => ({ findings: [] })), writeArtifact });

    const result = await coordinateBuildReviewRubrics(input);

    expect(testQualityBranch(result)).toEqual({ kind: "infrastructure-failure", rubric: "testQuality", reason: "artifact-write-failed" });
    expect(input.writeCache).not.toHaveBeenCalled();
  });

  it("turns a cache write failure into an owning infrastructure result", async () => {
    const emit = vi.fn(async (_event: Parameters<NonNullable<BuildReviewCoordinationInput["emit"]>>[0]) => undefined);
    const input = coordinationInput(true, {
      dispatchModel: vi.fn(async () => ({ findings: [] })),
      writeCache: vi.fn(async () => { throw new Error("disk full"); }),
      emit,
    });

    const result = await coordinateBuildReviewRubrics(input);

    expect(input.writeArtifact).toHaveBeenCalledTimes(1);
    expect(testQualityBranch(result)).toEqual({ kind: "infrastructure-failure", rubric: "testQuality", reason: "cache-write-failed" });
    expect(emit).toHaveBeenCalledWith({
      type: "build_review_rubric_infrastructure_failure", rubric: "testQuality", lapId: "lap-current", reason: "cache-write-failed",
    });
  });

  it.each([
    ['launch', 'scoped-run-launch-failed', 'scoped command could not launch'],
    ['timeout', 'scoped-run-timeout', 'scoped run exceeded 60s'],
    ['signal', 'scoped-run-signaled', 'scoped run received SIGTERM'],
  ] as const)("records a preflight %s infrastructure failure without dispatching the grader", async (_kind, reason, detail) => {
    const emit = vi.fn(async (_event: Parameters<NonNullable<BuildReviewCoordinationInput["emit"]>>[0]) => undefined);
    const input = coordinationInput(true, {
      preflight: vi.fn(async () => ({
        classification: "infrastructure-failure" as const, reason,
        failureExcerpt: detail,
        changedPaths: [], changedTestSelectors: [], sourceIdentities: { mergeBase: "base", headSha: "head" },
      })),
      emit,
    });

    const result = await coordinateBuildReviewRubrics(input);

    expect(input.preflight).toHaveBeenCalledTimes(1);
    expect(input.dispatchModel).not.toHaveBeenCalled();
    expect(input.readCache).not.toHaveBeenCalled();
    expect(input.writeArtifact).not.toHaveBeenCalled();
    expect(result).toEqual({
      kind: "ready",
      branches: [{ kind: "infrastructure-failure", rubric: "testQuality", reason, detail }],
    });
    expect(emit.mock.calls.map(([event]) => event)).toEqual([{
      type: "build_review_rubric_infrastructure_failure", rubric: "testQuality", lapId: "lap-current",
      reason, excerpt: detail,
    }]);
  });

  it("leaves an excerpt-less preflight infrastructure failure byte-identical", async () => {
    const input = coordinationInput(true, {
      preflight: vi.fn(async () => ({
        classification: "infrastructure-failure" as const, reason: "materialization-failed" as const,
        changedPaths: [], changedTestSelectors: [], sourceIdentities: { mergeBase: "base", headSha: "head" },
      })),
    });

    const result = await coordinateBuildReviewRubrics(input);

    expect(testQualityBranch(result)).toEqual({
      kind: "infrastructure-failure", rubric: "testQuality", reason: "materialization-failed",
    });
  });
});

describe("build-review coordinator: dispatch-failure detail carry-through", () => {
  it("rejects malformed counterfactualSensitivity as absent rerun evidence without a semantic route or cap tick", async () => {
    const frozenInputs = titledInputs();
    const lapId = parseBuildReviewLapId("lap-current")!;
    const projection = {
      rubric: "testQuality", contractVersion: "v3", projectionVersion: "v2", lapId,
      snapshotDigest: frozenInputs.sourceSnapshot.digest, digest: "sha256:test-quality",
      changedTestSelectors: [IN_SCOPE_TEST],
      changedTestTitles: frozenInputs.sourceSnapshot.changedTestTitles,
      changedFiles: [],
    } as never;
    const malformed = { findings: [], counterfactualSensitivity: "unknown" };
    const stamped = stampBuildReviewDispatchedCandidate(malformed, "testQuality", projection);
    const rubricFailures = { testQuality: 3 };
    const writeArtifact = vi.fn(async (artifact) => ({ version: 1, ...artifact }));
    const writeCache = vi.fn(async () => undefined);
    const emit = vi.fn(async (_event: Parameters<NonNullable<BuildReviewCoordinationInput["emit"]>>[0]) => undefined);

    // The dispatch repair predicate rejects the envelope before it can settle a
    // judged FAIL. With no persisted result, the existing gate-completion path
    // sees absent evidence and reruns; no semantic kickback can charge this tally.
    expect(validateBuildReviewDispatchedResult(stamped, "testQuality", projection)).toBeUndefined();

    const result = await coordinateBuildReviewRubrics(coordinationInput(true, {
      inputs: frozenInputs,
      dispatchModel: vi.fn(async () => malformed),
      writeArtifact,
      writeCache,
      emit,
    }));

    expect(testQualityBranch(result)).toMatchObject({
      kind: "infrastructure-failure", rubric: "testQuality", reason: "invalid-provider-result",
      detail: expect.stringContaining("counterfactualSensitivity"),
    });
    expect(writeArtifact).not.toHaveBeenCalled();
    expect(writeCache).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: "build_review_rubric_result", verdict: "FAIL" }));
    expect(rubricFailures).toEqual({ testQuality: 3 });
  });

  it("settles a dispatch-failure report as invalid-provider-result carrying its bounded detail", async () => {
    const detail = "judged-result contract not satisfied after one repair turn: ... Raw output excerpt: I judged the rubric...";
    const emit = vi.fn(async (_event: Parameters<NonNullable<BuildReviewCoordinationInput["emit"]>>[0]) => undefined);
    const input = coordinationInput(true, {
      dispatchModel: vi.fn(async () => ({ kind: "dispatch-failure", detail })),
      emit,
    });

    const result = await coordinateBuildReviewRubrics(input);

    expect(testQualityBranch(result)).toEqual({ kind: "infrastructure-failure", rubric: "testQuality", reason: "invalid-provider-result", detail });
    expect(input.writeArtifact).not.toHaveBeenCalled();
    // The event-spine occurrence stays a short reason; the detail travels on the branch only.
    expect(emit).toHaveBeenCalledWith({
      type: "build_review_rubric_infrastructure_failure", rubric: "testQuality", lapId: "lap-current", reason: "invalid-provider-result",
    });
  });

  it("settles an undefined dispatch result as invalid-provider-result with no detail", async () => {
    const result = await coordinateBuildReviewRubrics(coordinationInput(true));

    expect(testQualityBranch(result)).toEqual({ kind: "infrastructure-failure", rubric: "testQuality", reason: "invalid-provider-result" });
  });

  it.each([
    ["has no JSON object", "not JSON at all", "no parseable JSON object was found in the response"],
    ["has non-array findings", { findings: "none" }, '"findings" must be an array (empty when no concern was found)'],
    ["has one malformed finding among valid findings", {
      findings: [testQualityFinding(), { ...testQualityFinding(), anchor: { rubric: "testQuality", locus: { path: "", contentHash: IN_SCOPE_HASH, display: IN_SCOPE_TITLE } } }],
    }, 'findings[1].anchor.locus must be a content-region reference {"path", "contentHash", "display", "occurrence"?}'],
  ])("carries the engine-produced failed requirement when a provider result %s", async (_shape, payload, detail) => {
    const result = await coordinateBuildReviewRubrics(coordinationInput(true, {
      inputs: titledInputs(),
      dispatchModel: vi.fn(async () => payload),
    }));

    expect(testQualityBranch(result)).toEqual({ kind: "infrastructure-failure", rubric: "testQuality", reason: "invalid-provider-result", detail });
  });

  it("rejects colliding finding identities in one judged result as infrastructure, never a verdict", async () => {
    const input = coordinationInput(true, {
      inputs: titledInputs(),
      dispatchModel: vi.fn(async () => ({ findings: [testQualityFinding("first wording"), testQualityFinding("second wording")] })),
    });

    const result = await coordinateBuildReviewRubrics(input);

    expect(testQualityBranch(result)).toEqual({
      kind: "infrastructure-failure", rubric: "testQuality", reason: "invalid-provider-result",
      detail: `findings must not repeat one concern on one content region (duplicated: "${IN_SCOPE_TITLE}") — merge equivalent findings`,
    });
    expect(input.writeArtifact).not.toHaveBeenCalled();
    expect(input.writeCache).not.toHaveBeenCalled();
  });

  // The Record below is keyed BY the closed union, so `typecheck:test` fails on
  // a missing key when a member is added and on an excess key when one is
  // removed; the runtime assertions then prove the parser admits exactly these
  // members and nothing else.
  it("pins the closed infrastructure-reason vocabulary against silent growth", () => {
    const pinned: Record<BuildReviewInfrastructureFailureReason, true> = {
      "provider-error": true,
      "retry-exhausted": true,
      "missing-artifact": true,
      "malformed-artifact": true,
      "stale-artifact": true,
      "identity-mismatch": true,
      "preflight-failed": true,
      "artifact-read-failed": true,
      "artifact-write-failed": true,
    };
    // The parser admits exactly the reasons the coordinator mapping can produce;
    // the three union members outside that mapping are carried by other
    // producers and never reach this parser.
    const producible = new Set<string>(Object.values(mapBuildReviewCoordinatorFailureReason));
    expect([...producible].every((reason) => reason in pinned)).toBe(true);

    for (const reason of producible) {
      expect(parseBuildReviewInfrastructureFailure({
        kind: "infrastructure-failure", rubric: "testQuality", reason, detail: "d",
      })).toEqual({ kind: "infrastructure-failure", rubric: "testQuality", reason, detail: "d" });
    }
    expect(parseBuildReviewInfrastructureFailure({
      kind: "infrastructure-failure", rubric: "testQuality", reason: "invalid-provider-result", detail: "d",
    })).toBeUndefined();
    expect(parseBuildReviewInfrastructureFailure({
      kind: "infrastructure-failure", rubric: "testQuality", reason: "scoped-run-timeout", detail: "d",
    })).toBeUndefined();
  });
});

describe("build-review coordinator: findings-only provider payloads", () => {
  it.each([
    ["no findings", [], "PASS"],
    ["one finding", [testQualityFinding()], "FAIL"],
  ] as const)("persists a findings-only dispatch with %s as the complete engine-stamped v3 envelope", async (_shape, findings, verdict) => {
    const input = coordinationInput(true, {
      inputs: titledInputs(),
      dispatchModel: vi.fn(async () => ({ findings: [...findings] })),
    });

    const result = await coordinateBuildReviewRubrics(input);

    const expected = {
      kind: "judged", rubric: "testQuality", contractVersion: "v3", lapId: "lap-current", snapshotDigest: "sha256:snapshot",
      findings: [...findings], verdict,
    };
    expect(input.writeArtifact).toHaveBeenCalledWith({
      rubric: "testQuality", lapId: "lap-current", snapshotDigest: "sha256:snapshot", provenance: { kind: "fresh" }, result: expected,
    });
    expect(testQualityBranch(result)).toEqual({ kind: "dispatched", rubric: "testQuality", result: expected });
  });

  it.each([
    ["status discriminator", { findings: [], status: "judged" }, "PASS", []],
    ["type discriminator", { findings: [], type: "judged" }, "PASS", []],
    ["foreign lap and snapshot identity", { findings: [], lapId: "other-lap", snapshotDigest: "sha256:other" }, "PASS", []],
    ["different rubric", { findings: [], rubric: "scope" }, "PASS", []],
    ["v1 contract version", { findings: [testQualityFinding()], contractVersion: "v1" }, "FAIL", [testQualityFinding()]],
    ["unrecognized top-level keys", { findings: [], extra: "ignored", source: "provider" }, "PASS", []],
  ] as const)("settles a provider payload with %s under the engine-owned v3 envelope", async (_shape, payload, verdict, findings) => {
    const result = await coordinateBuildReviewRubrics(coordinationInput(true, {
      inputs: titledInputs(),
      dispatchModel: vi.fn(async () => payload),
    }));

    expect(testQualityBranch(result)).toEqual({
      kind: "dispatched", rubric: "testQuality",
      result: {
        kind: "judged", rubric: "testQuality", contractVersion: "v3", lapId: "lap-current", snapshotDigest: "sha256:snapshot",
        verdict, findings: [...findings],
      },
    });
  });
});

describe("build-review coordinator: counterfactual sensitivity is verdict-neutral", () => {
  it("settles indeterminate with no findings exactly as an ordinary empty result", async () => {
    const ordinary = await coordinateBuildReviewRubrics(coordinationInput(true, {
      inputs: titledInputs(),
      dispatchModel: vi.fn(async () => ({ findings: [] })),
    }));
    const indeterminate = await coordinateBuildReviewRubrics(coordinationInput(true, {
      inputs: titledInputs(),
      dispatchModel: vi.fn(async () => ({ findings: [], counterfactualSensitivity: "indeterminate" })),
    }));

    expect(testQualityBranch(ordinary)).toMatchObject({
      kind: "dispatched", result: { verdict: "PASS", findings: [] },
    });
    expect(testQualityBranch(indeterminate)).toMatchObject({
      kind: "dispatched", result: { verdict: "PASS", findings: [], counterfactualSensitivity: "indeterminate" },
    });
  });

  it("retains an evidenced test-insensitive finding despite indeterminate counterfactual sensitivity", async () => {
    const finding = testQualityFinding();
    const result = await coordinateBuildReviewRubrics(coordinationInput(true, {
      inputs: titledInputs(),
      dispatchModel: vi.fn(async () => ({ findings: [finding], counterfactualSensitivity: "indeterminate" })),
    }));

    expect(testQualityBranch(result)).toEqual({
      kind: "dispatched", rubric: "testQuality",
      result: {
        kind: "judged", rubric: "testQuality", contractVersion: "v3", lapId: "lap-current", snapshotDigest: "sha256:snapshot",
        findings: [finding], counterfactualSensitivity: "indeterminate", verdict: "FAIL",
      },
    });
  });

  it("settles repeated indeterminate findings as ordinary FAIL laps for the existing convergence bound", async () => {
    const finding = testQualityFinding();
    const laps = await Promise.all(["lap-one", "lap-two"].map(async (lap) => {
      const result = await coordinateBuildReviewRubrics(coordinationInput(true, {
        inputs: titledInputs(),
        lapId: parseBuildReviewLapId(lap)!,
        dispatchModel: vi.fn(async () => ({ findings: [finding], counterfactualSensitivity: "indeterminate" })),
      }));
      return testQualityBranch(result);
    }));

    expect(laps).toEqual(["lap-one", "lap-two"].map((lapId) => ({
      kind: "dispatched", rubric: "testQuality",
      result: {
        kind: "judged", rubric: "testQuality", contractVersion: "v3", lapId, snapshotDigest: "sha256:snapshot",
        findings: [finding], counterfactualSensitivity: "indeterminate", verdict: "FAIL",
      },
    })));
  });
});

describe("build-review coordinator: engine-held rubric isolation", () => {
  it("rejects a dispatch-time projection rubric mismatch without writing a branch artifact", async () => {
    const lapId = parseBuildReviewLapId("lap-current")!;
    const emit = vi.fn(async (_event: Parameters<NonNullable<BuildReviewCoordinationInput["emit"]>>[0]) => undefined);
    const input = coordinationInput(true, {
      lapId,
      projections: {
        testQuality: {
          rubric: "scope", contractVersion: "v3", projectionVersion: "v2", lapId,
          snapshotDigest: inputs().sourceSnapshot.digest, digest: "sha256:test-quality",
        },
      } as never,
      dispatchModel: vi.fn(async () => ({ findings: [] })),
      emit,
    });

    const result = await coordinateBuildReviewRubrics(input);

    expect(result).toEqual({
      kind: "ready",
      branches: [{ kind: "infrastructure-failure", rubric: "testQuality", reason: "projection-rubric-mismatch" }],
    });
    expect(input.readCache).not.toHaveBeenCalled();
    expect(input.dispatchModel).not.toHaveBeenCalled();
    expect(input.writeArtifact).not.toHaveBeenCalled();
    expect(emit.mock.calls.map(([event]) => event)).toEqual([{
      type: "build_review_rubric_infrastructure_failure", rubric: "testQuality", lapId: "lap-current", reason: "projection-rubric-mismatch",
    }]);
  });
});
