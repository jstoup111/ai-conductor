/**
 * B3: Resolver — named + installed + available → that provider, no warning.
 *
 * Tests the explicit availability probe: `isAvailable?.() === false` detects
 * unavailability; truthy/no-probe → uses the provider, zero warnings.
 *
 * FR-1 happy-path (adr-2026-06-29-per-project-memory-provider-selection).
 */
import { describe, it, expect } from 'vitest';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { resolveMemoryProvider } from '../../src/engine/config.js';
import { makeTestDoubleProvider } from '../fixtures/test-double-provider.js';
import { LocalMemoryProvider } from '../../src/engine/local-memory-provider.js';

function makeRegistry(...providers: Array<{ name: string; kind: string }>) {
  const r = new PluginRegistry();
  r.register('memory_provider', 'local', LocalMemoryProvider);
  for (const p of providers) r.register('memory_provider', p.name, p);
  return r;
}

describe('B3: named + installed + available → that provider, no warning', () => {
  it('returns the available double (not local), zero warnings', async () => {
    const double = makeTestDoubleProvider({ name: 'double', available: true });
    const registry = makeRegistry(double);
    const ctx = { warnings: [] as string[] };

    const result = await resolveMemoryProvider(
      { memory_provider: 'double' } as any,
      registry,
      ctx,
    );

    expect(result).toBe(double);
    expect(ctx.warnings).toHaveLength(0);
  });

  it('a provider with no isAvailable() method is treated as available', async () => {
    // Provider has no isAvailable — the probe (isAvailable?.() === false) should
    // NOT trigger the unavailable branch (undefined !== false).
    const noProbeProvider = { name: 'no-probe', kind: 'memory_provider' as const };
    const registry = makeRegistry(noProbeProvider);
    const ctx = { warnings: [] as string[] };

    const result = await resolveMemoryProvider(
      { memory_provider: 'no-probe' } as any,
      registry,
      ctx,
    );

    expect(result).toBe(noProbeProvider);
    expect(ctx.warnings).toHaveLength(0);
  });

  it('an explicitly available provider (isAvailable=true) returns without warning', async () => {
    const double = makeTestDoubleProvider({ name: 'explicit-avail', available: true });
    const registry = makeRegistry(double);
    const ctx = { warnings: [] as string[] };

    const result = await resolveMemoryProvider(
      { memory_provider: 'explicit-avail' } as any,
      registry,
      ctx,
    );

    expect(result).toBe(double);
    expect(ctx.warnings).toHaveLength(0);
  });
});
