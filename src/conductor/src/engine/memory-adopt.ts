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

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { load as loadYaml, dump as dumpYaml } from 'js-yaml';
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

interface MemoryProviderPlugin {
  name: string;
  requiredEnv?: string[];
  mcp?: { name: string; command: string; args?: string[] };
}

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

/**
 * Adopts a memory provider:
 *   1. Checks required credentials (BEFORE any writes — atomic on failure).
 *   2. Writes `memory_provider` to `.ai-conductor/config.yml` if needed.
 *   3. Wires the provider's MCP server via `mcp(['add', …])`, guarded by a
 *      prior `mcp(['get', …])` so the add is never duplicated.
 *
 * Idempotent: a re-`add` when config already names the provider AND MCP is
 * already registered is a pure no-op (config bytes unchanged, no extra add call).
 *
 * Security: credential VALUES are NEVER written to the tracked config file.
 */
export async function memoryAdd(opts: {
  projectRoot: string;
  provider: string;
  registry: PluginRegistry;
  mcp: McpRunner;
  env?: Record<string, string>;
}): Promise<{ ok: boolean; changed?: boolean; notice?: string }> {
  const { projectRoot, provider: providerName, registry, mcp, env } = opts;

  // Look up provider in registry.
  const provider = registry.tryGet<MemoryProviderPlugin>('memory_provider', providerName);
  if (!provider) {
    return { ok: false, notice: `Provider "${providerName}" is not registered` };
  }

  // SECURITY / ATOMICITY: check all required credentials BEFORE touching the config
  // file. If any credential is absent, return a notice and leave the config unchanged.
  const effectiveEnv = env ?? (process.env as Record<string, string>);
  for (const key of provider.requiredEnv ?? []) {
    if (!effectiveEnv[key]) {
      return {
        ok: false,
        notice: `Missing required credential: ${key}. Set ${key} in your environment before adopting this provider.`,
      };
    }
  }

  // Read existing config (preserves all unrelated keys).
  const raw = await readConfigRaw(projectRoot);
  const config = raw ? parseConfig(raw) : {};

  // Only write config when memory_provider isn't already this provider.
  // This keeps the file byte-for-byte unchanged on a redundant re-add.
  let changed = false;
  if (config.memory_provider !== providerName) {
    config.memory_provider = providerName;
    await mkdir(join(projectRoot, CONFIG_DIR), { recursive: true });
    await writeFile(configFilePath(projectRoot), dumpYaml(config), 'utf8');
    changed = true;
  }

  // Wire MCP if declared, guarded by `get` to prevent duplicate add calls.
  // Credential VALUES are NEVER passed to the tracked config — only to mcp runner.
  if (provider.mcp) {
    const mcpName = provider.mcp.name;
    const getResult = await mcp(['get', mcpName]);
    if (getResult.code !== 0) {
      // Not yet wired — add now. Command + args come from the provider manifest.
      await mcp(['add', mcpName, provider.mcp.command, ...(provider.mcp.args ?? [])]);
    }
  }

  return { ok: true, changed };
}

/**
 * Removes memory provider selection, returning the project to the `local` default.
 *
 * Idempotent: if `memory_provider` is already absent, the config file is left
 * byte-for-byte unchanged and `{ ok: true }` is returned.
 *
 * Also unwires the provider's MCP server if it is in the registry and has an
 * `mcp` descriptor. MCP unwiring errors are swallowed (best-effort).
 */
export async function memoryRemove(opts: {
  projectRoot: string;
  registry: PluginRegistry;
  mcp: McpRunner;
}): Promise<{ ok: boolean }> {
  const { projectRoot, registry, mcp } = opts;

  const raw = await readConfigRaw(projectRoot);
  if (!raw) {
    // No config file at all — already at default local, pure no-op.
    return { ok: true };
  }

  const config = parseConfig(raw);

  // Idempotent: already at local (no memory_provider key) → no file write.
  if (!config.memory_provider) {
    return { ok: true };
  }

  const activeProviderName = String(config.memory_provider);

  // Best-effort MCP unwiring — never let this block the config removal.
  const provider = registry.tryGet<MemoryProviderPlugin>('memory_provider', activeProviderName);
  if (provider?.mcp) {
    try {
      await mcp(['remove', provider.mcp.name]);
    } catch {
      // Swallow: MCP unwiring failure must not prevent config cleanup.
    }
  }

  // Remove the key and write the updated config.
  delete config.memory_provider;
  await writeFile(configFilePath(projectRoot), dumpYaml(config), 'utf8');

  return { ok: true };
}
