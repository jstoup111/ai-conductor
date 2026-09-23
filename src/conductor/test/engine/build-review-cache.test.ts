import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  cacheEntryPath,
  classifyBuildReviewCacheLookup,
  parseBuildReviewCacheEntry,
  readBuildReviewCacheEntry,
  tryWriteBuildReviewCacheEntry,
  writeBuildReviewCacheEntry,
  type BuildReviewCacheEntry,
  type BuildReviewCacheFilesystem,
  type BuildReviewCacheSemanticIdentity,
} from "../../src/engine/build-review-cache.js";
import { engineContentStamp } from "../../src/engine/engine-version-id.js";
import { coordinateBuildReviewRubrics } from "../../src/engine/build-review-coordinator.js";
import { getBuildReviewRubricDescriptor } from "../../src/engine/build-review-registry.js";
import { parseBuildReviewLapId } from "../../src/engine/build-review-domain.js";
import { stampBuildReviewCustomJudgedResult } from "../../src/engine/build-review-finding-identity.js";
import type { BuildReviewFrozenInputs } from "../../src/engine/build-review-inputs.js";
import { deriveBuildReviewRubricProjections } from "../../src/engine/build-review-projections.js";
import { fingerprintBuildReviewPolicyDeclaration } from "../../src/engine/build-review-policy.js";

function entry(snapshotDigest = "snapshot-a"): BuildReviewCacheEntry {
  return {
    version: 2,
    rubric: "testQuality",
    contractVersion: "v3",
    projectionVersion: "v3",
    projectionDigest: "sha256:projection-a",
    policyFingerprint: "sha256:policy-a",
    engineIdentity: { engineStamp: "8e7daae72ad7", skillDigest: "sha256:skill-a" },
    semanticIdentity: candidateIdentity(),
    result: {
      kind: "judged",
      rubric: "testQuality",
      lapId: "lap-a" as never,
      snapshotDigest,
      contractVersion: "v3" as never,
      findings: [],
      verdict: "PASS",
    },
  };
}

function securityEntry(overrides: Partial<BuildReviewCacheEntry> = {}): BuildReviewCacheEntry {
  return {
    ...entry(),
    rubric: "security",
    result: {
      kind: "judged",
      rubric: "security",
      lapId: "lap-a" as never,
      snapshotDigest: "snapshot-a",
      contractVersion: "v3",
      findings: [],
      verdict: "PASS",
    },
    ...overrides,
  } as BuildReviewCacheEntry;
}

function candidateIdentity(overrides: Partial<BuildReviewCacheSemanticIdentity> = {}): BuildReviewCacheSemanticIdentity {
  return {
    declarationFingerprint: "sha256:declaration-a",
    effectiveBundleDigest: "sha256:bundle-a",
    contractVersion: "v3",
    projectionVersion: "v3",
    semanticInputDigest: "sha256:input-a",
    executionPolicyFingerprint: "sha256:execution-a",
    engineStamp: "8e7daae72ad7",
    provider: "claude",
    model: "sonnet",
    effort: "medium",
    ...overrides,
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
    readdir: vi.fn(async (directory: string) => Object.keys(files)
      .filter((path) => path.startsWith(`${directory}/`))
      .map((path) => path.slice(directory.length + 1))
      .filter((name) => !name.includes('/'))),
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
  it("uses every semantic policy component while keeping producing provenance incidental", () => {
    const declaration = {
      rubric: "kotlin-review",
      skill: "acme:kotlin-review",
      question: "Does this change preserve Kotlin nullability?",
      source: "plugin" as const,
      resources: ["references/nullability.md", "references/style.md"],
    };
    const semanticIdentity = {
      declarationFingerprint: fingerprintBuildReviewPolicyDeclaration(declaration),
      effectiveBundleDigest: "sha256:bundle-a",
      contractVersion: "v3" as const,
      projectionVersion: "v3" as const,
      semanticInputDigest: "sha256:input-a",
      executionPolicyFingerprint: "sha256:execution-a",
      engineStamp: "8e7daae72ad7",
      provider: "codex",
      model: "gpt-5.6",
      effort: "high",
    };
    const cached = { ...entry(), semanticIdentity };
    const lookup = {
      rubric: "testQuality" as const,
      contractVersion: "v3" as const,
      projectionVersion: "v3" as const,
      projectionDigest: "sha256:projection-a",
      policyFingerprint: "sha256:policy-a",
      engineIdentity: { engineStamp: "8e7daae72ad7", skillDigest: "sha256:skill-a" },
      semanticIdentity,
      // These are current-use fields, never semantic eligibility fields.
      lapId: "lap-current-after-rebase" as never,
      snapshotDigest: "snapshot-current-after-rebase",
    };

    const changedDeclaration = {
      ...semanticIdentity,
      declarationFingerprint: fingerprintBuildReviewPolicyDeclaration({
        ...declaration,
        resources: ["references/nullability.md", "references/concurrency.md"],
      }),
    };
    const mutations = [
      ["rubric", { ...semanticIdentity, declarationFingerprint: fingerprintBuildReviewPolicyDeclaration({ ...declaration, rubric: "java-review" }) }, "declaration-fingerprint-mismatch"],
      ["skill", { ...semanticIdentity, declarationFingerprint: fingerprintBuildReviewPolicyDeclaration({ ...declaration, skill: "acme:java-review" }) }, "declaration-fingerprint-mismatch"],
      ["question", { ...semanticIdentity, declarationFingerprint: fingerprintBuildReviewPolicyDeclaration({ ...declaration, question: "Does this change preserve Kotlin concurrency?" }) }, "declaration-fingerprint-mismatch"],
      ["source", { ...semanticIdentity, declarationFingerprint: fingerprintBuildReviewPolicyDeclaration({ ...declaration, source: "global" }) }, "declaration-fingerprint-mismatch"],
      ["resources", changedDeclaration, "declaration-fingerprint-mismatch"],
      ["definition bytes", { ...semanticIdentity, effectiveBundleDigest: "sha256:bundle-definition-edited" }, "effective-bundle-digest-mismatch"],
      ["support bytes", { ...semanticIdentity, effectiveBundleDigest: "sha256:bundle-support-edited" }, "effective-bundle-digest-mismatch"],
      ["contract", { ...semanticIdentity, contractVersion: "v2" }, "contract-version-mismatch"],
      ["projection", { ...semanticIdentity, projectionVersion: "v2" }, "projection-version-mismatch"],
      ["input", { ...semanticIdentity, semanticInputDigest: "sha256:input-b" }, "semantic-input-digest-mismatch"],
      ["execution", { ...semanticIdentity, executionPolicyFingerprint: "sha256:execution-b" }, "execution-policy-fingerprint-mismatch"],
      ["engine", { ...semanticIdentity, engineStamp: "aaaaaaaaaaaa" }, "engine-content-stamp-mismatch"],
      ["provider", { ...semanticIdentity, provider: "claude" }, "provider-mismatch"],
      ["model", { ...semanticIdentity, model: "gpt-5.7" }, "model-mismatch"],
      ["effort", { ...semanticIdentity, effort: "medium" }, "effort-mismatch"],
    ] as const;

    expect(classifyBuildReviewCacheLookup(cached, lookup)).toMatchObject({
      kind: "hit",
      hit: {
        result: { lapId: "lap-current-after-rebase", snapshotDigest: "snapshot-current-after-rebase" },
        provenance: { cachedLapId: "lap-a", cachedSnapshotDigest: "snapshot-a" },
      },
    });
    expect(mutations.map(([, semanticIdentity, reason]) => [
      reason,
      classifyBuildReviewCacheLookup(cached, { ...lookup, semanticIdentity }),
    ])).toEqual(mutations.map(([, , reason]) => [reason, { kind: "miss", reason }]));
  });

  it("rejects v2 entries at the current public parse boundary", () => {
    expect(parseBuildReviewCacheEntry({ ...entry(), projectionVersion: "v2" })).toBeUndefined();
  });

  it("preserves the v3 cache contract boundary by rejecting a future v4 contract version", () => {
    expect(parseBuildReviewCacheEntry({ ...entry(), contractVersion: "v4" })).toBeUndefined();
  });

  it("persists the custom descriptor's v1/v1 cache pair without widening the v3 boundary", async () => {
    const descriptor = {
      version: "v1" as const,
      semanticSkill: "portable-policy",
      declaration: {
        version: "v1" as const, rubricId: "portablePolicy", semanticSkill: "portable-policy",
        question: "Check the frozen input.", resources: [],
      },
      installation: { source: "project" as const },
      effectivePolicy: { version: "v1" as const, bundleDigest: `sha256:${"a".repeat(64)}` },
      reviewedInput: { version: "v1" as const, contentDigest: `sha256:${"b".repeat(64)}` },
      producer: { provider: "codex", model: "gpt-5.6-sol", effort: "medium" },
    };
    const result = stampBuildReviewCustomJudgedResult(
      { kind: "custom-findings", version: "v1", findings: [] },
      {
        rubric: descriptor.declaration.rubricId, lapId: "lap-a",
        declaration: descriptor.declaration, policy: descriptor.effectivePolicy,
        candidate: descriptor.producer, reviewedInput: descriptor.reviewedInput,
      },
      { sourceRegions: [] },
    )!;
    const customEntry: BuildReviewCacheEntry = {
      ...entry(), rubric: descriptor.declaration.rubricId,
      contractVersion: "v1", projectionVersion: "v1",
      semanticIdentity: candidateIdentity({ contractVersion: "v1", projectionVersion: "v1" }),
      result: { descriptor, result },
    };
    const fs = memoryFilesystem();

    await expect(tryWriteBuildReviewCacheEntry("/feature", customEntry, fs)).resolves.toEqual({ ok: true });
    await expect(readBuildReviewCacheEntry("/feature", customEntry.rubric, fs, customEntry.semanticIdentity))
      .resolves.toMatchObject({ contractVersion: "v1", projectionVersion: "v1" });
    expect(parseBuildReviewCacheEntry({ ...customEntry, contractVersion: "v4" })).toBeUndefined();
  });

  it("parses legacy projection candidates through the read seam, then misses against the current v3 identity", async () => {
    const currentProjectionDigest = "sha256:digest-that-includes-evidence-content-hash";
    const currentLookup = {
      rubric: "testQuality",
      contractVersion: "v3",
      projectionVersion: "v3",
      projectionDigest: "sha256:projection-a",
      policyFingerprint: "sha256:policy-a",
      engineIdentity: { engineStamp: "8e7daae72ad7", skillDigest: "sha256:skill-a" },
      lapId: "lap-current",
      snapshotDigest: "snapshot-current",
    } as never;
    const root = "/feature";
    const path = cacheEntryPath(root, "testQuality");
    const fs = memoryFilesystem({
      [path]: JSON.stringify({
        ...entry(),
        projectionVersion: "v2",
      }),
    });

    expect([
      classifyBuildReviewCacheLookup(await readBuildReviewCacheEntry(root, "testQuality", fs), currentLookup),
      classifyBuildReviewCacheLookup({ ...entry(), projectionVersion: "v3", projectionDigest: "sha256:changed-input" }, currentLookup),
    ]).toEqual([
      { kind: "miss", reason: "projection-version-mismatch" },
      { kind: "miss", reason: "projection-digest-mismatch" },
    ]);
  });

  it("misses a pre-reference v3 entry closed without advancing the projection version", async () => {
    const root = "/feature";
    const path = cacheEntryPath(root, "testQuality");
    const oldEngineEntry = {
      ...entry(),
      // The former projection embedded this region's bytes in its digest input.
      projectionDigest: "sha256:digest-that-included-evidence-content",
    };
    const currentProjectionDigest = "sha256:digest-that-includes-evidence-content-hash";
    const currentLookup = {
      rubric: "testQuality",
      contractVersion: "v3",
      projectionVersion: "v3",
      // The reference-only projection instead digests its pinned contentHash.
      projectionDigest: currentProjectionDigest,
      policyFingerprint: oldEngineEntry.policyFingerprint,
      engineIdentity: oldEngineEntry.engineIdentity,
      lapId: "lap-current",
      snapshotDigest: "snapshot-current",
    } as never;
    const fs = memoryFilesystem({ [path]: JSON.stringify(oldEngineEntry) });

    await writeBuildReviewCacheEntry(root, entry("snapshot-current"), fs);
    const written = JSON.parse(fs.files[path]!);

    expect([
      classifyBuildReviewCacheLookup(await readBuildReviewCacheEntry(root, "testQuality", memoryFilesystem({ [path]: JSON.stringify(oldEngineEntry) })), currentLookup),
      classifyBuildReviewCacheLookup({ ...oldEngineEntry, projectionDigest: currentProjectionDigest, engineIdentity: { ...oldEngineEntry.engineIdentity, engineStamp: "aaaaaaaaaaaa" } }, currentLookup),
      written.projectionVersion,
      parseBuildReviewCacheEntry({ ...entry(), projectionVersion: "v4" }),
    ]).toEqual([
      { kind: "miss", reason: "projection-digest-mismatch" },
      { kind: "miss", reason: "engine-version-mismatch", cachedEngineStamp: "aaaaaaaaaaaa" },
      "v3",
      undefined,
    ]);
  });

  it("stores one versioned semantic judgement per feature-scoped rubric with atomic replacement", async () => {
    const fs = memoryFilesystem();
    const root = "/feature";
    const initial = entry();
    const replacement = entry("snapshot-b");
    const path = cacheEntryPath(root, "testQuality", initial.semanticIdentity);

    await writeBuildReviewCacheEntry(root, initial, fs);
    await writeBuildReviewCacheEntry(root, replacement, fs);

    expect({
      path,
      entry: await readBuildReviewCacheEntry(root, "testQuality", fs, initial.semanticIdentity),
      renameCalls: fs.renameCalls,
      files: Object.keys(fs.files),
    }).toEqual({
      path,
      entry: replacement,
      renameCalls: [
        [`${path}.tmp`, path],
        [`${path}.tmp`, path],
      ],
      files: [path],
    });
  });

  it("partitions complete preferred and fallback candidates without publishing incomplete writes", async () => {
    const root = "/feature";
    const preferredIdentity = candidateIdentity();
    const fallbackIdentity = candidateIdentity({
      effectiveBundleDigest: "sha256:bundle-fallback",
      provider: "codex",
      model: "gpt-5.6",
      effort: "high",
    });
    const preferred = { ...entry("snapshot-preferred"), semanticIdentity: preferredIdentity };
    const fallback = { ...entry("snapshot-fallback"), semanticIdentity: fallbackIdentity };
    const fs = memoryFilesystem();
    await writeBuildReviewCacheEntry(root, preferred, fs);
    await writeBuildReviewCacheEntry(root, fallback, fs);

    expect(cacheEntryPath(root, "testQuality", preferredIdentity)).not.toEqual(
      cacheEntryPath(root, "testQuality", fallbackIdentity),
    );
    await expect(readBuildReviewCacheEntry(root, "testQuality", fs, preferredIdentity)).resolves.toEqual(preferred);
    await expect(readBuildReviewCacheEntry(root, "testQuality", fs, fallbackIdentity)).resolves.toEqual(fallback);

    const interruptedFs = memoryFilesystem({ ...fs.files });
    interruptedFs.writeFile = vi.fn(async () => { throw new Error("interrupted"); });
    await expect(writeBuildReviewCacheEntry(root, {
      ...fallback,
      result: { ...fallback.result, snapshotDigest: "snapshot-fallback-retry" },
    }, interruptedFs)).rejects.toThrow("interrupted");
    await expect(readBuildReviewCacheEntry(root, "testQuality", interruptedFs, preferredIdentity)).resolves.toEqual(preferred);
    await expect(readBuildReviewCacheEntry(root, "testQuality", interruptedFs, fallbackIdentity)).resolves.toEqual(fallback);

    const incompleteFs = memoryFilesystem();
    const { semanticIdentity: _missingIdentity, ...incomplete } = entry();
    await expect(writeBuildReviewCacheEntry(root, incomplete, incompleteFs)).rejects.toThrow(
      "effective candidate identity",
    );
    expect(incompleteFs.writeCalls).toEqual([]);
    expect(incompleteFs.renameCalls).toEqual([]);
  });

  it("isolates a foreign feature entry by content digest before atomically replacing it", async () => {
    const featureBRoot = "/features/b";
    const foreignEntry = { ...entry("snapshot-feature-a"), projectionDigest: "sha256:feature-a-content" };
    const freshEntry = { ...entry("snapshot-feature-b"), projectionDigest: "sha256:feature-b-content" };
    // `BuildReviewCacheEntry` can also carry a custom artifact member, whose
    // reviewed-input identity is nested. This fixture deliberately exercises
    // the built-in cache contract, where the snapshot belongs to the result.
    if ('result' in freshEntry.result) throw new Error('expected a built-in cache result');
    const legacyPath = cacheEntryPath(featureBRoot, "testQuality");
    const path = cacheEntryPath(featureBRoot, "testQuality", freshEntry.semanticIdentity);
    const fs = memoryFilesystem({ [legacyPath]: JSON.stringify(foreignEntry) });

    const foreignCandidate = await readBuildReviewCacheEntry(featureBRoot, "testQuality", fs);
    await writeBuildReviewCacheEntry(featureBRoot, freshEntry, fs);

    expect({
      path,
      lookup: classifyBuildReviewCacheLookup(foreignCandidate, {
        rubric: "testQuality",
        contractVersion: "v3",
        projectionVersion: "v3",
        projectionDigest: freshEntry.projectionDigest,
        policyFingerprint: freshEntry.policyFingerprint,
        engineIdentity: freshEntry.engineIdentity,
        lapId: "lap-feature-b",
        snapshotDigest: freshEntry.result.snapshotDigest,
      } as never),
      storedEntry: await readBuildReviewCacheEntry(featureBRoot, "testQuality", fs, freshEntry.semanticIdentity),
      renameCalls: fs.renameCalls,
    }).toEqual({
      path,
      lookup: { kind: "miss", reason: "projection-digest-mismatch" },
      storedEntry: freshEntry,
      renameCalls: [[`${path}.tmp`, path]],
    });
  });

  it("treats a missing entry as a non-mutating miss and preserves malformed evidence as invalid", async () => {
    const root = "/feature";
    const path = cacheEntryPath(root, "testQuality");
    const fs = memoryFilesystem({ [path]: JSON.stringify({ version: 2, result: entry().result }) });

    expect(classifyBuildReviewCacheLookup(await readBuildReviewCacheEntry(root, "testQuality", fs), {
      rubric: "testQuality", contractVersion: "v3", projectionVersion: "v3", projectionDigest: "sha256:projection-a",
      policyFingerprint: "sha256:policy-a", engineIdentity: entry().engineIdentity, lapId: "lap-current" as never, snapshotDigest: "snapshot-current",
    })).toEqual({ kind: "miss", reason: "invalid-entry" });
    expect(fs.writeCalls).toEqual([]);
    expect(fs.renameCalls).toEqual([]);
    await expect(readBuildReviewCacheEntry(root, "security", fs)).resolves.toBeUndefined();
  });

  it("reads a prior candidate partition so engine and bundle changes remain classifiable", async () => {
    const root = "/feature";
    const currentIdentity = candidateIdentity({ engineStamp: "bbbbbbbbbbbb", effectiveBundleDigest: "sha256:bundle-current" });
    const priorIdentity = candidateIdentity({ engineStamp: "aaaaaaaaaaaa", effectiveBundleDigest: "sha256:bundle-prior" });
    const prior = {
      ...entry(),
      engineIdentity: { engineStamp: "aaaaaaaaaaaa", skillDigest: "sha256:bundle-prior" },
      semanticIdentity: priorIdentity,
    };
    const fs = memoryFilesystem({ [cacheEntryPath(root, "testQuality", priorIdentity)]: JSON.stringify(prior) });
    const lookup = {
      rubric: "testQuality" as const, contractVersion: "v3" as const, projectionVersion: "v3" as const,
      projectionDigest: prior.projectionDigest, policyFingerprint: prior.policyFingerprint,
      engineIdentity: { engineStamp: "bbbbbbbbbbbb", skillDigest: "sha256:bundle-current" },
      semanticIdentity: currentIdentity, lapId: "lap-current" as never, snapshotDigest: "snapshot-current",
    };

    expect(classifyBuildReviewCacheLookup(await readBuildReviewCacheEntry(root, "testQuality", fs, currentIdentity), lookup))
      .toEqual({ kind: "miss", reason: "engine-version-mismatch", cachedEngineStamp: "aaaaaaaaaaaa" });

    const sameEngine = { ...lookup, engineIdentity: { engineStamp: "aaaaaaaaaaaa", skillDigest: "sha256:bundle-current" }, semanticIdentity: { ...currentIdentity, engineStamp: "aaaaaaaaaaaa" } };
    expect(classifyBuildReviewCacheLookup(await readBuildReviewCacheEntry(root, "testQuality", fs, sameEngine.semanticIdentity), sameEngine))
      .toEqual({ kind: "miss", reason: "skill-digest-mismatch", cachedEngineStamp: "aaaaaaaaaaaa" });
  });

  it("refuses to persist skips and infrastructure failures as reusable cache state", async () => {
    const fs = memoryFilesystem();
    const invalid = { ...entry(), result: { kind: "skipped", rubric: "testQuality", reason: "disabled" } } as never;

    await expect(writeBuildReviewCacheEntry("/feature", invalid, fs)).rejects.toThrow("judged result");
    expect(fs.writeCalls).toEqual([]);
  });

  it("reuses only an exact semantic match and rematerializes it for the current lap", () => {
    const cached = {
      ...entry(),
      result: {
        ...entry().result,
        findings: [{
          concernKind: "test-insensitive",
          summary: "The changed test does not observe the behavior it should.",
          evidenceLocations: ["src/a.ts:1"],
          anchor: { rubric: "testQuality" as const, locus: { path: "test/a.test.ts", contentHash: "sha256:fixture", display: "fixture test" } },
        }],
        verdict: "FAIL" as const,
      },
    };
    const request = {
      rubric: "testQuality" as const,
      contractVersion: "v3" as const,
      projectionVersion: "v3" as const,
      projectionDigest: "sha256:projection-a",
      policyFingerprint: "sha256:policy-a",
      engineIdentity: { engineStamp: "8e7daae72ad7", skillDigest: "sha256:skill-a" },
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
    const config = { enabled: true, scopeContainmentEnforced: false, maxParallel: 5, rubrics: { testQuality: policy } } as never;
    const frozenInputs = {
      diff: "diff --git a/src/a.ts b/src/a.ts", planBody: "# Plan\n", mergeBase: "base", baseRef: "origin/main", baseKind: "remote", trackingRefSha: "base", remoteHeadSha: "base", fresh: true,
      repairContext: [], acceptedWidenings: [], removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] }, testSuiteProof: { provenanceHeadSha: "head", outcome: "PASS" },
      sourceSnapshot: { digest: "sha256:snapshot-current", contentDigest: "sha256:content", baseRef: "origin/main", mergeBase: "base", headSha: "head", diff: "diff --git a/src/a.ts b/src/a.ts", planBody: "# Plan\n", repairContext: [], acceptedWidenings: [], removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] }, testQuality: { inScopeTests: ["test/a.test.ts"], unresolvedMarkers: [] } },
    } as never;
    const oldLap = parseBuildReviewLapId("lap-before")!;
    const currentLap = parseBuildReviewLapId("lap-current")!;
    const testQuality = { changedTestSelectors: [], revertedProductionManifest: [], preflight: { classification: "not-requested" } } as never;
    const oldProjection = deriveBuildReviewRubricProjections({ lapId: oldLap, inputs: frozenInputs, testQuality }).testQuality;
    const currentProjection = deriveBuildReviewRubricProjections({ lapId: currentLap, inputs: frozenInputs, testQuality }).testQuality;
    const dispatchModel = vi.fn(async (branch, projection) => ({ kind: "judged" as const, rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest, contractVersion: "v3" as never, findings: [], verdict: "PASS" as const }));

    const coordination = await coordinateBuildReviewRubrics({
      config, inputs: frozenInputs, lapId: currentLap, preflight: async () => ({ classification: "approved-exception" as const, exception: "empty-test-set" as const, cacheable: true as const, cacheProvenance: "miss" as const, changedPaths: [], changedTestSelectors: [], revertedProductionManifest: [], sourceIdentities: { mergeBase: "base", headSha: "head" } }),
      engineIdentity: { engineStamp: "8e7daae72ad7", skillDigests: { testQuality: { kind: "resolved" as const, digest: "sha256:skill-a" } } },
      readCache: async (_branch, projection, policyFingerprint, semanticIdentity) => ({
        ...entry(),
        projectionDigest: projection.digest,
        policyFingerprint,
        semanticIdentity,
        result: { ...entry().result, lapId: oldLap, snapshotDigest: oldProjection.snapshotDigest },
      }),
      dispatchModel, writeArtifact: async (artifact) => ({ version: 1 as const, ...artifact }), writeCache: async () => undefined,
    });

    expect(oldProjection.digest).toBe(currentProjection.digest);
    expect(dispatchModel).not.toHaveBeenCalled();
    expect(coordination.kind === "ready" ? coordination.branches.find((branch) => branch.rubric === "testQuality") : undefined)
      .toMatchObject({ kind: "cache-hit", result: { lapId: "lap-current", snapshotDigest: "sha256:snapshot-current" } });
  });

  it("keeps a security projection digest stable when identical hunk content is rebased", () => {
    const frozenInputs = {
      diff: "diff --git a/src/auth.ts b/src/auth.ts\n@@ -1 +1 @@\n-const enabled = false;\n+const enabled = true;\n",
      planBody: "# Plan\n", mergeBase: "base", baseRef: "origin/main", baseKind: "remote", trackingRefSha: "base", remoteHeadSha: "base", fresh: true,
      repairContext: [], acceptedWidenings: [], removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] }, testSuiteProof: { provenanceHeadSha: "head", outcome: "PASS" },
      sourceSnapshot: { digest: "sha256:snapshot", contentDigest: "sha256:content", baseRef: "origin/main", mergeBase: "base", headSha: "head-before", diff: "diff --git a/src/auth.ts b/src/auth.ts\n@@ -1 +1 @@\n-const enabled = false;\n+const enabled = true;\n", planBody: "# Plan\n", repairContext: [], acceptedWidenings: [], removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] }, testQuality: { inScopeTests: [], unresolvedMarkers: [] } },
    } as unknown as BuildReviewFrozenInputs;
    const projectionSource = {
      inputs: frozenInputs,
      testQuality: { changedTestSelectors: [], revertedProductionManifest: [], preflight: { classification: "not-requested" } },
    } as unknown as Parameters<typeof deriveBuildReviewRubricProjections>[0];

    const before = deriveBuildReviewRubricProjections({ ...projectionSource, lapId: parseBuildReviewLapId("lap-before")! }).security;
    const after = deriveBuildReviewRubricProjections({
      ...projectionSource,
      lapId: parseBuildReviewLapId("lap-after")!,
      inputs: { ...frozenInputs, sourceSnapshot: { ...frozenInputs.sourceSnapshot, headSha: "head-after" } },
    }).security;

    expect(before.changedFiles).toEqual(after.changedFiles);
    expect(before.digest).toBe(after.digest);
  });

  it("requires matching security policy and skill identities before reuse", () => {
    const cached = securityEntry();
    const request = {
      rubric: "security" as const,
      contractVersion: "v3" as const,
      projectionVersion: "v3" as const,
      projectionDigest: cached.projectionDigest,
      policyFingerprint: cached.policyFingerprint,
      engineIdentity: cached.engineIdentity,
      lapId: "lap-current" as never,
      snapshotDigest: "snapshot-current",
    };

    expect([
      classifyBuildReviewCacheLookup(cached, request).kind,
      classifyBuildReviewCacheLookup(cached, { ...request, policyFingerprint: "sha256:model-changed" }),
      classifyBuildReviewCacheLookup(cached, { ...request, engineIdentity: { ...request.engineIdentity, skillDigest: "sha256:skill-edited" } }),
    ]).toEqual([
      "hit",
      { kind: "miss", reason: "policy-fingerprint-mismatch" },
      { kind: "miss", reason: "skill-digest-mismatch", cachedEngineStamp: "8e7daae72ad7" },
    ]);
  });

  it("classifies every unsafe cache identity and non-judged outcome as a conservative miss", () => {
    const request = {
      rubric: "testQuality" as const,
      contractVersion: "v3" as const,
      projectionVersion: "v3" as const,
      projectionDigest: "sha256:projection-a",
      policyFingerprint: "sha256:policy-a",
      engineIdentity: { engineStamp: "8e7daae72ad7", skillDigest: "sha256:skill-a" },
      lapId: "lap-current" as never,
      snapshotDigest: "snapshot-current",
    };
    const unsafeInfrastructure = {
      ...entry(),
      result: { kind: "infrastructure-failure", rubric: "testQuality", reason: "retry-exhausted", detail: "provider exhausted" },
    } as never;

    expect([
      classifyBuildReviewCacheLookup(undefined, request),
      classifyBuildReviewCacheLookup({ ...entry(), rubric: "scope" }, request),
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

  it("keeps legacy engine evidence and newer incomplete policy evidence as distinct lazy misses", () => {
    const current = entry();
    const lookup = {
      rubric: "testQuality" as const,
      contractVersion: "v3" as const,
      projectionVersion: "v3" as const,
      projectionDigest: current.projectionDigest,
      policyFingerprint: current.policyFingerprint,
      engineIdentity: current.engineIdentity,
      semanticIdentity: current.semanticIdentity,
      lapId: "lap-current" as never,
      snapshotDigest: "snapshot-current",
    };
    const { semanticIdentity: _missingIdentity, ...incompleteEvidence } = current;
    const { engineIdentity: _missingEngine, ...legacyWithoutEngine } = current;
    const legacyEvidence = { ...legacyWithoutEngine, version: 1 };

    expect([
      classifyBuildReviewCacheLookup(legacyEvidence, lookup),
      classifyBuildReviewCacheLookup(incompleteEvidence, lookup),
    ]).toEqual([
      { kind: "miss", reason: "engine-version-mismatch" },
      { kind: "miss", reason: "semantic-identity-missing" },
    ]);
  });
});

describe("engine identity in the cache key (adr-2026-08-21)", () => {
  const engineIdentity = { engineStamp: "8e7daae72ad7", skillDigest: "sha256:skill-a" };
  const identified = (): BuildReviewCacheEntry => ({ ...entry(), engineIdentity });
  const legacy = (): Record<string, unknown> => {
    const { engineIdentity: _dropped, ...rest } = entry();
    return { ...rest, version: 1 };
  };
  const request = {
    rubric: "testQuality" as const,
    contractVersion: "v3" as const,
      projectionVersion: "v3" as const,
    projectionDigest: "sha256:projection-a",
    policyFingerprint: "sha256:policy-a",
    engineIdentity,
    lapId: "lap-current" as never,
    snapshotDigest: "snapshot-current",
  };

  it("checks engineStamp then skillDigest after policy-fingerprint, and hits on a full match", () => {
    expect([
      classifyBuildReviewCacheLookup({ ...identified(), engineIdentity: { ...engineIdentity, engineStamp: "aaaaaaaaaaaa" } }, request),
      classifyBuildReviewCacheLookup({ ...identified(), engineIdentity: { ...engineIdentity, skillDigest: "sha256:skill-edited" } }, request),
      // Policy mismatch is checked before the engine identity (D1 ordering).
      classifyBuildReviewCacheLookup({ ...identified(), policyFingerprint: "sha256:other", engineIdentity: { ...engineIdentity, engineStamp: "aaaaaaaaaaaa" } }, request),
      classifyBuildReviewCacheLookup(identified(), request).kind,
    ]).toEqual([
      { kind: "miss", reason: "engine-version-mismatch", cachedEngineStamp: "aaaaaaaaaaaa" },
      { kind: "miss", reason: "skill-digest-mismatch", cachedEngineStamp: "8e7daae72ad7" },
      { kind: "miss", reason: "policy-fingerprint-mismatch" },
      "hit",
    ]);
  });

  it("misses when one byte of the resolved skill text changes its digest", () => {
    const skillText = "Judge changed tests.";
    const changedSkillText = "Judge changed testS.";
    const digest = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
    const cached = {
      ...identified(),
      engineIdentity: { ...engineIdentity, skillDigest: digest(skillText) },
    };
    const changedRequest = {
      ...request,
      engineIdentity: { ...engineIdentity, skillDigest: digest(changedSkillText) },
    };

    expect(skillText.length).toBe(changedSkillText.length);
    expect(classifyBuildReviewCacheLookup(cached, changedRequest)).toEqual({
      kind: "miss", reason: "skill-digest-mismatch", cachedEngineStamp: engineIdentity.engineStamp,
    });
  });

  it("classifies a legacy entry without engineIdentity as engine-version-mismatch, not invalid-entry (D4)", () => {
    expect(classifyBuildReviewCacheLookup(legacy(), request)).toEqual({
      kind: "miss",
      reason: "engine-version-mismatch",
    });
  });

  it("treats a malformed engineIdentity shape as invalid-entry (D4)", () => {
    expect([
      classifyBuildReviewCacheLookup({ ...legacy(), engineIdentity: { engineStamp: "8e7daae72ad7" } }, request),
      classifyBuildReviewCacheLookup({ ...legacy(), engineIdentity: "8e7daae72ad7" }, request),
    ]).toEqual([
      { kind: "miss", reason: "invalid-entry" },
      { kind: "miss", reason: "invalid-entry" },
    ]);
  });

  it("refuses to persist an entry without an engine identity", async () => {
    const fs = memoryFilesystem();
    await expect(writeBuildReviewCacheEntry("/feature", legacy() as never, fs)).rejects.toThrow();
    await writeBuildReviewCacheEntry("/feature", identified(), fs);
    expect(await readBuildReviewCacheEntry("/feature", "testQuality", fs, identified().semanticIdentity)).toEqual(identified());
  });
});

describe("engine identity injection into the coordinator (D5/D6)", () => {
  const policy = { enabled: true, llm_provider: "claude" as const, model: "sonnet", effort: "medium" as const, model_fallback_ladder: ["sonnet"], max_retries: 1, escalate: false };
  const config = { enabled: true, scopeContainmentEnforced: false, maxParallel: 5, rubrics: { testQuality: policy } } as never;
  const frozenInputs = {
    diff: "diff --git a/src/a.ts b/src/a.ts", planBody: "# Plan\n", mergeBase: "base", baseRef: "origin/main", baseKind: "remote", trackingRefSha: "base", remoteHeadSha: "base", fresh: true,
    repairContext: [], acceptedWidenings: [], removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] }, testSuiteProof: { provenanceHeadSha: "head", outcome: "PASS" },
    sourceSnapshot: { digest: "sha256:snapshot-current", contentDigest: "sha256:content", baseRef: "origin/main", mergeBase: "base", headSha: "head", diff: "diff --git a/src/a.ts b/src/a.ts", planBody: "# Plan\n", repairContext: [], acceptedWidenings: [], removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] }, testQuality: { inScopeTests: ["test/a.test.ts"], unresolvedMarkers: [] } },
  } as never;
  const preflight = async () => ({ classification: "approved-exception" as const, exception: "empty-test-set" as const, cacheable: true as const, cacheProvenance: "miss" as const, changedPaths: [], changedTestSelectors: [], revertedProductionManifest: [], sourceIdentities: { mergeBase: "base", headSha: "head" } });
  const lap = () => parseBuildReviewLapId("lap-current")!;
  const dispatch = vi.fn(async (branch: { rubric: string }, projection: { lapId: string; snapshotDigest: string }) => ({ kind: "judged" as const, rubric: branch.rubric, lapId: projection.lapId, snapshotDigest: projection.snapshotDigest, contractVersion: "v3" as never, findings: [], verdict: "PASS" as const }));

  it("fails the rubric closed (cache-read-failed naming the SKILL.md path) when the skill digest is unavailable", async () => {
    const readCache = vi.fn(async () => undefined);
    const writeCache = vi.fn(async () => undefined);
    const events: unknown[] = [];
    const coordination = await coordinateBuildReviewRubrics({
      config, inputs: frozenInputs, lapId: lap(), preflight,
      engineIdentity: { engineStamp: "dev", skillDigests: { testQuality: { kind: "unavailable", path: "skills/build-review-test-quality/SKILL.md" } } },
      readCache, dispatchModel: dispatch, writeArtifact: async (artifact: never) => ({ version: 1 as const, ...(artifact as object) }), writeCache,
      emit: async (event: unknown) => { events.push(event); },
    } as never);

    expect(readCache).not.toHaveBeenCalled();
    expect(writeCache).not.toHaveBeenCalled();
    expect(coordination.kind === "ready" ? coordination.branches[0] : undefined).toMatchObject({
      kind: "infrastructure-failure",
      reason: "cache-read-failed",
      detail: expect.stringContaining("skills/build-review-test-quality/SKILL.md"),
    });
  });

  it("keeps v3 descriptor versions when a pre-migration cache entry misses on engine identity", async () => {
    const cachedIdentity = { engineStamp: "aaaaaaaaaaaa", skillDigest: "sha256:skill-a" };
    const currentIdentity = { engineStamp: "bbbbbbbbbbbb", skillDigests: { testQuality: { kind: "resolved" as const, digest: "sha256:skill-a" } } };
    const fs = memoryFilesystem();
    const written: BuildReviewCacheEntry[] = [];
    const events: unknown[] = [];
    const coordination = await coordinateBuildReviewRubrics({
      config, inputs: frozenInputs, lapId: lap(), preflight,
      engineIdentity: currentIdentity,
      readCache: async (_branch: never, projection: { digest: string; snapshotDigest: string }, policyFingerprint: string) => ({
        ...entry(), projectionDigest: projection.digest, policyFingerprint, engineIdentity: cachedIdentity,
        result: { ...entry().result, lapId: "lap-old", snapshotDigest: projection.snapshotDigest },
      }),
      dispatchModel: dispatch,
      writeArtifact: async (artifact: never) => ({ version: 1 as const, ...(artifact as object) }),
      writeCache: async (cacheEntry: BuildReviewCacheEntry) => {
        written.push(cacheEntry);
        const persisted = await tryWriteBuildReviewCacheEntry('/feature', cacheEntry, fs);
        if (!persisted.ok) throw persisted.error;
      },
      emit: async (event: unknown) => { events.push(event); },
    } as never);

    expect(coordination.kind === "ready" ? coordination.branches[0] : undefined).toMatchObject({ kind: "dispatched" });
    expect(events).toContainEqual({
      type: "build_review_cache_discarded",
      rubric: "testQuality",
      lapId: "lap-current",
      reason: "engine-version-mismatch",
      cachedEngineStamp: "aaaaaaaaaaaa",
      currentEngineStamp: "bbbbbbbbbbbb",
    });
    const fresh = written[0]!;
    const descriptor = getBuildReviewRubricDescriptor('testQuality');
    expect(fresh).toMatchObject({
      contractVersion: descriptor.contractVersion,
      projectionVersion: descriptor.projectionVersion,
      engineIdentity: { engineStamp: "bbbbbbbbbbbb", skillDigest: "sha256:skill-a" },
    });
    await expect(readBuildReviewCacheEntry('/feature', 'testQuality', fs, fresh.semanticIdentity)).resolves.toMatchObject({
      contractVersion: 'v3', projectionVersion: 'v3',
    });
  });
});

describe("engineContentStamp (D2)", () => {
  it("takes the 12-hex content half of a published id and passes dev through", () => {
    expect([
      engineContentStamp("/store/dist-versions/20260831T111821Z-504e28ca8915"),
      engineContentStamp("/repo/src/conductor/dist"),
      engineContentStamp("/repo/src/engine"),
    ]).toEqual(["504e28ca8915", "dev", "dev"]);
  });
});
