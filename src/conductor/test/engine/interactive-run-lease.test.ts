// Covers: task:3
import { describe, expect, it, vi } from 'vitest';
import type { FeatureDispatchLease } from '../../src/engine/feature-dispatch-lease.js';
import { runInteractiveConductorWithLease } from '../../src/index.js';

describe('interactive conductor run lease', () => {
  it('takes the stacked-feature lease before the first conductor mutation despite an operator park marker', async () => {
    const calls: string[] = [];
    const release = vi.fn(async () => {
      calls.push('lease release');
      return { ok: true } as const;
    });
    const acquire = vi.fn(async () => {
      calls.push('lease acquire');
      return { kind: 'acquired' as const, lease: { release } satisfies FeatureDispatchLease };
    });
    const run = vi.fn(async () => {
      calls.push('worktree preparation');
      calls.push('conduct-state write');
    });

    const result = await runInteractiveConductorWithLease({
      projectRoot: '/main/.worktrees/demo',
      featureDesc: 'Demo',
      run,
      dependencies: {
        slugify: () => 'demo',
        hasDurableChildState: async () => true,
        resolveMainRepoRoot: async () => ({ root: '/main' }),
        acquire,
      },
    });

    expect(result).toEqual({ kind: 'ran' });
    expect(calls).toEqual([
      'lease acquire',
      'worktree preparation',
      'conduct-state write',
      'lease release',
    ]);
    expect(acquire).toHaveBeenCalledWith('/main', 'demo', 'interactive conductor run');
    // The interactive entry has no park predicate/dependency: a present marker
    // cannot be consulted or stop its first dispatched step.
    expect(run).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it('refuses a live lease owner before dispatching any conductor step', async () => {
    const run = vi.fn(async () => undefined);

    const result = await runInteractiveConductorWithLease({
      projectRoot: '/main/.worktrees/demo',
      featureDesc: 'Demo',
      run,
      dependencies: {
        slugify: () => 'demo',
        hasDurableChildState: async () => true,
        resolveMainRepoRoot: async () => ({ root: '/main' }),
        acquire: async () => ({
          kind: 'live-owner',
          owner: {
            host: 'local-host',
            pid: 4321,
            processStartTime: 'current-start',
            token: 'owner-token',
            purpose: 'operator stack land',
          },
        }),
      },
    });

    expect(result).toEqual({
      kind: 'refused',
      message: 'interactive conductor run refused: feature dispatch lease is held by operator stack land (pid 4321)',
    });
    expect(run).not.toHaveBeenCalled();
  });
});
