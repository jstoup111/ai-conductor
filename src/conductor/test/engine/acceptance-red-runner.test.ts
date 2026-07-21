import { describe, it, expect } from "vitest";
import {
  parseAcceptanceRunContract,
  crossCheckTargetSpecs,
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
