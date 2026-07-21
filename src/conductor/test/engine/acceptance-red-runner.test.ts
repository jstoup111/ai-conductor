import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseAcceptanceRunContract,
  crossCheckTargetSpecs,
  checkContractCwd,
  writeRedMarkerAtRoot,
  normalizeNestedRedMarker,
  selfHealAcceptanceRed,
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

describe("normalizeNestedRedMarker", () => {
  let worktreeRoot: string;

  afterEach(() => {
    if (worktreeRoot) {
      rmSync(worktreeRoot, { recursive: true, force: true });
    }
  });

  it("relocates a stray nested marker up to the root path when no root marker exists", () => {
    worktreeRoot = mkdtempSync(join(tmpdir(), "acceptance-red-runner-"));
    const nestedDir = join(worktreeRoot, "src", "conductor", ".pipeline");
    const nestedPath = join(nestedDir, "acceptance-specs-red.json");
    const rootPath = join(worktreeRoot, ".pipeline", "acceptance-specs-red.json");
    const nestedContent = {
      executed: 2,
      passed: 0,
      failed: 2,
      skipped: 0,
      errors: 0,
      command: "npm test",
      targetSpecs: ["b.test.ts"],
    };

    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(nestedPath, JSON.stringify(nestedContent), "utf8");

    normalizeNestedRedMarker(worktreeRoot);

    expect(existsSync(rootPath)).toBe(true);
    expect(existsSync(nestedPath)).toBe(false);
    expect(JSON.parse(readFileSync(rootPath, "utf8"))).toEqual(nestedContent);
  });

  it("leaves the root marker untouched when both root and nested markers exist", () => {
    worktreeRoot = mkdtempSync(join(tmpdir(), "acceptance-red-runner-"));
    const nestedDir = join(worktreeRoot, "src", "conductor", ".pipeline");
    const nestedPath = join(nestedDir, "acceptance-specs-red.json");
    const rootDir = join(worktreeRoot, ".pipeline");
    const rootPath = join(rootDir, "acceptance-specs-red.json");

    const rootContent = {
      executed: 3,
      passed: 0,
      failed: 3,
      skipped: 0,
      errors: 0,
      command: "npm test",
      targetSpecs: ["a.test.ts"],
    };
    const nestedContent = {
      executed: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      errors: 0,
      command: "npm test",
      targetSpecs: ["b.test.ts"],
    };

    mkdirSync(rootDir, { recursive: true });
    writeFileSync(rootPath, JSON.stringify(rootContent), "utf8");
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(nestedPath, JSON.stringify(nestedContent), "utf8");

    normalizeNestedRedMarker(worktreeRoot);

    expect(JSON.parse(readFileSync(rootPath, "utf8"))).toEqual(rootContent);
  });
});

describe("selfHealAcceptanceRed", () => {
  let worktreeRoot: string;

  afterEach(() => {
    if (worktreeRoot) {
      rmSync(worktreeRoot, { recursive: true, force: true });
    }
  });

  it("runs the contract command via exec and writes a passing RED marker at root", async () => {
    worktreeRoot = mkdtempSync(join(tmpdir(), "acceptance-red-runner-"));
    const pipelineDir = join(worktreeRoot, ".pipeline");
    mkdirSync(pipelineDir, { recursive: true });
    const contractPath = join(pipelineDir, "acceptance-specs-run.json");
    writeFileSync(
      contractPath,
      JSON.stringify({
        command: "npm test",
        cwd: ".",
        targetSpecs: ["a.test.ts"],
      }),
      "utf8",
    );

    const execCalls: { command: string; cwd: string }[] = [];
    const exec = async (command: string, opts: { cwd: string }) => {
      execCalls.push({ command, cwd: opts.cwd });
      return {
        command,
        targetSpecs: ["a.test.ts"],
        executed: 3,
        passed: 0,
        failed: 3,
        skipped: 0,
        errors: 0,
      };
    };

    const result = await selfHealAcceptanceRed({
      worktree: worktreeRoot,
      specFiles: ["a.test.ts"],
      exec,
    });

    expect(execCalls).toEqual([{ command: "npm test", cwd: join(worktreeRoot, ".") }]);
    expect(result).toEqual({ healed: true });

    const rootPath = join(worktreeRoot, ".pipeline", "acceptance-specs-red.json");
    expect(existsSync(rootPath)).toBe(true);
    expect(JSON.parse(readFileSync(rootPath, "utf8"))).toEqual({
      command: "npm test",
      targetSpecs: ["a.test.ts"],
      executed: 3,
      passed: 0,
      failed: 3,
      skipped: 0,
      errors: 0,
    });
  });

  it("returns healed:false without calling exec when targetSpecs cross-check fails", async () => {
    worktreeRoot = mkdtempSync(join(tmpdir(), "acceptance-red-runner-"));
    const pipelineDir = join(worktreeRoot, ".pipeline");
    mkdirSync(pipelineDir, { recursive: true });
    const contractPath = join(pipelineDir, "acceptance-specs-run.json");
    writeFileSync(
      contractPath,
      JSON.stringify({
        command: "npm test",
        cwd: ".",
        targetSpecs: ["missing.test.ts"],
      }),
      "utf8",
    );

    let execCalled = false;
    const exec = async () => {
      execCalled = true;
      return {};
    };

    const result = await selfHealAcceptanceRed({
      worktree: worktreeRoot,
      specFiles: ["a.test.ts"],
      exec,
    });

    expect(execCalled).toBe(false);
    expect(result.healed).toBe(false);
    if (!result.healed) {
      expect(result.reason).toMatch(/not among committed specs/);
    }
  });
});
