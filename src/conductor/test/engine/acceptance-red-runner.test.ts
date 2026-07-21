import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selfHealAcceptanceRed } from "../../src/engine/acceptance-red-runner";

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

  it("returns healed:false without calling exec when no contract file is present", async () => {
    worktreeRoot = mkdtempSync(join(tmpdir(), "acceptance-red-runner-"));

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
      expect(result.reason).toMatch(/run contract missing/);
    }
  });

  it("returns healed:false without calling exec when the contract file has malformed JSON", async () => {
    worktreeRoot = mkdtempSync(join(tmpdir(), "acceptance-red-runner-"));
    const pipelineDir = join(worktreeRoot, ".pipeline");
    mkdirSync(pipelineDir, { recursive: true });
    writeFileSync(join(pipelineDir, "acceptance-specs-run.json"), "{ not valid json", "utf8");

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
      expect(result.reason).toMatch(/invalid run contract JSON/);
    }
  });

  it("returns healed:false without calling exec when the contract is missing the command field", async () => {
    worktreeRoot = mkdtempSync(join(tmpdir(), "acceptance-red-runner-"));
    const pipelineDir = join(worktreeRoot, ".pipeline");
    mkdirSync(pipelineDir, { recursive: true });
    writeFileSync(
      join(pipelineDir, "acceptance-specs-run.json"),
      JSON.stringify({ cwd: ".", targetSpecs: ["a.test.ts"] }),
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
      expect(result.reason).toMatch(/missing command/);
    }
  });

  function writeContract(root: string): void {
    const pipelineDir = join(root, ".pipeline");
    mkdirSync(pipelineDir, { recursive: true });
    writeFileSync(
      join(pipelineDir, "acceptance-specs-run.json"),
      JSON.stringify({
        command: "npm test",
        cwd: ".",
        targetSpecs: ["a.test.ts"],
      }),
      "utf8",
    );
  }

  it("returns healed:false with a real-evidence reason when the run looks GREEN (failed==0, passed>0)", async () => {
    worktreeRoot = mkdtempSync(join(tmpdir(), "acceptance-red-runner-"));
    writeContract(worktreeRoot);

    const exec = async (command: string) => ({
      command,
      targetSpecs: ["a.test.ts"],
      executed: 3,
      passed: 3,
      failed: 0,
      skipped: 0,
      errors: 0,
    });

    const result = await selfHealAcceptanceRed({
      worktree: worktreeRoot,
      specFiles: ["a.test.ts"],
      exec,
    });

    expect(result).toEqual({
      healed: false,
      reason:
        "acceptance-specs RED run shows 0 failed — RED not established; the generated specs must FAIL before implementation",
    });
  });

  it("returns healed:false with a real-evidence reason when specs were skipped and none executed", async () => {
    worktreeRoot = mkdtempSync(join(tmpdir(), "acceptance-red-runner-"));
    writeContract(worktreeRoot);

    const exec = async (command: string) => ({
      command,
      targetSpecs: ["a.test.ts"],
      executed: 0,
      passed: 0,
      failed: 0,
      skipped: 3,
      errors: 0,
    });

    const result = await selfHealAcceptanceRed({
      worktree: worktreeRoot,
      specFiles: ["a.test.ts"],
      exec,
    });

    expect(result).toEqual({
      healed: false,
      reason:
        "3 acceptance spec(s) were SKIPPED — a skipped spec does not establish RED (missing testcontainer/dependency, or a unit-only test scope?). Bring up the required infra and run the feature's specs so they actually execute",
    });
  });

  it("returns healed:false with a real-evidence reason when the run errored at collection", async () => {
    worktreeRoot = mkdtempSync(join(tmpdir(), "acceptance-red-runner-"));
    writeContract(worktreeRoot);

    const exec = async (command: string) => ({
      command,
      targetSpecs: ["a.test.ts"],
      executed: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      errors: 2,
    });

    const result = await selfHealAcceptanceRed({
      worktree: worktreeRoot,
      specFiles: ["a.test.ts"],
      exec,
    });

    expect(result).toEqual({
      healed: false,
      reason:
        "acceptance specs errored at collection (2) — they never ran; fix the specs so they execute (this is not RED)",
    });
  });

  it("returns healed:false with a real-evidence reason when executed==0", async () => {
    worktreeRoot = mkdtempSync(join(tmpdir(), "acceptance-red-runner-"));
    writeContract(worktreeRoot);

    const exec = async (command: string) => ({
      command,
      targetSpecs: ["a.test.ts"],
      executed: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      errors: 0,
    });

    const result = await selfHealAcceptanceRed({
      worktree: worktreeRoot,
      specFiles: ["a.test.ts"],
      exec,
    });

    expect(result).toEqual({
      healed: false,
      reason: "acceptance-specs RED run executed 0 tests — the command did not select the feature's specs",
    });
  });

  it("returns healed:false without calling exec when the run contract file is absent", async () => {
    worktreeRoot = mkdtempSync(join(tmpdir(), "acceptance-red-runner-"));
    // no .pipeline/acceptance-specs-run.json written at all

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
      expect(result.reason).toMatch(/run contract missing/);
    }
  });

  it("returns healed:false without calling exec when the run contract file has malformed JSON", async () => {
    worktreeRoot = mkdtempSync(join(tmpdir(), "acceptance-red-runner-"));
    const pipelineDir = join(worktreeRoot, ".pipeline");
    mkdirSync(pipelineDir, { recursive: true });
    writeFileSync(join(pipelineDir, "acceptance-specs-run.json"), "{ not json", "utf8");

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
      expect(result.reason).toMatch(/invalid run contract JSON/);
    }
  });

  it("returns healed:false without calling exec when the contract cwd is absent under the worktree", async () => {
    worktreeRoot = mkdtempSync(join(tmpdir(), "acceptance-red-runner-"));
    const pipelineDir = join(worktreeRoot, ".pipeline");
    mkdirSync(pipelineDir, { recursive: true });
    writeFileSync(
      join(pipelineDir, "acceptance-specs-run.json"),
      JSON.stringify({
        command: "npm test",
        cwd: "does-not-exist",
        targetSpecs: ["a.test.ts"],
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
      expect(result.reason).toMatch(/contract cwd not found/);
    }
  });

  it("relocates and removes a stray nested marker before writing a fresh RED marker at root", async () => {
    worktreeRoot = mkdtempSync(join(tmpdir(), "acceptance-red-runner-"));
    writeContract(worktreeRoot);

    const nestedDir = join(worktreeRoot, "src", "conductor", ".pipeline");
    const nestedPath = join(nestedDir, "acceptance-specs-red.json");
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(nestedPath, JSON.stringify({ stale: true }), "utf8");

    const exec = async (command: string) => ({
      command,
      targetSpecs: ["a.test.ts"],
      executed: 3,
      passed: 0,
      failed: 3,
      skipped: 0,
      errors: 0,
    });

    const result = await selfHealAcceptanceRed({
      worktree: worktreeRoot,
      specFiles: ["a.test.ts"],
      exec,
    });

    expect(result).toEqual({ healed: true });
    expect(existsSync(nestedPath)).toBe(false);

    const rootPath = join(worktreeRoot, ".pipeline", "acceptance-specs-red.json");
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

  it("returns healed:false without calling exec when the run contract is missing the command field", async () => {
    worktreeRoot = mkdtempSync(join(tmpdir(), "acceptance-red-runner-"));
    const pipelineDir = join(worktreeRoot, ".pipeline");
    mkdirSync(pipelineDir, { recursive: true });
    writeFileSync(
      join(pipelineDir, "acceptance-specs-run.json"),
      JSON.stringify({
        cwd: ".",
        targetSpecs: ["a.test.ts"],
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
      expect(result.reason).toMatch(/missing command/);
    }
  });
});
