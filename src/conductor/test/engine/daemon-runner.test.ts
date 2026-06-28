import { describe, it, expect } from 'vitest';
import { makeRunFeature, type FeatureRunnerDeps, type WorktreeOutcome } from '../../src/engine/daemon-runner.js';
import type { BacklogItem } from '../../src/engine/daemon.js';

const ITEM: BacklogItem = { slug: 'feat-x', storiesPath: 's', planPath: 'p' };

function deps(
  outcome: WorktreeOutcome,
  rec: { teardownKeep?: boolean; processed?: boolean; threw?: boolean } = {},
  opts: { throwIn?: keyof FeatureRunnerDeps } = {},
): FeatureRunnerDeps {
  const maybeThrow = (k: keyof FeatureRunnerDeps) => {
    if (opts.throwIn === k) throw new Error(`fail in ${k}`);
  };
  return {
    createWorktree: async (slug) => {
      maybeThrow('createWorktree');
      return { path: `/wt/${slug}`, branch: `feat/${slug}` };
    },
    materializeSpecs: async () => {
      maybeThrow('materializeSpecs');
    },
    runConductor: async () => {
      maybeThrow('runConductor');
    },
    readOutcome: async () => outcome,
    teardownWorktree: async (_wt, keep) => {
      rec.teardownKeep = keep;
    },
    markProcessed: async () => {
      rec.processed = true;
    },
    // Non-daemon path: emission never runs, so these are inert but keep the
    // deps object type-complete.
    daemon: false,
    provider: {
      invoke: async () => ({ success: true, output: '' }),
      invokeInteractive: async () => {},
    },
    project: 'test-project',
  };
}

describe('engine/daemon-runner — makeRunFeature', () => {
  it('done → marks processed, removes the worktree, reports prUrl', async () => {
    const rec: { teardownKeep?: boolean; processed?: boolean } = {};
    const run = makeRunFeature(
      deps({ done: true, halted: false, prUrl: 'http://pr/1', costTokens: 42 }, rec),
    );
    const out = await run(ITEM);
    expect(out.status).toBe('done');
    expect(out.prUrl).toBe('http://pr/1');
    expect(out.costTokens).toBe(42);
    expect(rec.processed).toBe(true);
    expect(rec.teardownKeep).toBe(false); // removed on success
  });

  it('halted → keeps the worktree, does not mark processed', async () => {
    const rec: { teardownKeep?: boolean; processed?: boolean } = {};
    const run = makeRunFeature(
      deps({ done: false, halted: true, reason: 'needs human' }, rec),
    );
    const out = await run(ITEM);
    expect(out.status).toBe('halted');
    expect(out.reason).toBe('needs human');
    expect(rec.processed).toBeUndefined();
    expect(rec.teardownKeep).toBe(true); // kept for inspection
  });

  it('no DONE/HALT marker → error, worktree kept', async () => {
    const rec: { teardownKeep?: boolean } = {};
    const run = makeRunFeature(deps({ done: false, halted: false }, rec));
    const out = await run(ITEM);
    expect(out.status).toBe('error');
    expect(out.reason).toMatch(/without DONE or HALT/);
    expect(rec.teardownKeep).toBe(true);
  });

  it('a thrown primitive is caught as an error; worktree torn down', async () => {
    const rec: { teardownKeep?: boolean } = {};
    const run = makeRunFeature(
      deps({ done: true, halted: false }, rec, { throwIn: 'runConductor' }),
    );
    const out = await run(ITEM);
    expect(out.status).toBe('error');
    expect(out.reason).toMatch(/fail in runConductor/);
    expect(rec.teardownKeep).toBe(true);
  });

  it('a throw during createWorktree yields an error with no teardown', async () => {
    const rec: { teardownKeep?: boolean } = {};
    const run = makeRunFeature(
      deps({ done: true, halted: false }, rec, { throwIn: 'createWorktree' }),
    );
    const out = await run(ITEM);
    expect(out.status).toBe('error');
    expect(rec.teardownKeep).toBeUndefined(); // never created → nothing to tear down
  });

  describe('preflight (opt-in infra hook)', () => {
    function depsWithOrder(
      order: string[],
      opts: { preflightThrows?: boolean } = {},
      rec: { teardownKeep?: boolean } = {},
    ): FeatureRunnerDeps {
      const base = deps({ done: true, halted: false, prUrl: 'http://pr/1' }, rec);
      return {
        ...base,
        materializeSpecs: async () => {
          order.push('materialize');
        },
        preflight: async () => {
          order.push('preflight');
          if (opts.preflightThrows) throw new Error('pg_isready timed out');
        },
        runConductor: async () => {
          order.push('runConductor');
        },
      };
    }

    it('runs preflight after materializeSpecs and before runConductor', async () => {
      const order: string[] = [];
      const run = makeRunFeature(depsWithOrder(order));
      await run(ITEM);
      expect(order).toEqual(['materialize', 'preflight', 'runConductor']);
    });

    it('a preflight failure aborts before the build and keeps the worktree', async () => {
      const order: string[] = [];
      const rec: { teardownKeep?: boolean } = {};
      const run = makeRunFeature(depsWithOrder(order, { preflightThrows: true }, rec));
      const out = await run(ITEM);
      expect(out.status).toBe('error');
      expect(out.reason).toMatch(/pg_isready timed out/);
      expect(order).toEqual(['materialize', 'preflight']); // runConductor never reached
      expect(rec.teardownKeep).toBe(true); // worktree kept for inspection
    });

    it('a deps object without preflight builds normally (backward compatible)', async () => {
      // The existing deps() helper ships no preflight — the feature must still
      // build, proving the hook is genuinely opt-in.
      const run = makeRunFeature(deps({ done: true, halted: false, prUrl: 'http://pr/1' }));
      const out = await run(ITEM);
      expect(out.status).toBe('done');
    });
  });
});
