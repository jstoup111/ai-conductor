/**
 * `conduct memory` adopt/remove/status operations (Slice 1b).
 *
 * Drives the provider-selection lifecycle:
 *   - `memoryStatus`  — reports active provider + config source
 *   - `memoryAdd`     — writes config + wires MCP server (idempotent, atomic on cred failure)
 *   - `memoryRemove`  — clears config + unwires MCP (idempotent)
 *
 * All three functions accept an injected `mcp` runner so tests can stub the
 * process boundary (`claude mcp <args>`) without spawning a real binary.
 *
 * (adr-2026-06-29-per-project-memory-provider-selection, FR-6/FR-7)
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { load as loadYaml } from 'js-yaml';
import type { PluginRegistry } from './plugin-registry.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Injected seam for `claude mcp <args>`. Mirrors the claude CLI:
 *   mcp(['get', name])    → { code: 0 } when registered, { code: 1 } when absent
 *   mcp(['add', name, …]) → registers
 *   mcp(['remove', name]) → unregisters
 *
 * Non-zero exit codes and throws are mapped to { stdout, code } — never re-thrown.
 */
export type McpRunner = (args: string[]) => Promise<{ stdout: string; code: number }>;

// ─────────────────────────────────────────────────────────────────────────────
// Internal config helpers
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG_DIR = '.ai-conductor';
const CONFIG_FILE = 'config.yml';

function configFilePath(projectRoot: string): string {
  return join(projectRoot, CONFIG_DIR, CONFIG_FILE);
}

async function readConfigRaw(projectRoot: string): Promise<string | null> {
  try {
    return await readFile(configFilePath(projectRoot), 'utf8');
  } catch {
    return null;
  }
}

function parseConfig(raw: string): Record<string, unknown> {
  return (loadYaml(raw) as Record<string, unknown>) ?? {};
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reports the active memory provider and where it comes from.
 *
 * C1: `memory_provider` absent / not a string → `{ provider: 'local', source: 'default' }`
 * C2: `memory_provider` present              → `{ provider: <value>, source: 'config' }`
 */
export async function memoryStatus(opts: {
  projectRoot: string;
  registry: PluginRegistry;
}): Promise<{ provider: string; source: 'config' | 'default' }> {
  const raw = await readConfigRaw(opts.projectRoot);
  if (!raw) {
    return { provider: 'local', source: 'default' };
  }
  const config = parseConfig(raw);
  const sel = config.memory_provider;
  if (sel && typeof sel === 'string') {
    return { provider: sel, source: 'config' };
  }
  return { provider: 'local', source: 'default' };
}
