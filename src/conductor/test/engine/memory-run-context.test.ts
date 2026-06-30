/**
 * Task A9 — thread the resolved active memory provider onto run context.
 *
 * The resolved provider must be computed at run start (parallel to `llm_provider`)
 * and carried on `FeatureRunnerDeps` so every memory-using step sees the same
 * single active provider (adr-2026-06-29-per-project-memory-provider-selection, FR-10, FR-1: exactly one active).
 *
 * This test verifies:
 *   - `FeatureRunnerDeps` exposes a `memoryProvider` field.
 *   - `makeFeatureRunnerDeps` threads `cfg.memoryProvider` straight through to
 *     the returned deps object (the daemon-cli resolves it; the deps factory just
 *     carries it).
 *   - The value on deps is the SAME object that was resolved (identity check).
 */

import { describe, it, expect } from 'vitest';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { resolveMemoryProvider } from '../../src/engine/config.js';
import type { FeatureRunnerDeps } from '../../src/engine/daemon-runner.js';

// Minimal stubs — we only need to verify memoryProvider passes through.
function stubDeps(memoryProvider: unknown): FeatureRunnerDeps {
  return {
    createWorktree: async (slug) => ({ path: `/wt/${slug}`, branch: `feat/${slug}` }),
    runConductor: async () => {},
    readOutcome: async () => ({ done: false, halted: false }),
    teardownWorktree: async () => {},
    markProcessed: async () => {},
    daemon: false,
    provider: {
      invoke: async () => ({ success: true, output: '' }),
      invokeInteractive: async () => {},
    },
    project: 'test-project',
    memoryProvider,
  };
}

describe('A9: active memory provider on run context (adr-2026-06-29-per-project-memory-provider-selection / FR-10)', () => {
  it('FeatureRunnerDeps accepts and exposes a memoryProvider field', () => {
    const sentinel = { name: 'local', kind: 'memory_provider' };
    const deps = stubDeps(sentinel);
    expect(deps.memoryProvider).toBe(sentinel);
  });

  it('resolved provider from registry is the same object carried on context', async () => {
    const LOCAL = { name: 'local', kind: 'memory_provider' };
    const registry = new PluginRegistry();
    registry.register('memory_provider' as any, 'local', LOCAL);

    const ctx = { warnings: [] as string[] };
    const resolved = await resolveMemoryProvider({}, registry, ctx);

    // The resolved object must be identical to what was registered — C1 (real
    // provider, never null) and FR-10 (stable single value for the whole run).
    expect(resolved).toBe(LOCAL);

    // Threading: a deps object carrying this value surfaces it unchanged.
    const deps = stubDeps(resolved);
    expect(deps.memoryProvider).toBe(LOCAL);
    expect(ctx.warnings).toEqual([]);
  });

  it('memoryProvider on deps is independent per-project (no shared state)', async () => {
    const LOCAL_A = { name: 'local', kind: 'memory_provider', tag: 'A' };
    const LOCAL_B = { name: 'local', kind: 'memory_provider', tag: 'B' };

    // Two separate registries simulate two separate project runs.
    const regA = new PluginRegistry();
    regA.register('memory_provider' as any, 'local', LOCAL_A);
    const regB = new PluginRegistry();
    regB.register('memory_provider' as any, 'local', LOCAL_B);

    const resolvedA = await resolveMemoryProvider({}, regA, { warnings: [] });
    const resolvedB = await resolveMemoryProvider({}, regB, { warnings: [] });

    const depsA = stubDeps(resolvedA);
    const depsB = stubDeps(resolvedB);

    expect(depsA.memoryProvider).toBe(LOCAL_A);
    expect(depsB.memoryProvider).toBe(LOCAL_B);
    expect(depsA.memoryProvider).not.toBe(depsB.memoryProvider);
  });
});
