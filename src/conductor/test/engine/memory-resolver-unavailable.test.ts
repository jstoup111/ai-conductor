/**
 * B4: Resolver — installed but unavailable at run start → warn + local (C2b).
 *
 * FR-2 negative: run continues (no throw); exactly one bounded warning.
 * (adr-2026-06-29-per-project-memory-provider-selection, C3 — no catch-all else)
 */
import { describe, it, expect } from 'vitest';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { resolveMemoryProvider } from '../../src/engine/config.js';
import { makeTestDoubleProvider } from '../fixtures/test-double-provider.js';
import { LocalMemoryProvider } from '../../src/engine/local-memory-provider.js';

function makeRegistry(...providers: Array<{ name: string }>) {
  const r = new PluginRegistry();
  r.register('memory_provider', 'local', LocalMemoryProvider);
  for (const p of providers) r.register('memory_provider', p.name, p);
  return r;
}

describe('B4: installed but unavailable at run start → warn + local, run continues', () => {
  it('falls back to local with exactly one warning', async () => {
    const double = makeTestDoubleProvider({ name: 'double', available: false });
    const registry = makeRegistry(double);
    const ctx = { warnings: [] as string[] };

    const result = await resolveMemoryProvider(
      { memory_provider: 'double' } as any,
      registry,
      ctx,
    );

    expect(result).toBe(LocalMemoryProvider);
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.warnings[0]).toMatch(/unavailable|local|fall/i);
  });

  it('does not throw — run continues', async () => {
    const double = makeTestDoubleProvider({ name: 'down', available: false });
    const registry = makeRegistry(double);

    await expect(
      resolveMemoryProvider({ memory_provider: 'down' } as any, registry, { warnings: [] }),
    ).resolves.toBe(LocalMemoryProvider);
  });

  it('warning is bounded — repeated resolution of same unavailable provider stays ≤1 warning', async () => {
    const double = makeTestDoubleProvider({ name: 'flaky', available: false });
    const registry = makeRegistry(double);
    const ctx = { warnings: [] as string[] };

    for (let i = 0; i < 5; i++) {
      await resolveMemoryProvider({ memory_provider: 'flaky' } as any, registry, ctx);
    }

    expect(ctx.warnings.length).toBeLessThanOrEqual(1);
  });

  it('warning de-dup is per ctx object — independent ctx objects each warn once', async () => {
    const double = makeTestDoubleProvider({ name: 'down2', available: false });
    const registry = makeRegistry(double);

    const ctx1 = { warnings: [] as string[] };
    const ctx2 = { warnings: [] as string[] };

    await resolveMemoryProvider({ memory_provider: 'down2' } as any, registry, ctx1);
    await resolveMemoryProvider({ memory_provider: 'down2' } as any, registry, ctx2);

    // Each ctx is independent (different run scopes)
    expect(ctx1.warnings).toHaveLength(1);
    expect(ctx2.warnings).toHaveLength(1);
  });

  it('branches are EXPLICIT — unavailable goes through C2b, not C3 (not-installed branch)', async () => {
    // The "installed but unavailable" branch should emit "unavailable" warning,
    // NOT the C3 "not installed" warning, confirming the explicit branch is hit.
    const double = makeTestDoubleProvider({ name: 'explicit-branch', available: false });
    const registry = makeRegistry(double);
    const ctx = { warnings: [] as string[] };

    await resolveMemoryProvider({ memory_provider: 'explicit-branch' } as any, registry, ctx);

    // Warning text matches "unavailable" (C2b), not "not installed" (C3)
    expect(ctx.warnings[0]).toMatch(/unavailable/i);
    expect(ctx.warnings[0]).not.toMatch(/not installed/i);
  });
});
