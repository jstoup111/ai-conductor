/**
 * `conduct memory` CLI handlers (adr-2026-06-29-shared-memory-store-placement-and-durability, A14;
 * adr-2026-06-29-per-project-memory-provider-selection, FR-6/FR-7).
 *
 * Two distinct command groups under `memory`:
 *
 *   memory setup [dir]     — one-shot store creation / migration (existing)
 *   memory status          — report active provider + source (Slice 1b)
 *   memory add <provider>  — adopt a provider: write config + wire MCP (Slice 1b)
 *   memory remove          — clear provider: reset to local + unwire MCP (Slice 1b)
 *
 * All are non-interactive: run to completion and the caller exits with the
 * returned exit code. Mirrors the registry/engineer/daemon subcommand pattern
 * so each is dispatched BEFORE the interactive pipeline boots.
 *
 * The `mcp` runner seam follows the `gh` runner pattern in engineer-cli.ts:
 * injectable for tests, production-defaulted in dispatchMemoryAdopt().
 */

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat } from 'fs/promises';
import { join, isAbsolute, resolve as resolvePath } from 'path';
import { existsSync } from 'fs';
import { ensureMemoryStore } from './memory-store.js';
import { migrateMemory } from './memory-migrate.js';
import { memoryStatus, memoryAdd, memoryRemove, type McpRunner } from './memory-adopt.js';
import { PluginRegistry } from './plugin-registry.js';

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch type (mirrors RegistryDispatch pattern)
// ─────────────────────────────────────────────────────────────────────────────

export type MemoryDispatch =
  | { kind: 'setup'; dir?: string }
  | { kind: 'status' }
  | { kind: 'add'; provider: string }
  | { kind: 'remove' };

/**
 * Detect `conduct memory <subcommand>` in process.argv.
 * Returns the matched dispatch, or null when argv targets a different command.
 *
 * Handled subcommands:
 *   memory setup [dir]    → { kind: 'setup', dir? }
 *   memory status         → { kind: 'status' }
 *   memory add <provider> → { kind: 'add', provider }
 *   memory remove         → { kind: 'remove' }
 */
export function detectMemoryCommand(argv: string[]): MemoryDispatch | null {
  // argv is process.argv: [node, entry, sub, sub2, ...]
  const args = argv.slice(2);
  if (args[0] !== 'memory') return null;

  const sub = args[1];
  if (sub === 'setup') {
    const dir = args[2] && !args[2].startsWith('-') ? args[2] : undefined;
    return { kind: 'setup', dir };
  }
  if (sub === 'status') {
    return { kind: 'status' };
  }
  if (sub === 'add') {
    const provider = args[2];
    if (!provider || provider.startsWith('-')) return null; // malformed
    return { kind: 'add', provider };
  }
  if (sub === 'remove') {
    return { kind: 'remove' };
  }
  return null;
}

/**
 * Execute `conduct memory setup [dir]`.
 *
 * Logic:
 *   - Resolve `dir` (default: cwd).
 *   - If `.memory/` is a real directory → `migrateMemory` (copy-verify-swap,
 *     adr-2026-06-29-safe-reversible-memory-migration). On failure, prints the error and returns exit code 1.
 *   - Otherwise → `ensureMemoryStore` (create canonical dir + symlink,
 *     idempotent). On failure, prints the error and returns exit code 1.
 *
 * Returns 0 on success, 1 on error.
 */
export async function dispatchMemorySetup(d: Extract<MemoryDispatch, { kind: 'setup' }>): Promise<number> {
  const rawDir = d.dir ?? process.cwd();
  const projectDir = isAbsolute(rawDir) ? rawDir : resolvePath(process.cwd(), rawDir);

  if (!existsSync(projectDir)) {
    console.error(`conduct memory setup: directory does not exist: ${projectDir}`);
    return 1;
  }

  const memPath = join(projectDir, '.memory');

  try {
    let memStat: Awaited<ReturnType<typeof lstat>> | null = null;
    try {
      memStat = await lstat(memPath);
    } catch {
      // .memory does not exist — fall through to ensureMemoryStore.
    }

    if (memStat && !memStat.isSymbolicLink()) {
      // Real directory (pre-migration content) — migrate it.
      console.log(`conduct memory setup: migrating existing .memory/ in ${projectDir}`);
      await migrateMemory(projectDir);
    } else {
      // No .memory/ yet, or already a symlink — ensure the canonical store.
      await ensureMemoryStore(projectDir);
    }

    console.log(`conduct memory setup: .memory/ is ready at ${projectDir}`);
    return 0;
  } catch (e) {
    console.error(
      `conduct memory setup: failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return 1;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Default MCP runner (production seam)
// ─────────────────────────────────────────────────────────────────────────────

const execFileP = promisify(execFileCb);

/**
 * Build the default real MCP runner used in production.
 *
 * Contract: `runner(args)` → `execFile('claude', ['mcp', ...args])` and maps
 * any non-zero exit code (or thrown spawn error) to `{ stdout, code }` rather
 * than re-throwing — so callers never see an uncaught rejection from a missing
 * MCP server entry.
 *
 * Argv shape (pinned by unit test in test/engine/memory-adopt.test.ts):
 *   runner(['get', 'memory-x'])    →  claude mcp get memory-x
 *   runner(['add', 'memory-x'])    →  claude mcp add memory-x
 *   runner(['remove', 'memory-x']) →  claude mcp remove memory-x
 *
 * NOTE: Phase 1 ships no concrete MCP platform, so a real-binary smoke is
 * deferred. The argv-shape assertion in the unit tests bounds the seam until
 * an integration test can call the real `claude mcp` binary.
 */
export function makeProductionMcp(): McpRunner {
  return async (args: string[]): Promise<{ stdout: string; code: number }> => {
    try {
      const result = await execFileP('claude', ['mcp', ...args]);
      return { stdout: String(result.stdout), code: 0 };
    } catch (e: unknown) {
      // execFile rejects on non-zero exit. Extract code + stdout from the error.
      const err = e as { code?: number | string; stdout?: string | Buffer };
      const code = typeof err.code === 'number' ? err.code : 1;
      const stdout = err.stdout ? String(err.stdout) : '';
      return { stdout, code };
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch: memory status (Slice 1b — B6)
// ─────────────────────────────────────────────────────────────────────────────

export interface DispatchMemoryAdoptOpts {
  /** Project root (default: cwd). */
  projectRoot?: string;
  /** Injected MCP runner (default: makeProductionMcp()). */
  mcp?: McpRunner;
  /** Injected registry (default: empty — status works; add/remove need providers registered). */
  registry?: PluginRegistry;
  /** Print to stdout (default: process.stdout.write). */
  print?: (s: string) => void;
  /** Print to stderr (default: process.stderr.write). */
  printErr?: (s: string) => void;
}

/**
 * Execute `conduct memory status | add <provider> | remove`.
 *
 * Returns 0 on success, 1 on error. Deps are injectable for testing.
 */
export async function dispatchMemoryAdopt(
  d: Exclude<MemoryDispatch, { kind: 'setup' }>,
  opts: DispatchMemoryAdoptOpts = {},
): Promise<number> {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const registry = opts.registry ?? new PluginRegistry();
  const print = opts.print ?? ((s: string) => process.stdout.write(s + '\n'));
  const printErr = opts.printErr ?? ((s: string) => process.stderr.write(s + '\n'));

  try {
    if (d.kind === 'status') {
      const status = await memoryStatus({ projectRoot, registry });
      print(`memory_provider: ${status.provider} (source: ${status.source})`);
      return 0;
    }

    if (d.kind === 'add') {
      const mcp = opts.mcp ?? makeProductionMcp();
      const result = await memoryAdd({ projectRoot, provider: d.provider, registry, mcp });
      if (!result.ok) {
        printErr(`conduct memory add: ${result.notice ?? 'failed'}`);
        return 1;
      }
      print(`conduct memory add: ${d.provider} adopted${result.changed ? '' : ' (already active)'}`);
      return 0;
    }

    if (d.kind === 'remove') {
      const mcp = opts.mcp ?? makeProductionMcp();
      const result = await memoryRemove({ projectRoot, registry, mcp });
      if (!result.ok) {
        printErr(`conduct memory remove: failed`);
        return 1;
      }
      print(`conduct memory remove: reset to local`);
      return 0;
    }

    // TypeScript exhaustiveness — should never reach here at runtime.
    return 1;
  } catch (e) {
    printErr(`conduct memory: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
