import { describe, it, expect } from "vitest";
import { parseAcceptanceRunContract } from "../../src/engine/acceptance-red-runner";

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
