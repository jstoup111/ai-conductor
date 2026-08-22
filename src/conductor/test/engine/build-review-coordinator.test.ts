import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  classifyBuildReviewRubricBranches,
  coordinateBuildReviewRubrics as coordinateBuildReviewRubricsImpl,
  type BuildReviewRubricIdentities,
  type BuildReviewCoordinationInput,
  type BuildReviewCoordinatorHooks,
} from "../../src/engine/build-review-coordinator.js";
import {
  parseBuildReviewInfrastructureFailure,
  parseBuildReviewLapId,
  type BuildReviewInfrastructureFailureReason,
} from "../../src/engine/build-review-domain.js";
import type { BuildReviewCacheEntry } from "../../src/engine/build-review-cache.js";
import {
  engineStampFromEngineDir,
  type BuildReviewEngineIdentity,
} from "../../src/engine/build-review-engine-identity.js";
import type { BuildReviewFrozenInputs } from "../../src/engine/build-review-inputs.js";
import { deriveBuildReviewRubricProjections } from "../../src/engine/build-review-projections.js";
import type { ResolvedBuildReviewConfig } from "../../src/engine/resolved-config.js";
import type { ConductorEvent } from "../../src/types/events.js";

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
  const sourceContent = {
    diff: "diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts",
    planBody: "# Plan\n",
    repairContext: [],
    removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] },
  };
  return {
    diff: "diff --git a/src/a.ts b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts",
    planBody: "# Plan\n",
    mergeBase: "base", baseRef: "origin/main", baseKind: "remote", trackingRefSha: "base", remoteHeadSha: "base", fresh: true,
    repairContext: [], acceptedWidenings: [],
    removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] },
    testSuiteProof: { provenanceHeadSha: "head", outcome: "PASS" } as never,
    sourceSnapshot: {
      digest: "sha256:snapshot", contentDigest: contentDigestFor(sourceContent), baseRef: "origin/main", mergeBase: "base", headSha: "head",
      ...sourceContent, acceptedWidenings: [],
    },
  };
}

function contentDigestFor(content: {
  readonly diff: string;
  readonly planBody: string;
  readonly repairContext: readonly unknown[];
  readonly removalContext: unknown;
}): string {
  const { diff, planBody, repairContext, removalContext } = content;
  return `sha256:${createHash("sha256").update(JSON.stringify({
    diff,
    planBody,
    repairContext,
    removalContext,
  })).digest("hex")}`;
}

const engineIdentity = {
  engineStamp: "current-engine",
  skillDigest: "sha256:current-skill",
} as BuildReviewEngineIdentity;

const rubricIdentities: BuildReviewRubricIdentities = {
  tautology: { kind: "ready", identity: engineIdentity },
  scope: { kind: "ready", identity: engineIdentity },
  rootCause: { kind: "ready", identity: engineIdentity },
  completeness: { kind: "ready", identity: engineIdentity },
};

function identitiesFor(identity: BuildReviewEngineIdentity): BuildReviewRubricIdentities {
  return {
    tautology: { kind: "ready", identity },
    scope: { kind: "ready", identity },
    rootCause: { kind: "ready", identity },
    completeness: { kind: "ready", identity },
  };
}

const coordinateBuildReviewRubrics = coordinateBuildReviewRubricsImpl;

describe("build-review coordinator: frozen fan-out", () => {
  it("emits each rubric occurrence exactly once in branch settlement order", async () => {
    const emit = vi.fn(async (_event: Parameters<NonNullable<BuildReviewCoordinationInput['emit']>>[0]) => undefined);

    await coordinateBuildReviewRubrics({
      config: config({ rubrics: { ...config().rubrics, tautology: { ...config().rubrics.tautology, enabled: false } } }),
      inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!, engineIdentity: rubricIdentities,
      preflight: vi.fn(), readCache: async () => undefined,
      dispatchModel: async (branch, projection) => ({
        kind: "judged" as const, rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
        contractVersion: "v3" as never, findings: [], verdict: "PASS" as const,
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
      contractVersion: "v3" as never, findings: [], verdict: "PASS" as const,
    }));

    await coordinateBuildReviewRubrics({
      config: config(), inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!, engineIdentity: identitiesFor(engineIdentity),
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
    expect(writeArtifact.mock.calls.map(([artifact]) => artifact)).toEqual([
      expect.objectContaining({
        rubric: "tautology", lapId: "lap-current", snapshotDigest: "sha256:snapshot", provenance: { kind: "fresh" },
        result: expect.objectContaining({ kind: "judged", rubric: "tautology", contractVersion: "v3", lapId: "lap-current", snapshotDigest: "sha256:snapshot" }),
      }),
      expect.objectContaining({
        rubric: "scope", lapId: "lap-current", snapshotDigest: "sha256:snapshot", provenance: { kind: "fresh" },
        result: expect.objectContaining({ kind: "judged", rubric: "scope", contractVersion: "v3", lapId: "lap-current", snapshotDigest: "sha256:snapshot" }),
      }),
      expect.objectContaining({
        rubric: "rootCause", lapId: "lap-current", snapshotDigest: "sha256:snapshot", provenance: { kind: "fresh" },
        result: expect.objectContaining({ kind: "judged", rubric: "rootCause", contractVersion: "v3", lapId: "lap-current", snapshotDigest: "sha256:snapshot" }),
      }),
      expect.objectContaining({
        rubric: "completeness", lapId: "lap-current", snapshotDigest: "sha256:snapshot", provenance: { kind: "fresh" },
        result: expect.objectContaining({ kind: "judged", rubric: "completeness", contractVersion: "v3", lapId: "lap-current", snapshotDigest: "sha256:snapshot" }),
      }),
    ]);
    expect(writeCache.mock.calls.every(([entry]) => entry.result.kind === "judged")).toBe(true);
  });

  it("settles an unavailable rubric identity as cache-read-failed without cache I/O for that rubric", async () => {
    const readCache = vi.fn(async (_branch: Parameters<BuildReviewCoordinationInput["readCache"]>[0]) => undefined);
    const writeCache = vi.fn(async (_entry: BuildReviewCacheEntry) => undefined);
    const dispatchModel = vi.fn(async (branch, projection) => ({
      kind: "judged" as const, rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
      contractVersion: "v3" as never, findings: [], verdict: "PASS" as const,
    }));
    const unavailablePath = "/harness/skills/build-review-scope/SKILL.md";
    const result = await coordinateBuildReviewRubrics({
      config: config(), inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!,
      engineIdentity: {
        tautology: { kind: "ready", identity: engineIdentity },
        scope: { kind: "unavailable", path: unavailablePath },
        rootCause: { kind: "ready", identity: engineIdentity },
        completeness: { kind: "ready", identity: engineIdentity },
      },
      preflight: vi.fn(), readCache,
      dispatchModel,
      writeArtifact: async (artifact) => ({ version: 1, ...artifact }),
      writeCache,
    });

    const scope = result.kind === "ready" ? result.branches.find((branch) => branch.rubric === "scope") : undefined;
    expect(scope).toMatchObject({
      kind: "infrastructure-failure", rubric: "scope", reason: "cache-read-failed",
    });
    expect(scope).toMatchObject({ detail: expect.stringContaining(unavailablePath) });
    expect({
      cacheReads: readCache.mock.calls.map(([branch]) => branch.rubric),
      cacheWrites: writeCache.mock.calls.map(([entry]) => entry.rubric),
      dispatched: dispatchModel.mock.calls.map(([branch]) => branch.rubric),
    }).toEqual({
      cacheReads: ["tautology", "rootCause", "completeness"],
      cacheWrites: ["tautology", "rootCause", "completeness"],
      dispatched: ["tautology", "rootCause", "completeness"],
    });
  });

  it.each([
    ["engine-version-mismatch", { engineStamp: "old-engine", skillDigest: engineIdentity.skillDigest }, "old-engine"],
    ["skill-digest-mismatch", { engineStamp: engineIdentity.engineStamp, skillDigest: "sha256:old-skill" }, engineIdentity.engineStamp],
  ] as const)("discards a %s cache entry before dispatching it", async (reason, cachedIdentity, cachedEngineStamp) => {
    const emit = vi.fn(async (_event: Parameters<NonNullable<BuildReviewCoordinationInput["emit"]>>[0]) => undefined);
    const dispatchModel = vi.fn(async (branch, projection) => ({
      kind: "judged" as const, rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
      contractVersion: "v3" as never, findings: [], verdict: "PASS" as const,
    }));
    const writeCache = vi.fn(async (_entry: BuildReviewCacheEntry) => undefined);

    const result = await coordinateBuildReviewRubrics({
      config: config(), inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!, engineIdentity: identitiesFor(engineIdentity),
      preflight: vi.fn(),
      readCache: async (branch, projection, policyFingerprint) => branch.rubric === "scope" ? {
        version: 1, rubric: "scope", contractVersion: "v3", projectionVersion: "v2",
        projectionDigest: projection.digest, policyFingerprint,
        engineIdentity: cachedIdentity as BuildReviewEngineIdentity,
        result: {
          kind: "judged", rubric: "scope", lapId: parseBuildReviewLapId("cached")!, snapshotDigest: "cached-snapshot",
          contractVersion: "v3" as never, findings: [], verdict: "PASS",
        },
      } : undefined,
      dispatchModel,
      writeArtifact: async (artifact) => ({ version: 1, ...artifact }),
      writeCache,
      emit,
    });

    expect(emit.mock.calls.map(([event]) => event)).toEqual(expect.arrayContaining([
      {
        type: "build_review_cache_discarded", rubric: "scope", lapId: "lap-current", reason,
        cachedEngineStamp, currentEngineStamp: engineIdentity.engineStamp,
      },
      { type: "build_review_rubric_started", rubric: "scope", lapId: "lap-current" },
    ]));
    const events = emit.mock.calls.map(([event]) => event);
    expect(events.findIndex((event) => event.type === "build_review_cache_discarded"))
      .toBeLessThan(events.findIndex((event) => event.type === "build_review_rubric_started" && event.rubric === "scope"));
    expect(dispatchModel.mock.calls.map(([branch]) => branch.rubric)).toContain("scope");
    expect(writeCache.mock.calls.find(([entry]) => entry.rubric === "scope")?.[0].engineIdentity).toEqual(engineIdentity);
    expect(result).toMatchObject({ kind: "ready" });
  });

  it("emits no discard for missing, projection, policy, or invalid cache misses and completes without an emitter", async () => {
    const cases: Array<[string, unknown]> = [
      ["missing", undefined],
      ["projection", { projectionDigest: "sha256:other" }],
      ["policy", { policyFingerprint: "sha256:other" }],
      ["invalid", {}],
    ];

    for (const [name, override] of cases) {
      const emit = vi.fn(async (_event: Parameters<NonNullable<BuildReviewCoordinationInput["emit"]>>[0]) => undefined);
      const dispatched = vi.fn(async (branch, projection) => ({
        kind: "judged" as const, rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
        contractVersion: "v3" as never, findings: [], verdict: "PASS" as const,
      }));
      await coordinateBuildReviewRubrics({
        config: config(), inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!, engineIdentity: identitiesFor(engineIdentity),
        preflight: vi.fn(),
        readCache: async (branch, projection, policyFingerprint) => branch.rubric !== "scope"
          ? undefined
          : name === "invalid" ? {} as never
          : override === undefined ? undefined : {
            version: 1, rubric: "scope", contractVersion: "v3", projectionVersion: "v2",
            projectionDigest: projection.digest, policyFingerprint, engineIdentity,
            result: { kind: "judged", rubric: "scope", lapId: parseBuildReviewLapId("cached")!, snapshotDigest: "cached", contractVersion: "v3" as never, findings: [], verdict: "PASS" },
            ...(override as object),
          },
        dispatchModel: dispatched,
        writeArtifact: async (artifact) => ({ version: 1, ...artifact }),
        writeCache: async () => undefined,
        emit,
      });
      expect(emit.mock.calls.map(([event]) => event).filter((event) => event.type === "build_review_cache_discarded")).toEqual([]);
      expect(dispatched.mock.calls.map(([branch]) => branch.rubric)).toContain("scope");
    }

    const dispatched = vi.fn(async (branch, projection) => ({
      kind: "judged" as const, rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
      contractVersion: "v3" as never, findings: [], verdict: "PASS" as const,
    }));
    await expect(coordinateBuildReviewRubrics({
      config: config(), inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!, engineIdentity: identitiesFor(engineIdentity),
      preflight: vi.fn(),
      readCache: async (branch, projection, policyFingerprint) => branch.rubric === "scope" ? {
        version: 1, rubric: "scope", contractVersion: "v3", projectionVersion: "v2", projectionDigest: projection.digest,
        policyFingerprint, engineIdentity: { ...engineIdentity, engineStamp: "old-engine" } as BuildReviewEngineIdentity,
        result: { kind: "judged", rubric: "scope", lapId: parseBuildReviewLapId("cached")!, snapshotDigest: "cached", contractVersion: "v3" as never, findings: [], verdict: "PASS" },
      } : undefined,
      dispatchModel: dispatched,
      writeArtifact: async (artifact) => ({ version: 1, ...artifact }),
      writeCache: async () => undefined,
    })).resolves.toMatchObject({ kind: "ready" });
    expect(dispatched.mock.calls.map(([branch]) => branch.rubric)).toContain("scope");
  });

  it("discards a legacy cache entry without a cached engine stamp before dispatching it", async () => {
    const emit = vi.fn(async (_event: Parameters<NonNullable<BuildReviewCoordinationInput["emit"]>>[0]) => undefined);
    const dispatchModel = vi.fn(async (branch, projection) => ({
      kind: "judged" as const, rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
      contractVersion: "v3" as never, findings: [], verdict: "PASS" as const,
    }));

    await coordinateBuildReviewRubrics({
      config: config(), inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!, engineIdentity: identitiesFor(engineIdentity),
      preflight: vi.fn(),
      readCache: async (branch, projection, policyFingerprint) => branch.rubric === "scope" ? {
        version: 1, rubric: "scope", contractVersion: "v3", projectionVersion: "v2",
        projectionDigest: projection.digest, policyFingerprint,
        result: {
          kind: "judged", rubric: "scope", lapId: parseBuildReviewLapId("cached")!, snapshotDigest: "cached-snapshot",
          contractVersion: "v3" as never, findings: [], verdict: "PASS",
        },
      } : undefined,
      dispatchModel,
      writeArtifact: async (artifact) => ({ version: 1, ...artifact }),
      writeCache: async () => undefined,
      emit,
    });

    const events = emit.mock.calls.map(([event]) => event);
    const discarded = events.find((event) => event.type === "build_review_cache_discarded");
    expect(discarded).toEqual({
      type: "build_review_cache_discarded", rubric: "scope", lapId: "lap-current",
      reason: "engine-version-mismatch", currentEngineStamp: engineIdentity.engineStamp,
    });
    expect(discarded).not.toHaveProperty("cachedEngineStamp");
    expect(events.findIndex((event) => event.type === "build_review_cache_discarded"))
      .toBeLessThan(events.findIndex((event) => event.type === "build_review_rubric_started" && event.rubric === "scope"));
    expect(dispatchModel.mock.calls.map(([branch]) => branch.rubric)).toContain("scope");
  });

  it("rematerializes an exact cache hit with provenance without rewriting its semantic entry", async () => {
    const writeArtifact = vi.fn(async (artifact) => ({ version: 1 as const, ...artifact }));
    const writeCache = vi.fn(async (_entry: BuildReviewCacheEntry) => undefined);
    const dispatchModel = vi.fn(async (branch, projection) => ({
      kind: "judged" as const, rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
      contractVersion: "v3" as never, findings: [], verdict: "PASS" as const,
    }));
    const result = await coordinateBuildReviewRubrics({
      config: config(), inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!, engineIdentity: identitiesFor(engineIdentity),
      preflight: async () => ({
        classification: "approved-exception" as const, exception: "empty-test-set" as const,
        cacheable: true as const, cacheProvenance: "miss" as const, changedPaths: [], changedTestSelectors: [],
        revertedProductionManifest: [], sourceIdentities: { mergeBase: "base", headSha: "head" },
      }),
      readCache: async (branch, projection, policyFingerprint) => branch.rubric === "scope" ? {
        version: 1 as const, rubric: "scope" as const, contractVersion: "v3" as const, projectionVersion: "v2" as const,
        projectionDigest: projection.digest, policyFingerprint, engineIdentity,
        result: {
          kind: "judged" as const, rubric: "scope" as const, lapId: parseBuildReviewLapId("cached")!,
          snapshotDigest: "cached-snapshot", contractVersion: "v3" as never, findings: [], verdict: "PASS" as const,
        },
      } : undefined,
      dispatchModel, writeArtifact, writeCache,
    });

    expect(result).toMatchObject({ kind: "ready" });
    expect(writeCache).toHaveBeenCalledTimes(3);
    expect(writeArtifact.mock.calls.find(([artifact]) => artifact.rubric === "scope")?.[0]).toMatchObject({
      lapId: "lap-current", snapshotDigest: "sha256:snapshot", provenance: { kind: "cache-hit", cachedLapId: "cached" },
    });
    expect(dispatchModel).not.toHaveBeenCalledWith(expect.objectContaining({ rubric: "scope" }), expect.anything());
    expect(dispatchModel.mock.calls.map(([branch]) => branch.rubric)).not.toContain("scope");
  });

  it("serves rebased cache hits with current-lap provenance and re-dispatches only widened scope", async () => {
    const cache = new Map<BuildReviewCacheEntry["rubric"], BuildReviewCacheEntry>();
    const writeArtifact = vi.fn(async (artifact) => ({ version: 1 as const, ...artifact }));
    const writeCache = vi.fn(async (entry: BuildReviewCacheEntry) => {
      cache.set(entry.rubric, entry);
    });
    const dispatchModel = vi.fn(async (branch, projection) => ({
      kind: "judged" as const, rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
      contractVersion: "v3" as never, findings: [], verdict: "PASS" as const,
    }));
    const emit = vi.fn(async (_event: Parameters<NonNullable<BuildReviewCoordinationInput["emit"]>>[0]) => undefined);
    let preflightSourceIdentities = { mergeBase: "base", headSha: "head" };
    const preflight = async () => ({
      classification: "approved-exception" as const, exception: "empty-test-set" as const,
      cacheable: true as const, cacheProvenance: "miss" as const, changedPaths: [], changedTestSelectors: [],
      revertedProductionManifest: [], revertedProductionPatch: [], sourceIdentities: preflightSourceIdentities, output: { stdout: "", stderr: "" },
    });
    const initial = inputs();
    const rebased: BuildReviewFrozenInputs = {
      ...initial,
      mergeBase: "rebased-base",
      baseRef: "origin/rebased-main",
      testSuiteProof: {
        ...initial.testSuiteProof,
        provenanceHeadSha: "rebased-head",
      },
      sourceSnapshot: {
        ...initial.sourceSnapshot,
        digest: "sha256:rebased-snapshot",
        mergeBase: "rebased-base",
        headSha: "rebased-head",
        baseRef: "origin/rebased-main",
      },
    };
    const run = (lapId: string, snapshot: BuildReviewFrozenInputs) => coordinateBuildReviewRubrics({
      config: config(), inputs: snapshot, lapId: parseBuildReviewLapId(lapId)!, preflight, engineIdentity: rubricIdentities,
      readCache: async (branch) => cache.get(branch.rubric), dispatchModel, writeArtifact, writeCache, emit,
    });

    await run("lap-cached", initial);
    dispatchModel.mockClear();
    writeArtifact.mockClear();
    emit.mockClear();
    preflightSourceIdentities = { mergeBase: "rebased-base", headSha: "rebased-head" };

    const rebasedResult = await run("lap-rebased", rebased);

    expect({
      cacheHits: emit.mock.calls.map(([event]) => event).filter((event) => event.type === "build_review_cache_hit"),
      dispatches: dispatchModel.mock.calls.length,
      branches: rebasedResult.kind === "ready" ? rebasedResult.branches : [],
      artifacts: writeArtifact.mock.calls.map(([artifact]) => artifact),
    }).toMatchObject({
      cacheHits: [
        { rubric: "tautology", lapId: "lap-rebased" },
        { rubric: "scope", lapId: "lap-rebased" },
        { rubric: "rootCause", lapId: "lap-rebased" },
        { rubric: "completeness", lapId: "lap-rebased" },
      ],
      dispatches: 0,
      branches: [
        { kind: "cache-hit", rubric: "tautology", result: { lapId: "lap-rebased", snapshotDigest: "sha256:rebased-snapshot" } },
        { kind: "cache-hit", rubric: "scope", result: { lapId: "lap-rebased", snapshotDigest: "sha256:rebased-snapshot" } },
        { kind: "cache-hit", rubric: "rootCause", result: { lapId: "lap-rebased", snapshotDigest: "sha256:rebased-snapshot" } },
        { kind: "cache-hit", rubric: "completeness", result: { lapId: "lap-rebased", snapshotDigest: "sha256:rebased-snapshot" } },
      ],
      artifacts: [
        { rubric: "tautology", provenance: { kind: "cache-hit", cachedLapId: "lap-cached" } },
        { rubric: "scope", provenance: { kind: "cache-hit", cachedLapId: "lap-cached" } },
        { rubric: "rootCause", provenance: { kind: "cache-hit", cachedLapId: "lap-cached" } },
        { rubric: "completeness", provenance: { kind: "cache-hit", cachedLapId: "lap-cached" } },
      ],
    });

    dispatchModel.mockClear();
    emit.mockClear();
    const widenedSourceSnapshot = {
      ...rebased.sourceSnapshot,
      digest: "sha256:widened-snapshot",
      acceptedWidenings: [{ path: "src/widened.ts", rationale: "required coordination", derived: false, taskId: "5", sha: "widened-sha" }],
    };
    const widened = {
      ...rebased,
      sourceSnapshot: {
        ...widenedSourceSnapshot,
      },
    };

    const widenedResult = await run("lap-widened", widened);

    expect({
      cacheHits: emit.mock.calls.map(([event]) => event).filter((event) => event.type === "build_review_cache_hit"),
      dispatched: dispatchModel.mock.calls.map(([branch]) => branch.rubric),
      branches: widenedResult.kind === "ready" ? widenedResult.branches : [],
    }).toMatchObject({
      cacheHits: [
        { rubric: "tautology", lapId: "lap-widened" },
        { rubric: "rootCause", lapId: "lap-widened" },
        { rubric: "completeness", lapId: "lap-widened" },
      ],
      dispatched: ["scope"],
      branches: [
        { kind: "cache-hit", rubric: "tautology" },
        { kind: "dispatched", rubric: "scope" },
        { kind: "cache-hit", rubric: "rootCause" },
        { kind: "cache-hit", rubric: "completeness" },
      ],
    });
  });

  it("reuses four cached rubrics with matching per-rubric identities without dispatching a model", async () => {
    const identities = {
      tautology: { kind: "ready" as const, identity: { engineStamp: "31b5c81beaec", skillDigest: "sha256:tautology" } as BuildReviewEngineIdentity },
      scope: { kind: "ready" as const, identity: { engineStamp: "31b5c81beaec", skillDigest: "sha256:scope" } as BuildReviewEngineIdentity },
      rootCause: { kind: "ready" as const, identity: { engineStamp: "31b5c81beaec", skillDigest: "sha256:root-cause" } as BuildReviewEngineIdentity },
      completeness: { kind: "ready" as const, identity: { engineStamp: "31b5c81beaec", skillDigest: "sha256:completeness" } as BuildReviewEngineIdentity },
    };
    const emit = vi.fn(async (_event: Parameters<NonNullable<BuildReviewCoordinationInput["emit"]>>[0]) => undefined);
    const dispatchModel = vi.fn();
    const result = await coordinateBuildReviewRubrics({
      config: config(), inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!, engineIdentity: identities,
      preflight: vi.fn(),
      readCache: async (branch, projection, policyFingerprint) => ({
        version: 1, rubric: branch.rubric, contractVersion: "v3", projectionVersion: "v2",
        projectionDigest: projection.digest, policyFingerprint, engineIdentity: identities[branch.rubric].identity,
        result: {
          kind: "judged", rubric: branch.rubric, lapId: parseBuildReviewLapId("cached")!, snapshotDigest: "cached-snapshot",
          contractVersion: "v3" as never, findings: [], verdict: "PASS",
        },
      }),
      dispatchModel,
      writeArtifact: async (artifact) => ({ version: 1, ...artifact }),
      writeCache: async () => undefined,
      emit,
    });

    expect({
      dispatches: dispatchModel.mock.calls.length,
      cacheHits: emit.mock.calls.map(([event]) => event).filter((event) => event.type === "build_review_cache_hit"),
      branches: result.kind === "ready" ? result.branches : [],
    }).toMatchObject({
      dispatches: 0,
      cacheHits: [
        { rubric: "tautology", lapId: "lap-current" },
        { rubric: "scope", lapId: "lap-current" },
        { rubric: "rootCause", lapId: "lap-current" },
        { rubric: "completeness", lapId: "lap-current" },
      ],
      branches: [
        { kind: "cache-hit", rubric: "tautology", result: { lapId: "lap-current" } },
        { kind: "cache-hit", rubric: "scope", result: { lapId: "lap-current" } },
        { kind: "cache-hit", rubric: "rootCause", result: { lapId: "lap-current" } },
        { kind: "cache-hit", rubric: "completeness", result: { lapId: "lap-current" } },
      ],
    });
  });

  it("invalidates only the rubric whose skill digest changed", async () => {
    const identities = {
      tautology: { kind: "ready" as const, identity: { engineStamp: "31b5c81beaec", skillDigest: "sha256:tautology" } as BuildReviewEngineIdentity },
      scope: { kind: "ready" as const, identity: { engineStamp: "31b5c81beaec", skillDigest: "sha256:scope-current" } as BuildReviewEngineIdentity },
      rootCause: { kind: "ready" as const, identity: { engineStamp: "31b5c81beaec", skillDigest: "sha256:root-cause" } as BuildReviewEngineIdentity },
      completeness: { kind: "ready" as const, identity: { engineStamp: "31b5c81beaec", skillDigest: "sha256:completeness" } as BuildReviewEngineIdentity },
    };
    const dispatchModel = vi.fn(async (branch, projection) => ({
      kind: "judged" as const, rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
      contractVersion: "v3" as never, findings: [], verdict: "PASS" as const,
    }));
    const result = await coordinateBuildReviewRubrics({
      config: config(), inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!, engineIdentity: identities,
      preflight: vi.fn(),
      readCache: async (branch, projection, policyFingerprint) => ({
        version: 1, rubric: branch.rubric, contractVersion: "v3", projectionVersion: "v2",
        projectionDigest: projection.digest, policyFingerprint,
        engineIdentity: branch.rubric === "scope"
          ? { ...identities.scope.identity, skillDigest: "sha256:scope-cached" } as BuildReviewEngineIdentity
          : identities[branch.rubric].identity,
        result: {
          kind: "judged", rubric: branch.rubric, lapId: parseBuildReviewLapId("cached")!, snapshotDigest: "cached-snapshot",
          contractVersion: "v3" as never, findings: [], verdict: "PASS",
        },
      }),
      dispatchModel,
      writeArtifact: async (artifact) => ({ version: 1, ...artifact }),
      writeCache: async () => undefined,
    });

    expect({
      dispatched: dispatchModel.mock.calls.map(([branch]) => branch.rubric),
      branches: result.kind === "ready" ? result.branches : [],
    }).toMatchObject({
      dispatched: ["scope"],
      branches: [
        { kind: "cache-hit", rubric: "tautology" },
        { kind: "dispatched", rubric: "scope" },
        { kind: "cache-hit", rubric: "rootCause" },
        { kind: "cache-hit", rubric: "completeness" },
      ],
    });
  });

  it("reuses a cache entry when published engine timestamps differ but content stamps match", async () => {
    const cachedStamp = engineStampFromEngineDir(
      "/x/dist-versions/20260820T204302Z-31b5c81beaec/engine",
    );
    const currentStamp = engineStampFromEngineDir(
      "/x/dist-versions/20260821T010203Z-31b5c81beaec/engine",
    );
    const identity = {
      engineStamp: currentStamp,
      skillDigest: "sha256:scope",
    } as BuildReviewEngineIdentity;
    const dispatchModel = vi.fn();
    const result = await coordinateBuildReviewRubrics({
      config: config({ rubrics: { ...config().rubrics, tautology: { ...config().rubrics.tautology, enabled: false }, rootCause: { ...config().rubrics.rootCause, enabled: false }, completeness: { ...config().rubrics.completeness, enabled: false } } }),
      inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!, engineIdentity: identitiesFor(identity),
      preflight: vi.fn(),
      readCache: async (branch, projection, policyFingerprint) => ({
        version: 1, rubric: branch.rubric, contractVersion: "v3", projectionVersion: "v2",
        projectionDigest: projection.digest, policyFingerprint,
        engineIdentity: { ...identity, engineStamp: cachedStamp } as BuildReviewEngineIdentity,
        result: {
          kind: "judged", rubric: branch.rubric, lapId: parseBuildReviewLapId("cached")!, snapshotDigest: "cached-snapshot",
          contractVersion: "v3" as never, findings: [], verdict: "PASS",
        },
      }),
      dispatchModel,
      writeArtifact: async (artifact) => ({ version: 1, ...artifact }),
      writeCache: async () => undefined,
    });

    expect({ cachedStamp, currentStamp, dispatches: dispatchModel.mock.calls.length, branches: result.kind === "ready" ? result.branches : [] }).toMatchObject({
      cachedStamp: "31b5c81beaec",
      currentStamp: "31b5c81beaec",
      dispatches: 0,
      branches: [
        { kind: "skipped", rubric: "tautology" },
        { kind: "cache-hit", rubric: "scope", result: { lapId: "lap-current" } },
        { kind: "skipped", rubric: "rootCause" },
        { kind: "skipped", rubric: "completeness" },
      ],
    });
  });

  it("turns artifact write failure into an owning infrastructure result and never caches skips", async () => {
    const writeCache = vi.fn(async (_entry: BuildReviewCacheEntry) => undefined);
    const result = await coordinateBuildReviewRubrics({
      config: config({ rubrics: { ...config().rubrics, tautology: { ...config().rubrics.tautology, enabled: false } } }),
      inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!, engineIdentity: rubricIdentities,
      preflight: vi.fn(), readCache: async () => undefined,
      dispatchModel: async (branch, projection) => ({
        kind: "judged" as const, rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
        contractVersion: "v3" as never, findings: [], verdict: "PASS" as const,
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
      config: config(), inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!, engineIdentity: rubricIdentities,
      preflight: async () => ({
        classification: "approved-exception" as const, exception: "empty-test-set" as const,
        cacheable: true as const, cacheProvenance: "miss" as const, changedPaths: [], changedTestSelectors: [],
        revertedProductionManifest: [], sourceIdentities: { mergeBase: "base", headSha: "head" },
      }),
      readCache: async () => undefined,
      dispatchModel: async (branch, projection) => ({
        kind: "judged" as const, rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
        contractVersion: "v3" as never, findings: [], verdict: "PASS" as const,
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
        contractVersion: "v3", findings: [], verdict: "PASS",
      };
    });
    const preflight = vi.fn(async () => ({
      classification: "red" as const, cacheable: true as const, cacheProvenance: "miss" as const,
      changedPaths: ["src/a.ts", "test/a.test.ts"], changedTestSelectors: ["test/a.test.ts"],
      revertedProductionManifest: [{ path: "src/a.ts", mergeBaseBlobSha: "e79120aab4682bfe81153595c7d2ec1ad3bd3dd8" }],
      sourceIdentities: { mergeBase: "base", headSha: "head" },
      scopedRun: { exitCode: 1 as number, runKind: "nonzero-exit" as const, ranSelectors: ["test/a.test.ts"], failureExcerpt: "AssertionError: expected 2 to be 1" },
    }));
    const cachedScope = {
      version: 1 as const, rubric: "scope" as const, contractVersion: "v3" as const, projectionVersion: "v2" as const,
      projectionDigest: "", policyFingerprint: "", engineIdentity, result: {
        kind: "judged" as const, rubric: "scope" as const, lapId: parseBuildReviewLapId("cached")!,
        snapshotDigest: "old", contractVersion: "v3" as never, findings: [], verdict: "PASS" as const,
      },
    };
    const result = await coordinateBuildReviewRubrics({
      config: config({ maxParallel: 2 }), inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!, engineIdentity: identitiesFor(engineIdentity), preflight,
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
        contractVersion: "v2" as never, findings: [], verdict: "PASS" as const,
      };
    });
    const rawRunOutput = `raw runner output ${"x".repeat(4_096)}`;
    await coordinateBuildReviewRubrics({
      config: config(), inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!, engineIdentity: rubricIdentities,
      preflight: async () => ({
        classification: "red" as const, cacheable: true as const, cacheProvenance: "miss" as const,
        changedPaths: ["src/a.ts", "test/a.test.ts"], changedTestSelectors: ["test/a.test.ts"],
        revertedProductionManifest: [{ path: "src/a.ts", mergeBaseBlobSha: "e79120aab4682bfe81153595c7d2ec1ad3bd3dd8" }],
        eligibleSelectorRemovals: [],
        sourceIdentities: { mergeBase: "base", headSha: "head" },
        scopedRun: {
          exitCode: 1, runKind: "nonzero-exit" as const, ranSelectors: ["test/a.test.ts"],
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
        exitCode: 1, runKind: "nonzero-exit", ranSelectors: ["test/a.test.ts"],
        failureExcerpt: rawRunOutput.slice(0, 64),
      },
    });
  });

  it("records a preflight infrastructure failure without dispatching Tautology while sibling rubrics settle", async () => {
    const infrastructureEvents: Array<Extract<ConductorEvent, {
      type: "build_review_rubric_infrastructure_failure";
    }>> = [];
    const emit = vi.fn(async (event: ConductorEvent) => {
      if (event.type === "build_review_rubric_infrastructure_failure") infrastructureEvents.push(event);
    });
    const dispatchModel = vi.fn(async (branch, projection) => ({
      kind: "judged" as const, rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
      contractVersion: "v3" as never, findings: [], verdict: "PASS" as const,
    }));
    const result = await coordinateBuildReviewRubrics({
      config: config(), inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!, engineIdentity: rubricIdentities,
      preflight: async () => ({
        classification: "infrastructure-failure", reason: "scoped-run-timeout", changedPaths: [], changedTestSelectors: [],
        sourceIdentities: { mergeBase: "base", headSha: "head" },
      }),
      readCache: async () => undefined, dispatchModel,
      writeArtifact: async (artifact) => ({ version: 1, ...artifact }),
      writeCache: async () => undefined,
      emit,
    });

    if (result.kind !== "ready") throw new Error("expected a settled review lap");
    expect(result.branches[0]).toMatchObject({ rubric: "tautology", kind: "infrastructure-failure" });
    expect(dispatchModel.mock.calls.map(([branch]) => branch.rubric)).not.toContain("tautology");
    expect(result.branches).toHaveLength(4);
    expect(infrastructureEvents).toHaveLength(1);
    expect(infrastructureEvents).toEqual([{
      type: "build_review_rubric_infrastructure_failure",
      rubric: "tautology",
      lapId: "lap-current",
      reason: "scoped-run-timeout",
    }]);
    expect(infrastructureEvents[0]).not.toHaveProperty("excerpt");
  });
});

describe("build-review coordinator: dispatch-failure detail carry-through", () => {
  const noTautology = () =>
    config({ rubrics: { ...config().rubrics, tautology: { ...config().rubrics.tautology, enabled: false } } });

  it("settles a dispatch-failure report as invalid-provider-result carrying its bounded detail", async () => {
    const emit = vi.fn(async (_event: Parameters<NonNullable<BuildReviewCoordinationInput["emit"]>>[0]) => undefined);
    const coordination = await coordinateBuildReviewRubrics({
      config: noTautology(),
      inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!, engineIdentity: rubricIdentities,
      preflight: vi.fn(), readCache: async () => undefined,
      dispatchModel: async (branch, projection) =>
        branch.rubric === "scope"
          ? { kind: "dispatch-failure", detail: "judged-result contract not satisfied after one repair turn: ... Raw output excerpt: I judged the rubric..." }
          : {
              kind: "judged" as const, rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
              contractVersion: "v3" as never, findings: [], verdict: "PASS" as const,
            },
      writeArtifact: async (artifact) => ({ version: 1, ...artifact }),
      writeCache: async () => undefined,
      emit,
    });

    expect(coordination.kind).toBe("ready");
    const scope = coordination.kind === "ready"
      ? coordination.branches.find((branch) => branch.rubric === "scope")
      : undefined;
    expect(scope).toEqual({
      kind: "infrastructure-failure",
      rubric: "scope",
      reason: "invalid-provider-result",
      detail: "judged-result contract not satisfied after one repair turn: ... Raw output excerpt: I judged the rubric...",
    });
    // The event-spine occurrence stays a short reason; the detail travels on the branch only.
    expect(emit).toHaveBeenCalledWith({
      type: "build_review_rubric_infrastructure_failure", rubric: "scope", lapId: "lap-current", reason: "invalid-provider-result",
    });
  });

  it("settles an undefined dispatch result as invalid-provider-result with no detail (unchanged behavior)", async () => {
    const coordination = await coordinateBuildReviewRubrics({
      config: noTautology(),
      inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!, engineIdentity: rubricIdentities,
      preflight: vi.fn(), readCache: async () => undefined,
      dispatchModel: async (branch, projection) =>
        branch.rubric === "rootCause" ? undefined : {
          kind: "judged" as const, rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
          contractVersion: "v3" as never, findings: [], verdict: "PASS" as const,
        },
      writeArtifact: async (artifact) => ({ version: 1, ...artifact }),
      writeCache: async () => undefined,
    });

    const rootCause = coordination.kind === "ready"
      ? coordination.branches.find((branch) => branch.rubric === "rootCause")
      : undefined;
    expect(rootCause).toEqual({ kind: "infrastructure-failure", rubric: "rootCause", reason: "invalid-provider-result" });
  });

  it.each([
    ["has no JSON object", "not JSON at all", "no parseable JSON object was found in the response"],
    ["has non-array findings", { findings: "none" }, '"findings" must be an array (empty when no concern was found)'],
    ["has one malformed finding among valid findings", {
      findings: [
        { concernKind: "out-of-plan-change", summary: "outside plan", evidenceLocations: ["src/a.ts:1"], anchor: { rubric: "scope", path: "src/a.ts", relation: "not-authorized-by-plan" } },
        { concernKind: "out-of-plan-change", summary: "outside plan", evidenceLocations: ["src/a.ts:1"], anchor: { rubric: "scope", path: "", relation: "not-authorized-by-plan" } },
      ],
    }, "findings[1].anchor.path must be a non-empty string"],
  ])("carries the engine-produced failed requirement when a provider result %s", async (_shape, payload, detail) => {
    const coordination = await coordinateBuildReviewRubrics({
      config: noTautology(),
      inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!, engineIdentity: rubricIdentities,
      preflight: vi.fn(), readCache: async () => undefined,
      dispatchModel: async (branch, projection) => branch.rubric === "scope"
        ? payload
        : {
            kind: "judged" as const, rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
            contractVersion: "v3" as never, findings: [], verdict: "PASS" as const,
          },
      writeArtifact: async (artifact) => ({ version: 1, ...artifact }),
      writeCache: async () => undefined,
    });

    expect(coordination.kind === "ready" ? coordination.branches.find((branch) => branch.rubric === "scope") : undefined)
      .toEqual({ kind: "infrastructure-failure", rubric: "scope", reason: "invalid-provider-result", detail });
  });

  // Task 18 step 3 forbids adding a member to the closed
  // BuildReviewInfrastructureFailureReason union — that mapping belongs to
  // `review-infrastructure-failures-are-operator-unreco`. The Record below is
  // keyed BY the union, so `typecheck:test` fails on a missing key when a member
  // is added and on an excess key when one is removed; the runtime assertions
  // then prove the parser admits exactly these members and nothing else.
  it("persists a tautology relocation audit from a findings-only live dispatch", async () => {
    const relocationAudit = [
      "[relocation-audit] EXEMPTED: test/fixture/c.md → test/fixture/docs/c.md; production hunk(s) do force the move",
    ];
    const writeArtifact = vi.fn(async (artifact) => ({ version: 1 as const, ...artifact }));
    const writeCache = vi.fn(async (_entry: BuildReviewCacheEntry) => undefined);

    const coordination = await coordinateBuildReviewRubrics({
      config: config(), inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!, engineIdentity: rubricIdentities,
      preflight: async () => ({
        classification: "approved-exception" as const, exception: "empty-test-set" as const,
        cacheable: true as const, cacheProvenance: "miss" as const, changedPaths: [], changedTestSelectors: [],
        revertedProductionManifest: [], sourceIdentities: { mergeBase: "base", headSha: "head" },
      }),
      readCache: async () => undefined,
      dispatchModel: async (branch) => branch.rubric === "tautology"
        ? { findings: [], relocationAudit }
        : { findings: [] },
      writeArtifact,
      writeCache,
    });

    expect(coordination.kind === "ready" ? coordination.branches.find((branch) => branch.rubric === "tautology") : undefined)
      .toMatchObject({ kind: "dispatched", rubric: "tautology", result: { relocationAudit } });
    expect(writeArtifact.mock.calls.find(([artifact]) => artifact.rubric === "tautology")?.[0].result)
      .toMatchObject({ relocationAudit });
    expect(writeCache.mock.calls.find(([entry]) => entry.rubric === "tautology")?.[0].result)
      .toMatchObject({ relocationAudit });
  });

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
    const reasons = Object.keys(pinned) as BuildReviewInfrastructureFailureReason[];

    for (const reason of reasons) {
      expect(parseBuildReviewInfrastructureFailure({
        kind: "infrastructure-failure", rubric: "scope", reason, detail: "d",
      })).toEqual({ kind: "infrastructure-failure", rubric: "scope", reason, detail: "d" });
    }
    expect(parseBuildReviewInfrastructureFailure({
      kind: "infrastructure-failure", rubric: "scope", reason: "invalid-provider-result", detail: "d",
    })).toBeUndefined();
  });
});

describe("build-review coordinator: findings-only provider payloads", () => {
  const noTautology = () =>
    config({ rubrics: { ...config().rubrics, tautology: { ...config().rubrics.tautology, enabled: false } } });

  const judged = (rubric: "tautology" | "scope" | "rootCause" | "completeness", projection: { lapId: string; snapshotDigest: string }) => ({
    kind: "judged" as const, rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
    contractVersion: "v3" as never, findings: [], verdict: "PASS" as const,
  });

  it("persists a live findings-only scope dispatch as the complete engine-stamped v3 envelope", async () => {
    const writeArtifact = vi.fn(async (artifact) => ({ version: 1 as const, ...artifact }));
    const coordination = await coordinateBuildReviewRubrics({
      config: noTautology(),
      inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!, engineIdentity: rubricIdentities,
      preflight: vi.fn(), readCache: async () => undefined,
      dispatchModel: async (branch, projection) => branch.rubric === "scope"
        ? { findings: [] }
        : judged(branch.rubric, projection),
      writeArtifact,
      writeCache: async () => undefined,
    });

    expect(writeArtifact.mock.calls
      .map(([artifact]) => artifact)
      .filter((artifact) => artifact.rubric === "scope"))
      .toEqual([{
        rubric: "scope", lapId: "lap-current", snapshotDigest: "sha256:snapshot", provenance: { kind: "fresh" },
        result: {
          kind: "judged", rubric: "scope", contractVersion: "v3", lapId: "lap-current", snapshotDigest: "sha256:snapshot",
          findings: [], verdict: "PASS",
        },
      }]);
  });


  it("settles a well-formed scope finding without provider envelope fields", async () => {
    const finding = {
      concernKind: "out-of-plan-change",
      summary: "The changed source path is not authorized by the plan.",
      evidenceLocations: ["src/a.ts:1"],
      anchor: { rubric: "scope" as const, path: "src/a.ts", relation: "not-authorized-by-plan" },
    };
    const coordination = await coordinateBuildReviewRubrics({
      config: noTautology(),
      inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!, engineIdentity: rubricIdentities,
      preflight: vi.fn(), readCache: async () => undefined,
      dispatchModel: async (branch, projection) => branch.rubric === "scope"
        ? { findings: [finding] }
        : judged(branch.rubric, projection),
      writeArtifact: async (artifact) => ({ version: 1, ...artifact }),
      writeCache: async () => undefined,
    });

    expect(coordination.kind === "ready" ? coordination.branches.find((branch) => branch.rubric === "scope") : undefined)
      .toEqual({
        kind: "dispatched", rubric: "scope",
        result: {
          kind: "judged", rubric: "scope", contractVersion: "v3", lapId: "lap-current", snapshotDigest: "sha256:snapshot",
          findings: [finding], verdict: "FAIL",
        },
      });
  });

  it("stamps one projection identity onto concurrent findings-only rubric results", async () => {
    const coordination = await coordinateBuildReviewRubrics({
      config: noTautology(),
      inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!, engineIdentity: rubricIdentities,
      preflight: vi.fn(), readCache: async () => undefined,
      dispatchModel: async () => ({ findings: [] }),
      writeArtifact: async (artifact) => ({ version: 1, ...artifact }),
      writeCache: async () => undefined,
    });

    expect(coordination.kind === "ready" ? coordination.branches.filter((branch) =>
      branch.kind === "dispatched" && (branch.rubric === "scope" || branch.rubric === "rootCause"),
    ) : []).toEqual([
      {
        kind: "dispatched", rubric: "scope",
        result: expect.objectContaining({ lapId: "lap-current", snapshotDigest: "sha256:snapshot" }),
      },
      {
        kind: "dispatched", rubric: "rootCause",
        result: expect.objectContaining({ lapId: "lap-current", snapshotDigest: "sha256:snapshot" }),
      },
    ]);
  });

  const settleScopePayload = async (payload: Record<string, unknown>) => {
    const coordination = await coordinateBuildReviewRubrics({
      config: noTautology(),
      inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!, engineIdentity: rubricIdentities,
      preflight: vi.fn(), readCache: async () => undefined,
      dispatchModel: async (branch, projection) => branch.rubric === "scope"
        ? payload
        : judged(branch.rubric, projection),
      writeArtifact: async (artifact) => ({ version: 1, ...artifact }),
      writeCache: async () => undefined,
    });
    return coordination.kind === "ready"
      ? coordination.branches.find((branch) => branch.rubric === "scope")
      : undefined;
  };

  const scopeFinding = {
    concernKind: "out-of-plan-change",
    summary: "The changed source path is not authorized by the plan.",
    evidenceLocations: ["src/a.ts:1"],
    anchor: { rubric: "scope", path: "src/a.ts", relation: "not-authorized-by-plan" },
  };

  it.each([
    ["status discriminator", { findings: [], status: "judged" }, "PASS", []],
    ["type discriminator", { findings: [], type: "judged" }, "PASS", []],
    ["omitted lap and snapshot identity", { findings: [] }, "PASS", []],
    ["different rubric", { findings: [], rubric: "rootCause" }, "PASS", []],
    ["v1 contract version", { findings: [scopeFinding], contractVersion: "v1" }, "FAIL", [scopeFinding]],
    // relocationAudit is deliberately NOT here: it is a recognized provider-owned
    // evidence field — a non-tautology payload carrying one is rejected with the
    // named problem (pinned in build-review-domain.test.ts), never laundered.
    ["unrecognized top-level keys", { findings: [], extra: "ignored", source: "provider" }, "PASS", []],
  ] as const)("settles a provider payload with %s under the engine-owned v3 envelope", async (_shape, payload, verdict, findings) => {
    expect(await settleScopePayload(payload)).toMatchObject({
      kind: "dispatched", rubric: "scope",
      result: {
        kind: "judged", rubric: "scope", contractVersion: "v3", lapId: "lap-current", snapshotDigest: "sha256:snapshot",
        verdict, findings,
      },
    });
  });
});

describe("build-review coordinator: engine-held rubric isolation", () => {
  it("rejects a dispatch-time projection rubric mismatch without writing either branch artifact", async () => {
    const writeArtifact = vi.fn(async (artifact) => ({ version: 1 as const, ...artifact }));
    const frozenInputs = inputs();
    const lapId = parseBuildReviewLapId("lap-current")!;
    const projections = deriveBuildReviewRubricProjections({
      lapId,
      inputs: frozenInputs,
      tautology: {
        changedTestSelectors: [], revertedProductionManifest: [], preflightEvidence: { classification: "not-requested" },
      },
    });
    const coordination = await coordinateBuildReviewRubrics({
      config: config({ rubrics: { ...config().rubrics, tautology: { ...config().rubrics.tautology, enabled: false } } }),
      inputs: frozenInputs, lapId, engineIdentity: rubricIdentities,
      projections: { ...projections, scope: projections.rootCause as never },
      preflight: vi.fn(), readCache: async () => undefined,
      dispatchModel: async () => ({ findings: [] }),
      writeArtifact,
      writeCache: async () => undefined,
    });

    expect({
      scope: coordination.kind === "ready" ? coordination.branches.find((branch) => branch.rubric === "scope") : undefined,
      artifactRubrics: writeArtifact.mock.calls.map(([artifact]) => artifact.rubric),
    }).toEqual({
      scope: { kind: "infrastructure-failure", rubric: "scope", reason: "projection-rubric-mismatch" },
      artifactRubrics: ["rootCause", "completeness"],
    });
  });

  it("writes four concurrent rubric results only under their own branch identities", async () => {
    const writeArtifact = vi.fn(async (artifact) => ({ version: 1 as const, ...artifact }));
    await coordinateBuildReviewRubrics({
      config: config(), inputs: inputs(), lapId: parseBuildReviewLapId("lap-current")!, engineIdentity: rubricIdentities,
      preflight: vi.fn(), readCache: async () => undefined,
      dispatchModel: async () => ({ findings: [] }),
      writeArtifact,
      writeCache: async () => undefined,
    });

    expect(writeArtifact.mock.calls.map(([artifact]) => ({
      artifactRubric: artifact.rubric,
      resultRubric: artifact.result.rubric,
      provenance: artifact.provenance.kind,
    }))).toEqual([
      { artifactRubric: "tautology", resultRubric: "tautology", provenance: "fresh" },
      { artifactRubric: "scope", resultRubric: "scope", provenance: "fresh" },
      { artifactRubric: "rootCause", resultRubric: "rootCause", provenance: "fresh" },
      { artifactRubric: "completeness", resultRubric: "completeness", provenance: "fresh" },
    ]);
  });
});
