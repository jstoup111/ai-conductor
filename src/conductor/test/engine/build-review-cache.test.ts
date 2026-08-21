import { describe, expect, it, vi } from "vitest";
import {
  cacheEntryPath,
  classifyBuildReviewCacheLookup,
  parseBuildReviewCacheEntry,
  readBuildReviewCacheEntry,
  writeBuildReviewCacheEntry,
  type BuildReviewCacheEntry,
  type BuildReviewCacheFilesystem,
} from "../../src/engine/build-review-cache.js";
import { coordinateBuildReviewRubrics } from "../../src/engine/build-review-coordinator.js";
import { parseBuildReviewLapId } from "../../src/engine/build-review-domain.js";
import { deriveBuildReviewRubricProjections } from "../../src/engine/build-review-projections.js";

function entry(snapshotDigest = "snapshot-a"): BuildReviewCacheEntry {
  return {
    version: 1,
    rubric: "scope",
    contractVersion: "v3",
    projectionVersion: "v2",
    projectionDigest: "sha256:projection-a",
    policyFingerprint: "sha256:policy-a",
    result: {
      kind: "judged",
      rubric: "scope",
      lapId: "lap-a" as never,
      snapshotDigest,
      contractVersion: "v3" as never,
      findings: [],
      verdict: "PASS",
    },
  };
}

function memoryFilesystem(files: Record<string, string> = {}): BuildReviewCacheFilesystem & {
  files: Record<string, string>;
  writeCalls: Array<[string, string]>;
  renameCalls: Array<[string, string]>;
} {
  const writeCalls: Array<[string, string]> = [];
  const renameCalls: Array<[string, string]> = [];
  return {
    files,
    readFile: vi.fn(async (path: string) => {
      if (!(path in files)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return files[path]!;
    }),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async (path: string, contents: string) => {
      writeCalls.push([path, contents]);
      files[path] = contents;
    }),
    rename: vi.fn(async (from: string, to: string) => {
      renameCalls.push([from, to]);
      files[to] = files[from]!;
      delete files[from];
    }),
    writeCalls,
    renameCalls,
  };
}

describe("build-review semantic cache", () => {
  it("rejects v1 entries at the current public parse boundary", () => {
    expect(parseBuildReviewCacheEntry({ ...entry(), projectionVersion: "v1" })).toBeUndefined();
  });

  it("parses stored v1 contract entries through the read seam, then misses against the current v3 identity", async () => {
    const currentLookup = {
      rubric: "scope",
      contractVersion: "v3",
      projectionVersion: "v2",
      projectionDigest: "sha256:projection-a",
      policyFingerprint: "sha256:policy-a",
      lapId: "lap-current",
      snapshotDigest: "snapshot-current",
    } as never;
    const root = "/feature";
    const path = cacheEntryPath(root, "scope");
    const fs = memoryFilesystem({
      [path]: JSON.stringify({
        ...entry(),
        contractVersion: "v1",
        result: { ...entry().result, contractVersion: "v1" },
      }),
    });

    expect([
      classifyBuildReviewCacheLookup(await readBuildReviewCacheEntry(root, "scope", fs), currentLookup),
      classifyBuildReviewCacheLookup({ ...entry(), projectionVersion: "v2", projectionDigest: "sha256:changed-input" }, currentLookup),
    ]).toEqual([
      { kind: "miss", reason: "contract-version-mismatch" },
      { kind: "miss", reason: "projection-digest-mismatch" },
    ]);
  });

  it("stores one versioned semantic judgement per feature-scoped rubric with atomic replacement", async () => {
    const fs = memoryFilesystem();
    const root = "/feature";
    const path = cacheEntryPath(root, "scope");

    await writeBuildReviewCacheEntry(root, entry(), fs);
    await writeBuildReviewCacheEntry(root, entry("snapshot-b"), fs);

    expect({
      path,
      entry: await readBuildReviewCacheEntry(root, "scope", fs),
      renameCalls: fs.renameCalls,
      files: Object.keys(fs.files),
    }).toEqual({
      path: "/feature/.pipeline/build-review/cache/scope.json",
      entry: entry("snapshot-b"),
      renameCalls: [
        ["/feature/.pipeline/build-review/cache/scope.json.tmp", "/feature/.pipeline/build-review/cache/scope.json"],
        ["/feature/.pipeline/build-review/cache/scope.json.tmp", "/feature/.pipeline/build-review/cache/scope.json"],
      ],
      files: [path],
    });
  });

  it("isolates a foreign feature entry by content digest before atomically replacing it", async () => {
    const featureBRoot = "/features/b";
    const path = cacheEntryPath(featureBRoot, "scope");
    const foreignEntry = { ...entry("snapshot-feature-a"), projectionDigest: "sha256:feature-a-content" };
    const freshEntry = { ...entry("snapshot-feature-b"), projectionDigest: "sha256:feature-b-content" };
    const fs = memoryFilesystem({ [path]: JSON.stringify(foreignEntry) });

    const foreignCandidate = await readBuildReviewCacheEntry(featureBRoot, "scope", fs);
    await writeBuildReviewCacheEntry(featureBRoot, freshEntry, fs);

    expect({
      path,
      lookup: classifyBuildReviewCacheLookup(foreignCandidate, {
        rubric: "scope",
        contractVersion: "v3",
        projectionVersion: "v2",
        projectionDigest: freshEntry.projectionDigest,
        policyFingerprint: freshEntry.policyFingerprint,
        lapId: "lap-feature-b",
        snapshotDigest: freshEntry.result.snapshotDigest,
      } as never),
      storedEntry: await readBuildReviewCacheEntry(featureBRoot, "scope", fs),
      renameCalls: fs.renameCalls,
    }).toEqual({
      path: "/features/b/.pipeline/build-review/cache/scope.json",
      lookup: { kind: "miss", reason: "projection-digest-mismatch" },
      storedEntry: freshEntry,
      renameCalls: [[`${path}.tmp`, path]],
    });
  });

  it("treats a missing, malformed, or unsupported entry as a non-mutating cache miss", async () => {
    const root = "/feature";
    const path = cacheEntryPath(root, "scope");
    const fs = memoryFilesystem({ [path]: JSON.stringify({ version: 2, result: entry().result }) });

    await expect(readBuildReviewCacheEntry(root, "scope", fs)).resolves.toBeUndefined();
    expect(fs.writeCalls).toEqual([]);
    expect(fs.renameCalls).toEqual([]);
    await expect(readBuildReviewCacheEntry(root, "tautology", fs)).resolves.toBeUndefined();
  });

  it("refuses to persist skips and infrastructure failures as reusable cache state", async () => {
    const fs = memoryFilesystem();
    const invalid = { ...entry(), result: { kind: "skipped", rubric: "scope", reason: "disabled" } } as never;

    await expect(writeBuildReviewCacheEntry("/feature", invalid, fs)).rejects.toThrow("judged result");
    expect(fs.writeCalls).toEqual([]);
  });

  it("reuses only an exact semantic match and rematerializes it for the current lap", () => {
    const cached = {
      ...entry(),
      result: {
        ...entry().result,
        findings: [{
          concernKind: "out-of-plan-change",
          summary: "src/a.ts is outside the approved plan.",
          evidenceLocations: ["src/a.ts:1"],
          anchor: { rubric: "scope" as const, path: "src/a.ts", relation: "not-authorized-by-plan" },
        }],
        verdict: "FAIL" as const,
      },
    };
    const request = {
      rubric: "scope" as const,
      contractVersion: "v3" as const,
      projectionVersion: "v2" as const,
      projectionDigest: "sha256:projection-a",
      policyFingerprint: "sha256:policy-a",
      lapId: "lap-current" as never,
      snapshotDigest: "snapshot-current",
    };

    expect({
      hit: classifyBuildReviewCacheLookup(cached, request),
      pass: classifyBuildReviewCacheLookup(entry(), request),
      changedPolicy: classifyBuildReviewCacheLookup(cached, { ...request, policyFingerprint: "sha256:other" }),
      changedProjection: classifyBuildReviewCacheLookup(cached, { ...request, projectionDigest: "sha256:other" }),
    }).toEqual({
      hit: {
        kind: "hit",
        hit: {
          result: {
            ...cached.result,
            lapId: "lap-current",
            snapshotDigest: "snapshot-current",
          },
          provenance: {
            kind: "cache-hit",
            cachedLapId: "lap-a",
            cachedSnapshotDigest: "snapshot-a",
            projectionDigest: "sha256:projection-a",
            policyFingerprint: "sha256:policy-a",
          },
        },
      },
      pass: {
        kind: "hit",
        hit: {
          result: { ...entry().result, lapId: "lap-current", snapshotDigest: "snapshot-current" },
          provenance: {
            kind: "cache-hit",
            cachedLapId: "lap-a",
            cachedSnapshotDigest: "snapshot-a",
            projectionDigest: "sha256:projection-a",
            policyFingerprint: "sha256:policy-a",
          },
        },
      },
      changedPolicy: { kind: "miss", reason: "policy-fingerprint-mismatch" },
      changedProjection: { kind: "miss", reason: "projection-digest-mismatch" },
    });
  });

  it("keeps a pre-change cache entry reusable when only lap provenance changes", async () => {
    const policy = { enabled: true, llm_provider: "claude" as const, model: "sonnet", effort: "medium" as const, model_fallback_ladder: ["sonnet"], max_retries: 1, escalate: false };
    const config = { enabled: true, perTaskFloor: true, scopeContainmentEnforced: false, maxParallel: 5, rubrics: { tautology: policy, scope: policy, rootCause: policy, completeness: policy } } as never;
    const frozenInputs = {
      diff: "diff --git a/src/a.ts b/src/a.ts", planBody: "# Plan\n", mergeBase: "base", baseRef: "origin/main", baseKind: "remote", trackingRefSha: "base", remoteHeadSha: "base", fresh: true,
      repairContext: [], acceptedWidenings: [], removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] }, testSuiteProof: { provenanceHeadSha: "head", outcome: "PASS" },
      sourceSnapshot: { digest: "sha256:snapshot-current", contentDigest: "sha256:content", baseRef: "origin/main", mergeBase: "base", headSha: "head", diff: "diff --git a/src/a.ts b/src/a.ts", planBody: "# Plan\n", repairContext: [], acceptedWidenings: [], removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] } },
    } as never;
    const oldLap = parseBuildReviewLapId("lap-before")!;
    const currentLap = parseBuildReviewLapId("lap-current")!;
    const oldProjection = deriveBuildReviewRubricProjections({ lapId: oldLap, inputs: frozenInputs, tautology: { changedTestSelectors: [], revertedProductionManifest: [], preflightEvidence: { classification: "not-requested" } } }).scope;
    const currentProjection = deriveBuildReviewRubricProjections({ lapId: currentLap, inputs: frozenInputs, tautology: { changedTestSelectors: [], revertedProductionManifest: [], preflightEvidence: { classification: "not-requested" } } }).scope;
    const dispatchModel = vi.fn(async (branch, projection) => ({ kind: "judged" as const, rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest, contractVersion: "v3" as never, findings: [], verdict: "PASS" as const }));

    const coordination = await coordinateBuildReviewRubrics({
      config, inputs: frozenInputs, lapId: currentLap, preflight: async () => ({ classification: "approved-exception" as const, exception: "empty-test-set" as const, cacheable: true as const, cacheProvenance: "miss" as const, changedPaths: [], changedTestSelectors: [], revertedProductionManifest: [], sourceIdentities: { mergeBase: "base", headSha: "head" } }),
      readCache: async (branch, projection, policyFingerprint) => branch.rubric === "scope" ? { ...entry(), projectionDigest: projection.digest, policyFingerprint, result: { ...entry().result, lapId: oldLap, snapshotDigest: oldProjection.snapshotDigest } } : undefined,
      dispatchModel, writeArtifact: async (artifact) => ({ version: 1 as const, ...artifact }), writeCache: async () => undefined,
    });

    expect(oldProjection.digest).toBe(currentProjection.digest);
    expect(dispatchModel.mock.calls.map(([branch]) => branch.rubric)).not.toContain("scope");
    expect(coordination.kind === "ready" ? coordination.branches.find((branch) => branch.rubric === "scope") : undefined)
      .toMatchObject({ kind: "cache-hit", result: { lapId: "lap-current", snapshotDigest: "sha256:snapshot-current" } });
  });

  it("classifies every unsafe cache identity and non-judged outcome as a conservative miss", () => {
    const request = {
      rubric: "scope" as const,
      contractVersion: "v3" as const,
      projectionVersion: "v2" as const,
      projectionDigest: "sha256:projection-a",
      policyFingerprint: "sha256:policy-a",
      lapId: "lap-current" as never,
      snapshotDigest: "snapshot-current",
    };
    const unsafeInfrastructure = {
      ...entry(),
      result: { kind: "infrastructure-failure", rubric: "scope", reason: "retry-exhausted", detail: "provider exhausted" },
    } as never;

    expect([
      classifyBuildReviewCacheLookup(undefined, request),
      classifyBuildReviewCacheLookup({ ...entry(), rubric: "completeness" }, request),
      classifyBuildReviewCacheLookup({ ...entry(), contractVersion: "v1", result: { ...entry().result, contractVersion: "v1" } } as never, request),
      classifyBuildReviewCacheLookup({ ...entry(), projectionVersion: "v1" } as never, request),
      classifyBuildReviewCacheLookup({ ...entry(), projectionDigest: "sha256:changed-input" }, request),
      classifyBuildReviewCacheLookup({ ...entry(), policyFingerprint: "sha256:changed-provider-model-effort-fallback-retry" }, request),
      classifyBuildReviewCacheLookup(unsafeInfrastructure, request),
    ]).toEqual([
      { kind: "miss", reason: "missing" },
      { kind: "miss", reason: "invalid-entry" },
      { kind: "miss", reason: "contract-version-mismatch" },
      { kind: "miss", reason: "projection-version-mismatch" },
      { kind: "miss", reason: "projection-digest-mismatch" },
      { kind: "miss", reason: "policy-fingerprint-mismatch" },
      { kind: "miss", reason: "invalid-entry" },
    ]);
  });
});
