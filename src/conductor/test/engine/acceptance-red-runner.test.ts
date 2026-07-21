import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseAcceptanceRunContract,
  crossCheckTargetSpecs,
  checkContractCwd,
  writeRedMarkerAtRoot,
} from "../../src/engine/acceptance-red-runner";

describe("parseAcceptanceRunContract", () => {
  it("returns ok:true with the parsed contract for valid JSON", () => {
    const raw = JSON.stringify({
      command: "npm test",
      cwd: "/repo",
      targetSpecs: ["spec/foo.test.ts"],
    });

    const result = parseAcceptanceRunContract(raw);

    expect(result).toEqual({
      ok: true,
      contract: {
        command: "npm test",
        cwd: "/repo",
        targetSpecs: ["spec/foo.test.ts"],
      },
    });
  });

  it("returns ok:false for non-JSON input", () => {
    const result = parseAcceptanceRunContract("not json at all");

    expect(result.ok).toBe(false);
  });

  it("returns ok:false when command is missing", () => {
    const raw = JSON.stringify({
      cwd: "/repo",
      targetSpecs: ["spec/foo.test.ts"],
    });

    const result = parseAcceptanceRunContract(raw);

    expect(result.ok).toBe(false);
  });

  it("returns ok:false when targetSpecs is empty", () => {
    const raw = JSON.stringify({
      command: "npm test",
      cwd: "/repo",
      targetSpecs: [],
    });

    const result = parseAcceptanceRunContract(raw);

    expect(result.ok).toBe(false);
  });
});

describe("crossCheckTargetSpecs", () => {
  it("returns ok:false when targetSpecs are not among committed specs", () => {
    const contract = {
      command: "npm test",
      cwd: "/repo",
      targetSpecs: ["b.test.ts"],
    };

    const result = crossCheckTargetSpecs(contract, ["a.test.ts"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/targetSpecs .* not among committed specs/);
    }
  });

  it("returns ok:true with the contract when all targetSpecs are committed", () => {
    const contract = {
      command: "npm test",
      cwd: "/repo",
      targetSpecs: ["a.test.ts"],
    };

    const result = crossCheckTargetSpecs(contract, ["a.test.ts"]);

    expect(result).toEqual({ ok: true, contract });
  });
});

describe("checkContractCwd", () => {
  it("returns ok:false when the contract cwd is absent under the worktree", () => {
    const contract = {
      command: "npm test",
      cwd: "does-not-exist",
      targetSpecs: ["a.test.ts"],
    };

    const result = checkContractCwd(contract, __dirname);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/contract cwd not found/);
    }
  });

  it("returns ok:false when the contract cwd escapes the worktree via ../", () => {
    const contract = {
      command: "npm test",
      cwd: "../../etc",
      targetSpecs: ["a.test.ts"],
    };

    const result = checkContractCwd(contract, __dirname);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/contract cwd not found/);
    }
  });

  it("returns ok:true when the contract cwd exists under the worktree", () => {
    const contract = {
      command: "npm test",
      cwd: ".",
      targetSpecs: ["a.test.ts"],
    };

    const result = checkContractCwd(contract, __dirname);

    expect(result).toEqual({ ok: true, contract });
  });
});

describe("writeRedMarkerAtRoot", () => {
  let worktreeRoot: string;

  afterEach(() => {
    if (worktreeRoot) {
      rmSync(worktreeRoot, { recursive: true, force: true });
    }
  });

  it("writes the marker at <worktree>/.pipeline/acceptance-specs-red.json, never a nested path", () => {
    worktreeRoot = mkdtempSync(join(tmpdir(), "acceptance-red-runner-"));
    const markerContent = {
      executed: 3,
      passed: 0,
      failed: 3,
      skipped: 0,
      errors: 0,
      command: "npm test",
      targetSpecs: ["a.test.ts"],
    };

    writeRedMarkerAtRoot(worktreeRoot, markerContent);

    const rootPath = join(worktreeRoot, ".pipeline", "acceptance-specs-red.json");
    const nestedPath = join(worktreeRoot, "src", "conductor", ".pipeline", "acceptance-specs-red.json");

    expect(existsSync(rootPath)).toBe(true);
    expect(existsSync(nestedPath)).toBe(false);
    expect(JSON.parse(readFileSync(rootPath, "utf8"))).toEqual(markerContent);
  });
});
