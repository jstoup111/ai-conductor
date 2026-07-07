import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
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

  describe('false-ship path (Task 10: #337)', () => {
    // Story 3 acceptance criteria: outcome.done=true but fails ship-eligibility guard
    // (finishChoice != 'pr' or prUrl null or finishChoice undefined).
    // Expected: HALT written, DONE deleted, worktree kept, markProcessed NOT called,
    // status='halted', reason names the contradiction.

    it('done with null prUrl → halted (Story 3, null prUrl)', async () => {
      const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
      try {
        const rec: { teardownKeep?: boolean; processed?: boolean; escalated?: boolean } = {};
        const run = makeRunFeature({
          ...deps(
            {
              done: true,
              halted: false,
              finishChoice: 'pr',
              prUrl: undefined, // null prUrl fails the guard
              costTokens: 30,
            },
            rec,
          ),
          createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          escalateBuildFailure: async () => {
            rec.escalated = true;
            return {};
          },
        });
        const out = await run(ITEM);
        expect(out.status).toBe('halted');
        expect(out.reason).toMatch(/prUrl is null/);
        expect(out.costTokens).toBe(30);
        expect(rec.processed).toBeUndefined(); // markProcessed NOT called
        expect(rec.teardownKeep).toBe(true); // worktree kept
        expect(rec.escalated).toBe(true); // escalateBuildFailure called
        // HALT marker must exist
        const halt = await readFile(join(wt, '.pipeline', 'HALT'), 'utf-8');
        expect(halt).toMatch(/prUrl is null/);
      } finally {
        await rm(wt, { recursive: true, force: true });
      }
    });

    it('done with undefined finishChoice → halted (Story 3, missing finishChoice)', async () => {
      const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
      try {
        const rec: { teardownKeep?: boolean; processed?: boolean } = {};
        const run = makeRunFeature({
          ...deps(
            {
              done: true,
              halted: false,
              finishChoice: undefined, // missing finishChoice fails the guard
              prUrl: 'https://github.com/owner/repo/pull/123',
              costTokens: 25,
            },
            rec,
          ),
          createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
        });
        const out = await run(ITEM);
        expect(out.status).toBe('halted');
        expect(out.reason).toMatch(/without a finish-choice marker/);
        expect(rec.processed).toBeUndefined(); // markProcessed NOT called
        expect(rec.teardownKeep).toBe(true); // worktree kept
        // HALT marker must exist
        const halt = await readFile(join(wt, '.pipeline', 'HALT'), 'utf-8');
        expect(halt).toMatch(/without a finish-choice marker/);
      } finally {
        await rm(wt, { recursive: true, force: true });
      }
    });

    it('done with finishChoice="keep" → halted', async () => {
      const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
      try {
        const rec: { teardownKeep?: boolean; processed?: boolean } = {};
        const run = makeRunFeature({
          ...deps(
            {
              done: true,
              halted: false,
              finishChoice: 'keep', // not 'pr' fails the guard
              prUrl: 'https://github.com/owner/repo/pull/123',
            },
            rec,
          ),
          createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
        });
        const out = await run(ITEM);
        expect(out.status).toBe('halted');
        expect(out.reason).toMatch(/finish choice is "keep" not "pr"/);
        expect(rec.processed).toBeUndefined();
        expect(rec.teardownKeep).toBe(true);
      } finally {
        await rm(wt, { recursive: true, force: true });
      }
    });

    it('false-ship deletes the DONE marker if it exists', async () => {
      const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
      try {
        // Pre-create the DONE marker (simulating an outcome that converged DONE before the guard)
        await mkdir(join(wt, '.pipeline'), { recursive: true });
        await writeFile(join(wt, '.pipeline', 'DONE'), 'marked\n', 'utf-8');

        const rec: { teardownKeep?: boolean } = {};
        const run = makeRunFeature({
          ...deps(
            {
              done: true,
              halted: false,
              finishChoice: 'pr',
              prUrl: undefined, // fails guard
            },
            rec,
          ),
          createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
        });
        const out = await run(ITEM);
        expect(out.status).toBe('halted');

        // DONE marker must be deleted (conflict resolution)
        try {
          await readFile(join(wt, '.pipeline', 'DONE'), 'utf-8');
          throw new Error('DONE marker should have been deleted');
        } catch (err) {
          if ((err as any).code !== 'ENOENT') throw err;
        }

        // HALT marker must exist
        const halt = await readFile(join(wt, '.pipeline', 'HALT'), 'utf-8');
        expect(halt).toBeTruthy();
      } finally {
        await rm(wt, { recursive: true, force: true });
      }
    });

    it('false-ship calls escalateBuildFailure with proper context', async () => {
      const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
      try {
        const escalateCalls: Array<{ projectRoot: string; failureReason: string }> = [];
        const run = makeRunFeature({
          ...deps(
            {
              done: true,
              halted: false,
              finishChoice: 'pr',
              prUrl: undefined,
            },
            {},
          ),
          createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          escalateBuildFailure: async (opts) => {
            escalateCalls.push(opts);
            return {};
          },
        });
        await run(ITEM);
        expect(escalateCalls).toHaveLength(1);
        expect(escalateCalls[0].projectRoot).toBe(wt);
        expect(escalateCalls[0].failureReason).toMatch(/prUrl is null/);
      } finally {
        await rm(wt, { recursive: true, force: true });
      }
    });

    it('false-ship continues even if escalateBuildFailure throws', async () => {
      const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
      try {
        const rec: { teardownKeep?: boolean; processed?: boolean } = {};
        const run = makeRunFeature({
          ...deps(
            {
              done: true,
              halted: false,
              finishChoice: 'pr',
              prUrl: undefined,
            },
            rec,
          ),
          createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          escalateBuildFailure: async () => {
            throw new Error('push failed');
          },
        });
        const out = await run(ITEM);
        // Must not throw; must complete the halted path
        expect(out.status).toBe('halted');
        expect(rec.teardownKeep).toBe(true); // still kept
        // HALT marker still written
        const halt = await readFile(join(wt, '.pipeline', 'HALT'), 'utf-8');
        expect(halt).toBeTruthy();
      } finally {
        await rm(wt, { recursive: true, force: true });
      }
    });

    it('false-ship runs maybeSweep (FR-14: sweep after every completion)', async () => {
      const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
      try {
        const sweepCalls: number[] = [];
        const run = makeRunFeature({
          ...deps(
            {
              done: true,
              halted: false,
              finishChoice: 'pr',
              prUrl: undefined,
            },
            {},
          ),
          createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          projectRoot: '/proj',
          sweepMergeableLabels: async () => {
            sweepCalls.push(Date.now());
          },
        });
        const out = await run(ITEM);
        expect(out.status).toBe('halted');
        expect(sweepCalls).toHaveLength(1); // sweep called
      } finally {
        await rm(wt, { recursive: true, force: true });
      }
    });
  });
});
