// Covers: task:2
import { describe, expect, it } from "vitest";

import {
  buildReviewPolicyIdentity,
  type BuildReviewPolicyIdentityInputs,
} from "../../src/engine/build-review-review-frontier.js";

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
});
