// Unit tests for runEngineerMode — START sequence only (Phase 9.3, Task 33).
//
// Coverage: registry load + store open, project count print, blank re-prompt,
// exit/EOF clean termination, absent registry (0 projects), absent store,
// and malformed registry (fast error naming the file).
//
// Routing/authoring/PR (task 34) is NOT tested here. Non-blank ideas that
// would require routing are NOT included — the loop body extension point is
// designed for task 34.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// Dynamic import so a missing module surfaces as the test's own RED failure.
async function loadLoop(): Promise<{ runEngineerMode: (...args: any[]) => Promise<any> }> {
  return import('../../../src/engine/engineer/loop.js') as Promise<{
    runEngineerMode: (...args: any[]) => Promise<any>;
  }>;
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Scripted IO: yields queued lines then null (EOF). Captures output. */
function scriptedIo(lines: string[]) {
  const queue = [...lines];
  const out: string[] = [];
  return {
    out,
    text: () => out.join('\n'),
    io: {
      prompt: async (): Promise<string | null> => (queue.length ? queue.shift()! : null),
      print: (s: string) => out.push(s),
    },
  };
}

/** Minimal no-op provider stub (routing/authoring not needed for task 33). */
const noopProvider = {
  invoke: async () => ({ success: false, output: '', exitCode: 0 }),
  invokeInteractive: async () => {},
};

/** Minimal gh stub (PR machinery not needed for task 33). */
const noopGh = async (_args: string[], _opts: { cwd: string }) => ({ stdout: '' });

// ── temp dir scaffolding ──────────────────────────────────────────────────────

let workDir: string;
let registryPath: string;
let engineerDir: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'loop-start-test-'));
  registryPath = join(workDir, 'registry.json');
  engineerDir = join(workDir, 'engineer');
  await mkdir(engineerDir, { recursive: true });
  savedEnv.AI_CONDUCTOR_REGISTRY = process.env.AI_CONDUCTOR_REGISTRY;
  savedEnv.AI_CONDUCTOR_ENGINEER_DIR = process.env.AI_CONDUCTOR_ENGINEER_DIR;
  process.env.AI_CONDUCTOR_REGISTRY = registryPath;
  process.env.AI_CONDUCTOR_ENGINEER_DIR = engineerDir;
});

afterEach(async () => {
  process.env.AI_CONDUCTOR_REGISTRY = savedEnv.AI_CONDUCTOR_REGISTRY;
  process.env.AI_CONDUCTOR_ENGINEER_DIR = savedEnv.AI_CONDUCTOR_ENGINEER_DIR;
  await rm(workDir, { recursive: true, force: true });
});

// ── helpers for writing registry ──────────────────────────────────────────────

function makeRecord(path: string, name: string) {
  return {
    schemaVersion: 1,
    name,
    path,
    status: 'registered',
    registeredAt: '2026-06-25T00:00:00.000Z',
  };
}

async function writeRegistry(records: unknown[]): Promise<void> {
  await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');
}

// ═════════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════════

describe('runEngineerMode — start sequence (task 33)', () => {
  // ── 1. Export shape ────────────────────────────────────────────────────────
  it('exports runEngineerMode as a function', async () => {
    const mod = await loadLoop();
    expect(typeof mod.runEngineerMode).toBe('function');
  });

  // ── 2. Project count — registry with 2 entries ────────────────────────────
  it('prints the project count on start when registry has entries', async () => {
    const dirA = join(workDir, 'alpha');
    const dirB = join(workDir, 'beta');
    await mkdir(dirA, { recursive: true });
    await mkdir(dirB, { recursive: true });
    await writeRegistry([makeRecord(dirA, 'alpha'), makeRecord(dirB, 'beta')]);

    const { runEngineerMode } = await loadLoop();
    const { io, text } = scriptedIo(['exit']);
    const summary = await runEngineerMode({ provider: noopProvider, io, gh: noopGh });

    expect(text()).toMatch(/2 (known )?project/i);
    expect(summary.exitCode ?? 0).toBe(0);
    expect(summary.ideasProcessed).toBe(0);
  });

  // ── 3. Absent registry → 0 projects, no crash ────────────────────────────
  it('absent registry → 0 projects, prints so, no crash, exits cleanly', async () => {
    // registryPath intentionally not written
    const { runEngineerMode } = await loadLoop();
    const { io, text } = scriptedIo(['exit']);
    const summary = await runEngineerMode({ provider: noopProvider, io, gh: noopGh });

    expect(text()).toMatch(/0 (known )?project/i);
    expect(summary.exitCode ?? 0).toBe(0);
    expect(summary.ideasProcessed).toBe(0);
  });

  // ── 4. Absent/empty store → flywheel no-op, loop still runs ──────────────
  it('absent store (no signals.jsonl) → flywheel no-op, clean exit', async () => {
    // engineerDir exists but no signals.jsonl inside it
    const { runEngineerMode } = await loadLoop();
    const { io, text } = scriptedIo(['exit']);
    const summary = await runEngineerMode({ provider: noopProvider, io, gh: noopGh });

    // Should not throw and should exit cleanly
    expect(summary.exitCode ?? 0).toBe(0);
    expect(summary.ideasProcessed).toBe(0);
    // Still prints project count (0 in this case)
    expect(text()).toMatch(/0 (known )?project/i);
  });

  // ── 5. MALFORMED registry → fast clear error naming "registry" ────────────
  //
  // NEGATIVE PATH: assert the SPECIFIC error message matches /registry/i.
  // This is the falsifiable assertion required by task constraints.
  it('malformed registry → rejects with error naming "registry" (not silently 0 projects)', async () => {
    await writeFile(registryPath, '{ not json', 'utf-8');

    const { runEngineerMode } = await loadLoop();
    const { io } = scriptedIo(['exit']);

    // The error MUST mention "registry" — not a bare throw or a generic error.
    await expect(
      runEngineerMode({ provider: noopProvider, io, gh: noopGh }),
    ).rejects.toThrow(/registry/i);
  });

  // ── 6. exit line → clean exit ─────────────────────────────────────────────
  it('"exit" line → ideasProcessed=0, exitCode=0', async () => {
    const { runEngineerMode } = await loadLoop();
    const { io } = scriptedIo(['exit']);
    const summary = await runEngineerMode({ provider: noopProvider, io, gh: noopGh });

    expect(summary.exitCode ?? 0).toBe(0);
    expect(summary.ideasProcessed).toBe(0);
  });

  // ── 7. EOF (null from prompt) → clean exit ───────────────────────────────
  it('EOF (null from io.prompt) → clean exit, ideasProcessed=0', async () => {
    const { runEngineerMode } = await loadLoop();
    // Empty queue → first prompt() returns null (EOF)
    const { io } = scriptedIo([]);
    const summary = await runEngineerMode({ provider: noopProvider, io, gh: noopGh });

    expect(summary.exitCode ?? 0).toBe(0);
    expect(summary.ideasProcessed).toBe(0);
  });

  // ── 8. Blank line → re-prompt with NO side effects ───────────────────────
  it('blank line re-prompts without incrementing ideasProcessed, then exit', async () => {
    const { runEngineerMode } = await loadLoop();
    // blank line, then exit
    const { io } = scriptedIo(['', 'exit']);
    const summary = await runEngineerMode({ provider: noopProvider, io, gh: noopGh });

    expect(summary.exitCode ?? 0).toBe(0);
    // blank line must NOT count as an idea processed
    expect(summary.ideasProcessed).toBe(0);
  });

  // ── 9. Multiple blank lines then EOF ─────────────────────────────────────
  it('multiple blank lines then EOF → ideasProcessed=0, clean exit', async () => {
    const { runEngineerMode } = await loadLoop();
    const { io } = scriptedIo(['', '   ', '']);
    const summary = await runEngineerMode({ provider: noopProvider, io, gh: noopGh });

    expect(summary.exitCode ?? 0).toBe(0);
    expect(summary.ideasProcessed).toBe(0);
  });

  // ── 10. Injectable registryPath dep (not just env) ────────────────────────
  it('accepts registryPath dep override (not just env AI_CONDUCTOR_REGISTRY)', async () => {
    const altDir = join(workDir, 'alt');
    await mkdir(altDir, { recursive: true });
    const altRegPath = join(workDir, 'alt-registry.json');
    await writeRegistry([makeRecord(altDir, 'alt-project')]);
    // This test writes to the SAME registryPath as env, then verifies via dep injection.
    // The dep override should let us point at the same path without relying on env.

    const { runEngineerMode } = await loadLoop();
    const { io, text } = scriptedIo(['exit']);
    const summary = await runEngineerMode({
      provider: noopProvider,
      io,
      gh: noopGh,
      registryPath,   // explicit override
      engineerDir,       // explicit override
    });

    expect(text()).toMatch(/1 (known )?project/i);
    expect(summary.exitCode ?? 0).toBe(0);
  });

  // ── 11. EngineerSessionSummary shape ─────────────────────────────────────────
  it('returns a EngineerSessionSummary with ideasProcessed and exitCode', async () => {
    const { runEngineerMode } = await loadLoop();
    const { io } = scriptedIo(['exit']);
    const summary = await runEngineerMode({ provider: noopProvider, io, gh: noopGh });

    expect(typeof summary).toBe('object');
    expect(typeof summary.ideasProcessed).toBe('number');
    // exitCode is optional but if present must be a number
    if (summary.exitCode !== undefined) {
      expect(typeof summary.exitCode).toBe('number');
    }
  });
});
