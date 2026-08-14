import { describe, expect, it, vi } from "vitest";
import {
  classifyBuildReviewRubricBranches,
  coordinateBuildReviewRubrics,
  type BuildReviewCoordinatorHooks,
} from "../../src/engine/build-review-coordinator.js";
import { parseBuildReviewLapId } from "../../src/engine/build-review-domain.js";
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
      wiring: policy,
    },
    ...overrides,
  };
}

describe("build-review coordinator: pre-dispatch classification", () => {
  it("classifies disabled and Wiring-only missing-entry-point branches before any cache or model call", () => {
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
        { kind: "skipped", rubric: "wiring", reason: "missing-entry-points" },
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
    entryPoints: ["src/index.ts"], repairContext: [], acceptedWidenings: [],
    removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] },
    testSuiteProof: { provenanceHeadSha: "head", outcome: "PASS" } as never,
    sourceSnapshot: {
      digest: "sha256:snapshot", baseRef: "origin/main", mergeBase: "base", headSha: "head",
      diff: "diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts",
      planBody: "# Plan\n", repairContext: [],
      removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] },
    },
  };
}

describe("build-review coordinator: frozen fan-out", () => {
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
      revertedProductionPatch: [{ path: "src/a.ts", mergeBaseContent: "base" }],
      sourceIdentities: { mergeBase: "base", headSha: "head" }, output: { stdout: "", stderr: "" },
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
    });

    expect(preflight).toHaveBeenCalledOnce();
    if (result.kind !== "ready") throw new Error("expected a settled review lap");
    expect(active.peak).toBeLessThanOrEqual(2);
    expect(dispatchModel).toHaveBeenCalledTimes(4);
    expect(dispatchModel.mock.calls.map(([branch]) => branch.rubric)).not.toContain("scope");
    expect(result.branches.map((branch) => branch.rubric)).toEqual(["tautology", "scope", "rootCause", "completeness", "wiring"]);
    expect(result.branches.find((branch) => branch.rubric === "scope")).toMatchObject({ kind: "cache-hit" });
    expect(dispatchModel.mock.calls.every(([, projection]) => !("dispositions" in projection) && !("siblings" in projection))).toBe(true);
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
    });

    if (result.kind !== "ready") throw new Error("expected a settled review lap");
    expect(result.branches[0]).toMatchObject({ rubric: "tautology", kind: "infrastructure-failure" });
    expect(dispatchModel.mock.calls.map(([branch]) => branch.rubric)).not.toContain("tautology");
    expect(result.branches).toHaveLength(5);
  });
});
