import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  classifyBuildReviewRubricBranches,
  coordinateBuildReviewRubrics,
  type BuildReviewCoordinationInput,
} from "../../src/engine/build-review-coordinator.js";
import { parseBuildReviewLapId } from "../../src/engine/build-review-domain.js";
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
    acceptedWidenings: [],
    testSuiteProof: { provenanceHeadSha: "head", outcome: "PASS" } as never,
    sourceSnapshot: {
      digest: "sha256:snapshot",
      contentDigest: `sha256:${createHash("sha256").update(JSON.stringify(sourceContent)).digest("hex")}`,
      baseRef: "origin/main",
      mergeBase: "base",
      headSha: "head",
      ...sourceContent,
      acceptedWidenings: [],
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
