// Unit tests for runEngineerMode — Tasks 23-24 (Phase 9.3, FR-1).
//
// Task 23 (FR-1): Loop startup loads registry + store; reports counts.
// Task 24 (FR-1, C2): Degraded start — missing registry/store, no crash, no subprocess.
// C2 REGRESSION INVARIANTS (static source analysis):
//   - loop.ts does NOT spawn 'claude' or 'claude -p' (no execFile/spawn of claude binary).
//   - loop.ts does NOT create a Node TTY readline REPL (no createInterface on stdin).
//   - loop.ts imports intake/port.js (the port interface, NOT the concrete adapter).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { existsSync } from 'fs';

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

/** Minimal no-op provider stub. */
const noopProvider = {
  invoke: async () => ({ success: false, output: '', exitCode: 0 }),
  invokeInteractive: async () => {},
};

/** Minimal gh stub. */
const noopGh = async (_args: string[], _opts: { cwd: string }) => ({ stdout: '' });

// ── temp dir scaffolding ──────────────────────────────────────────────────────

let workDir: string;
let registryPath: string;
let engineerDir: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'loop-test-'));
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

// helpers
function makeRecord(path: string, name: string) {
  return {
    schemaVersion: 1,
    name,
    path,
    status: 'registered',
    registeredAt: '2026-06-26T00:00:00.000Z',
  };
}

async function writeRegistry(records: unknown[]): Promise<void> {
  await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');
}

function loopSrcPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', '..', 'src', 'engine', 'engineer', 'loop.ts');
}

// ═════════════════════════════════════════════════════════════════════════════
// Task 23 (FR-1): Loop startup loads registry + store; reports counts.
// ═════════════════════════════════════════════════════════════════════════════

describe('Task 23: loop startup loads registry + store, reports counts (FR-1)', () => {
  it('loads registry with 2 projects and prints the known-project count', async () => {
    const dirA = join(workDir, 'alpha');
    const dirB = join(workDir, 'beta');
    await mkdir(dirA, { recursive: true });
    await mkdir(dirB, { recursive: true });
    await writeRegistry([makeRecord(dirA, 'alpha'), makeRecord(dirB, 'beta')]);

    const { runEngineerMode } = await loadLoop();
    const { io, text } = scriptedIo(['exit']);
    const summary = await runEngineerMode({
      provider: noopProvider,
      io,
      gh: noopGh,
      registryPath,
      engineerDir,
    });

    expect(text()).toMatch(/2 (known )?project/i);
    expect(summary.exitCode ?? 0).toBe(0);
    expect(summary.ideasProcessed).toBe(0);
  });

  it('opens the store read-only: signals.jsonl is NOT created when no signals exist', async () => {
    await writeRegistry([]);

    const { runEngineerMode } = await loadLoop();
    const { io, text } = scriptedIo(['exit']);
    const summary = await runEngineerMode({
      provider: noopProvider,
      io,
      gh: noopGh,
      registryPath,
      engineerDir,
    });

    expect(text()).toMatch(/0 (known )?project/i);
    expect(summary.exitCode ?? 0).toBe(0);
    // Store opened read-only — signals.jsonl must NOT be created by startup.
    expect(existsSync(join(engineerDir, 'signals.jsonl'))).toBe(false);
  });

  // C2 static invariant: loop.ts must NOT contain execFile/spawn of 'claude' binary.
  it('[C2] loop.ts does NOT contain execFile/spawn of "claude" binary at top level', async () => {
    const src = await readFile(loopSrcPath(), 'utf8');
    // Forbidden patterns: spawning the claude CLI (the subprocess form).
    expect(src).not.toMatch(/execFile\s*\(\s*['"]claude['"]/);
    expect(src).not.toMatch(/spawn\s*\(\s*['"]claude['"]/);
  });

  // C2 static invariant: loop.ts must NOT create a readline REPL.
  it('[C2] loop.ts does NOT import readline or call createInterface (no TTY REPL)', async () => {
    const src = await readFile(loopSrcPath(), 'utf8');
    expect(src).not.toMatch(/from\s+['"]node:readline['"]/);
    expect(src).not.toMatch(/require\s*\(\s*['"]readline['"]\s*\)/);
    expect(src).not.toMatch(/createInterface/);
  });

  // FR-1 / C5 static invariant: loop.ts imports from intake/port.js (port seam present).
  // RED until loop.ts is updated to import from intake/port.js.
  it('[FR-1] loop.ts imports from intake/port.js (port seam is the dependency)', async () => {
    const src = await readFile(loopSrcPath(), 'utf8');
    // The port module must appear as a static import in loop.ts.
    expect(src).toMatch(/intake\/port(\.js)?['"]/);
    // And it must NOT import the concrete claude-session adapter directly.
    expect(src).not.toMatch(/from\s+['"][^'"]*intake\/claude-session(\.js)?['"]/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Task 24 (FR-1, C2): Degraded start — missing registry/store, no crash, no subprocess.
// ═════════════════════════════════════════════════════════════════════════════

describe('Task 24: degraded loop start without registry/store, no subprocess (FR-1, C2)', () => {
  it('missing registry → degraded mode (0 projects), exit 0, no crash', async () => {
    // registryPath intentionally not written — absent registry is degraded mode.
    const { runEngineerMode } = await loadLoop();
    const { io, text } = scriptedIo(['exit']);

    // Must NOT throw — absent registry is not a fatal error.
    const summary = await runEngineerMode({
      provider: noopProvider,
      io,
      gh: noopGh,
      registryPath,
      engineerDir,
    });

    expect(text()).toMatch(/0 (known )?project/i);
    expect(summary.exitCode ?? 0).toBe(0);
    expect(summary.ideasProcessed).toBe(0);
  });

  it('missing store (no signals.jsonl in engineerDir) → no crash, still reports count', async () => {
    // engineerDir exists but no signals.jsonl inside it.
    await writeRegistry([]);

    const { runEngineerMode } = await loadLoop();
    const { io, text } = scriptedIo(['exit']);

    const summary = await runEngineerMode({
      provider: noopProvider,
      io,
      gh: noopGh,
      registryPath,
      engineerDir,
    });

    // Must not crash — absent signals.jsonl is a no-op (returns []).
    expect(summary.exitCode ?? 0).toBe(0);
    expect(text()).toMatch(/0 (known )?project/i);
  });

  it('missing registry degraded path: at least one line of output is produced', async () => {
    // Verifies the startup sequence runs fully even in degraded mode.
    const { runEngineerMode } = await loadLoop();
    const { io, out } = scriptedIo(['exit']);

    const summary = await runEngineerMode({
      provider: noopProvider,
      io,
      gh: noopGh,
      registryPath,
      engineerDir,
    });

    // At least one output line (the project count line).
    expect(out.length).toBeGreaterThan(0);
    expect(summary.exitCode ?? 0).toBe(0);
  });

  // C2: The SAME static source invariants apply to the degraded path (same file, same code).
  it('[C2 static] degraded-path: no claude spawn, no readline REPL in source', async () => {
    const src = await readFile(loopSrcPath(), 'utf8');
    // These patterns are forbidden regardless of which execution path runs.
    expect(src).not.toMatch(/execFile\s*\(\s*['"]claude['"]/);
    expect(src).not.toMatch(/spawn\s*\(\s*['"]claude['"]/);
    expect(src).not.toMatch(/from\s+['"]node:readline['"]/);
    expect(src).not.toMatch(/createInterface/);
  });
});
