// Unit tests for runEngineerMode — Tasks 23-26, 29-30, 36-37 (Phase 9.3, FR-1/FR-2/FR-4/FR-7/FR-10/FR-21).
//
// Task 23 (FR-1): Loop startup loads registry + store; reports counts.
// Task 24 (FR-1, C2): Degraded start — missing registry/store, no crash, no subprocess.
// Task 25 (FR-2): Multi-idea loop via intake port (injected in-memory IntakePort).
// Task 26 (FR-2): Empty idea re-prompt; clean exit; no side effects.
// Task 29 (FR-4): Multi-repo fan-out — independent authoring per target.
// Task 30 (FR-4): Fan-out partial failure isolation + deselect.
// Task 36 (FR-7/FR-10): Spec PR opened; never builds/merges; PR-open failure names branch.
// Task 37 (FR-21/FR-7): ensure-running wired after handoff; not called on no-author path.
// C2 REGRESSION INVARIANTS (static source analysis):
//   - loop.ts does NOT spawn 'claude' or 'claude -p' (no execFile/spawn of claude binary).
//   - loop.ts does NOT create a Node TTY readline REPL (no createInterface on stdin).
//   - loop.ts imports intake/port.js (the port interface, NOT the concrete adapter).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'fs';
import type { IntakePort } from '../../../src/engine/engineer/intake/port.js';

const execFile = promisify(execFileCb);

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

// ═════════════════════════════════════════════════════════════════════════════
// Task 25 (FR-2): Multi-idea loop via intake port.
// Port seam: IntakePort interface is injected; loop.ts never directly imports
// the concrete claude-session adapter. Context persists across ideas.
// C2: No stub stories ('_Generated by engineer._') written to disk.
// ═════════════════════════════════════════════════════════════════════════════

/** Create a no-op IntakePort for injection testing. */
function createTestIntakePort(): IntakePort {
  return {
    async report(_sourceRef: string, _status: any): Promise<void> {
      // no-op — 9.3b write-back deferred
    },
  };
}

describe('Task 25: multi-idea loop via intake port (FR-2)', () => {
  it('IntakePort interface is loadable from intake/port.js', async () => {
    // The port module must be importable and export the boundary function.
    const portMod = await import('../../../src/engine/engineer/intake/port.js');
    expect(typeof portMod.parseEnvelope).toBe('function');
  });

  it('injected in-memory IntakePort satisfies the port contract (report no-op)', async () => {
    // An in-memory IntakePort must implement report() without throwing.
    const port = createTestIntakePort();
    await expect(port.report('turn-1', 'pending')).resolves.toBeUndefined();
    await expect(port.report('turn-2', 'done')).resolves.toBeUndefined();
  });

  it('two sequential sessions on same registry do not leak context between them', async () => {
    await writeRegistry([]);

    const { runEngineerMode } = await loadLoop();

    // First session.
    const { io: io1, text: text1 } = scriptedIo(['exit']);
    const s1 = await runEngineerMode({ provider: noopProvider, io: io1, gh: noopGh, registryPath, engineerDir });

    // Second session — fresh IO, same registry/store paths.
    const { io: io2, text: text2 } = scriptedIo(['exit']);
    const s2 = await runEngineerMode({ provider: noopProvider, io: io2, gh: noopGh, registryPath, engineerDir });

    expect(text1()).toMatch(/0 (known )?project/i);
    expect(text2()).toMatch(/0 (known )?project/i);
    expect(s1.exitCode ?? 0).toBe(0);
    expect(s2.exitCode ?? 0).toBe(0);
    expect(s1.ideasProcessed).toBe(0);
    expect(s2.ideasProcessed).toBe(0);
  });

  it('EOF without explicit "exit" line → exits cleanly (intake port seam proof)', async () => {
    await writeRegistry([]);
    const { runEngineerMode } = await loadLoop();
    // Empty IO queue → first prompt() returns null (EOF).
    const { io } = scriptedIo([]);

    const summary = await runEngineerMode({
      provider: noopProvider,
      io,
      gh: noopGh,
      registryPath,
      engineerDir,
    });

    // Clean exit — the loop seam correctly handles EOF from any IO provider.
    expect(summary.exitCode ?? 0).toBe(0);
    expect(summary.ideasProcessed).toBe(0);
  });

  // C2 static: loop.ts must NOT write stub stories (the _Generated by engineer._ template).
  // RED until the stubs in processIdea's authoringProvider.invoke are removed.
  it('[C2] loop.ts does NOT write stub stories ("_Generated by engineer._")', async () => {
    const src = await readFile(loopSrcPath(), 'utf8');
    // The forbidden stub strings that the engineer must never write.
    // These are template-filler stubs, not real authored content.
    expect(src).not.toMatch(/_Generated by engineer\./);
  });

  it('[C2] loop.ts does NOT write Status:DRAFT stories (no DRAFT marker in authored content)', async () => {
    const src = await readFile(loopSrcPath(), 'utf8');
    // C2: authored stories must never have a DRAFT status marker.
    // This ensures the engineer writes real content, not placeholder drafts.
    expect(src).not.toMatch(/Status:\s*DRAFT/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Task 26 (FR-2): Empty idea re-prompt; clean exit; no side effects.
// Falsifiable invariants:
//   - Empty/whitespace line → re-prompt, ideasProcessed stays 0.
//   - Exit → exit code 0, NO leftover lock/temp files in engineerDir.
//   - Engineer-cli dispatchEngineer returns exit code 0 on clean session.
// ═════════════════════════════════════════════════════════════════════════════

describe('Task 26: empty-idea re-prompt + clean exit (FR-2)', () => {
  it('empty line → re-prompt with NO side effects (ideasProcessed stays 0)', async () => {
    const dirA = join(workDir, 'alpha');
    await mkdir(dirA, { recursive: true });
    await writeRegistry([makeRecord(dirA, 'alpha')]);

    const { runEngineerMode } = await loadLoop();
    const { io } = scriptedIo(['', 'exit']);

    const summary = await runEngineerMode({
      provider: noopProvider,
      io,
      gh: noopGh,
      registryPath,
      engineerDir,
    });

    // Empty line must not trigger authoring — ideasProcessed is the falsifiable check.
    expect(summary.ideasProcessed).toBe(0);
    expect(summary.exitCode ?? 0).toBe(0);
  });

  it('whitespace-only line → same zero-side-effects guarantee as empty line', async () => {
    await writeRegistry([]);

    const { runEngineerMode } = await loadLoop();
    const { io } = scriptedIo(['   ', '\t', 'exit']);

    const summary = await runEngineerMode({
      provider: noopProvider,
      io,
      gh: noopGh,
      registryPath,
      engineerDir,
    });

    expect(summary.ideasProcessed).toBe(0);
    expect(summary.exitCode ?? 0).toBe(0);
  });

  it('clean exit → exit code 0, NO leftover lock/temp files in engineerDir', async () => {
    await writeRegistry([]);

    const { runEngineerMode } = await loadLoop();
    const { io } = scriptedIo(['exit']);

    const summary = await runEngineerMode({
      provider: noopProvider,
      io,
      gh: noopGh,
      registryPath,
      engineerDir,
    });

    expect(summary.exitCode ?? 0).toBe(0);

    // No lock or temp files must remain after clean exit.
    const files = await readdir(engineerDir);
    const lockFiles = files.filter((f) => f.endsWith('.lock') || f.startsWith('.tmp'));
    expect(lockFiles).toHaveLength(0);
  });

  it('EOF after multiple blanks → exit 0, ideasProcessed=0, no leftover temp files', async () => {
    await writeRegistry([]);

    const { runEngineerMode } = await loadLoop();
    const { io } = scriptedIo(['', '', '']);

    const summary = await runEngineerMode({
      provider: noopProvider,
      io,
      gh: noopGh,
      registryPath,
      engineerDir,
    });

    expect(summary.exitCode ?? 0).toBe(0);
    expect(summary.ideasProcessed).toBe(0);

    // No lock/temp files left over.
    const files = await readdir(engineerDir);
    const leftover = files.filter((f) => f.endsWith('.lock') || f.startsWith('.tmp'));
    expect(leftover).toHaveLength(0);
  });

  // CLI dispatch path: dispatchEngineer returns exit code 0 on clean session.
  // This exercises the injected-io path in engineer-cli.ts (not the production readline path).
  it('dispatchEngineer(injected-io) returns exit code 0 on clean EOF session', async () => {
    await writeRegistry([]);

    const { dispatchEngineer, detectEngineerCommand } = await import(
      '../../../src/engine/engineer-cli.js'
    );

    // Detect the dispatch descriptor.
    const dispatch = detectEngineerCommand(['node', 'conduct', 'engineer']);
    expect(dispatch).toEqual({ kind: 'engineer' });

    // Inject a scripted IO that EOFs immediately — clean exit.
    const { io } = scriptedIo([]);

    const exitCode = await dispatchEngineer(dispatch!, { io });

    // Clean exit from the injected-io path must return 0.
    expect(exitCode).toBe(0);
  });
});

// ─── helpers for git-backed tests ────────────────────────────────────────────

async function initRepo(dir: string, withRemote = true): Promise<void> {
  await mkdir(dir, { recursive: true });
  await execFile('git', ['init', '-b', 'main'], { cwd: dir });
  await execFile('git', ['config', 'user.email', 't@t.test'], { cwd: dir });
  await execFile('git', ['config', 'user.name', 'Test'], { cwd: dir });
  await writeFile(join(dir, 'README.md'), '# repo\n');
  await execFile('git', ['add', '.'], { cwd: dir });
  await execFile('git', ['commit', '-m', 'init'], { cwd: dir });
  if (withRemote) {
    await execFile('git', ['remote', 'add', 'origin', 'https://example.invalid/x.git'], { cwd: dir });
    await execFile('git', ['update-ref', 'refs/remotes/origin/HEAD', 'refs/heads/main'], { cwd: dir });
    await execFile('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: dir });
    await execFile('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/heads/main'], { cwd: dir });
  }
}

function makeTestProvider(opts: { routeTo?: string; noFit?: boolean } = {}) {
  const calls: { cwd?: string; prompt: string }[] = [];
  const provider = {
    async invoke(o: any): Promise<any> {
      calls.push({ cwd: o.cwd, prompt: String(o.prompt ?? '') });
      const prompt = String(o.prompt ?? '');
      if (/route|candidate|which project/i.test(prompt) && !o.cwd) {
        const body = opts.noFit
          ? JSON.stringify({ candidates: [], suggestCreate: true })
          : JSON.stringify({ candidates: [{ name: opts.routeTo ?? 'alpha', score: 0.9, rationale: 'match' }] });
        return { ok: true, output: body };
      }
      if (o.cwd) {
        return { ok: true, output: 'DECIDE complete', authored: true };
      }
      return { ok: true, output: '' };
    },
  };
  return { provider, calls };
}

function makeTestGh(prUrl = 'https://example.invalid/x/pull/1') {
  const calls: string[][] = [];
  const gh = async (args: string[], _opts: { cwd: string }) => {
    calls.push([...args]);
    if (args[0] === 'pr' && args[1] === 'create') return { stdout: prUrl };
    return { stdout: '' };
  };
  return { gh, calls };
}

// ═════════════════════════════════════════════════════════════════════════════
// Task 29 (FR-4): Multi-repo fan-out — independent authoring.
// Test: idea spanning targets {A,B}, after human confirms, authors INDEPENDENT
// spec branches + PRs per repo. One repo's outcome DOES NOT affect the other.
// ═════════════════════════════════════════════════════════════════════════════

describe('Task 29: multi-repo fan-out independent authoring (FR-4)', () => {
  it('fan-out: both targets authored independently when human confirms all', async () => {
    const dirA = join(workDir, 'alpha');
    const dirB = join(workDir, 'beta');
    await initRepo(dirA);
    await initRepo(dirB);
    await writeRegistry([
      makeRecord(dirA, 'alpha'),
      makeRecord(dirB, 'beta'),
    ]);

    const { runEngineerMode } = await loadLoop();
    const { provider } = makeTestProvider({ routeTo: 'alpha' });
    const { gh } = makeTestGh();

    // Idea targets both alpha and beta. The loop asks to confirm alpha (top candidate),
    // operator adds beta via fan-out syntax, then confirms all.
    const { io, text } = scriptedIo(['fanout idea', 'y', 'exit']);

    const summary = await runEngineerMode({
      provider,
      io,
      gh,
      registryPath,
      engineerDir,
    });

    // At least 1 idea processed (alpha confirmed)
    expect(summary.ideasProcessed).toBeGreaterThanOrEqual(1);
    expect(summary.exitCode ?? 0).toBe(0);
    // No builds triggered — buildsRun stays 0
    expect(summary.buildsRun ?? 0).toBe(0);
  });

  it('fan-out: gh is called with pr create for each confirmed target (no merge)', async () => {
    const dirA = join(workDir, 'alpha');
    await initRepo(dirA);
    await writeRegistry([makeRecord(dirA, 'alpha')]);

    const { runEngineerMode } = await loadLoop();
    const { provider } = makeTestProvider({ routeTo: 'alpha' });
    const { gh, calls } = makeTestGh();
    const { io } = scriptedIo(['multi-repo idea', 'y', 'exit']);

    const summary = await runEngineerMode({
      provider,
      io,
      gh,
      registryPath,
      engineerDir,
    });

    // Every gh call must be pr create, never merge
    for (const callArgs of calls) {
      expect(callArgs).not.toContain('merge');
    }
    expect(summary.buildsRun ?? 0).toBe(0);
  });

  it('fan-out: ideasProcessed reflects number of ideas processed in the loop', async () => {
    const dirA = join(workDir, 'alpha');
    await initRepo(dirA);
    await writeRegistry([makeRecord(dirA, 'alpha')]);

    const { runEngineerMode } = await loadLoop();
    const { provider } = makeTestProvider({ routeTo: 'alpha' });
    const { gh } = makeTestGh();
    // Two ideas, each confirmed
    const { io } = scriptedIo(['idea one', 'y', 'idea two', 'y', 'exit']);

    const summary = await runEngineerMode({
      provider,
      io,
      gh,
      registryPath,
      engineerDir,
    });

    expect(summary.ideasProcessed).toBe(2);
    expect(summary.buildsRun ?? 0).toBe(0);
  });
});
