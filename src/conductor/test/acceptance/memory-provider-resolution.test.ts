import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for Slice 1a — total, run-start resolution of the active
// memory provider, defaulting to the built-in `local` (ADR-016, conditions
// C1 / C3), plus default-store category parity (FR-9).
//
// Stories (.docs/stories/pluggable-memory-1a-durable-default-memory.md):
//   FR-1  No selection → `local` active; two projects resolve independently;
//         exactly one active; no cross-project leakage.
//   FR-2  Absent/empty/malformed → `local` (clear note, no crash); unknown name
//         → warn + `local` + run continues; bounded warning.
//   FR-9  `local` exposes the same categories as today; no category semantics lost.
//   FR-10 The resolved active provider is one stable value used by all steps.
//
// Drives `resolveMemoryProvider(config, registry, ctx?)` (new, in config.ts) and
// `ensureMemoryStore` (memory-store.ts). `resolveMemoryProvider` does not exist
// yet → dynamically imported so the suite is RED for the right reason.
//
// `memory_provider` is not yet a PluginKind / HarnessConfig field, so kind +
// config values are cast `as any` to keep `tsc --noEmit` clean (the runtime
// failure is the RED signal, not a type error).
// ─────────────────────────────────────────────────────────────────────────────

const execFile = promisify(execFileCb);
const CONFIG_MOD = '../../src/engine/config.js';
const STORE_MOD = '../../src/engine/memory-store.js';

async function load(modPath: string): Promise<Record<string, unknown>> {
  return (await import(modPath)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: any[]) => any;
}

/** A registry with only the built-in `local` memory provider registered. */
const LOCAL = { name: 'local', kind: 'memory_provider' };
function registryWithLocal(): PluginRegistry {
  const registry = new PluginRegistry();
  registry.register('memory_provider' as any, 'local', LOCAL);
  return registry;
}

let workDir: string;
let fakeHome: string;
const savedHome = { value: process.env.HOME };
const savedProfile = { value: process.env.USERPROFILE };

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

async function makeRepo(name: string, originUrl: string): Promise<string> {
  const repoPath = join(workDir, name);
  await mkdir(repoPath, { recursive: true });
  await git(['init', '-q', '-b', 'main'], repoPath);
  await git(['config', 'user.email', 'test@test.com'], repoPath);
  await git(['config', 'user.name', 'Test'], repoPath);
  await git(['remote', 'add', 'origin', originUrl], repoPath);
  await git(['commit', '-q', '--allow-empty', '-m', 'init'], repoPath);
  return repoPath;
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'memory-resolve-'));
  fakeHome = join(workDir, 'home');
  await mkdir(fakeHome, { recursive: true });
  savedHome.value = process.env.HOME;
  savedProfile.value = process.env.USERPROFILE;
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
});

afterEach(async () => {
  process.env.HOME = savedHome.value;
  process.env.USERPROFILE = savedProfile.value;
  await rm(workDir, { recursive: true, force: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-1 / FR-2 happy: a valid or absent selection resolves to a real provider with
// no warning — never null, never a throw (C1: total value).
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-1 / FR-2: default resolution is total and warning-free for valid input', () => {
  it('no selection (undefined) → the local provider, zero warnings', async () => {
    const resolveMemoryProvider = requireFn(await load(CONFIG_MOD), 'resolveMemoryProvider');
    const ctx = { warnings: [] as string[] };

    const provider = await resolveMemoryProvider({}, registryWithLocal(), ctx);

    expect(provider).toBe(LOCAL);
    expect(ctx.warnings).toEqual([]);
  });

  it('explicit `local` selection → the local provider, zero warnings', async () => {
    const resolveMemoryProvider = requireFn(await load(CONFIG_MOD), 'resolveMemoryProvider');
    const ctx = { warnings: [] as string[] };

    const provider = await resolveMemoryProvider(
      { memory_provider: 'local' } as any,
      registryWithLocal(),
      ctx,
    );

    expect(provider).toBe(LOCAL);
    expect(ctx.warnings).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-2 negative: absent/empty/malformed selection degrades to `local` with at
// most one clear note — never crashes (C1/C3: explicit branches, no catch-all).
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-2: malformed selection degrades to local without crashing', () => {
  it('empty string → local (no throw)', async () => {
    const resolveMemoryProvider = requireFn(await load(CONFIG_MOD), 'resolveMemoryProvider');
    const provider = await resolveMemoryProvider(
      { memory_provider: '' } as any,
      registryWithLocal(),
      { warnings: [] },
    );
    expect(provider).toBe(LOCAL);
  });

  it('non-string (malformed) → local (no throw)', async () => {
    const resolveMemoryProvider = requireFn(await load(CONFIG_MOD), 'resolveMemoryProvider');
    const provider = await resolveMemoryProvider(
      { memory_provider: 123 } as any,
      registryWithLocal(),
      { warnings: [] },
    );
    expect(provider).toBe(LOCAL);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-2 negative: an unknown provider name warns once and falls back to local; the
// run continues. Warnings are bounded across repeated resolutions in one run.
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-2: unknown provider name → warn once + local + continue', () => {
  it('names a provider that is not installed → local + exactly one warning', async () => {
    const resolveMemoryProvider = requireFn(await load(CONFIG_MOD), 'resolveMemoryProvider');
    const ctx = { warnings: [] as string[] };

    const provider = await resolveMemoryProvider(
      { memory_provider: 'does-not-exist' } as any,
      registryWithLocal(),
      ctx,
    );

    expect(provider).toBe(LOCAL);
    expect(ctx.warnings.length).toBe(1);
    expect(ctx.warnings[0]).toMatch(/does-not-exist|local|fall/i);
  });

  it('repeated resolution in one run emits at most one bad-selection warning (bounded)', async () => {
    const resolveMemoryProvider = requireFn(await load(CONFIG_MOD), 'resolveMemoryProvider');
    const ctx = { warnings: [] as string[] };
    const registry = registryWithLocal();

    await resolveMemoryProvider({ memory_provider: 'nope' } as any, registry, ctx);
    await resolveMemoryProvider({ memory_provider: 'nope' } as any, registry, ctx);
    await resolveMemoryProvider({ memory_provider: 'nope' } as any, registry, ctx);

    expect(ctx.warnings.length).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-1 negative / FR-10: selection is per-project and stable — resolving one
// project's config does not change another's, and the same config always yields
// the same single active provider.
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-1 / FR-10: per-project, stable resolution', () => {
  it('two configs resolve independently — no cross-project leakage', async () => {
    const resolveMemoryProvider = requireFn(await load(CONFIG_MOD), 'resolveMemoryProvider');
    const registry = registryWithLocal();

    const a = await resolveMemoryProvider({ memory_provider: 'local' } as any, registry, {
      warnings: [],
    });
    const b = await resolveMemoryProvider({ memory_provider: 'unknown-b' } as any, registry, {
      warnings: [],
    });

    // A's valid resolution is unaffected by B's bad one.
    expect(a).toBe(LOCAL);
    expect(b).toBe(LOCAL); // B also degrades to local, but independently
    // Re-resolving A still yields local — B did not mutate shared state.
    const aAgain = await resolveMemoryProvider({ memory_provider: 'local' } as any, registry, {
      warnings: [],
    });
    expect(aAgain).toBe(LOCAL);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-9: the default `local` store exposes the same categories as today — no
// category/entry semantics are lost in the relocation.
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-9: default store preserves today’s categories', () => {
  it('ensureMemoryStore lays out the canonical categories + index.md', async () => {
    const repo = await makeRepo('alpha', 'https://example.com/alpha.git');
    const ensureMemoryStore = requireFn(await load(STORE_MOD), 'ensureMemoryStore');

    await ensureMemoryStore(repo);

    const entries = await readdir(join(repo, '.memory'));
    // index.md is always present; the standard memory categories are exposed.
    expect(entries).toContain('index.md');
    for (const category of ['decisions', 'patterns', 'gotchas', 'context']) {
      expect(entries).toContain(category);
    }
    // index.md is readable through the symlink — recall is "agent reads + judges".
    const index = await readFile(join(repo, '.memory', 'index.md'), 'utf8');
    expect(typeof index).toBe('string');
  });
});
