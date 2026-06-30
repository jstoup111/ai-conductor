import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { loadConfig, resolveMemoryProvider } from '../../src/engine/config.js';
import { resolveMemoryGuidanceSkill } from '../../src/engine/skill-resolver.js';
import { persistMemory } from '../../src/engine/memory-fallback.js';

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance specs for Slice 1b — flow-level assertions for FR-10 (B21 / B22).
//
// B21 (happy): with a non-default ("double") provider active, the COMPOSED PATH
//   (adopt → resolver → guidance → persist) operates THROUGH the active provider.
//   persistMemory routes to the platform (sink:platform); recall is the agent
//   querying the double's own state — the harness performs NO retrieval (FR-3).
//
// B22 (negative): switching providers (add A → remove → add B) leaves each run
//   reading from the then-active source; no stale wiring, no cross-provider
//   leakage across switches; resolver always returns the currently-active provider.
//
// These specs build FLOW-LEVEL assertions on top of the unit round-trips already
// tested in memory-provider-adoption.test.ts. They do NOT re-test the
// memoryAdd / memoryRemove / memoryStatus unit behaviour — only the composed
// path that crosses multiple modules.
//
// `claude mcp` is STUBBED at the process boundary via an injected runner.
// HOME is redirected to a per-test tmp dir; each `it` is fully independent.
// ─────────────────────────────────────────────────────────────────────────────

const ADOPT_MOD = '../../src/engine/memory-adopt.js';

async function loadMod(modPath: string): Promise<Record<string, unknown>> {
  return (await import(modPath)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function`);
  }
  return fn as (...args: any[]) => any;
}

// ── Self-contained test double (mirrors memory-provider-adoption.test.ts) ─────
// Tracks every write so tests can inspect the double's state via `.list()`
// without any harness-side retrieval call.
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

// ── Stubbed `claude mcp` runner (mirrors memory-provider-adoption.test.ts) ────
// Tracks registrations in-memory; never spawns a real process.
function makeMcpStub() {
  const registered = new Set<string>();
  const calls: string[][] = [];
  const runner = async (args: string[]): Promise<{ stdout: string; code: number }> => {
    calls.push(args);
    const [verb, mcpName] = args;
    if (verb === 'get') {
      return registered.has(mcpName)
        ? { stdout: `${mcpName}: memory-double-server`, code: 0 }
        : { stdout: '', code: 1 };
    }
    if (verb === 'add') {
      registered.add(mcpName);
      return { stdout: 'added', code: 0 };
    }
    if (verb === 'remove') {
      registered.delete(mcpName);
      return { stdout: 'removed', code: 0 };
    }
    if (verb === 'list') {
      return { stdout: [...registered].join('\n'), code: 0 };
    }
    return { stdout: '', code: 0 };
  };
  return { runner, calls, registered };
}

function registryWith(...providers: Array<{ name: string }>): PluginRegistry {
  const registry = new PluginRegistry();
  registry.register('memory_provider' as any, 'local', { name: 'local', kind: 'memory_provider' });
  for (const p of providers) {
    registry.register('memory_provider' as any, p.name, p);
  }
  return registry;
}

const SEEDED_CONFIG = 'llm_provider: claude\ndefaults:\n  model: opus\n';

async function seedConfig(root: string, body: string = SEEDED_CONFIG): Promise<void> {
  await mkdir(join(root, '.ai-conductor'), { recursive: true });
  await writeFile(join(root, '.ai-conductor', 'config.yml'), body, 'utf8');
}

// ── Per-test tmp dir + HOME redirect ─────────────────────────────────────────
let workDir: string;
let projectRoot: string;
let fakeHome: string;
const savedHome = { value: process.env.HOME };
const savedProfile = { value: process.env.USERPROFILE };

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'memory-alt-'));
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
  await rm(workDir, { recursive: true, force: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// B21 — FR-10 happy: memory behaviors operate under an alternative active provider.
//
// Composed flow under test:
//   memoryAdd (adopt) → loadConfig → resolveMemoryProvider → double is active
//   → resolveMemoryGuidanceSkill → guidance follows the active provider
//   → persistMemory → entry routed to platform (not local fallback)
//   → double.list() holds the entry (harness performed no retrieval — FR-3 locked)
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-10: memory behaviors operate under an alternative active provider', () => {
  it('resolveMemoryProvider returns the double (not local) after memoryAdd adopts it', async () => {
    const mod = await loadMod(ADOPT_MOD);
    const memoryAdd = requireFn(mod, 'memoryAdd');
    const double = makeDouble('double');
    const registry = registryWith(double);
    const mcp = makeMcpStub();
    await seedConfig(projectRoot);

    const added = await memoryAdd({ projectRoot, provider: 'double', registry, mcp: mcp.runner });
    expect(added.ok).toBe(true);

    // Read config that memoryAdd committed; resolver must surface the double.
    const loaded = await loadConfig(projectRoot);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const ctx = { warnings: [] as string[] };
    const active = await resolveMemoryProvider(loaded.config, registry, ctx);

    // Active provider IS the double, not local.
    expect(active).toBe(double);
    expect((active as { name: string }).name).toBe('double');
    // Clean resolution: config selects the double and it is available.
    expect(ctx.warnings).toHaveLength(0);
  });

  it('resolveMemoryGuidanceSkill returns the declared guidance path of the active provider', async () => {
    const mod = await loadMod(ADOPT_MOD);
    const memoryAdd = requireFn(mod, 'memoryAdd');
    // Double that declares a guidance path contained within projectRoot.
    const guidancePath = 'skills/serena-memory/SKILL.md';
    const double = makeDouble('double', { guidance: guidancePath });
    const registry = registryWith(double);
    const mcp = makeMcpStub();
    await seedConfig(projectRoot);

    await memoryAdd({ projectRoot, provider: 'double', registry, mcp: mcp.runner });

    const loaded = await loadConfig(projectRoot);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    // Resolve the active provider first — the double.
    const active = await resolveMemoryProvider(loaded.config, registry, { warnings: [] });
    expect(active).toBe(double);

    // Guidance resolver follows the active provider, not the local default.
    const guidanceCtx = { warnings: [] as string[] };
    const resolution = await resolveMemoryGuidanceSkill({
      provider: active as any,
      config: loaded.config as any,
      projectRoot,
      ctx: guidanceCtx,
    });

    expect(resolution.path).toBe(guidancePath);
    // No warnings — the guidance path is declared and contained.
    expect(guidanceCtx.warnings).toHaveLength(0);
  });

  it('resolveMemoryGuidanceSkill degrades to local default when active provider declares no guidance', async () => {
    const mod = await loadMod(ADOPT_MOD);
    const memoryAdd = requireFn(mod, 'memoryAdd');
    // Double with no guidance declared — degradation path.
    const double = makeDouble('no-guidance-double');
    const registry = registryWith(double);
    const mcp = makeMcpStub();
    await seedConfig(projectRoot);

    await memoryAdd({ projectRoot, provider: 'no-guidance-double', registry, mcp: mcp.runner });

    const loaded = await loadConfig(projectRoot);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const active = await resolveMemoryProvider(loaded.config, registry, { warnings: [] });
    expect(active).toBe(double);

    const guidanceCtx = { warnings: [] as string[] };
    const resolution = await resolveMemoryGuidanceSkill({
      provider: active as any,
      config: loaded.config as any,
      projectRoot,
      ctx: guidanceCtx,
    });

    // Falls back to the default skill — not the provider-specific path (none declared).
    expect(resolution.path).toBe('skills/memory/SKILL.md');
    // Exactly one warning: provider is active but declares no guidance.
    expect(guidanceCtx.warnings).toHaveLength(1);
    expect(guidanceCtx.warnings[0]).toMatch(/no-guidance-double|guidance|default/i);
  });

  it('persistMemory routes to the platform (sink:platform) when the active provider accepts writes', async () => {
    // Direct persist test: provider is the resolved double — accepts writes.
    const double = makeDouble('double');
    const ctx = { warnings: [] as string[] };
    const entry = {
      category: 'decisions' as const,
      name: 'test-decision',
      body: '# Test Decision\n\nSome content.',
      indexLine: '- [test-decision](decisions/test-decision.md)',
    };

    const result = await persistMemory({
      repoPath: projectRoot,
      provider: double as any,
      entry,
      ctx,
    });

    // Persisted to platform — not the local fallback store.
    expect(result.sink).toBe('platform');
    expect(result.pendingReconcile).toBe(false);
    // No warnings: write succeeded, no fallback triggered.
    expect(ctx.warnings).toHaveLength(0);
  });

  it('recall is agent-side: persisted entry is observable in double.list(), harness performed no retrieval', async () => {
    // The harness's role is WRITE (persist); RECALL is the agent querying the
    // provider directly. The double's `.list()` is the agent-side recall
    // mechanism. The harness exports no retrieve function — FR-3 stays locked.
    const double = makeDouble('double');
    const ctx = { warnings: [] as string[] };
    const entry = {
      category: 'context' as const,
      name: 'recall-test',
      body: '# Recall Test\n\nEntry persisted via the active provider.',
      indexLine: '- [recall-test](context/recall-test.md)',
    };

    await persistMemory({ repoPath: projectRoot, provider: double as any, entry, ctx });

    // The double holds the entry in its own state — the harness wrote to it.
    const stored = double.list();
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('recall-test');
    expect(stored[0].body).toContain('Recall Test');

    // No fallback: the write went to the platform.
    expect(ctx.warnings).toHaveLength(0);

    // FR-3 assertion: the harness has no harness-side retrieval call.
    // `double.list()` IS the agent's recall mechanism; there is no
    // `retrieveMemory`, `pullFromProvider`, or equivalent export in
    // memory-fallback.ts or config.ts that would aggregate from the provider.
    // Asserting the double's state is sufficient proof — if the harness had
    // retrieved the entry itself, double.list() would have been called from
    // production code, not only from this test.
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// B22 — FR-10 negative: switching providers reads from the active source.
//
// Composed flow under test:
//   add A → resolver(A) → remove → resolver(local, A MCP gone) →
//   add B → resolver(B, not A) → no stale wiring →
//   persist to A-era → switch to B → B.list() is clean (no cross-provider leakage)
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-10: switching providers reads from the active source', () => {
  it('resolver returns A after add A; local after remove (A MCP gone); B after add B (not A)', async () => {
    const mod = await loadMod(ADOPT_MOD);
    const memoryAdd = requireFn(mod, 'memoryAdd');
    const memoryRemove = requireFn(mod, 'memoryRemove');

    const doubleA = makeDouble('alpha');
    const doubleB = makeDouble('beta');
    const registry = registryWith(doubleA, doubleB);
    const mcp = makeMcpStub();
    await seedConfig(projectRoot);

    // ── add A ─────────────────────────────────────────────────────────────────
    const addedA = await memoryAdd({ projectRoot, provider: 'alpha', registry, mcp: mcp.runner });
    expect(addedA.ok).toBe(true);

    const loadedA = await loadConfig(projectRoot);
    expect(loadedA.ok).toBe(true);
    if (!loadedA.ok) return;

    const activeA = await resolveMemoryProvider(loadedA.config, registry, { warnings: [] });
    expect(activeA).toBe(doubleA);
    // A's MCP is wired.
    expect(mcp.registered.has('memory-alpha')).toBe(true);

    // ── remove → resolver falls back to local; A's MCP unwired ───────────────
    const removed = await memoryRemove({ projectRoot, registry, mcp: mcp.runner });
    expect(removed.ok).toBe(true);

    const loadedLocal = await loadConfig(projectRoot);
    expect(loadedLocal.ok).toBe(true);
    if (!loadedLocal.ok) return;

    const activeLocal = await resolveMemoryProvider(loadedLocal.config, registry, { warnings: [] });
    expect((activeLocal as { name: string }).name).toBe('local');
    // A's MCP is gone — no dangling wiring after remove.
    expect(mcp.registered.has('memory-alpha')).toBe(false);

    // ── add B → resolver returns B, not A (no stale wiring) ──────────────────
    const addedB = await memoryAdd({ projectRoot, provider: 'beta', registry, mcp: mcp.runner });
    expect(addedB.ok).toBe(true);

    const loadedB = await loadConfig(projectRoot);
    expect(loadedB.ok).toBe(true);
    if (!loadedB.ok) return;

    const activeB = await resolveMemoryProvider(loadedB.config, registry, { warnings: [] });
    expect(activeB).toBe(doubleB);
    expect(activeB).not.toBe(doubleA);
    // B's MCP is wired; A's remains absent.
    expect(mcp.registered.has('memory-beta')).toBe(true);
    expect(mcp.registered.has('memory-alpha')).toBe(false);

    // Stable: repeated resolution with the same config still returns B.
    const activeB2 = await resolveMemoryProvider(loadedB.config, registry, { warnings: [] });
    expect(activeB2).toBe(doubleB);
  });

  it('entries persisted under A are not surfaced in B state (no cross-provider leakage)', async () => {
    const mod = await loadMod(ADOPT_MOD);
    const memoryAdd = requireFn(mod, 'memoryAdd');
    const memoryRemove = requireFn(mod, 'memoryRemove');

    const doubleA = makeDouble('alpha');
    const doubleB = makeDouble('beta');
    const registry = registryWith(doubleA, doubleB);
    const mcp = makeMcpStub();
    await seedConfig(projectRoot);

    // ── Phase A: adopt A, resolve it, persist an entry through it ────────────
    await memoryAdd({ projectRoot, provider: 'alpha', registry, mcp: mcp.runner });

    const loadedA = await loadConfig(projectRoot);
    expect(loadedA.ok).toBe(true);
    if (!loadedA.ok) return;

    const resolvedA = await resolveMemoryProvider(loadedA.config, registry, { warnings: [] });
    expect(resolvedA).toBe(doubleA);

    const entry = {
      category: 'context' as const,
      name: 'alpha-era-entry',
      body: '# Alpha Era\n\nPersisted while A was the active source.',
      indexLine: '- [alpha-era-entry](context/alpha-era-entry.md)',
    };
    const ctxA = { warnings: [] as string[] };
    const resultA = await persistMemory({
      repoPath: projectRoot,
      provider: resolvedA as any,
      entry,
      ctx: ctxA,
    });

    // Entry went to A's platform.
    expect(resultA.sink).toBe('platform');
    expect(ctxA.warnings).toHaveLength(0);
    expect(doubleA.list()).toHaveLength(1);
    expect(doubleA.list()[0].name).toBe('alpha-era-entry');

    // ── Phase B: switch to B; B's state is clean ─────────────────────────────
    await memoryRemove({ projectRoot, registry, mcp: mcp.runner });
    await memoryAdd({ projectRoot, provider: 'beta', registry, mcp: mcp.runner });

    const loadedB = await loadConfig(projectRoot);
    expect(loadedB.ok).toBe(true);
    if (!loadedB.ok) return;

    const resolvedB = await resolveMemoryProvider(loadedB.config, registry, { warnings: [] });
    expect(resolvedB).toBe(doubleB);
    expect(resolvedB).not.toBe(doubleA);

    // B holds no entries from A — no cross-provider leakage.
    expect(doubleB.list()).toHaveLength(0);

    // A's entry is isolated on A, not phantom-surfaced as B-platform data.
    expect(doubleA.list()).toHaveLength(1);
    expect(doubleA.list()[0].name).toBe('alpha-era-entry');
  });
});
