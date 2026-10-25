// Covers: task:2, task:7
import { describe, expect, it } from "vitest";

import {
  buildReviewPolicyIdentity,
  decideBuildReviewReviewScope,
  mapBuildReviewFindingToHunks,
  settledBuildReviewHunks,
  type BuildReviewPolicyIdentityInputs,
} from "../../src/engine/build-review-review-frontier.js";
import { isBuildReviewFindingOutOfDelta } from "../../src/engine/build-review-aggregate.js";
import type { BuildReviewReviewScope } from "../../src/engine/build-review-artifacts.js";
import type {
  BuildReviewCustomFinding,
  BuildReviewFinding,
  BuildReviewLapId,
} from "../../src/engine/build-review-domain.js";
import {
  buildReviewFindingReferenceContext,
  parseBuildReviewFindingAnchor,
} from "../../src/engine/build-review-domain.js";
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

  // Covers: task:7
  it("maps built-in anchors by content hash and falls back when their hunk is gone", () => {
    const files: readonly ChangedFileReference[] = [
      {
        path: "src/auth.ts", changeKind: "modified",
        hunks: [{ oldStart: 1, oldCount: 1, newStart: 4, newCount: 2, contentHash: "sha256:auth" }],
      },
      {
        path: "src/domain.ts", changeKind: "modified",
        hunks: [{ oldStart: 8, oldCount: 1, newStart: 8, newCount: 1, contentHash: "sha256:domain" }],
      },
    ];
    const security = {
      concernKind: "injection", summary: "unsafe command", evidenceLocations: [],
      anchor: { rubric: "security" as const, locus: { path: "src/auth.ts", contentHash: "sha256:auth", display: "command" } },
    } satisfies BuildReviewFinding;
    const implementation = {
      concernKind: "duplication", summary: "duplicate", evidenceLocations: [],
      anchor: { rubric: "implementationQuality" as const, locus: { path: "src/domain.ts", contentHash: "sha256:domain", display: "branch" } },
    } satisfies BuildReviewFinding;

    expect(mapBuildReviewFindingToHunks(security, files)).toEqual([{ kind: "hunks", hunks: [{ path: "src/auth.ts", contentHash: "sha256:auth" }] }]);
    expect(mapBuildReviewFindingToHunks(implementation, files)).toEqual([{ kind: "hunks", hunks: [{ path: "src/domain.ts", contentHash: "sha256:domain" }] }]);
    expect(mapBuildReviewFindingToHunks({
      ...security,
      anchor: { ...security.anchor, locus: { ...security.anchor.locus, contentHash: "sha256:gone" } },
    }, files)).toEqual([{ kind: "file", path: "src/auth.ts" }]);
  });

  // Covers: task:7
  it("intersects custom and test-quality source regions with new-side hunks", () => {
    const files: readonly ChangedFileReference[] = [{
      path: "test/widget.test.ts", changeKind: "modified",
      hunks: [
        { oldStart: 2, oldCount: 1, newStart: 10, newCount: 3, contentHash: "sha256:first" },
        { oldStart: 20, oldCount: 1, newStart: 30, newCount: 2, contentHash: "sha256:second" },
      ],
    }];
    const testRegion = {
      path: "test/widget.test.ts", startLine: 12, endLine: 30,
      contentHash: "sha256:anchored-test", display: "widget persists state",
    };
    const custom = {
      concernId: "custom:coverage", summary: "coverage gap", evidenceLocations: [],
      sourceRegions: [testRegion],
    } satisfies BuildReviewCustomFinding;
    const references = buildReviewFindingReferenceContext({
      rubric: "testQuality",
      changedTestSelectors: [testRegion.path],
      changedFiles: files,
      testScope: {
        targets: [{
          source: { fileName: testRegion.path, side: "head" },
          declaration: {
            kind: "test", titleChain: [testRegion.display], occurrence: 0,
            span: { start: 30, end: 90 },
          },
        }],
        evidence: [{
          source: { fileName: testRegion.path, side: "head" },
          region: { start: 30, end: 90 },
          startLine: testRegion.startLine, endLine: testRegion.endLine,
        }],
      },
    } as never);
    const anchor = parseBuildReviewFindingAnchor({
      rubric: "testQuality",
      locus: {
        path: testRegion.path,
        contentHash: "sha256:66f03846005a531480a01c22ab5e34b127efca5d4dbd2e0a92c9222be72f7c3d",
        display: testRegion.display,
      },
    }, references)!;
    const testQuality = {
      concernKind: "test-insensitive", summary: "does not observe", evidenceLocations: [],
      anchor,
    } satisfies BuildReviewFinding;

    const expected = [{
      kind: "hunks",
      hunks: [
        { path: "test/widget.test.ts", contentHash: "sha256:first" },
        { path: "test/widget.test.ts", contentHash: "sha256:second" },
      ],
    }];
    expect(mapBuildReviewFindingToHunks(testQuality, files)).toEqual(expected);
    expect(mapBuildReviewFindingToHunks(custom, files)).toEqual(expected);
    expect(mapBuildReviewFindingToHunks({ ...custom, sourceRegions: [{ ...testRegion, startLine: 20, endLine: 21 }] }, files)).toEqual([
      { kind: "file", path: "test/widget.test.ts" },
    ]);
  });

  // Covers: task:7
  it("preserves every custom path and keeps a fallback path in delta scope", () => {
    const files: readonly ChangedFileReference[] = [
      {
        path: "src/intersects.ts", changeKind: "modified",
        hunks: [{ oldStart: 2, oldCount: 1, newStart: 10, newCount: 2, contentHash: "sha256:intersects" }],
      },
      {
        path: "src/fallback.ts", changeKind: "modified",
        hunks: [{ oldStart: 2, oldCount: 1, newStart: 30, newCount: 2, contentHash: "sha256:fallback" }],
      },
    ];
    const finding = {
      concernId: "custom:two-paths", summary: "cross-file concern", evidenceLocations: [],
      sourceRegions: [
        { path: "src/intersects.ts", startLine: 10, endLine: 10, contentHash: "sha256:region-a", display: "first" },
        { path: "src/fallback.ts", startLine: 3, endLine: 3, contentHash: "sha256:region-b", display: "second" },
      ],
    } satisfies BuildReviewCustomFinding;

    expect(mapBuildReviewFindingToHunks(finding, files)).toEqual([
      { kind: "hunks", hunks: [{ path: "src/intersects.ts", contentHash: "sha256:intersects" }] },
      { kind: "file", path: "src/fallback.ts" },
    ]);
    expect(isBuildReviewFindingOutOfDelta(finding, {
      changedFiles: files,
      reviewScope: { mode: "delta", deltaHunks: [{ path: "src/fallback.ts", contentHash: "sha256:fallback" }] },
    })).toBe(false);
  });

  // Covers: task:7
  it("deduplicates identical hunk identities and maps a fused hunk only once", () => {
    const repeated: readonly ChangedFileReference[] = [{
      path: "src/repeated.ts", changeKind: "modified",
      hunks: [
        { oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, contentHash: "sha256:same" },
        { oldStart: 20, oldCount: 1, newStart: 20, newCount: 1, contentHash: "sha256:same" },
      ],
    }];
    const repeatedFinding = {
      concernKind: "duplication", summary: "same bytes", evidenceLocations: [],
      anchor: { rubric: "implementationQuality" as const, locus: { path: "src/repeated.ts", contentHash: "sha256:same", display: "duplicate hunk" } },
    } satisfies BuildReviewFinding;
    const fused: readonly ChangedFileReference[] = [{
      path: "src/fused.ts", changeKind: "modified",
      hunks: [{ oldStart: 10, oldCount: 2, newStart: 10, newCount: 3, contentHash: "sha256:fused" }],
    }];
    const fusedFinding = {
      concernKind: "duplication", summary: "fused edit", evidenceLocations: [],
      anchor: { rubric: "implementationQuality" as const, locus: { path: "src/fused.ts", contentHash: "sha256:fused", display: "fused hunk" } },
    } satisfies BuildReviewFinding;

    expect(mapBuildReviewFindingToHunks(repeatedFinding, repeated)).toEqual([
      { kind: "hunks", hunks: [{ path: "src/repeated.ts", contentHash: "sha256:same" }] },
    ]);
    expect(mapBuildReviewFindingToHunks(fusedFinding, fused)).toEqual([
      { kind: "hunks", hunks: [{ path: "src/fused.ts", contentHash: "sha256:fused" }] },
    ]);
  });
});
