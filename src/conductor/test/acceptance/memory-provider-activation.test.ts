import { describe, it, expect } from 'vitest';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { resolveMemoryProvider } from '../../src/engine/config.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for Slice 1b — non-default ACTIVATION through the resolver
// (FR-1 / FR-2). 1a built/tested the absent/empty/malformed/unknown/`local`
// branches; 1b completes the two remaining EXPLICIT non-default branches:
//   - named + installed + available            → that provider, zero warnings
//   - named + installed + UNAVAILABLE at start  → `local` + exactly one warning,
//                                                 run continues (no throw)
// plus FR-1 per-project independence (resolving one project's config never
// mutates another's — no cross-project leakage).
//
// Drives the (partly-built) `resolveMemoryProvider` in `config.ts`. The
// UNAVAILABLE branch is the RED driver: today's resolver returns any installed
// provider without an availability probe, so it returns the unavailable double
// instead of falling back to `local`.
// ─────────────────────────────────────────────────────────────────────────────

const LOCAL = { name: 'local', kind: 'memory_provider' as const };

// Self-contained test double — availability is togglable; exposes both an
// `isAvailable()` method and an `available` getter so whichever probe the
// resolver adopts observes the same truth.
function makeDouble(name: string, available: boolean) {
  return {
    name,
    kind: 'memory_provider' as const,
    _available: available,
    isAvailable(): boolean {
      return this._available;
    },
    get available(): boolean {
      return this._available;
    },
  };
}

function registryWith(...providers: Array<{ name: string }>): PluginRegistry {
  const registry = new PluginRegistry();
  registry.register('memory_provider' as any, 'local', LOCAL);
  for (const p of providers) registry.register('memory_provider' as any, p.name, p);
  return registry;
}

// ═════════════════════════════════════════════════════════════════════════════
// FR-1 happy: a named, installed, available provider becomes active, no warning.
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-1: named + installed + available → that provider', () => {
  it('resolves the double (not local) with zero warnings', async () => {
    const double = makeDouble('double', true);
    const ctx = { warnings: [] as string[] };

    const active = await resolveMemoryProvider(
      { memory_provider: 'double' } as any,
      registryWith(double),
      ctx,
    );

    expect(active).toBe(double);
    expect(ctx.warnings).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-2 negative: a selected provider that exists but is UNAVAILABLE at run start
// → warn + fall back to `local` + the run continues (no throw escapes).
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-2: installed but unavailable at run start → warn + local + continue', () => {
  it('falls back to local with exactly one clear warning', async () => {
    const double = makeDouble('double', false); // installed but DOWN
    const ctx = { warnings: [] as string[] };

    const active = await resolveMemoryProvider(
      { memory_provider: 'double' } as any,
      registryWith(double),
      ctx,
    );

    expect(active).toBe(LOCAL);
    expect(ctx.warnings.length).toBe(1);
    expect(ctx.warnings[0]).toMatch(/double|unavailable|local|fall/i);
  });

  it('repeated resolution of the same unavailable provider stays bounded (≤1 warning)', async () => {
    const double = makeDouble('double', false);
    const registry = registryWith(double);
    const ctx = { warnings: [] as string[] };

    await resolveMemoryProvider({ memory_provider: 'double' } as any, registry, ctx);
    await resolveMemoryProvider({ memory_provider: 'double' } as any, registry, ctx);
    await resolveMemoryProvider({ memory_provider: 'double' } as any, registry, ctx);

    expect(ctx.warnings.length).toBeLessThanOrEqual(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-1 negative: selection is per-project — resolving project A's config does not
// change project B's active provider (no cross-project leakage).
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-1: per-project resolution, no cross-project leakage', () => {
  it('project A=double and project B=local resolve independently', async () => {
    const double = makeDouble('double', true);
    const registry = registryWith(double);

    const aActive = await resolveMemoryProvider(
      { memory_provider: 'double' } as any,
      registry,
      { warnings: [] },
    );
    const bActive = await resolveMemoryProvider(
      { memory_provider: 'local' } as any,
      registry,
      { warnings: [] },
    );

    expect(aActive).toBe(double);
    expect(bActive).toBe(LOCAL);

    // Re-resolving A is unchanged — B's resolution did not mutate shared state.
    const aAgain = await resolveMemoryProvider(
      { memory_provider: 'double' } as any,
      registry,
      { warnings: [] },
    );
    expect(aAgain).toBe(double);
  });
});
