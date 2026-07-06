import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRunFeature, type FeatureRunnerDeps, type WorktreeOutcome } from '../../src/engine/daemon-runner.js';
import type { BacklogItem } from '../../src/engine/daemon.js';

const ITEM: BacklogItem = { slug: 'feat-x' };

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
      deps(
        {
          done: true,
          halted: false,
          finishChoice: 'pr',
          prUrl: 'http://pr/1',
          costTokens: 42,
        },
        rec,
      ),
    );
    const out = await run(ITEM);
    expect(out.status).toBe('done');
    expect(out.prUrl).toBe('http://pr/1');
    expect(out.costTokens).toBe(42);
    expect(rec.processed).toBe(true);
    expect(rec.teardownKeep).toBe(false); // removed on success
  });

  it('done with verified prUrl and finishChoice="pr" → ships (happy path)', async () => {
    const rec: { teardownKeep?: boolean; processed?: boolean } = {};
    const run = makeRunFeature(
      deps(
        {
          done: true,
          halted: false,
          finishChoice: 'pr',
          prUrl: 'https://github.com/owner/repo/pull/123',
          costTokens: 50,
        },
        rec,
      ),
    );
    const out = await run(ITEM);
    expect(out.status).toBe('done');
    expect(out.prUrl).toBe('https://github.com/owner/repo/pull/123');
    expect(out.costTokens).toBe(50);
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

  describe('prepareWorktree (write namespace + run bin/setup)', () => {
    function depsWithOrder(
      order: string[],
      opts: { prepareThrows?: boolean } = {},
      rec: { teardownKeep?: boolean } = {},
    ): FeatureRunnerDeps {
      const base = deps(
        {
          done: true,
          halted: false,
          finishChoice: 'pr',
          prUrl: 'http://pr/1',
        },
        rec,
      );
      return {
        ...base,
        createWorktree: async (slug) => {
          order.push('createWorktree');
          return { path: `/wt/${slug}`, branch: `feat/${slug}` };
        },
        prepareWorktree: async () => {
          order.push('prepareWorktree');
          if (opts.prepareThrows) throw new Error('bin/setup failed: pg unreachable');
        },
        runConductor: async () => {
          order.push('runConductor');
        },
      };
    }

    it('runs prepareWorktree after createWorktree and before runConductor', async () => {
      const order: string[] = [];
      const run = makeRunFeature(depsWithOrder(order));
      await run(ITEM);
      expect(order).toEqual(['createWorktree', 'prepareWorktree', 'runConductor']);
    });

    it('a prepareWorktree failure aborts before the build and keeps the worktree', async () => {
      const order: string[] = [];
      const rec: { teardownKeep?: boolean } = {};
      const run = makeRunFeature(depsWithOrder(order, { prepareThrows: true }, rec));
      const out = await run(ITEM);
      expect(out.status).toBe('error');
      expect(out.reason).toMatch(/bin\/setup failed/);
      expect(order).toEqual(['createWorktree', 'prepareWorktree']); // runConductor never reached
      expect(rec.teardownKeep).toBe(true); // worktree kept for inspection
    });

    it('writes a diagnostic .pipeline/HALT into the worktree on an error (so it is not opaque)', async () => {
      const wt = await mkdtemp(join(tmpdir(), 'wt-err-'));
      try {
        const base = deps(
          {
            done: true,
            halted: false,
            finishChoice: 'pr',
          },
          {},
        );
        const run = makeRunFeature({
          ...base,
          createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          prepareWorktree: async () => {
            throw new Error("bin/setup failed: UnknownAdapterError 'stub'");
          },
          runConductor: async () => {},
        });
        const out = await run(ITEM);
        expect(out.status).toBe('error');
        // The captured reason is now persisted to .pipeline/HALT for the operator.
        const halt = await readFile(join(wt, '.pipeline', 'HALT'), 'utf-8');
        expect(halt).toMatch(/feature errored/);
        expect(halt).toMatch(/UnknownAdapterError 'stub'/);
      } finally {
        await rm(wt, { recursive: true, force: true });
      }
    });

    it('a deps object without prepareWorktree builds normally (backward compatible)', async () => {
      // The existing deps() helper ships no prepareWorktree — the feature must
      // still build, proving the step is genuinely opt-in.
      const run = makeRunFeature(
        deps({
          done: true,
          halted: false,
          finishChoice: 'pr',
          prUrl: 'http://pr/1',
        }),
      );
      const out = await run(ITEM);
      expect(out.status).toBe('done');
    });
  });
});
