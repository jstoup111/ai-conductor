// Covers: task:15
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildSpoolExporters, resolveSpoolDir } from "../../../src/engine/otel/spool-wiring.js";
import type { ConductorEventEmitter } from "../../../src/ui/events.js";

const execFile = promisify(execFileCallback);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("resolveSpoolDir", () => {
  it("uses the linked worktree's main checkout for the durable spool", async () => {
    const root = await mkdtemp(join(tmpdir(), "spool-wiring-"));
    temporaryDirectories.push(root);
    const mainRoot = join(root, "main");
    const worktree = join(root, "linked-worktree");
    await mkdir(mainRoot, { recursive: true });

    await execFile("git", ["init", "--initial-branch=main", mainRoot]);
    await execFile("git", ["-C", mainRoot, "config", "user.email", "test@example.com"]);
    await execFile("git", ["-C", mainRoot, "config", "user.name", "Test User"]);
    await execFile("git", ["-C", mainRoot, "commit", "--allow-empty", "-m", "initial"]);
    await execFile("git", ["-C", mainRoot, "worktree", "add", "-b", "linked", worktree]);
    await mkdir(join(worktree, "src"));

    const spoolDir = await resolveSpoolDir(join(worktree, "src"));

    expect(spoolDir).toBe(join(mainRoot, ".daemon", "otel-spool"));
    expect(dirname(spoolDir!)).not.toBe(join(worktree, ".daemon"));
  });

  it("disables the spool and warns once when no main checkout can be resolved", async () => {
    const directory = await mkdtemp(join(tmpdir(), "spool-wiring-non-git-"));
    temporaryDirectories.push(directory);
    const emit = vi.fn().mockResolvedValue(undefined);
    const events = { emit } as unknown as ConductorEventEmitter;
    const config = {
      enabled: true as const,
      exporter: "otlp" as const,
      endpoint: "http://localhost:4318",
      spool: { enabled: true, maxBytes: 1024 },
    };

    await buildSpoolExporters(config, directory, events);
    await buildSpoolExporters(config, directory, events);

    expect(emit).toHaveBeenCalledTimes(1);
  });
});
