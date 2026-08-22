import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  digestRubricSkill,
  engineStampFromEngineDir,
  parseBuildReviewEngineIdentity,
  SkillDigestUnavailable,
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

  it("digests the exact rubric skill bytes from the injected filesystem", async () => {
    const bytes = Buffer.from("# Scope\n\nPreserve this trailing space: ");
    const readFile = async (path: string): Promise<Buffer> => {
      expect(path).toBe("/h/skills/build-review-scope/SKILL.md");
      return bytes;
    };

    const digest = await digestRubricSkill({
      harnessRoot: "/h",
      skillName: "build-review-scope",
      readFile,
    });

    expect(digest).toBe(`sha256:${createHash("sha256").update(bytes).digest("hex")}`);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("distinguishes whitespace-only rubric skill edits", async () => {
    const digest = async (bytes: Uint8Array) =>
      digestRubricSkill({
        harnessRoot: "/h",
        skillName: "build-review-scope",
        readFile: async () => bytes,
      });

    const [withoutTrailingSpace, withTrailingSpace] = await Promise.all([
      digest(Buffer.from("# Scope\n")),
      digest(Buffer.from("# Scope\n ")),
    ]);

    expect(withoutTrailingSpace).not.toBe(withTrailingSpace);
  });

  it("reports unreadable rubric skill text as a typed error with its path", async () => {
    const expectedPath = "/h/skills/build-review-scope/SKILL.md";

    await expect(
      digestRubricSkill({
        harnessRoot: "/h",
        skillName: "build-review-scope",
        readFile: async () => {
          throw new Error("EACCES");
        },
      }),
    ).rejects.toMatchObject({
      name: "SkillDigestUnavailable",
      path: expectedPath,
    });

    await expect(
      digestRubricSkill({
        harnessRoot: "/h",
        skillName: "build-review-scope",
        readFile: async () => {
          throw new Error("EACCES");
        },
      }),
    ).rejects.toBeInstanceOf(SkillDigestUnavailable);
  });
});
