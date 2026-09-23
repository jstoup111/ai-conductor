// Covers: task:7, task:15
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  classifyBuildReviewRubricBranches,
  buildReviewCandidateScopeResolutionContext,
  coordinateBuildReviewRubrics,
  describeBuildReviewDispatchedResultRejection,
  stampBuildReviewDispatchedCandidate,
  type BuildReviewCoordinationInput,
  validateBuildReviewDispatchedResult,
} from "../../src/engine/build-review-coordinator.js";
import { makeBuildReviewDispatchFailure } from '../../src/engine/build-review-domain.js';
import {
  deriveBuildReviewScopeIncompleteFault,
  mapBuildReviewCoordinatorFailureReason,
  parseBuildReviewInfrastructureFailure,
  parseBuildReviewLapId,
  type BuildReviewInfrastructureFailureReason,
} from "../../src/engine/build-review-domain.js";
import { fingerprintBuildReviewRubricPolicy } from "../../src/engine/build-review-registry.js";
import { canonicalJson, deriveBuildReviewRubricProjections, type BuildReviewProjectionJson, type BuildReviewRubricProjection } from "../../src/engine/build-review-projections.js";
import { canonicalizeBuildReviewFindingSet } from '../../src/engine/build-review-finding-identity.js';
import type { BuildReviewFrozenInputs } from "../../src/engine/build-review-inputs.js";
import type {
  ResolvedBuildReviewConfig,
  ResolvedBuildReviewRubricPolicy,
} from "../../src/engine/resolved-config.js";
import { EventPersister } from "../../src/engine/event-persister.js";
import { ConductorEventEmitter } from "../../src/ui/events.js";

const policy: ResolvedBuildReviewRubricPolicy = {
  enabled: true,
  max_projection_bytes: 1_048_576,
  llm_provider: "claude",
  model: "sonnet",
  effort: "medium",
  model_fallback_ladder: ["sonnet"],
  max_retries: 1,
  escalate: false,
  min_confidence: 0,
};

function config(testQualityEnabled: boolean, securityEnabled = false, maxProjectionBytes = policy.max_projection_bytes): ResolvedBuildReviewConfig {
  // The test-quality config key is introduced after the legacy resolved type.
  // The coordinator's registry, not that retired type, owns runnable membership.
  return {
    enabled: true,
    perTaskFloor: true,
    scopeContainmentEnforced: false,
    maxParallel: 1,
    rubrics: {
      testQuality: { ...policy, enabled: testQualityEnabled, max_projection_bytes: maxProjectionBytes },
      security: { ...policy, enabled: securityEnabled, effort: 'high' },
    },
  } as unknown as ResolvedBuildReviewConfig;
}

function configWithSecurityModel(model: string): ResolvedBuildReviewConfig {
  const resolved = config(false, true);
  return {
    ...resolved,
    rubrics: { ...resolved.rubrics, security: { ...policy, enabled: true, model, effort: "high" } },
  } as unknown as ResolvedBuildReviewConfig;
}

const disabledSecurityBranch = { kind: 'skipped', rubric: 'security', reason: 'disabled' } as const;

function projectionWithCanonicalByteLength(byteLength: number): BuildReviewCoordinationInput["projections"] {
  const lapId = parseBuildReviewLapId("lap-current")!;
  const projection = {
    rubric: "testQuality",
    contractVersion: "v3",
    projectionVersion: "v3",
    lapId,
    snapshotDigest: "sha256:snapshot",
    digest: "sha256:test-quality",
    padding: "",
  };
  const paddingLength = byteLength - Buffer.byteLength(canonicalJson(projection), "utf8");
  if (paddingLength < 0) throw new Error("requested projection size is below its fixed envelope");
  return { testQuality: { ...projection, padding: "x".repeat(paddingLength) } } as never;
}
function inputs(): BuildReviewFrozenInputs {
  const sourceContent = {
    diff: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -0,0 +1 @@\n+const command = request.input\ndiff --git a/test/a.test.ts b/test/a.test.ts",
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
      testQuality: { inScopeTests: ["test/a.test.ts"], counterfactualFileSelectors: ["test/a.test.ts"], unresolvedMarkers: [] },
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
  it('keeps setup-only provider exhaustion as infrastructure without accepting findings or retrying', async () => {
    const dispatchModel = vi.fn(async () => makeBuildReviewDispatchFailure('redacted setup diagnostic', {
      candidates: [{ provider: 'codex', reason: 'redacted', recoveryAction: 'recover' }],
    }));
    const input = coordinationInput(true, { dispatchModel });

    const result = await coordinateBuildReviewRubrics(input);

    expect(dispatchModel).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      kind: 'ready',
      branches: [{
        kind: 'infrastructure-failure',
        reason: 'invalid-structured-result',
        providerSetupExhaustion: { candidates: [{ provider: 'codex' }] },
      }, disabledSecurityBranch],
    });
    expect(testQualityBranch(result)).not.toHaveProperty('findings');
  });

  it('maps a native-schema-unsupported dispatch refusal to its closed infrastructure cause', async () => {
    const dispatchModel = vi.fn(async () => makeBuildReviewDispatchFailure(
      'candidate set [claude] lacks native output schema capability. Recovery action: update claude.',
      undefined,
      { cause: 'native-schema-unsupported' },
    ));
    const result = await coordinateBuildReviewRubrics(coordinationInput(true, { dispatchModel }));

    expect(dispatchModel).toHaveBeenCalledOnce();
    expect(testQualityBranch(result)).toMatchObject({
      kind: 'infrastructure-failure',
      reason: 'native-schema-unsupported',
      detail: expect.stringContaining('candidate set [claude]'),
    });
  });

  it('stamps Claude and Codex structured fixtures into byte-identical envelopes and finding identities', () => {
    const frozenInputs = titledInputs();
    const projection = deriveBuildReviewRubricProjections({
      lapId: parseBuildReviewLapId('lap-current')!,
      inputs: frozenInputs,
      testQuality: { changedTestSelectors: [IN_SCOPE_TEST], unresolvedMarkers: [], revertedProductionManifest: [], preflight: { classification: 'not-requested', excerpt: '' } },
    }).testQuality as BuildReviewRubricProjection;
    const finding = testQualityFinding();
    const claudeTerminalEnvelope = { structuredOutput: { findings: [finding] } };
    const codexTerminalItem = { findings: [{ anchor: finding.anchor, evidenceLocations: finding.evidenceLocations, summary: finding.summary, concernKind: finding.concernKind }] };
    const claudeStamped = stampBuildReviewDispatchedCandidate(claudeTerminalEnvelope.structuredOutput, 'testQuality', projection);
    const codexStamped = stampBuildReviewDispatchedCandidate(codexTerminalItem, 'testQuality', projection);
    const claudeResult = validateBuildReviewDispatchedResult(claudeStamped, 'testQuality', projection)!;
    const codexResult = validateBuildReviewDispatchedResult(codexStamped, 'testQuality', projection)!;

    expect(canonicalJson(claudeStamped as BuildReviewProjectionJson)).toBe(canonicalJson(codexStamped as BuildReviewProjectionJson));
    const claudeIds = canonicalizeBuildReviewFindingSet(claudeResult.findings.map((entry) => ({
      rubric: claudeResult.rubric, contractVersion: claudeResult.contractVersion, ...entry,
    })))?.map(({ id }) => id);
    const codexIds = canonicalizeBuildReviewFindingSet(codexResult.findings.map((entry) => ({
      rubric: codexResult.rubric, contractVersion: codexResult.contractVersion, ...entry,
    })))?.map(({ id }) => id);
    expect(claudeIds).toEqual(codexIds);
  });

  it.each([
    ['an unlisted content hash', () => ({
      findings: [{
        ...testQualityFinding(),
        anchor: {
          rubric: 'testQuality',
          locus: { path: IN_SCOPE_TEST, contentHash: `sha256:${'b'.repeat(64)}`, display: IN_SCOPE_TITLE },
        },
      }],
    }), 'findings[0].anchor.locus.contentHash'],
    ['an out-of-enum concern kind', () => ({
      findings: [{ ...testQualityFinding(), concernKind: 'invented-kind' }],
    }), 'findings[0].concernKind'],
    ['a duplicate finding identity', () => ({
      findings: [testQualityFinding(), testQualityFinding('Same identity, different wording.')],
    }), 'findings[1].identity'],
  ])('settles a dispatched result with %s absent as an invalid structured result', async (_caseName, resultFactory, field) => {
    const dispatchModel = vi.fn(async () => resultFactory());
    const writeArtifact = vi.fn(async (artifact) => ({ version: 1, ...artifact }));
    const writeCache = vi.fn(async () => undefined);

    const result = await coordinateBuildReviewRubrics(coordinationInput(true, {
      inputs: titledInputs(), dispatchModel, writeArtifact, writeCache,
    }));

    expect(dispatchModel).toHaveBeenCalledOnce();
    expect(testQualityBranch(result)).toMatchObject({
      kind: 'infrastructure-failure', rubric: 'testQuality', reason: 'invalid-structured-result',
      rejection: { kind: 'explained', problems: [expect.objectContaining({ field })] },
    });
    expect(writeArtifact).not.toHaveBeenCalled();
    expect(writeCache).not.toHaveBeenCalled();
  });

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
      type: "build_review_rubric_skipped",
      rubric: "testQuality",
      lapId: "lap-current",
      reason: "disabled",
    });
    expect(emit).toHaveBeenCalledWith({
      type: "build_review_rubric_skipped",
      rubric: "security",
      lapId: "lap-current",
      reason: "disabled",
    });
    expect(emit).toHaveBeenCalledWith({
      type: "build_review_outer_verdict",
      lapId: "lap-current",
      rawVerdict: "PASS",
      effectiveVerdict: "PASS",
      reason: "build_review_no_rubrics",
    });
  });

  it.each([
    ['a production-only refactor'],
    ['a pure test relocation'],
    ['a plan without test paths'],
  ])("passes typed empty scope for %s without preflight or grader dispatch", async () => {
    const frozenInputs = inputs();
    const emit = vi.fn(async () => undefined);
    const input = coordinationInput(true, {
      inputs: {
        ...frozenInputs,
        sourceSnapshot: {
          ...frozenInputs.sourceSnapshot,
          // The old compatibility selector is deliberately non-empty: typed
          // scope, not a file-level selector, decides empty-scope eligibility.
          testQuality: {
            inScopeTests: ['test/legacy-selector.test.ts'],
            counterfactualFileSelectors: [],
            unresolvedMarkers: [{ selector: 'test/legacy-selector.test.ts', reference: 'S99.1' }],
          },
          testScope: {
            targets: [], candidates: [],
            notes: [{ kind: 'unresolved-reference' }],
            changedDeclarations: [], affectedGroups: [], sharedSources: [],
          } as never,
        },
      },
      emit,
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
    expect(emit).toHaveBeenCalledWith({
      type: 'build_review_outer_verdict', lapId: 'lap-current', rawVerdict: 'PASS', effectiveVerdict: 'PASS',
      reason: 'test_quality_empty_scope',
      unresolvedMarkers: [{ selector: 'test/legacy-selector.test.ts', reference: 'S99.1' }],
    });
    // The settled empty scope publishes its counts on the same event as a judged
    // settlement, so no-candidate laps are observable on the ordinary event path.
    const emitted = emit.mock.calls.map((call) => (call as unknown as unknown[])[0] as { type: string });
    expect(emitted.filter((event) => event.type === 'build_review_scope_summary')).toEqual([
      {
        type: 'build_review_scope_summary', rubric: 'testQuality', lapId: 'lap-current',
        establishedTargetCount: 0, candidateCount: 0, unresolvedReasons: [],
      },
    ]);
    expect(emitted.findIndex((event) => event.type === 'build_review_scope_summary'))
      .toBeLessThan(emitted.findIndex((event) => event.type === 'build_review_outer_verdict'));
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
          testQuality: { inScopeTests: [inScopeTest], counterfactualFileSelectors: [inScopeTest], unresolvedMarkers: [] },
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
      branches: [{ kind: "infrastructure-failure", rubric: "testQuality", reason: "invalid-structured-result" }, disabledSecurityBranch],
    });
  });

  it('keeps conservative preflight file execution separate from established quality targets', async () => {
    const established = 'test/established.test.ts';
    const candidate = 'test/candidate-group.test.ts';
    const frozenInputs = inputs();
    const dispatchModel = vi.fn(async () => ({ findings: [] }));

    await coordinateBuildReviewRubrics(coordinationInput(true, {
      inputs: {
        ...frozenInputs,
        sourceSnapshot: {
          ...frozenInputs.sourceSnapshot,
          testQuality: {
            inScopeTests: [established],
            counterfactualFileSelectors: [candidate, established],
            unresolvedMarkers: [],
          },
        },
      },
      preflight: vi.fn(async () => ({
        classification: 'stayed-green' as const, cacheable: true as const, cacheProvenance: 'miss' as const,
        changedPaths: ['src/a.ts', established], changedTestSelectors: [established],
        counterfactualFileSelectors: [candidate, established], revertedProductionManifest: [],
        sourceIdentities: { mergeBase: 'base', headSha: 'head' },
        scopedRun: { exitCode: 0 as const, runKind: 'passed' as const, ranSelectors: [candidate, established], failureExcerpt: '' },
      })),
      dispatchModel,
    }));

    expect(dispatchModel).toHaveBeenCalledWith(
      expect.objectContaining({ rubric: 'testQuality' }),
      expect.objectContaining({
        runnerSelectors: [candidate, established],
        changedTestSelectors: [established],
      }),
    );
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
      branches: [{ rubric: "testQuality", skillName: "build-review-test-quality" }, disabledSecurityBranch],
    });
    expect(dispatchModel).toHaveBeenCalledTimes(1);
    expect(dispatchModel).toHaveBeenCalledWith(
      expect.objectContaining({ rubric: "testQuality" }),
      expect.objectContaining({ rubric: "testQuality" }),
    );
    expect(result).toMatchObject({ kind: "ready" });
  });

  it('classifies enabled security as dispatchable and an omitted security policy as disabled', () => {
    expect(classifyBuildReviewRubricBranches(config(false, true), [])).toMatchObject({
      kind: 'ready',
      branches: [
        { kind: 'skipped', rubric: 'testQuality', reason: 'disabled' },
        { rubric: 'security', skillName: 'build-review-security', policy: expect.objectContaining({ enabled: true, effort: 'high' }) },
      ],
    });

    const absentSecurity = config(false) as unknown as { rubrics: Record<string, unknown> };
    delete absentSecurity.rubrics.security;
    expect(classifyBuildReviewRubricBranches(absentSecurity as ResolvedBuildReviewConfig, [])).toEqual({
      kind: 'passed', verdict: 'PASS', reason: 'build_review_no_rubrics',
      branches: [
        { kind: 'skipped', rubric: 'testQuality', reason: 'disabled' },
        disabledSecurityBranch,
      ],
    });
  });

  it('dispatches only security when it is the only enabled rubric', async () => {
    const dispatchModel = vi.fn(async () => ({ findings: [] }));
    const input = coordinationInput(false, {
      config: config(false, true),
      engineIdentity: { engineStamp: '8e7daae72ad7', skillDigests: { security: { kind: 'resolved', digest: 'sha256:security-skill' } } },
      dispatchModel,
    });

    const result = await coordinateBuildReviewRubrics(input);

    expect(input.preflight).not.toHaveBeenCalled();
    expect(dispatchModel).toHaveBeenCalledTimes(1);
    expect(dispatchModel).toHaveBeenCalledWith(
      expect.objectContaining({ rubric: 'security', skillName: 'build-review-security' }),
      expect.objectContaining({ rubric: 'security' }),
    );
    expect(result).toMatchObject({
      kind: 'ready',
      branches: [
        { kind: 'skipped', rubric: 'testQuality', reason: 'disabled' },
        { kind: 'dispatched', rubric: 'security', result: { verdict: 'PASS' } },
      ],
    });
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
      testScope: {
        changedDeclarations: [],
        targets: [{
          source: { fileName: IN_SCOPE_TEST, side: 'head' },
          declaration: {
            kind: 'test', titleChain: [IN_SCOPE_TITLE], occurrence: 0,
            modifierChain: [], span: { start: 0, end: 1 }, argumentsSpan: { start: 0, end: 1 },
          },
          bindings: [],
          associationChanges: [],
        }],
        candidates: [],
        notes: [],
        affectedGroups: [],
        sharedSources: [],
      },
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

function securityBranch(result: Awaited<ReturnType<typeof coordinateBuildReviewRubrics>>) {
  return result.kind === "ready" ? result.branches.find((branch) => branch.rubric === "security") : undefined;
}

describe("build-review coordinator: security envelope", () => {
  it("serves an identical security judgement from cache without dispatching and emits the cache-hit occurrence", async () => {
    const frozenInputs = inputs();
    const lapId = parseBuildReviewLapId("lap-current")!;
    const projection = deriveBuildReviewRubricProjections({
      lapId,
      inputs: frozenInputs,
      testQuality: { changedTestSelectors: [], unresolvedMarkers: [], revertedProductionManifest: [], preflight: { classification: "not-requested", excerpt: "" } },
    }).security;
    const emit = vi.fn(async () => undefined);
    const dispatchModel = vi.fn(async () => ({ findings: [] }));
    const input = coordinationInput(false, {
      config: config(false, true),
      inputs: frozenInputs,
      engineIdentity: { engineStamp: "8e7daae72ad7", skillDigests: { security: { kind: "resolved", digest: "sha256:security-skill" } } },
      // Candidate-partitioned (v2) entry: a hit requires the lookup's semantic identity.
      readCache: vi.fn(async (_branch, currentProjection, policyFingerprint, semanticIdentity) => ({
        version: 2, rubric: "security", contractVersion: "v3", projectionVersion: "v3",
        projectionDigest: currentProjection.digest, policyFingerprint, semanticIdentity,
        engineIdentity: { engineStamp: "8e7daae72ad7", skillDigest: "sha256:security-skill" },
        result: { kind: "judged", rubric: "security", contractVersion: "v3", lapId: parseBuildReviewLapId("lap-previous")!, snapshotDigest: projection.snapshotDigest, findings: [], verdict: "PASS" },
      }) as never),
      dispatchModel,
      emit,
    });

    const result = await coordinateBuildReviewRubrics(input);

    expect(dispatchModel).not.toHaveBeenCalled();
    expect(input.writeCache).not.toHaveBeenCalled();
    expect(securityBranch(result)).toMatchObject({ kind: "cache-hit", rubric: "security", result: { verdict: "PASS" } });
    expect(emit).toHaveBeenCalledWith({ type: "build_review_cache_hit", rubric: "security", lapId });
    expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: "build_review_rubric_started", rubric: "security" }));
  });

  it.each([
    ["model policy", configWithSecurityModel("opus"), { engineStamp: "8e7daae72ad7", skillDigests: { security: { kind: "resolved" as const, digest: "sha256:security-skill" } } }, "sha256:old-policy"],
    ["skill digest", config(false, true), { engineStamp: "8e7daae72ad7", skillDigests: { security: { kind: "resolved" as const, digest: "sha256:security-skill-edited" } } }, undefined],
  ])("dispatches security after a changed %s misses cache identity", async (_change, currentConfig, engineIdentity, cachedPolicyFingerprint) => {
    const dispatchModel = vi.fn(async () => ({ findings: [] }));
    const input = coordinationInput(false, {
      config: currentConfig,
      engineIdentity,
      readCache: vi.fn(async (_branch, projection, policyFingerprint, semanticIdentity) => ({
        version: 2, rubric: "security", contractVersion: "v3", projectionVersion: "v3", projectionDigest: projection.digest, semanticIdentity,
        policyFingerprint: cachedPolicyFingerprint ?? policyFingerprint,
        engineIdentity: { engineStamp: "8e7daae72ad7", skillDigest: "sha256:security-skill" },
        result: { kind: "judged", rubric: "security", contractVersion: "v3", lapId: parseBuildReviewLapId("lap-previous")!, snapshotDigest: projection.snapshotDigest, findings: [], verdict: "PASS" },
      }) as never),
      dispatchModel,
    });

    const result = await coordinateBuildReviewRubrics(input);

    expect(dispatchModel).toHaveBeenCalledOnce();
    expect(securityBranch(result)).toMatchObject({ kind: "dispatched", rubric: "security" });
  });

  it("fails closed when the security skill cannot be read, without cache or provider writes", async () => {
    const dispatchModel = vi.fn(async () => ({ findings: [] }));
    const input = coordinationInput(false, {
      config: config(false, true),
      engineIdentity: { engineStamp: "8e7daae72ad7", skillDigests: { security: { kind: "unavailable", path: "skills/build-review-security/SKILL.md" } } },
      dispatchModel,
    });

    const result = await coordinateBuildReviewRubrics(input);

    expect(securityBranch(result)).toMatchObject({ kind: "infrastructure-failure", rubric: "security", reason: "cache-read-failed" });
    expect(input.readCache).not.toHaveBeenCalled();
    expect(dispatchModel).not.toHaveBeenCalled();
    expect(input.writeCache).not.toHaveBeenCalled();
  });

  it("defers an unavailable harness-root digest to candidate-local production resolution", async () => {
    const dispatchModel = vi.fn(async () => ({ kind: "judged", rubric: "security", lapId: "lap-current", snapshotDigest: "sha256:snapshot", contractVersion: "v3", findings: [], verdict: "PASS" }));
    const input = coordinationInput(false, {
      config: config(false, true), useCandidateCache: true,
      engineIdentity: { engineStamp: "8e7daae72ad7", skillDigests: { security: { kind: "unavailable", path: "skills/build-review-security/SKILL.md" } } },
      dispatchModel,
    });

    const result = await coordinateBuildReviewRubrics(input);

    expect(dispatchModel).toHaveBeenCalledOnce();
    expect(securityBranch(result)).toMatchObject({ kind: "dispatched", rubric: "security" });
    expect(input.readCache).not.toHaveBeenCalled();
  });

  it("stamps a security finding with the projection-owned envelope and derived failure verdict", async () => {
    const securityHash = `sha256:${createHash("sha256").update("const command = request.input").digest("hex")}`;
    const result = await coordinateBuildReviewRubrics(coordinationInput(false, {
      config: config(false, true),
      engineIdentity: { engineStamp: "8e7daae72ad7", skillDigests: { security: { kind: "resolved", digest: "sha256:security-skill" } } },
      dispatchModel: vi.fn(async () => ({
        verdict: "PASS", rubric: "testQuality", lapId: "reviewer", snapshotDigest: "reviewer", contractVersion: "invalid", kind: "invalid",
        findings: [{
        concernKind: "injection",
        summary: "Request input reaches a shell command.",
        evidenceLocations: ["src/a.ts:1"],
        anchor: { rubric: "security", locus: { path: "src/a.ts", contentHash: securityHash, display: "request-derived command" } },
      }],
      })),
    }));

    expect(securityBranch(result)).toMatchObject({
      kind: "dispatched", rubric: "security", result: {
        kind: "judged", rubric: "security", contractVersion: "v3", lapId: "lap-current", snapshotDigest: "sha256:snapshot", verdict: "FAIL",
      },
    });
  });

  it.each([
    ["kind", { kind: "judged" }],
    ["verdict", { verdict: "PASS" }],
    ["rubric", { rubric: "testQuality" }],
    ["contractVersion", { contractVersion: "v3" }],
    ["lapId", { lapId: "lap-reviewer" }],
    ["snapshotDigest", { snapshotDigest: "sha256:reviewer" }],
  ])("ignores a reviewer-supplied security %s and stamps engine authority", async (_field, envelope) => {
    const result = await coordinateBuildReviewRubrics(coordinationInput(false, {
      config: config(false, true),
      engineIdentity: { engineStamp: "8e7daae72ad7", skillDigests: { security: { kind: "resolved", digest: "sha256:security-skill" } } },
      dispatchModel: vi.fn(async () => ({ findings: [], ...envelope })),
    }));

    expect(securityBranch(result)).toMatchObject({
      kind: "dispatched", rubric: "security", result: { kind: "judged", rubric: "security", contractVersion: "v3", lapId: "lap-current", snapshotDigest: "sha256:snapshot", verdict: "PASS" },
    });
  });

  it.each(['scopeResolutions', 'relocationAudit', 'counterfactualSensitivity'])("rejects test-quality evidence %s on security results", async (field) => {
    const result = await coordinateBuildReviewRubrics(coordinationInput(false, {
      config: config(false, true),
      engineIdentity: { engineStamp: "engine", skillDigests: { security: { kind: "resolved", digest: "security" } } },
      dispatchModel: vi.fn(async () => ({ findings: [], [field]: field === 'counterfactualSensitivity' ? 'supports' : [] })),
    }));
    expect(securityBranch(result)).toMatchObject({ kind: 'infrastructure-failure', reason: 'invalid-structured-result', detail: expect.stringContaining(field) });
  });

  it("continues security review when enabled test quality has no targets", async () => {
    const frozen = inputs();
    const input = coordinationInput(true, {
      config: config(true, true),
      inputs: { ...frozen, sourceSnapshot: { ...frozen.sourceSnapshot, testQuality: { inScopeTests: [], counterfactualFileSelectors: [], unresolvedMarkers: [] } } },
      engineIdentity: { engineStamp: "engine", skillDigests: { security: { kind: "resolved", digest: "security" } } },
      dispatchModel: vi.fn(async () => ({ findings: [{ concernKind: 'injection', summary: 'Untrusted shell input', evidenceLocations: ['src/a.ts:1'], anchor: { rubric: 'security', locus: { path: 'src/a.ts', contentHash: `sha256:${createHash('sha256').update('const command = request.input').digest('hex')}`, display: 'command' } } }] })),
    });
    const result = await coordinateBuildReviewRubrics(input);
    expect(input.preflight).not.toHaveBeenCalled();
    expect(input.dispatchModel).toHaveBeenCalledTimes(1);
    expect(securityBranch(result)).toMatchObject({ kind: 'dispatched', result: { verdict: 'FAIL' } });
    expect(result).toMatchObject({ kind: 'ready', branches: [ { kind: 'skipped', rubric: 'testQuality', reason: 'test_quality_empty_scope' }, { rubric: 'security' } ] });
  });

  it("maps a security-review refusal to infrastructure rather than an empty pass", async () => {
    const result = await coordinateBuildReviewRubrics(coordinationInput(false, {
      config: config(false, true),
      engineIdentity: { engineStamp: "8e7daae72ad7", skillDigests: { security: { kind: "resolved", digest: "sha256:security-skill" } } },
      dispatchModel: vi.fn(async () => "I cannot perform a security review."),
    }));

    expect(securityBranch(result)).toMatchObject({ kind: "infrastructure-failure", rubric: "security", reason: "invalid-structured-result" });
  });
});

describe("build-review coordinator: frozen fan-out", () => {
  it('keeps a valid indeterminate scope judgement, its independent finding, and named event evidence without a repair dispatch', async () => {
    const frozenInputs = titledInputs();
    const candidateHash = `sha256:${'b'.repeat(64)}`;
    const emit = vi.fn(async () => undefined);
    const dispatchModel = vi.fn(async () => ({
      findings: [testQualityFinding()],
      scopeResolutions: [{
        candidateId: 'candidate:setup', status: 'indeterminate',
        missingEvidenceReason: 'the changed setup cannot be associated with one marker',
      }],
    }));

    const result = await coordinateBuildReviewRubrics(coordinationInput(true, {
      inputs: {
        ...frozenInputs,
        sourceSnapshot: {
          ...frozenInputs.sourceSnapshot,
          testScope: {
            targets: [{
              source: { fileName: IN_SCOPE_TEST, side: 'head' },
              declaration: { kind: 'test', titleChain: [IN_SCOPE_TITLE], occurrence: 0 },
            }],
            candidates: [{
              candidateId: 'candidate:setup',
              sourceRegion: { path: IN_SCOPE_TEST, startLine: 2, endLine: 4, contentHash: candidateHash, display: 'changed setup' },
              obligationReferences: ['story:S6.1'],
            }],
            notes: [], changedDeclarations: [], affectedGroups: [], sharedSources: [],
          } as never,
        },
      },
      dispatchModel,
      emit,
    }));

    expect(dispatchModel).toHaveBeenCalledTimes(1);
    expect(testQualityBranch(result)).toMatchObject({
      kind: 'dispatched',
      result: {
        findings: [testQualityFinding()],
        scopeResolutions: [{
          candidateId: 'candidate:setup', status: 'indeterminate',
          sourceRegion: { path: IN_SCOPE_TEST, contentHash: candidateHash },
          obligationReferences: ['story:S6.1'],
          missingEvidenceReason: 'the changed setup cannot be associated with one marker',
        }],
      },
    });
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'build_review_scope_incomplete', rubric: 'testQuality', lapId: 'lap-current',
      candidates: [expect.objectContaining({ candidateId: 'candidate:setup', obligationReferences: ['story:S6.1'] })],
    }));
  });

  it('persists normal scope counts and an indeterminate candidate through the shared event spine', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'build-review-scope-events-'));
    const emitter = new ConductorEventEmitter();
    const persister = new EventPersister(join(directory, 'events.jsonl'), emitter);
    persister.start();
    try {
      const scopedInputs = inputs();
      await coordinateBuildReviewRubrics(coordinationInput(true, {
        inputs: {
          ...scopedInputs,
          sourceSnapshot: {
            ...scopedInputs.sourceSnapshot,
            testScope: {
              targets: [{}, {}],
              candidates: [{
                candidateId: 'candidate:setup',
                sourceRegion: { path: IN_SCOPE_TEST, startLine: 2, endLine: 4, contentHash: IN_SCOPE_HASH, display: 'changed setup' },
                obligationReferences: ['story:S6.1'],
                reasons: ['uncertain-association'],
              }],
            } as never,
          },
        },
        dispatchModel: vi.fn(async () => ({
          findings: [],
          scopeResolutions: [{
            candidateId: 'candidate:setup', status: 'indeterminate',
            missingEvidenceReason: 'the pinned marker association is ambiguous',
          }],
        })),
        emit: async (event) => { await emitter.emit(event); },
      }));
      persister.stop();

      const records = (await readFile(join(directory, 'events.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => {
          const { ts: _ts, ...event } = JSON.parse(line);
          return event;
        });
      expect(records.filter((event) => event.type === 'build_review_scope_summary' || event.type === 'build_review_scope_incomplete')).toEqual([
        {
          type: 'build_review_scope_summary', rubric: 'testQuality', lapId: 'lap-current',
          establishedTargetCount: 2, candidateCount: 1, unresolvedReasons: ['uncertain-association'],
        },
        {
          type: 'build_review_scope_incomplete', rubric: 'testQuality', lapId: 'lap-current',
          candidates: [expect.objectContaining({
            candidateId: 'candidate:setup',
            missingEvidenceReason: 'the pinned marker association is ambiguous',
          })],
        },
      ]);
    } finally {
      persister.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("emits each rubric occurrence exactly once in branch settlement order", async () => {
    const emit = vi.fn(async (_event: Parameters<NonNullable<BuildReviewCoordinationInput["emit"]>>[0]) => undefined);

    const result = await coordinateBuildReviewRubrics(coordinationInput(true, {
      dispatchModel: vi.fn(async () => ({ findings: [] })),
      emit,
    }));

    expect(result).toMatchObject({ kind: "ready", branches: [{ kind: "dispatched", rubric: "testQuality" }, disabledSecurityBranch] });
    // Disabled rubrics settle before cache, preflight, or provider work.
    expect(emit.mock.calls.map(([event]) => event)).toEqual([
      { type: "build_review_rubric_started", rubric: "testQuality", lapId: "lap-current" },
      { type: "build_review_rubric_skipped", rubric: "security", lapId: "lap-current", reason: "disabled" },
      { type: "build_review_rubric_result", rubric: "testQuality", lapId: "lap-current", verdict: "PASS" },
      {
        type: 'build_review_scope_summary', rubric: 'testQuality', lapId: 'lap-current',
        establishedTargetCount: 1, candidateCount: 0, unresolvedReasons: [],
      },
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
      version: 2, rubric: "testQuality", contractVersion: "v3", projectionVersion: expect.any(String),
      projectionDigest: expect.stringMatching(/^sha256:/), policyFingerprint: expect.any(String),
      semanticIdentity: expect.objectContaining({
        semanticInputDigest: expect.stringMatching(/^sha256:/),
        effectiveBundleDigest: "sha256:skill-a",
      }),
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
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      type: "build_review_rubric_infrastructure_failure", rubric: "testQuality", lapId: "lap-current",
      reason: "cache-write-failed", cause: "artifact-write-failed",
    }));
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
      branches: [{ kind: "infrastructure-failure", rubric: "testQuality", reason, detail }, disabledSecurityBranch],
    });
    expect(emit.mock.calls.map(([event]) => event)).toEqual([{
      type: "build_review_rubric_infrastructure_failure", rubric: "testQuality", lapId: "lap-current",
      reason, excerpt: detail,
    }, {
      type: "build_review_rubric_skipped", rubric: "security", lapId: "lap-current", reason: "disabled",
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
      kind: "infrastructure-failure", rubric: "testQuality", reason: "invalid-structured-result",
      detail: expect.stringContaining("counterfactualSensitivity"),
    });
    expect(writeArtifact).not.toHaveBeenCalled();
    expect(writeCache).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: "build_review_rubric_result", verdict: "FAIL" }));
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      type: "build_review_rubric_infrastructure_failure", rubric: "testQuality", lapId: "lap-current",
      reason: "invalid-structured-result", cause: "invalid-structured-result",
      rejection: expect.objectContaining({
        kind: "explained",
        problems: expect.arrayContaining([
          expect.objectContaining({ field: "counterfactualSensitivity" }),
        ]),
      }),
    }));
    expect(rubricFailures).toEqual({ testQuality: 3 });
  });

  it("settles a dispatch-failure report as invalid-structured-result carrying its bounded detail", async () => {
    const detail = "judged-result contract not satisfied after one repair turn: ... Raw output excerpt: I judged the rubric...";
    const emit = vi.fn(async (_event: Parameters<NonNullable<BuildReviewCoordinationInput["emit"]>>[0]) => undefined);
    const input = coordinationInput(true, {
      dispatchModel: vi.fn(async () => ({ kind: "dispatch-failure", detail })),
      emit,
    });

    const result = await coordinateBuildReviewRubrics(input);

    expect(testQualityBranch(result)).toMatchObject({ kind: "infrastructure-failure", rubric: "testQuality", reason: "invalid-structured-result", detail });
    expect(input.writeArtifact).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      type: "build_review_rubric_infrastructure_failure", rubric: "testQuality", lapId: "lap-current", reason: "invalid-structured-result",
      cause: "invalid-structured-result", excerpt: detail,
    }));
  });

  it("settles an undefined dispatch result as invalid-provider-result with an engine diagnosis", async () => {
    const emit = vi.fn(async (_event: Parameters<NonNullable<BuildReviewCoordinationInput["emit"]>>[0]) => undefined);
    const result = await coordinateBuildReviewRubrics(coordinationInput(true, { emit }));

    expect(testQualityBranch(result)).toEqual({
      kind: "infrastructure-failure", rubric: "testQuality", reason: "invalid-provider-result",
      detail: '"findings" must be an array (empty when no concern was found)',
    });
    expect(emit.mock.calls.map(([event]) => event)).toEqual([{
      type: "build_review_rubric_started", rubric: "testQuality", lapId: "lap-current",
    }, {
      type: "build_review_rubric_skipped", rubric: "security", lapId: "lap-current", reason: "disabled",
    }, {
      type: "build_review_rubric_infrastructure_failure", rubric: "testQuality", lapId: "lap-current", reason: "invalid-provider-result",
      cause: "malformed-artifact",
      excerpt: '"findings" must be an array (empty when no concern was found)',
    }]);
  });

  it.each([
    ["has no JSON object", "not JSON at all", '"findings" must be an array (empty when no concern was found)'],
    ["has non-array findings", { findings: "none" }, '"findings" must be an array (empty when no concern was found)'],
    ["has one malformed finding among valid findings", {
      findings: [testQualityFinding(), { ...testQualityFinding(), anchor: { rubric: "testQuality", locus: { path: "", contentHash: IN_SCOPE_HASH, display: IN_SCOPE_TITLE } } }],
    }, 'findings[1].anchor.locus must be a content-region reference {"path", "contentHash", "display", "occurrence"?}'],
  ])("carries the engine-produced failed requirement when a provider result %s", async (_shape, payload, detail) => {
    const result = await coordinateBuildReviewRubrics(coordinationInput(true, {
      inputs: titledInputs(),
      dispatchModel: vi.fn(async () => payload),
    }));

    expect(testQualityBranch(result)).toMatchObject({ kind: "infrastructure-failure", rubric: "testQuality", reason: "invalid-structured-result", detail });
  });

  it("rejects colliding finding identities in one judged result as infrastructure, never a verdict", async () => {
    const input = coordinationInput(true, {
      inputs: titledInputs(),
      dispatchModel: vi.fn(async () => ({ findings: [testQualityFinding("first wording"), testQualityFinding("second wording")] })),
    });

    const result = await coordinateBuildReviewRubrics(input);

    expect(testQualityBranch(result)).toMatchObject({
      kind: "infrastructure-failure", rubric: "testQuality", reason: "invalid-structured-result",
      detail: expect.stringContaining('findings must not repeat one concern on one content region (duplicated identity: sha256:'),
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
      "scope-incomplete": true,
      "projection-oversized": true,
      "invalid-structured-result": true,
      "native-schema-unsupported": true,
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

describe("build-review coordinator: candidate scope resolutions", () => {
  const scopeRegion = {
    path: "test/widget.test.ts", startLine: 1, endLine: 1,
    contentHash: `sha256:${"a".repeat(64)}`, display: "widget persists state",
  };
  const scopeCandidate = {
    candidateId: "candidate-widget", sourceRegion: scopeRegion,
    obligationReferences: ["criterion:S5.1"],
  };
  const candidateProjection = {
    rubric: "testQuality", contractVersion: "v3", projectionVersion: "v3", lapId: parseBuildReviewLapId("lap-current")!,
    snapshotDigest: "sha256:snapshot", contentDigest: "sha256:content", digest: "sha256:projection", mergeBase: "base", headSha: "head",
    changedFiles: [], changedTestSelectors: [], runnerSelectors: [], unresolvedMarkers: [], changedTestTitles: [],
    testScope: {
      targets: [{
        source: { fileName: IN_SCOPE_TEST, side: 'head' },
        declaration: { kind: 'test', titleChain: [IN_SCOPE_TITLE], occurrence: 0 },
      }],
      candidates: [scopeCandidate],
    }, testSuiteProof: {}, revertedProductionManifest: [], preflight: { classification: "approved-exception", exception: "empty-test-set" },
  } as unknown as import('../../src/engine/build-review-projections.js').TestQualityProjection;

  it('stamps a uniquely resolved source reference into the existing declared-title identity', async () => {
    const projection = {
      ...candidateProjection,
      testScope: {
        targets: [],
        candidates: [{
          candidateId: scopeCandidate.candidateId,
          source: { side: 'head', fileName: scopeRegion.path },
          declaration: { kind: 'test', span: { start: 9, end: 29 }, titleChain: ['widget', 'persists state'], occurrence: 1 },
          markers: [{ reference: { kind: 'criterion', id: 'S5.1' } }],
        }],
        evidence: [{
          id: scopeCandidate.candidateId,
          source: { side: 'head', fileName: scopeRegion.path },
          region: { start: 9, end: 29 },
          startLine: scopeRegion.startLine,
          endLine: scopeRegion.endLine,
          contentHash: scopeRegion.contentHash,
        }],
      },
    };
    const resolution = { ...scopeCandidate, status: 'resolved', associationReason: 'The pinned assertion covers the obligation.' };
    const payload = {
      findings: [{ ...testQualityFinding('Cleanup only tests itself'), anchor: {
        rubric: 'testQuality', locus: { path: scopeRegion.path, contentHash: scopeRegion.contentHash, display: scopeRegion.display },
      } }], scopeResolutions: [resolution],
    };
    const result = validateBuildReviewDispatchedResult(stampBuildReviewDispatchedCandidate(payload, 'testQuality', projection), 'testQuality', projection);
    expect(result).toMatchObject({ verdict: 'FAIL', findings: [{ anchor: { locus: {
      path: scopeRegion.path,
      contentHash: `sha256:${createHash('sha256').update('widget > persists state').digest('hex')}`,
      occurrence: 1,
    } } }], scopeResolutions: [resolution] });
    expect(payload.findings[0]!.anchor.locus.contentHash).toBe(scopeRegion.contentHash);
    const input = coordinationInput(true, { projections: { testQuality: projection }, dispatchModel: vi.fn(async () => payload) });
    const coordinated = await coordinateBuildReviewRubrics(input);
    expect(testQualityBranch(coordinated)).toMatchObject({ kind: 'dispatched', result });
    expect(input.dispatchModel).toHaveBeenCalledTimes(1);
    expect(input.writeArtifact).toHaveBeenCalledWith(expect.objectContaining({ result }));
  });

  it.each(['out-of-scope', 'indeterminate', 'foreign-hash', 'unlisted-path', 'ambiguous', 'wrong-occurrence'])(
    'does not translate a %s source reference into finding authority', (failure) => {
      const declared = { ...scopeCandidate, declaration: { kind: 'test', titleChain: ['widget', 'persists state'], occurrence: 1 } };
      const candidates = failure === 'ambiguous' ? [declared, { ...declared, candidateId: 'sibling' }] : [declared];
      const projection = { ...candidateProjection, testScope: { targets: [], candidates } };
      const resolutions = candidates.map((candidate) => failure === 'out-of-scope'
        ? { candidateId: candidate.candidateId, status: 'out-of-scope', exclusionReason: 'Unrelated assertion.' }
        : failure === 'indeterminate'
          ? { candidateId: candidate.candidateId, status: 'indeterminate', missingEvidenceReason: 'Binding uncertain.' }
          : { ...candidate, status: 'resolved', associationReason: 'Pinned assertion.' });
      const payload = { findings: [{ ...testQualityFinding('Concern'), anchor: { rubric: 'testQuality', locus: {
        path: failure === 'unlisted-path' ? 'test/unlisted.test.ts' : scopeRegion.path,
        contentHash: failure === 'foreign-hash' ? `sha256:${'b'.repeat(64)}` : scopeRegion.contentHash,
        display: scopeRegion.display, ...(failure === 'wrong-occurrence' ? { occurrence: 2 } : {}),
      } } }], scopeResolutions: resolutions };
      expect(validateBuildReviewDispatchedResult(stampBuildReviewDispatchedCandidate(payload, 'testQuality', projection), 'testQuality', projection)).toBeUndefined();
    },
  );

  it('rejects a finding whose content hash is absent from projected evidence and candidates', () => {
    const unreadableResolution = {
      candidateId: scopeCandidate.candidateId,
      status: 'indeterminate',
      missingEvidenceReason: 'unreadable at pinned ref',
    };
    const payload = {
      findings: [{ ...testQualityFinding('The unreadable region can pass.'), anchor: { rubric: 'testQuality', locus: {
        path: scopeRegion.path, contentHash: `sha256:${'f'.repeat(64)}`, display: scopeRegion.display,
      } } }],
      scopeResolutions: [unreadableResolution],
    };

    expect(validateBuildReviewDispatchedResult(
      stampBuildReviewDispatchedCandidate(payload, 'testQuality', candidateProjection), 'testQuality', candidateProjection,
    )).toBeUndefined();
  });

  it('accepts an unreadable pinned region as indeterminate only with a non-empty reason', () => {
    const acceptedPayload = {
      findings: [],
      scopeResolutions: [{
        candidateId: scopeCandidate.candidateId,
        status: 'indeterminate',
        missingEvidenceReason: 'unreadable at pinned ref',
      }],
    };
    const emptyReasonPayload = {
      ...acceptedPayload,
      scopeResolutions: [{ ...acceptedPayload.scopeResolutions[0], missingEvidenceReason: '' }],
    };

    expect(validateBuildReviewDispatchedResult(
      stampBuildReviewDispatchedCandidate(acceptedPayload, 'testQuality', candidateProjection), 'testQuality', candidateProjection,
    )).toMatchObject({ scopeResolutions: [{ ...acceptedPayload.scopeResolutions[0], sourceRegion: scopeRegion }] });
    expect(validateBuildReviewDispatchedResult(
      stampBuildReviewDispatchedCandidate(emptyReasonPayload, 'testQuality', candidateProjection), 'testQuality', candidateProjection,
    )).toBeUndefined();
  });

  it('diagnoses invalid candidate authority before blaming an otherwise scoped finding anchor', () => {
    const foreignResolution = {
      candidateId: 'candidate-widget', status: 'resolved',
      sourceRegion: { ...scopeRegion, startLine: 2, endLine: 2 },
      obligationReferences: ['criterion:S5.1'], associationReason: 'This incorrectly points at a sibling.',
    };
    const candidate = stampBuildReviewDispatchedCandidate({
      findings: [{
        ...testQualityFinding('The sibling assertion can pass.'),
        anchor: { rubric: 'testQuality', locus: { path: scopeRegion.path, contentHash: scopeRegion.contentHash, display: scopeRegion.display } },
      }],
      scopeResolutions: [foreignResolution],
    }, 'testQuality', candidateProjection);

    expect(validateBuildReviewDispatchedResult(candidate, 'testQuality', candidateProjection)).toBeUndefined();
    expect(describeBuildReviewDispatchedResultRejection(candidate, 'testQuality', candidateProjection)).toContain('foreign sourceRegion or obligationReferences');
  });

  it("revalidates a cache hit against current candidate and finding authority before reuse", async () => {
    const currentResolution = {
      candidateId: "candidate-widget", status: "resolved", sourceRegion: scopeRegion,
      obligationReferences: ["criterion:S5.1"], associationReason: "The current source binds this candidate.",
    };
    const staleScopeRegion = {
      ...scopeRegion,
      contentHash: `sha256:${"c".repeat(64)}`,
      display: "unchanged sibling test",
    };
    const staleResult = {
      kind: "judged", rubric: "testQuality", contractVersion: "v3", lapId: parseBuildReviewLapId("lap-old")!,
      snapshotDigest: "sha256:old", findings: [{
        ...testQualityFinding("A coarse sibling anchor was cached."),
        anchor: { rubric: "testQuality", locus: { path: staleScopeRegion.path, contentHash: staleScopeRegion.contentHash, display: staleScopeRegion.display } },
      }],
      scopeResolutions: [{ ...currentResolution, sourceRegion: staleScopeRegion }], verdict: "FAIL",
    };
    const dispatchModel = vi.fn(async () => ({ findings: [], scopeResolutions: [currentResolution] }));
    const input = coordinationInput(true, {
      projections: { testQuality: candidateProjection },
      readCache: vi.fn(async () => ({
        version: 1, rubric: "testQuality", contractVersion: "v3", projectionVersion: "v3",
        projectionDigest: candidateProjection.digest, policyFingerprint: fingerprintBuildReviewRubricPolicy(policy),
        engineIdentity: { engineStamp: "8e7daae72ad7", skillDigest: "sha256:skill-a" }, result: staleResult,
      }) as never),
      dispatchModel,
    });

    const result = await coordinateBuildReviewRubrics(input);

    expect(dispatchModel).toHaveBeenCalledOnce();
    expect(input.writeArtifact).toHaveBeenCalledOnce();
    expect(testQualityBranch(result)).toMatchObject({
      kind: "dispatched", result: { findings: [], scopeResolutions: [currentResolution], verdict: "PASS" },
    });
  });

  it("derives the pre-change candidate-context golden from identity-only pinned evidence", () => {
    const projection = {
      ...candidateProjection,
      testScope: {
        candidates: [{
          source: { side: 'head', fileName: 'test/widget.test.ts' },
          declaration: { span: { start: 9, end: 29 }, titleChain: ["widget persists state"] },
          markers: [{ reference: { kind: "criterion", id: "S5.1" } }],
        }],
        evidence: [{
          id: "source:head:test/widget.test.ts:9:29", source: { side: "head", fileName: "test/widget.test.ts" },
          region: { start: 9, end: 29 }, startLine: 12, endLine: 12, contentHash: scopeRegion.contentHash,
        }],
      },
    } as never;

    expect(buildReviewCandidateScopeResolutionContext(projection)).toEqual({ candidates: [{
      candidateId: "source:head:test/widget.test.ts:9:29", sourceRegion: { ...scopeRegion, startLine: 12, endLine: 12 },
      obligationReferences: ["criterion:S5.1"],
    }] });
  });

  it('does not create candidate authority from a hash-less evidence record, and rejects its anchor', () => {
    const projection = {
      ...candidateProjection,
      testScope: {
        targets: [],
        candidates: [{
          source: { side: 'head', fileName: scopeRegion.path },
          declaration: { span: { start: 9, end: 29 }, titleChain: ['widget persists state'] },
          markers: [{ reference: { kind: 'criterion', id: 'S5.1' } }],
        }],
        evidence: [{
          id: 'source:head:test/widget.test.ts:9:29', source: { side: 'head', fileName: scopeRegion.path },
          region: { start: 9, end: 29 }, startLine: 12, endLine: 12,
        }],
      },
    } as never;
    const candidate = {
      findings: [{
        ...testQualityFinding('The hash-less candidate can pass.'),
        anchor: { rubric: 'testQuality', locus: scopeRegion },
      }],
    };

    expect(buildReviewCandidateScopeResolutionContext(projection)).toEqual({ candidates: [] });
    expect(validateBuildReviewDispatchedResult(candidate, 'testQuality', projection)).toBeUndefined();
  });

  it('keeps merged multi-reason candidates independently settleable by their pinned identities', () => {
    const projection = {
      ...candidateProjection,
      testScope: {
        candidates: [
          { source: { side: 'head', fileName: 'test/widget.test.ts' }, declaration: { span: { start: 9, end: 29 }, titleChain: ['widget persists state'] }, markers: [{ reference: { kind: 'criterion', id: 'S5.1' } }], reasons: ['declaration-group', 'affected-dependency'] },
          { source: { side: 'head', fileName: 'test/widget.test.ts' }, declaration: { span: { start: 30, end: 50 }, titleChain: ['widget removes state'] }, markers: [{ reference: { kind: 'criterion', id: 'S5.2' } }], reasons: ['affected-dependency'] },
        ],
        evidence: [
          { id: 'source:head:test/widget.test.ts:9:29', source: { side: 'head', fileName: 'test/widget.test.ts' }, region: { start: 9, end: 29 }, startLine: 12, endLine: 12, contentHash: scopeRegion.contentHash },
          { id: 'source:head:test/widget.test.ts:30:50', source: { side: 'head', fileName: 'test/widget.test.ts' }, region: { start: 30, end: 50 }, startLine: 13, endLine: 13, contentHash: `sha256:${'b'.repeat(64)}` },
        ],
      },
    } as never;
    const context = buildReviewCandidateScopeResolutionContext(projection);
    const resolutions = context.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      status: 'out-of-scope' as const,
      exclusionReason: 'The pinned candidate is unrelated to the changed behavior.',
    }));

    expect(context.candidates.map((candidate) => candidate.candidateId)).toEqual([
      'source:head:test/widget.test.ts:9:29',
      'source:head:test/widget.test.ts:30:50',
    ]);
    expect(validateBuildReviewDispatchedResult(stampBuildReviewDispatchedCandidate({ findings: [], scopeResolutions: resolutions }, 'testQuality', projection), 'testQuality', projection)).toBeDefined();
  });

  it('keeps equal-span fallback candidates bound to their own frozen source identity', () => {
    const firstRegion = { ...scopeRegion, path: 'test/first.test.ts', display: 'first fallback' };
    const secondRegion = { ...scopeRegion, path: 'test/second.test.ts', display: 'second fallback' };
    const projection = {
      ...candidateProjection,
      testScope: {
        candidates: [
          { source: { side: 'head', fileName: firstRegion.path }, declaration: { span: { start: 9, end: 29 }, titleChain: [firstRegion.display] }, markers: [{ reference: { kind: 'criterion', id: 'S5.1' } }] },
          { source: { side: 'head', fileName: secondRegion.path }, declaration: { span: { start: 9, end: 29 }, titleChain: [secondRegion.display] }, markers: [{ reference: { kind: 'criterion', id: 'S5.2' } }] },
        ],
        evidence: [
          { id: 'source:head:test/first.test.ts:9:29', source: { side: 'head', fileName: firstRegion.path }, region: { start: 9, end: 29 }, startLine: 12, endLine: 12, contentHash: firstRegion.contentHash },
          { id: 'source:head:test/second.test.ts:9:29', source: { side: 'head', fileName: secondRegion.path }, region: { start: 9, end: 29 }, startLine: 12, endLine: 12, contentHash: secondRegion.contentHash },
        ],
      },
    } as never;

    expect(buildReviewCandidateScopeResolutionContext(projection)).toEqual({ candidates: [
      { candidateId: 'source:head:test/first.test.ts:9:29', sourceRegion: { ...firstRegion, startLine: 12, endLine: 12 }, obligationReferences: ['criterion:S5.1'] },
      { candidateId: 'source:head:test/second.test.ts:9:29', sourceRegion: { ...secondRegion, startLine: 12, endLine: 12 }, obligationReferences: ['criterion:S5.2'] },
    ] });
  });

  it("settles one source-grounded fallback resolution and its finding in one provider dispatch", async () => {
    const resolution = {
      candidateId: "candidate-widget", status: "resolved", sourceRegion: scopeRegion,
      obligationReferences: ["criterion:S5.1"], associationReason: "The changed fallback assertion covers the criterion.",
    };
    const finding = {
      concernKind: "test-insensitive", summary: "The fallback assertion can pass without persistence.", evidenceLocations: ["test/widget.test.ts:1"],
      anchor: { rubric: "testQuality", locus: { path: scopeRegion.path, contentHash: scopeRegion.contentHash, display: scopeRegion.display } },
    };
    const dispatchModel = vi.fn(async () => ({ findings: [finding], scopeResolutions: [resolution], lapId: "provider-lap" }));
    const input = coordinationInput(true, { projections: { testQuality: candidateProjection }, dispatchModel });

    const result = await coordinateBuildReviewRubrics(input);

    expect(dispatchModel).toHaveBeenCalledTimes(1);
    expect(testQualityBranch(result)).toMatchObject({
      kind: "dispatched", result: {
        contractVersion: "v3", lapId: "lap-current", snapshotDigest: "sha256:snapshot", findings: [finding], scopeResolutions: [resolution], verdict: "FAIL",
      },
    });
    expect(input.writeArtifact).toHaveBeenCalledWith(expect.objectContaining({
      rubric: 'testQuality', lapId: 'lap-current', snapshotDigest: 'sha256:snapshot',
      result: expect.objectContaining({ contractVersion: 'v3', lapId: 'lap-current', snapshotDigest: 'sha256:snapshot', scopeResolutions: [resolution] }),
    }));
  });

  it("retains an out-of-scope exclusion without inventing a quality finding", async () => {
    const exclusion = { candidateId: "candidate-widget", status: "out-of-scope", exclusionReason: "Pinned candidate is unrelated to the changed behavior." };
    const input = coordinationInput(true, {
      projections: { testQuality: candidateProjection },
      dispatchModel: vi.fn(async () => ({ findings: [], scopeResolutions: [exclusion] })),
    });

    const result = await coordinateBuildReviewRubrics(input);

    expect(testQualityBranch(result)).toMatchObject({
      kind: "dispatched", result: { findings: [], scopeResolutions: [exclusion], verdict: "PASS" },
    });
  });

  it('re-runs scope coordination against corrected pinned binding evidence instead of retaining an old indeterminacy', async () => {
    const initial = await coordinateBuildReviewRubrics(coordinationInput(true, {
      projections: { testQuality: candidateProjection },
      dispatchModel: vi.fn(async () => ({
        findings: [], scopeResolutions: [{ candidateId: 'candidate-widget', status: 'indeterminate', missingEvidenceReason: 'the pinned binding is incomplete' }],
      })),
    }));
    const initialBranch = testQualityBranch(initial);
    expect(initialBranch).toMatchObject({ kind: 'dispatched' });
    if (!initialBranch || initialBranch.kind !== 'dispatched') throw new Error('fixture must dispatch testQuality');
    const initialResult = initialBranch.result;
    if (initialResult.kind !== 'judged') throw new Error('fixture must settle a judged result');
    expect(deriveBuildReviewScopeIncompleteFault(initialResult)).toMatchObject({
      candidates: [{ candidateId: 'candidate-widget', missingEvidenceReason: 'the pinned binding is incomplete' }],
    });

    const correctedRegion = { ...scopeRegion, contentHash: `sha256:${'c'.repeat(64)}`, display: 'corrected setup binding' };
    const correctedProjection = {
      ...candidateProjection,
      digest: 'sha256:corrected-projection',
      testScope: { candidates: [{ ...scopeCandidate, sourceRegion: correctedRegion }] },
    };
    const recovered = await coordinateBuildReviewRubrics(coordinationInput(true, {
      projections: { testQuality: correctedProjection },
      dispatchModel: vi.fn(async () => ({
        findings: [], scopeResolutions: [{
          candidateId: 'candidate-widget', status: 'resolved', sourceRegion: correctedRegion,
          obligationReferences: ['criterion:S5.1'], associationReason: 'Corrected pinned binding proves this candidate.',
        }],
      })),
    }));
    const recoveredBranch = testQualityBranch(recovered);
    expect(recoveredBranch).toMatchObject({ kind: 'dispatched' });
    if (!recoveredBranch || recoveredBranch.kind !== 'dispatched') throw new Error('fixture must dispatch testQuality');
    const recoveredResult = recoveredBranch.result;
    if (recoveredResult.kind !== 'judged') throw new Error('fixture must settle a judged result');
    expect(recoveredResult.scopeResolutions).toMatchObject([{ status: 'resolved', sourceRegion: correctedRegion }]);
    expect(deriveBuildReviewScopeIncompleteFault(recoveredResult)).toBeUndefined();
  });

  it('does not empty-pass a concrete candidate, and permits its resolved indeterminate no-findings result', async () => {
    const resolution = {
      candidateId: 'candidate-widget', status: 'resolved', sourceRegion: scopeRegion,
      obligationReferences: ['criterion:S5.1'], associationReason: 'The affected group remains relevant after inspection.',
    };
    const frozenInputs = inputs();
    const dispatchModel = vi.fn(async () => ({
      findings: [], scopeResolutions: [resolution], counterfactualSensitivity: 'indeterminate',
    }));
    const result = await coordinateBuildReviewRubrics(coordinationInput(true, {
      inputs: {
        ...frozenInputs,
        sourceSnapshot: {
          ...frozenInputs.sourceSnapshot,
          testQuality: { inScopeTests: [], counterfactualFileSelectors: ['test/widget.test.ts'], unresolvedMarkers: [] },
          testScope: { candidates: [scopeCandidate] } as never,
        },
      },
      projections: { testQuality: candidateProjection },
      preflight: vi.fn(async () => ({
        classification: 'approved-exception' as const, exception: 'empty-test-set' as const,
        cacheable: true as const, cacheProvenance: 'miss' as const, changedPaths: [], changedTestSelectors: [],
        counterfactualFileSelectors: ['test/widget.test.ts'], revertedProductionManifest: [],
        sourceIdentities: { mergeBase: 'base', headSha: 'head' },
      })),
      dispatchModel,
    }));

    expect(dispatchModel).toHaveBeenCalledOnce();
    expect(testQualityBranch(result)).toMatchObject({
      kind: 'dispatched',
      result: { verdict: 'PASS', findings: [], counterfactualSensitivity: 'indeterminate', scopeResolutions: [resolution] },
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
  it("refuses an oversized canonical projection before cache or model dispatch", async () => {
    const dispatchModel = vi.fn(async () => ({ findings: [] }));
    const emit = vi.fn(async (_event: Parameters<NonNullable<BuildReviewCoordinationInput["emit"]>>[0]) => undefined);
    const result = await coordinateBuildReviewRubrics(coordinationInput(true, {
      config: config(true, false, 1_048_576),
      projections: projectionWithCanonicalByteLength(1_346_093),
      dispatchModel,
      emit,
    }));

    expect(result).toEqual({
      kind: "ready",
      branches: [{
        kind: "infrastructure-failure",
        rubric: "testQuality",
        reason: "projection-oversized",
        detail: "measured=1346093 bytes limit=1048576 bytes",
      }, disabledSecurityBranch],
    });
    expect(dispatchModel).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith({
      type: "build_review_rubric_infrastructure_failure",
      rubric: "testQuality",
      lapId: "lap-current",
      reason: "projection-oversized",
      excerpt: "measured=1346093 bytes limit=1048576 bytes",
      measuredBytes: 1_346_093,
      limitBytes: 1_048_576,
    });
  });

  it("admits an exactly bounded projection", async () => {
    const dispatchModel = vi.fn(async () => ({ findings: [] }));
    const exactProjection = projectionWithCanonicalByteLength(1_024);

    await coordinateBuildReviewRubrics(coordinationInput(true, {
      config: config(true, false, 1_024),
      projections: exactProjection,
      dispatchModel,
    }));

    expect(dispatchModel).toHaveBeenCalledTimes(1);
  });

  it("measures canonical projections in UTF-8 bytes rather than JavaScript characters", async () => {
    const lapId = parseBuildReviewLapId("lap-current")!;
    const projection = {
      rubric: "testQuality",
      contractVersion: "v3",
      projectionVersion: "v3",
      lapId,
      snapshotDigest: "sha256:snapshot",
      digest: "sha256:test-quality",
      padding: "€".repeat(100),
    };
    const measured = Buffer.byteLength(canonicalJson(projection), "utf8");
    const dispatchModel = vi.fn(async () => ({ findings: [] }));

    const refused = await coordinateBuildReviewRubrics(coordinationInput(true, {
      config: config(true, false, measured - 1),
      projections: { testQuality: projection } as never,
      dispatchModel,
    }));
    await coordinateBuildReviewRubrics(coordinationInput(true, {
      config: config(true, false, measured),
      projections: { testQuality: projection } as never,
      dispatchModel,
    }));

    expect(measured).toBeGreaterThan([...canonicalJson(projection)].length);
    expect(refused).toMatchObject({
      branches: [
        { kind: "infrastructure-failure", reason: "projection-oversized", detail: `measured=${measured} bytes limit=${measured - 1} bytes` },
        disabledSecurityBranch,
      ],
    });
    expect(dispatchModel).toHaveBeenCalledTimes(1);
  });

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
      branches: [{ kind: "infrastructure-failure", rubric: "testQuality", reason: "projection-rubric-mismatch" }, disabledSecurityBranch],
    });
    expect(input.readCache).not.toHaveBeenCalled();
    expect(input.dispatchModel).not.toHaveBeenCalled();
    expect(input.writeArtifact).not.toHaveBeenCalled();
    expect(emit.mock.calls.map(([event]) => event)).toEqual([{
      type: "build_review_rubric_infrastructure_failure", rubric: "testQuality", lapId: "lap-current", reason: "projection-rubric-mismatch",
    }, {
      type: "build_review_rubric_skipped", rubric: "security", lapId: "lap-current", reason: "disabled",
    }]);
  });
});
