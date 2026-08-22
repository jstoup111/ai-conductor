import { describe, expect, it } from "vitest";

import {
  engineStampFromEngineDir,
  parseBuildReviewEngineIdentity,
} from "../../src/engine/build-review-engine-identity.js";

describe("build-review engine identity", () => {
  it("derives a cache-safe stamp from versioned and development engine directories", () => {
    const versioned = engineStampFromEngineDir(
      "/x/dist-versions/20260820T204302Z-31b5c81beaec/engine",
    );
    const development = engineStampFromEngineDir("/repo/src/conductor/dist/engine");

    expect(versioned).toBe("31b5c81beaec");
    expect(development).toBe("dev");
    expect(versioned).not.toContain("T");
    expect(versioned).not.toContain("Z");
    expect(development).not.toContain("T");
    expect(development).not.toContain("Z");
  });

  it("rejects malformed build-review engine identities", () => {
    expect(parseBuildReviewEngineIdentity({})).toBeUndefined();
    expect(parseBuildReviewEngineIdentity({ engineStamp: "", skillDigest: "x" })).toBeUndefined();
    expect(parseBuildReviewEngineIdentity({ engineStamp: "abc", skillDigest: "" })).toBeUndefined();
    expect(parseBuildReviewEngineIdentity({ engineStamp: "abc", skillDigest: 1 })).toBeUndefined();
    expect(parseBuildReviewEngineIdentity({ engineStamp: 1, skillDigest: "def" })).toBeUndefined();
    expect(parseBuildReviewEngineIdentity("not an object")).toBeUndefined();
  });

  it("parses a well-formed build-review engine identity", () => {
    expect(parseBuildReviewEngineIdentity({ engineStamp: "abc", skillDigest: "def" })).toEqual({
      engineStamp: "abc",
      skillDigest: "def",
    });
  });
});
