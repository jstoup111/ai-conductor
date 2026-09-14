// Covers: task:3
import { describe, expect, it } from "vitest";
import { resolveFullSuiteCommandEntries } from "../../src/engine/full-suite-commands.js";

describe("resolveFullSuiteCommandEntries", () => {
  it("resolves ordered entries with entry, shared, and default values", () => {
    expect(
      resolveFullSuiteCommandEntries({
        project_root: "/workspace/project",
        command: "npm run test:shared",
        working_directory: "packages/shared",
        timeout_seconds: 900,
        commands: [
          {
            command: "npm run test:entry",
            working_directory: "packages/entry",
            timeout_seconds: 120,
          },
          { command: "npm run test:shared-values" },
          { command: "npm run test:defaults" },
        ],
      }),
    ).toEqual([
      {
        command: "npm run test:entry",
        working_directory: "/workspace/project/packages/entry",
        timeout_seconds: 120,
      },
      {
        command: "npm run test:shared-values",
        working_directory: "/workspace/project/packages/shared",
        timeout_seconds: 900,
      },
      {
        command: "npm run test:defaults",
        working_directory: "/workspace/project/packages/shared",
        timeout_seconds: 900,
      },
    ]);
  });

  it("falls back to the project root and default timeout without shared values", () => {
    expect(
      resolveFullSuiteCommandEntries({
        project_root: "/workspace/project",
        commands: [
          { command: "npm run test:first" },
          { command: "npm run test:second" },
        ],
      }),
    ).toEqual([
      {
        command: "npm run test:first",
        working_directory: "/workspace/project",
        timeout_seconds: 1800,
      },
      {
        command: "npm run test:second",
        working_directory: "/workspace/project",
        timeout_seconds: 1800,
      },
    ]);
  });
});
