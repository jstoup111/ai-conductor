import { describe, expect, it, vi } from "vitest";
import {
  cacheEntryPath,
  readBuildReviewCacheEntry,
  writeBuildReviewCacheEntry,
  type BuildReviewCacheEntry,
  type BuildReviewCacheFilesystem,
} from "../../src/engine/build-review-cache.js";

function entry(snapshotDigest = "snapshot-a"): BuildReviewCacheEntry {
  return {
    version: 1,
    rubric: "scope",
    contractVersion: "v1",
    projectionVersion: "v1",
    projectionDigest: "sha256:projection-a",
    policyFingerprint: "sha256:policy-a",
    result: {
      kind: "judged",
      rubric: "scope",
      lapId: "lap-a" as never,
      snapshotDigest,
      contractVersion: "v1" as never,
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
});
