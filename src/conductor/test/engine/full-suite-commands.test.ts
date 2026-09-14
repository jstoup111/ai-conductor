// Covers: task:3, task:4
import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const filesystemFixture = vi.hoisted(() => ({ rejectRealpathFor: "" }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    realpathSync: (...args: Parameters<typeof actual.realpathSync>) => {
      if (args[0] === filesystemFixture.rejectRealpathFor) {
        throw Object.assign(new Error("injected realpath failure"), { code: "EACCES" });
      }
      return actual.realpathSync(...args);
    },
  };
});

import { resolveFullSuiteCommandEntries } from "../../src/engine/full-suite-commands.js";

describe("resolveFullSuiteCommandEntries", () => {
  it("resolves ordered entries with entry, shared, and default values", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "full-suite-commands-"));
    await Promise.all([
      mkdir(join(projectRoot, "packages", "entry"), { recursive: true }),
      mkdir(join(projectRoot, "packages", "shared"), { recursive: true }),
    ]);

    try {
      expect(
        resolveFullSuiteCommandEntries({
          project_root: projectRoot,
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
          working_directory: join(projectRoot, "packages", "entry"),
          timeout_seconds: 120,
        },
        {
          command: "npm run test:shared-values",
          working_directory: join(projectRoot, "packages", "shared"),
          timeout_seconds: 900,
        },
        {
          command: "npm run test:defaults",
          working_directory: join(projectRoot, "packages", "shared"),
          timeout_seconds: 900,
        },
      ]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("falls back to the project root and default timeout without shared values", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "full-suite-commands-"));

    try {
      expect(
        resolveFullSuiteCommandEntries({
          project_root: projectRoot,
          commands: [
            { command: "npm run test:first" },
            { command: "npm run test:second" },
          ],
        }),
      ).toEqual([
        {
          command: "npm run test:first",
          working_directory: projectRoot,
          timeout_seconds: 1800,
        },
        {
          command: "npm run test:second",
          working_directory: projectRoot,
          timeout_seconds: 1800,
        },
      ]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("refuses the complete collection when a later entry directory is missing", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "full-suite-commands-"));
    await mkdir(join(projectRoot, "present"));

    try {
      expect(() =>
        resolveFullSuiteCommandEntries({
          project_root: projectRoot,
          commands: [
            { command: "npm run test:present", working_directory: "present" },
            { command: "npm run test:missing", working_directory: "missing" },
          ],
        }),
      ).toThrow("test_suite.commands[1].working_directory");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("refuses an outward symlink before returning any executable entries", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "full-suite-commands-"));
    const outside = await mkdtemp(join(tmpdir(), "full-suite-outside-"));
    try {
      await symlink(outside, join(projectRoot, "outward-link"));

      expect(() =>
        resolveFullSuiteCommandEntries({
          project_root: projectRoot,
          commands: [{ command: "npm run test", working_directory: "outward-link" }],
        }),
      ).toThrow("test_suite.commands[0].working_directory");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("does not bypass entry preflight when the configured project root is missing", () => {
    expect(() =>
      resolveFullSuiteCommandEntries({
        project_root: join(tmpdir(), "missing-full-suite-project-root"),
        commands: [{ command: "npm run test", working_directory: "missing" }],
      }),
    ).toThrow("test_suite.commands[0].working_directory");
  });

  it("refuses an unusable entry directory when realpath fails", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "full-suite-commands-"));
    const unusable = join(projectRoot, "unusable");
    await mkdir(unusable);
    filesystemFixture.rejectRealpathFor = unusable;

    try {
      expect(() =>
        resolveFullSuiteCommandEntries({
          project_root: projectRoot,
          commands: [{ command: "npm run test", working_directory: "unusable" }],
        }),
      ).toThrow("test_suite.commands[0].working_directory");
    } finally {
      filesystemFixture.rejectRealpathFor = "";
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
