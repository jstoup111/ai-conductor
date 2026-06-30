import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { load as loadYaml } from 'js-yaml';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { loadConfig } from '../../src/engine/config.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for Slice 1b — the ADOPT round-trip (FR-6 / FR-7 / FR-1):
//   conduct memory add <double>  → writes `memory_provider` to
//   `.ai-conductor/config.yml` AND wires the MCP server (via a STUBBED
//   `claude mcp` runner) → `conduct memory status` reports the double as active
//   (source: config) → `resolveMemoryProvider` returns the double → `remove`
//   → status/resolver fall back to `local`.
//
// Adversarial paths folded into the flow:
//   - re-`add` is idempotent (no duplicate MCP entry; config unchanged)
//   - `add` with MISSING credentials → notice, config left UNCHANGED (atomic),
//     no secret written to the tracked config, no MCP wiring
//   - successful `add` never writes the credential VALUE into the tracked config
//   - `remove` is idempotent; removed active provider → clean `local`, no dangle
//   - interrupted add (config written, MCP not yet wired) re-runs cleanly
//   - switching add A → remove → add B always reads from the then-active source
//
// Drives the not-yet-existing production entry point
// `src/conductor/src/engine/memory-adopt.ts` (memoryAdd / memoryRemove /
// memoryStatus). The module does not exist yet, so it is dynamically imported
// per-test → the suite is RED for the right reason ("not yet implemented"),
// never a syntax/typo failure. `claude mcp` is STUBBED at the process boundary
// via an injected runner; no real MCP server and no real credentials are touched.
// ─────────────────────────────────────────────────────────────────────────────

const ADOPT_MOD = '../../src/engine/memory-adopt.js';

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

// ── Inline, self-contained test-double memory provider ───────────────────────
// A `memory_provider` instance whose availability, write-accept/reject, and the
// MCP/credential wiring it declares are all controllable. Self-contained on
// purpose — the shared `test/fixtures/test-double-provider.ts` is a separate
// pipeline task, so depending on it would conflate "fixture missing" with
// "feature missing".
interface DoubleOpts {
  available?: boolean;
  acceptsWrites?: boolean;
  guidance?: string;
  requiredEnv?: string[];
}
function makeDouble(name: string, opts: DoubleOpts = {}) {
  const entries: any[] = [];
  return {
    name,
    kind: 'memory_provider' as const,
    guidance: opts.guidance,
    requiredEnv: opts.requiredEnv ?? [],
    // MCP wiring descriptor the adopt path uses to `claude mcp add` this provider.
    mcp: { name: `memory-${name}`, command: 'memory-double-server', args: ['--provider', name] },
    _available: opts.available ?? true,
    _acceptsWrites: opts.acceptsWrites ?? true,
    isAvailable(): boolean {
      return this._available;
    },
    get available(): boolean {
      return this._available;
    },
    write(entry: any): void {
      if (!this._available || !this._acceptsWrites) {
        throw new Error(`provider ${name} rejected write`);
      }
      entries.push(entry);
    },
    list(): any[] {
      return [...entries];
    },
  };
}

// ── Stubbed `claude mcp` runner (process-boundary seam) ──────────────────────
// Mirrors `claude mcp <args>`: tracks which MCP servers are "registered" and
// records every call so the specs can assert idempotency (no duplicate add).
//   mcp(['get', <name>])    → code 0 when registered, code 1 when absent
//   mcp(['add', <name>, …]) → registers <name>
//   mcp(['remove', <name>]) → unregisters <name>
function makeMcpStub() {
  const registered = new Set<string>();
  const calls: string[][] = [];
  const runner = async (args: string[]): Promise<{ stdout: string; code: number }> => {
    calls.push(args);
    const [verb, name] = args;
    if (verb === 'get') {
      return registered.has(name)
        ? { stdout: `${name}: memory-double-server`, code: 0 }
        : { stdout: '', code: 1 };
    }
    if (verb === 'add') {
      registered.add(name);
      return { stdout: 'added', code: 0 };
    }
    if (verb === 'remove') {
      registered.delete(name);
      return { stdout: 'removed', code: 0 };
    }
    if (verb === 'list') {
      return { stdout: [...registered].join('\n'), code: 0 };
    }
    return { stdout: '', code: 0 };
  };
  return {
    runner,
    calls,
    registered,
    addCount: (mcpName: string) =>
      calls.filter((c) => c[0] === 'add' && c[1] === mcpName).length,
  };
}

function registryWith(...providers: Array<{ name: string }>): PluginRegistry {
  const registry = new PluginRegistry();
  registry.register('memory_provider' as any, 'local', { name: 'local', kind: 'memory_provider' });
  for (const p of providers) {
    registry.register('memory_provider' as any, p.name, p);
  }
  return registry;
}

let workDir: string;
let projectRoot: string;
let fakeHome: string;
const savedHome = { value: process.env.HOME };
const savedProfile = { value: process.env.USERPROFILE };
const SEEDED_CONFIG = 'llm_provider: claude\ndefaults:\n  model: opus\n';

async function seedConfig(root: string, body: string = SEEDED_CONFIG): Promise<void> {
  await mkdir(join(root, '.ai-conductor'), { recursive: true });
  await writeFile(join(root, '.ai-conductor', 'config.yml'), body, 'utf8');
}

async function readRawConfig(root: string): Promise<string> {
  return readFile(join(root, '.ai-conductor', 'config.yml'), 'utf8');
}

async function readParsedConfig(root: string): Promise<Record<string, unknown>> {
  return (loadYaml(await readRawConfig(root)) as Record<string, unknown>) ?? {};
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'memory-adopt-'));
  projectRoot = join(workDir, 'project');
  await mkdir(projectRoot, { recursive: true });
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
  delete process.env.MEMORY_DOUBLE_TOKEN;
  await rm(workDir, { recursive: true, force: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-6 / FR-7 / FR-1: the full adopt → status → resolve → remove round-trip.
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-6/FR-7: adopt → status → resolve → remove round-trip', () => {
  it('add writes config + wires MCP; status + resolver report the double; remove returns to local', async () => {
    const mod = await load(ADOPT_MOD);
    const memoryAdd = requireFn(mod, 'memoryAdd');
    const memoryRemove = requireFn(mod, 'memoryRemove');
    const memoryStatus = requireFn(mod, 'memoryStatus');
    const { resolveMemoryProvider } = await import('../../src/engine/config.js');

    const double = makeDouble('double');
    const registry = registryWith(double);
    const mcp = makeMcpStub();
    await seedConfig(projectRoot);

    // ── add ──────────────────────────────────────────────────────────────────
    const added = await memoryAdd({ projectRoot, provider: 'double', registry, mcp: mcp.runner });
    expect(added.ok).toBe(true);

    // Config now selects the double, and the MCP server was wired exactly once.
    const cfg = await readParsedConfig(projectRoot);
    expect(cfg.memory_provider).toBe('double');
    expect(mcp.addCount('memory-double')).toBe(1);
    expect(mcp.registered.has('memory-double')).toBe(true);
    // Pre-existing, unrelated config is untouched (no clobber).
    expect(cfg.llm_provider).toBe('claude');
    expect((cfg.defaults as Record<string, unknown>).model).toBe('opus');

    // ── status (source: config) ───────────────────────────────────────────────
    const statusActive = await memoryStatus({ projectRoot, registry });
    expect(statusActive.provider).toBe('double');
    expect(statusActive.source).toBe('config');

    // ── resolver returns the double ───────────────────────────────────────────
    const loaded = await loadConfig(projectRoot);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      const active = await resolveMemoryProvider(loaded.config, registry, { warnings: [] });
      expect(active).toBe(double);
    }

    // ── remove → back to local ────────────────────────────────────────────────
    const removed = await memoryRemove({ projectRoot, registry, mcp: mcp.runner });
    expect(removed.ok).toBe(true);

    const cfgAfter = await readParsedConfig(projectRoot);
    expect(cfgAfter.memory_provider ?? undefined).toBeUndefined();
    // Unrelated config still intact after removal.
    expect(cfgAfter.llm_provider).toBe('claude');

    const statusLocal = await memoryStatus({ projectRoot, registry });
    expect(statusLocal.provider).toBe('local');
    expect(statusLocal.source).toBe('default');

    const loadedAfter = await loadConfig(projectRoot);
    expect(loadedAfter.ok).toBe(true);
    if (loadedAfter.ok) {
      const active = await resolveMemoryProvider(loadedAfter.config, registry, { warnings: [] });
      expect((active as { name: string }).name).toBe('local');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-6 negative: re-add is idempotent — no duplicate MCP entry, config unchanged.
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-6: add is idempotent', () => {
  it('a second add is a no-op — no duplicate MCP entry, config unchanged', async () => {
    const memoryAdd = requireFn(await load(ADOPT_MOD), 'memoryAdd');
    const double = makeDouble('double');
    const registry = registryWith(double);
    const mcp = makeMcpStub();
    await seedConfig(projectRoot);

    await memoryAdd({ projectRoot, provider: 'double', registry, mcp: mcp.runner });
    const rawAfterFirst = await readRawConfig(projectRoot);

    await memoryAdd({ projectRoot, provider: 'double', registry, mcp: mcp.runner });
    const rawAfterSecond = await readRawConfig(projectRoot);

    // MCP wired once across both calls (guarded by `claude mcp get`).
    expect(mcp.addCount('memory-double')).toBe(1);
    // Config byte-for-byte unchanged by the redundant re-add.
    expect(rawAfterSecond).toBe(rawAfterFirst);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-6 negative (security): missing credentials → notice, NOT a half-config.
// The tracked config is never half-written and never receives a secret value.
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-6: missing credentials → notice, atomic (no half-config, no secret)', () => {
  it('add without required credentials leaves config unchanged and wires no MCP', async () => {
    const memoryAdd = requireFn(await load(ADOPT_MOD), 'memoryAdd');
    const double = makeDouble('secure', { requiredEnv: ['MEMORY_DOUBLE_TOKEN'] });
    const registry = registryWith(double);
    const mcp = makeMcpStub();
    await seedConfig(projectRoot);
    delete process.env.MEMORY_DOUBLE_TOKEN; // credential absent

    const before = await readRawConfig(projectRoot);
    const result = await memoryAdd({
      projectRoot,
      provider: 'secure',
      registry,
      mcp: mcp.runner,
      env: {},
    });

    // A clear notice, not a thrown error or a broken half-state.
    expect(result.ok).toBe(false);
    expect(String(result.notice ?? '')).toMatch(/credential/i);

    // Atomic: the tracked config is byte-for-byte unchanged (never half-written).
    const after = await readRawConfig(projectRoot);
    expect(after).toBe(before);
    const parsed = await readParsedConfig(projectRoot);
    expect(parsed.memory_provider ?? undefined).toBeUndefined();
    // No MCP wiring attempted when creds are missing.
    expect(mcp.addCount('memory-secure')).toBe(0);
  });

  it('a successful add never writes the credential VALUE into the tracked config', async () => {
    const memoryAdd = requireFn(await load(ADOPT_MOD), 'memoryAdd');
    const double = makeDouble('secure', { requiredEnv: ['MEMORY_DOUBLE_TOKEN'] });
    const registry = registryWith(double);
    const mcp = makeMcpStub();
    await seedConfig(projectRoot);

    const SECRET = 'super-secret-token-value-7f3a';
    const result = await memoryAdd({
      projectRoot,
      provider: 'secure',
      registry,
      mcp: mcp.runner,
      env: { MEMORY_DOUBLE_TOKEN: SECRET },
    });

    expect(result.ok).toBe(true);
    // The secret must never land in the git-tracked config file.
    const raw = await readRawConfig(projectRoot);
    expect(raw).not.toContain(SECRET);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-7 negative: remove is idempotent — re-remove is a clean no-op.
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-7: remove is idempotent', () => {
  it('removing when already local is a no-op (no error, config unchanged)', async () => {
    const memoryRemove = requireFn(await load(ADOPT_MOD), 'memoryRemove');
    const registry = registryWith();
    const mcp = makeMcpStub();
    await seedConfig(projectRoot); // no memory_provider selected → already local

    const before = await readRawConfig(projectRoot);
    const result = await memoryRemove({ projectRoot, registry, mcp: mcp.runner });
    expect(result.ok).toBe(true);
    const after = await readRawConfig(projectRoot);
    expect(after).toBe(before);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-6 negative: an interrupted add (config written, MCP not yet wired) re-runs
// cleanly to a consistent adopted state — no duplicate, no dangling half-state.
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-6: interrupted add re-runs cleanly', () => {
  it('config already selects the provider but MCP is unwired → re-run wires it once', async () => {
    const memoryAdd = requireFn(await load(ADOPT_MOD), 'memoryAdd');
    const double = makeDouble('double');
    const registry = registryWith(double);
    const mcp = makeMcpStub();
    // Simulate interruption: config already names the provider, MCP NOT registered.
    await seedConfig(projectRoot, 'memory_provider: double\nllm_provider: claude\n');
    expect(mcp.registered.has('memory-double')).toBe(false);

    const result = await memoryAdd({ projectRoot, provider: 'double', registry, mcp: mcp.runner });
    expect(result.ok).toBe(true);

    // Re-entrant: MCP wired exactly once, config still names the provider once.
    expect(mcp.addCount('memory-double')).toBe(1);
    expect(mcp.registered.has('memory-double')).toBe(true);
    const cfg = await readParsedConfig(projectRoot);
    expect(cfg.memory_provider).toBe('double');
    expect(cfg.llm_provider).toBe('claude');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-10 negative: switching add A → remove → add B always reads the then-active
// source; no stale wiring, no lost recall across switches.
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-10: switching providers reads from the then-active source', () => {
  it('add A → remove → add B leaves B active and A unwired', async () => {
    const mod = await load(ADOPT_MOD);
    const memoryAdd = requireFn(mod, 'memoryAdd');
    const memoryRemove = requireFn(mod, 'memoryRemove');
    const memoryStatus = requireFn(mod, 'memoryStatus');

    const a = makeDouble('alpha');
    const b = makeDouble('beta');
    const registry = registryWith(a, b);
    const mcp = makeMcpStub();
    await seedConfig(projectRoot);

    await memoryAdd({ projectRoot, provider: 'alpha', registry, mcp: mcp.runner });
    expect((await memoryStatus({ projectRoot, registry })).provider).toBe('alpha');

    await memoryRemove({ projectRoot, registry, mcp: mcp.runner });
    expect((await memoryStatus({ projectRoot, registry })).provider).toBe('local');

    await memoryAdd({ projectRoot, provider: 'beta', registry, mcp: mcp.runner });
    const finalStatus = await memoryStatus({ projectRoot, registry });
    expect(finalStatus.provider).toBe('beta');
    expect(finalStatus.source).toBe('config');

    // Config reflects only the then-active provider; B's MCP is wired.
    const cfg = await readParsedConfig(projectRoot);
    expect(cfg.memory_provider).toBe('beta');
    expect(mcp.registered.has('memory-beta')).toBe(true);
  });
});
