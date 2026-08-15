import { describe, expect, it, vi } from "vitest";
import {
  classifyBuildReviewRubricBranches,
  coordinateBuildReviewRubrics,
  type BuildReviewCoordinationInput,
  type BuildReviewCoordinatorHooks,
} from "../../src/engine/build-review-coordinator.js";
import { parseBuildReviewLapId } from "../../src/engine/build-review-domain.js";
import type { BuildReviewCacheEntry } from "../../src/engine/build-review-cache.js";
import type { BuildReviewFrozenInputs } from "../../src/engine/build-review-inputs.js";
import type { ResolvedBuildReviewConfig } from "../../src/engine/resolved-config.js";

function config(overrides: Partial<ResolvedBuildReviewConfig> = {}): ResolvedBuildReviewConfig {
  const policy = {
    enabled: true,
    llm_provider: "claude" as const,
    model: "sonnet",
    effort: "medium" as const,
    model_fallback_ladder: ["sonnet"],
    max_retries: 1,
    escalate: false,
  };
  return {
    enabled: true,
    perTaskFloor: true,
    scopeContainmentEnforced: false,
    maxParallel: 5,
    rubrics: {
      tautology: policy,
      scope: policy,
      rootCause: policy,
      completeness: policy,
    },
    ...overrides,
  };
}

describe("build-review coordinator: pre-dispatch classification", () => {
  it("classifies disabled branches before any cache or model call", () => {
    const resolved = config({
      rubrics: {
        ...config().rubrics,
        tautology: { ...config().rubrics.tautology, enabled: false },
      },
    });
    const hooks: BuildReviewCoordinatorHooks = {
      lookupCache: vi.fn(),
      dispatchModel: vi.fn(),
    };

    expect(classifyBuildReviewRubricBranches(resolved, [], hooks)).toEqual({
      kind: "ready",
      branches: [
        { kind: "skipped", rubric: "tautology", reason: "disabled" },
        { rubric: "scope", skillName: "build-review-scope", policy: resolved.rubrics.scope },
        { rubric: "rootCause", skillName: "build-review-root-cause", policy: resolved.rubrics.rootCause },
        { rubric: "completeness", skillName: "build-review-completeness", policy: resolved.rubrics.completeness },
      ],
    });
    expect(hooks.lookupCache).not.toHaveBeenCalled();
    expect(hooks.dispatchModel).not.toHaveBeenCalled();
  });

  it("refuses an enabled gate whose every rubric is disabled instead of passing an empty lap", () => {
    const disabled = { ...config().rubrics };
    for (const rubric of Object.keys(disabled) as Array<keyof typeof disabled>) {
      disabled[rubric] = { ...disabled[rubric], enabled: false };
    }

    expect(classifyBuildReviewRubricBranches(config({ rubrics: disabled }), ["src/index.ts"])).toEqual({
      kind: "refused",
      reason: "no-enabled-rubrics",
    });
  });

  it("returns a disabled gate result without creating a synthetic successful branch", () => {
    expect(classifyBuildReviewRubricBranches(config({ enabled: false }), ["src/index.ts"])).toEqual({
      kind: "gate-disabled",
    });
  });
});

function inputs(): BuildReviewFrozenInputs {
  return {
    diff: "diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts",
    planBody: "# Plan\n",
    mergeBase: "base", baseRef: "origin/main", baseKind: "remote", trackingRefSha: "base", remoteHeadSha: "base", fresh: true,
    repairContext: [], acceptedWidenings: [],
    removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] },
    testSuiteProof: { provenanceHeadSha: "head", outcome: "PASS" } as never,
    sourceSnapshot: {
      digest: "sha256:snapshot", baseRef: "origin/main", mergeBase: "base", headSha: "head",
      diff: "diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts",
      planBody: "# Plan\n", repairContext: [], acceptedWidenings: [],
      removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] },
    },
  };
}

describe("build-review coordinator: frozen fan-out", () => {
  it("emits each rubric occurrence exactly once in branch settlement order", async () => {
    const emit = vi.fn(async (_event: Parameters<NonNullable<BuildReviewCoordinationInput['emit']>>[0]) => undefined);

    await coordinateBuildReviewRubrics({
      config: config({ rubrics: { ...config().rubrics, tautology: { ...config().rubrics.tautology, enabled: false } } }),
      inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!,
      preflight: vi.fn(), readCache: async () => undefined,
      dispatchModel: async (branch, projection) => ({
        kind: "judged" as const, rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
        contractVersion: "v1" as never, findings: [], verdict: "PASS" as const,
      }),
      writeArtifact: async (artifact) => ({ version: 1, ...artifact }),
      writeCache: async () => undefined,
      emit,
    });

    expect(emit.mock.calls.map(([event]) => event)).toEqual([
      { type: "build_review_rubric_skipped", rubric: "tautology", lapId: "lap-current", reason: "disabled" },
      { type: "build_review_rubric_started", rubric: "scope", lapId: "lap-current" },
      { type: "build_review_rubric_started", rubric: "rootCause", lapId: "lap-current" },
      { type: "build_review_rubric_started", rubric: "completeness", lapId: "lap-current" },
      { type: "build_review_rubric_result", rubric: "scope", lapId: "lap-current", verdict: "PASS" },
      { type: "build_review_rubric_result", rubric: "rootCause", lapId: "lap-current", verdict: "PASS" },
      { type: "build_review_rubric_result", rubric: "completeness", lapId: "lap-current", verdict: "PASS" },
    ]);
  });

  it("materializes a fresh result into both current-lap evidence stores before returning it", async () => {
    const writeArtifact = vi.fn(async (artifact) => ({ version: 1 as const, ...artifact }));
    const writeCache = vi.fn(async (_entry: BuildReviewCacheEntry) => undefined);
    const dispatchModel = vi.fn(async (branch, projection) => ({
      kind: "judged" as const, rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
      contractVersion: "v1" as never, findings: [], verdict: "PASS" as const,
    }));

    await coordinateBuildReviewRubrics({
      config: config(), inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!,
      preflight: async () => ({
        classification: "approved-exception" as const, exception: "empty-test-set" as const,
        cacheable: true as const, cacheProvenance: "miss" as const, changedPaths: [], changedTestSelectors: [],
        revertedProductionManifest: [], sourceIdentities: { mergeBase: "base", headSha: "head" },
      }),
      readCache: async () => undefined,
      dispatchModel,
      writeArtifact,
      writeCache,
    });

    expect(writeArtifact).toHaveBeenCalledTimes(4);
    expect(writeCache).toHaveBeenCalledTimes(4);
    expect(writeArtifact.mock.calls.every(([artifact]) => artifact.provenance.kind === "fresh")).toBe(true);
    expect(writeCache.mock.calls.every(([entry]) => entry.result.kind === "judged")).toBe(true);
  });

  it("rematerializes an exact cache hit with provenance without rewriting its semantic entry", async () => {
    const writeArtifact = vi.fn(async (artifact) => ({ version: 1 as const, ...artifact }));
    const writeCache = vi.fn(async (_entry: BuildReviewCacheEntry) => undefined);
    const dispatchModel = vi.fn(async (branch, projection) => ({
      kind: "judged" as const, rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
      contractVersion: "v1" as never, findings: [], verdict: "PASS" as const,
    }));
    const result = await coordinateBuildReviewRubrics({
      config: config(), inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!,
      preflight: async () => ({
        classification: "approved-exception" as const, exception: "empty-test-set" as const,
        cacheable: true as const, cacheProvenance: "miss" as const, changedPaths: [], changedTestSelectors: [],
        revertedProductionManifest: [], sourceIdentities: { mergeBase: "base", headSha: "head" },
      }),
      readCache: async (branch, projection, policyFingerprint) => branch.rubric === "scope" ? {
        version: 1 as const, rubric: "scope" as const, contractVersion: "v1" as const, projectionVersion: "v1" as const,
        projectionDigest: projection.digest, policyFingerprint,
        result: {
          kind: "judged" as const, rubric: "scope" as const, lapId: parseBuildReviewLapId("cached")!,
          snapshotDigest: "cached-snapshot", contractVersion: "v1" as never, findings: [], verdict: "PASS" as const,
        },
      } : undefined,
      dispatchModel, writeArtifact, writeCache,
    });

    expect(result).toMatchObject({ kind: "ready" });
    expect(writeCache).toHaveBeenCalledTimes(3);
    expect(writeArtifact.mock.calls.find(([artifact]) => artifact.rubric === "scope")?.[0]).toMatchObject({
      lapId: "lap-current", snapshotDigest: "sha256:snapshot", provenance: { kind: "cache-hit", cachedLapId: "cached" },
    });
    expect(dispatchModel.mock.calls.map(([branch]) => branch.rubric)).not.toContain("scope");
  });

  it("turns artifact write failure into an owning infrastructure result and never caches skips", async () => {
    const writeCache = vi.fn(async (_entry: BuildReviewCacheEntry) => undefined);
    const result = await coordinateBuildReviewRubrics({
      config: config({ rubrics: { ...config().rubrics, tautology: { ...config().rubrics.tautology, enabled: false } } }),
      inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!,
      preflight: vi.fn(), readCache: async () => undefined,
      dispatchModel: async (branch, projection) => ({
        kind: "judged" as const, rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
        contractVersion: "v1" as never, findings: [], verdict: "PASS" as const,
      }),
      writeArtifact: async (artifact) => {
        if (artifact.rubric === "scope") throw new Error("disk full");
        return { version: 1, ...artifact };
      },
      writeCache,
    });

    expect(result).toMatchObject({ kind: "ready" });
    expect((result as Extract<typeof result, { kind: "ready" }>).branches.find((branch) => branch.rubric === "scope"))
      .toEqual({ kind: "infrastructure-failure", rubric: "scope", reason: "artifact-write-failed" });
    expect(writeCache).toHaveBeenCalledTimes(2);
    expect(writeCache.mock.calls.map(([entry]) => entry.rubric)).toEqual(["rootCause", "completeness"]);
  });

  it("turns a cache write failure into an owning infrastructure result", async () => {
    const result = await coordinateBuildReviewRubrics({
      config: config(), inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!,
      preflight: async () => ({
        classification: "approved-exception" as const, exception: "empty-test-set" as const,
        cacheable: true as const, cacheProvenance: "miss" as const, changedPaths: [], changedTestSelectors: [],
        revertedProductionManifest: [], sourceIdentities: { mergeBase: "base", headSha: "head" },
      }),
      readCache: async () => undefined,
      dispatchModel: async (branch, projection) => ({
        kind: "judged" as const, rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
        contractVersion: "v1" as never, findings: [], verdict: "PASS" as const,
      }),
      writeArtifact: async (artifact) => ({ version: 1, ...artifact }),
      writeCache: async (entry) => {
        if (entry.rubric === "scope") throw new Error("disk full");
      },
    });

    expect((result as Extract<typeof result, { kind: "ready" }>).branches.find((branch) => branch.rubric === "scope"))
      .toEqual({ kind: "infrastructure-failure", rubric: "scope", reason: "cache-write-failed" });
  });

  it("runs one Tautology preflight, reuses exact hits, caps misses, and settles every branch", async () => {
    const active = { count: 0, peak: 0 };
    const dispatchModel = vi.fn(async (branch, projection) => {
      active.count += 1;
      active.peak = Math.max(active.peak, active.count);
      await Promise.resolve();
      active.count -= 1;
      return {
        kind: "judged", rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
        contractVersion: "v1", findings: [], verdict: "PASS",
      };
    });
    const preflight = vi.fn(async () => ({
      classification: "red" as const, cacheable: true as const, cacheProvenance: "miss" as const,
      changedPaths: ["src/a.ts", "test/a.test.ts"], changedTestSelectors: ["test/a.test.ts"],
      revertedProductionManifest: [{ path: "src/a.ts", mergeBaseBlobSha: "e79120aab4682bfe81153595c7d2ec1ad3bd3dd8" }],
      sourceIdentities: { mergeBase: "base", headSha: "head" },
      scopedRun: { exitCode: 1 as number, runKind: "test-failure" as const, ranSelectors: ["test/a.test.ts"], failureExcerpt: "AssertionError: expected 2 to be 1" },
    }));
    const cachedScope = {
      version: 1 as const, rubric: "scope" as const, contractVersion: "v1" as const, projectionVersion: "v1" as const,
      projectionDigest: "", policyFingerprint: "", result: {
        kind: "judged" as const, rubric: "scope" as const, lapId: parseBuildReviewLapId("cached")!,
        snapshotDigest: "old", contractVersion: "v1" as never, findings: [], verdict: "PASS" as const,
      },
    };
    const result = await coordinateBuildReviewRubrics({
      config: config({ maxParallel: 2 }), inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!, preflight,
      readCache: async (branch, projection, policyFingerprint) => branch.rubric === "scope"
        ? { ...cachedScope, projectionDigest: projection.digest, policyFingerprint }
        : undefined,
      dispatchModel,
      writeArtifact: async (artifact) => ({ version: 1, ...artifact }),
      writeCache: async () => undefined,
    });

    expect(preflight).toHaveBeenCalledOnce();
    if (result.kind !== "ready") throw new Error("expected a settled review lap");
    expect(active.peak).toBeLessThanOrEqual(2);
    expect(dispatchModel).toHaveBeenCalledTimes(3);
    expect(dispatchModel.mock.calls.map(([branch]) => branch.rubric)).not.toContain("scope");
    expect(result.branches.map((branch) => branch.rubric)).toEqual(["tautology", "scope", "rootCause", "completeness"]);
    expect(result.branches.find((branch) => branch.rubric === "scope")).toMatchObject({ kind: "cache-hit" });
    expect(dispatchModel.mock.calls.every(([, projection]) => !("dispositions" in projection) && !("siblings" in projection))).toBe(true);
  });

  it("projects a content-free tautology payload: manifest by reference, verdict fields verbatim, no raw run output", async () => {
    const projected: unknown[] = [];
    const dispatchModel = vi.fn(async (branch, projection) => {
      if (branch.rubric === "tautology") projected.push(projection);
      return {
        kind: "judged" as const, rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
        contractVersion: "v1" as never, findings: [], verdict: "PASS" as const,
      };
    });
    const rawRunOutput = `raw runner output ${"x".repeat(4_096)}`;
    await coordinateBuildReviewRubrics({
      config: config(), inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!,
      preflight: async () => ({
        classification: "red" as const, cacheable: true as const, cacheProvenance: "miss" as const,
        changedPaths: ["src/a.ts", "test/a.test.ts"], changedTestSelectors: ["test/a.test.ts"],
        revertedProductionManifest: [{ path: "src/a.ts", mergeBaseBlobSha: "e79120aab4682bfe81153595c7d2ec1ad3bd3dd8" }],
        eligibleSelectorRemovals: [],
        sourceIdentities: { mergeBase: "base", headSha: "head" },
        scopedRun: {
          exitCode: 1, runKind: "test-failure" as const, ranSelectors: ["test/a.test.ts"],
          failureExcerpt: rawRunOutput.slice(0, 64),
        },
      }),
      readCache: async () => undefined, dispatchModel,
      writeArtifact: async (artifact) => ({ version: 1, ...artifact }),
      writeCache: async () => undefined,
    });

    expect(projected).toHaveLength(1);
    const projection = projected[0] as Record<string, unknown>;
    // Manifest is by reference only — no merge-base content field survives projection.
    expect(projection.revertedProductionManifest).toEqual([
      { path: "src/a.ts", mergeBaseBlobSha: "e79120aab4682bfe81153595c7d2ec1ad3bd3dd8" },
    ]);
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain("mergeBaseContent");
    expect(serialized).not.toContain("revertedProductionPatch");
    expect(serialized).not.toContain(rawRunOutput);
    // The engine-derived verdict fields travel verbatim inside preflightEvidence.
    expect(projection.preflightEvidence).toMatchObject({
      classification: "red",
      changedPaths: ["src/a.ts", "test/a.test.ts"],
      changedTestSelectors: ["test/a.test.ts"],
      sourceIdentities: { mergeBase: "base", headSha: "head" },
      scopedRun: {
        exitCode: 1, runKind: "test-failure", ranSelectors: ["test/a.test.ts"],
        failureExcerpt: rawRunOutput.slice(0, 64),
      },
    });
  });

  it("records a preflight infrastructure failure without dispatching Tautology while sibling rubrics settle", async () => {
    const dispatchModel = vi.fn(async (branch, projection) => ({
      kind: "judged" as const, rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
      contractVersion: "v1" as never, findings: [], verdict: "PASS" as const,
    }));
    const result = await coordinateBuildReviewRubrics({
      config: config(), inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!,
      preflight: async () => ({
        classification: "infrastructure-failure", reason: "scoped-run-timeout", changedPaths: [], changedTestSelectors: [],
        sourceIdentities: { mergeBase: "base", headSha: "head" },
      }),
      readCache: async () => undefined, dispatchModel,
      writeArtifact: async (artifact) => ({ version: 1, ...artifact }),
      writeCache: async () => undefined,
    });

    if (result.kind !== "ready") throw new Error("expected a settled review lap");
    expect(result.branches[0]).toMatchObject({ rubric: "tautology", kind: "infrastructure-failure" });
    expect(dispatchModel.mock.calls.map(([branch]) => branch.rubric)).not.toContain("tautology");
    expect(result.branches).toHaveLength(4);
  });
});
