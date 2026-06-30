/**
 * B5: Resolver — per-project, no cross-project leakage.
 *
 * FR-1 negative: resolving one project's config does not mutate another's.
 * State lives on `ctx` (not module scope), so two separate calls with
 * different configs do not interfere (A10 — purity over config arg).
 */
import { describe, it, expect } from 'vitest';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { resolveMemoryProvider } from '../../src/engine/config.js';
import { makeTestDoubleProvider } from '../fixtures/test-double-provider.js';
import { LocalMemoryProvider } from '../../src/engine/local-memory-provider.js';

function makeSharedRegistry(doubles: Array<{ name: string }>) {
  const r = new PluginRegistry();
  r.register('memory_provider', 'local', LocalMemoryProvider);
  for (const d of doubles) r.register('memory_provider', d.name, d);
  return r;
}

describe('B5: per-project resolution, no cross-project leakage', () => {
  it('project A=double and project B=local resolve independently', async () => {
    const double = makeTestDoubleProvider({ name: 'double', available: true });
    const registry = makeSharedRegistry([double]);

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
    expect(bActive).toBe(LocalMemoryProvider);
  });

  it('re-resolving A after B is unchanged', async () => {
    const double = makeTestDoubleProvider({ name: 'double', available: true });
    const registry = makeSharedRegistry([double]);

    const aFirst = await resolveMemoryProvider(
      { memory_provider: 'double' } as any,
      registry,
      { warnings: [] },
    );
    // Resolve B (different project config)
    await resolveMemoryProvider({ memory_provider: 'local' } as any, registry, { warnings: [] });
    // Re-resolve A — must be unchanged
    const aSecond = await resolveMemoryProvider(
      { memory_provider: 'double' } as any,
      registry,
      { warnings: [] },
    );

    expect(aFirst).toBe(double);
    expect(aSecond).toBe(double);
  });

  it('warning de-dup is ctx-scoped — resolving project A has no effect on project B ctx', async () => {
    const unavailable = makeTestDoubleProvider({ name: 'down', available: false });
    const registry = makeSharedRegistry([unavailable]);

    const ctxA = { warnings: [] as string[] };
    const ctxB = { warnings: [] as string[] };

    await resolveMemoryProvider({ memory_provider: 'down' } as any, registry, ctxA);
    await resolveMemoryProvider({ memory_provider: 'down' } as any, registry, ctxB);

    // Each ctx is isolated — warnings do not bleed across
    expect(ctxA.warnings).toHaveLength(1);
    expect(ctxB.warnings).toHaveLength(1);
    // And within each ctx, repeats are bounded
    await resolveMemoryProvider({ memory_provider: 'down' } as any, registry, ctxA);
    expect(ctxA.warnings).toHaveLength(1); // still 1, de-duped
  });

  it('different providers for different projects resolve from the same shared registry', async () => {
    const alpha = makeTestDoubleProvider({ name: 'alpha', available: true });
    const beta = makeTestDoubleProvider({ name: 'beta', available: true });
    const registry = makeSharedRegistry([alpha, beta]);

    const aResult = await resolveMemoryProvider(
      { memory_provider: 'alpha' } as any,
      registry,
      { warnings: [] },
    );
    const bResult = await resolveMemoryProvider(
      { memory_provider: 'beta' } as any,
      registry,
      { warnings: [] },
    );

    expect(aResult).toBe(alpha);
    expect(bResult).toBe(beta);
    // They don't alias each other
    expect(aResult).not.toBe(bResult);
  });

  it('no module-level mutable state: fresh ctx is fully independent', async () => {
    // This test creates multiple independent ctxs and verifies they accumulate
    // independently — no shared state escapes to module scope.
    const unavailable = makeTestDoubleProvider({ name: 'shared-down', available: false });
    const registry = makeSharedRegistry([unavailable]);

    const results: string[][] = [];
    for (let i = 0; i < 3; i++) {
      const ctx = { warnings: [] as string[] };
      await resolveMemoryProvider({ memory_provider: 'shared-down' } as any, registry, ctx);
      await resolveMemoryProvider({ memory_provider: 'shared-down' } as any, registry, ctx);
      results.push([...ctx.warnings]);
    }

    // Each run (ctx) emits exactly 1 warning, not affected by prior runs
    for (const warnings of results) {
      expect(warnings).toHaveLength(1);
    }
  });
});
