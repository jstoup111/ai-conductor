// Covers: task:2
import { describe, expect, it } from "vitest";

import {
  buildReviewPolicyIdentity,
  decideBuildReviewReviewScope,
  mapBuildReviewFindingToHunks,
  settledBuildReviewHunks,
  type BuildReviewPolicyIdentityInputs,
} from "../../src/engine/build-review-review-frontier.js";
import type { BuildReviewReviewScope } from "../../src/engine/build-review-artifacts.js";
import type { BuildReviewLapId } from "../../src/engine/build-review-domain.js";
import type { ChangedFileReference } from "../../src/engine/build-review-projections.js";

function inputs(
  overrides: Partial<BuildReviewPolicyIdentityInputs> = {},
): BuildReviewPolicyIdentityInputs {
  return {
    contractVersion: "v4",
    projectionVersion: "v4",
    declarationFingerprint: "sha256:declaration-a",
    effectiveBundleDigest: "sha256:bundle-a",
    provider: "codex",
    model: "gpt-5.6-sol",
    effort: "medium",
    engineStamp: "engine-a",
    ...overrides,
  };
}

function lapId(value: string): BuildReviewLapId {
  return value as BuildReviewLapId;
}

function changedFiles(): readonly ChangedFileReference[] {
  return [{
    path: "src/example.ts",
    changeKind: "modified",
    hunks: [{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, contentHash: "sha256:hunk-a" }],
  }];
}

function scope(
  overrides: Partial<BuildReviewReviewScope> = {},
): BuildReviewReviewScope {
  return {
    mode: "full",
    reason: "first-lap",
    sequence: 1,
    unreadableLapIds: [],
    mergeBase: "base-a",
    headSha: "head-a",
    policyIdentity: "sha256:policy-a",
    reviewedHunks: [{ path: "src/example.ts", contentHash: "sha256:hunk-a" }],
    deltaHunks: [{ path: "src/example.ts", contentHash: "sha256:hunk-a" }],
    outOfDeltaSourceIds: [],
    ...overrides,
  };
}

function decide(
  overrides: Partial<Parameters<typeof decideBuildReviewReviewScope>[0]> = {},
) {
  return decideBuildReviewReviewScope({
    lapId: lapId("lap-current"),
    changedFiles: changedFiles(),
    mergeBase: "base-a",
    headSha: "head-a",
    policyIdentity: "sha256:policy-a",
    priorLaps: [],
    openSourceUnmapped: false,
    ...overrides,
  });
}

describe("build-review review frontier", () => {
  it("includes every per-rubric policy component except engine identity", () => {
    const baseline = inputs();
    const identity = buildReviewPolicyIdentity("security", baseline);

    for (const changed of [
      inputs({ contractVersion: "v2" }),
      inputs({ projectionVersion: "v1" }),
      inputs({ declarationFingerprint: "sha256:declaration-b" }),
      inputs({ effectiveBundleDigest: "sha256:bundle-b" }),
      inputs({ provider: "claude" }),
      inputs({ model: "sonnet" }),
      inputs({ effort: "high" }),
    ]) {
      expect(buildReviewPolicyIdentity("security", changed)).not.toBe(identity);
    }

    expect(buildReviewPolicyIdentity("security", inputs({ engineStamp: "engine-b" }))).toBe(identity);
  });

  it("includes test-scope analysis and binding identities only for testQuality", () => {
    const baseline = inputs({
      testScope: {
        analysisVersion: "test-scope-v1",
        bindingIdentity: "sha256:binding-a",
      },
    });
    const identity = buildReviewPolicyIdentity("testQuality", baseline);

    expect(buildReviewPolicyIdentity("testQuality", inputs({
      testScope: { ...baseline.testScope!, analysisVersion: "test-scope-v2" },
    }))).not.toBe(identity);
    expect(buildReviewPolicyIdentity("testQuality", inputs({
      testScope: { ...baseline.testScope!, bindingIdentity: "sha256:binding-b" },
    }))).not.toBe(identity);
  });

  // Covers: task:3
  it("uses a full first lap over every current hunk", () => {
    expect(decide()).toEqual(scope({
      headSha: "head-a",
    }));
  });

  // Covers: task:3
  it("uses the latest readable scope to choose merge-base and version full laps", () => {
    const earlier = { lapId: lapId("lap-older"), reviewScope: scope({ sequence: 1, mergeBase: "base-old", policyIdentity: "sha256:policy-old" }) };
    const latest = { lapId: lapId("lap-latest"), reviewScope: scope({ sequence: 2, mergeBase: "base-old", policyIdentity: "sha256:policy-old" }) };

    expect(decide({ priorLaps: [earlier, latest], openSourceUnmapped: true })).toMatchObject({
      mode: "full", reason: "merge-base-changed", sequence: 3, predecessorLapId: lapId("lap-latest"),
    });
    expect(decide({ priorLaps: [{ lapId: lapId("lap-latest"), reviewScope: scope({ policyIdentity: "sha256:policy-old" }) }], openSourceUnmapped: true })).toMatchObject({
      mode: "full", reason: "version-changed", sequence: 2, predecessorLapId: lapId("lap-latest"),
    });
  });

  // Covers: task:3
  it("does not inspect a rebase kickback cause when the merge base changes", () => {
    for (const { priorLaps } of [
      { kickbackCause: "base-refresh", priorLaps: [{ lapId: lapId("lap-prior"), reviewScope: scope({ mergeBase: "base-old" }) }] },
      { kickbackCause: "feature-repair", priorLaps: [{ lapId: lapId("lap-prior"), reviewScope: scope({ mergeBase: "base-old" }) }] },
      { priorLaps: [{ lapId: lapId("lap-prior"), reviewScope: scope({ mergeBase: "base-old" }) }] },
    ]) {
      expect(decide({ priorLaps })).toMatchObject({ mode: "full", reason: "merge-base-changed" });
    }
  });

  // Covers: task:3
  it("prefers an unaccounted unreadable record over every other full-lap reason", () => {
    const unreadable = { lapId: lapId("lap-unreadable"), reviewScope: { kind: "unreadable" as const } };
    expect(decide({ priorLaps: [unreadable], openSourceUnmapped: true })).toMatchObject({
      mode: "full", reason: "record-unreadable", sequence: 1, unreadableLapIds: [lapId("lap-unreadable")],
    });

    expect(decide({
      priorLaps: [
        unreadable,
        { lapId: lapId("lap-readable"), reviewScope: scope({ unreadableLapIds: [lapId("lap-unreadable")] }) },
      ],
      openSourceUnmapped: true,
    })).toMatchObject({ mode: "full", reason: "open-source-unmapped", sequence: 2, unreadableLapIds: [] });
  });

  // Covers: task:4, task:8, task:9
  it("uses only unsettled hunks for a compatible later lap and reuses a same-lap decision", () => {
    const prior = { lapId: lapId("lap-prior"), reviewScope: scope() };
    const settled = [{ path: "src/example.ts", contentHash: "sha256:hunk-a" }];
    expect(decide({ priorLaps: [prior], settledHunks: settled })).toMatchObject({
      mode: "delta", reason: "delta", sequence: 2, predecessorLapId: lapId("lap-prior"), deltaHunks: [],
    });
    const current = scope({ sequence: 2, mode: "delta", reason: "delta", predecessorLapId: lapId("lap-prior"), deltaHunks: [] });
    expect(decide({ priorLaps: [prior, { lapId: lapId("lap-current"), reviewScope: current }] })).toBe(current);
  });

  // Covers: task:7, task:8, task:9
  it("maps precise and file-level sources conservatively and keeps live sources unsettled", () => {
    const files: readonly ChangedFileReference[] = [{
      path: "src/example.ts", changeKind: "modified",
      hunks: [{ oldStart: 1, oldCount: 1, newStart: 10, newCount: 3, contentHash: "sha256:hunk-a" }],
    }];
    const finding = {
      concernKind: "duplication", summary: "duplicate", evidenceLocations: [],
      anchor: { rubric: "implementationQuality" as const, locus: { path: "src/example.ts", contentHash: "sha256:hunk-a", display: "line" } },
    };
    expect(mapBuildReviewFindingToHunks(finding, files)).toEqual([{ kind: "hunks", hunks: [{ path: "src/example.ts", contentHash: "sha256:hunk-a" }] }]);
    const imprecise = { ...finding, anchor: { ...finding.anchor, locus: { ...finding.anchor.locus, contentHash: "sha256:missing" } } };
    expect(mapBuildReviewFindingToHunks(imprecise, files)).toEqual([{ kind: "file", path: "src/example.ts" }]);
    const lap = { reviewScope: scope(), findings: [{ sourceId: "source-a", finding }] };
    expect(settledBuildReviewHunks({ changedFiles: files, mergeBase: "base-a", policyIdentity: "sha256:policy-a", laps: [lap], nonBlockingSourceIds: new Set(["source-a"]) })).toEqual([{ path: "src/example.ts", contentHash: "sha256:hunk-a" }]);
    expect(settledBuildReviewHunks({ changedFiles: files, mergeBase: "base-a", policyIdentity: "sha256:policy-a", laps: [lap], nonBlockingSourceIds: new Set(["source-a"]), liveSourceIds: new Set(["source-a"]) })).toEqual([]);
  });
});
