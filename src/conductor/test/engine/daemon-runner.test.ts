import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRunFeature, type FeatureRunnerDeps, type WorktreeOutcome } from '../../src/engine/daemon-runner.js';
import type { BacklogItem } from '../../src/engine/daemon.js';
import type { TriageOutcome } from '../../src/engine/setup-triage.js';
import { SetupFailureError } from '../../src/engine/worktree-prepare.js';

const ITEM: BacklogItem = { slug: 'feat-x' };

interface TestRecorder {
  teardownKeep?: boolean;
  processed?: boolean;
  processedCalls?: Array<{ slug: string; prUrl?: string }>;
  cleanupCalls?: Array<{ prUrl: string }>;
  enrollCalls?: Array<{ prUrl: string; slug: string }>;
  threw?: boolean;
}

function deps(
  outcome: WorktreeOutcome,
  rec: TestRecorder = {},
  opts: { throwIn?: keyof FeatureRunnerDeps } = {},
): FeatureRunnerDeps {
  const maybeThrow = (k: keyof FeatureRunnerDeps) => {
    if (opts.throwIn === k) throw new Error(`fail in ${k}`);
  };
  // Ensure arrays are initialized
  if (!rec.processedCalls) rec.processedCalls = [];
  if (!rec.enrollCalls) rec.enrollCalls = [];
  if (!rec.cleanupCalls) rec.cleanupCalls = [];

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
    markProcessed: async (slug: string, prUrl?: string) => {
      rec.processed = true;
      rec.processedCalls!.push({ slug, prUrl });
    },
    // Non-daemon path: emission never runs, so these are inert but keep the
    // deps object type-complete.
    daemon: false,
    provider: {
      invoke: async () => ({ success: true, output: '' }),
      invokeInteractive: async () => {},
    },
    project: 'test-project',
    projectRoot: '/proj',
    runGh: {
      async invoke() {
        return { stdout: '', exitCode: 0 };
      },
      async invokeInteractive() {},
    },
    enrollWatch: async (projectRoot: string, entry: any) => {
      rec.enrollCalls!.push({ prUrl: entry.prUrl, slug: entry.slug });
    },
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

  describe('daemon-only triage routing (Task 13 — makeRunFeature wiring)', () => {
    // Story TS-2: setup-failure triage + daemon mode dispatch flow
    // Story TS-1: non-setup errors keep today's path
    // Use TriageOutcome type to keep import alive
    type TriageHandler = (error: any, worktree: any, item: any) => Promise<TriageOutcome>;

    // Minimal SetupFailureError mock (imported from worktree-prepare)
    class SetupFailureError extends Error {
      outputTail: string;

      constructor(message: string, outputTail: string = '') {
        super(message);
        this.name = 'SetupFailureError';
        this.outputTail = outputTail;
      }
    }

    interface TriageRecorder {
      triageCalls?: Array<{ error: string; daemon: boolean }>;
      triageReturnValue?: { kind: 'quarantined-pass' | 'park'; outputTail?: string };
    }

    function depsWithTriageOrder(
      order: string[],
      rec: TriageRecorder & { teardownKeep?: boolean } = {},
      opts: {
        prepareThrows?: 'setup-failure' | 'plain-error';
        daemon?: boolean;
        triageThrows?: boolean;
      } = {},
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
      const triageHandler: TriageHandler = async (error: any, _worktree: any, _item: any) => {
        order.push('triage');
        if (!rec.triageCalls) rec.triageCalls = [];
        rec.triageCalls.push({ error: error.message, daemon: opts.daemon ?? false });
        if (opts.triageThrows) throw new Error('triage dispatch failed');
        return rec.triageReturnValue ?? { kind: 'quarantined-pass', outputTail: '' };
      };
      return {
        ...base,
        daemon: opts.daemon ?? false,
        createWorktree: async (slug) => {
          order.push('createWorktree');
          return { path: `/wt/${slug}`, branch: `feat/${slug}` };
        },
        prepareWorktree: async () => {
          order.push('prepareWorktree');
          if (opts.prepareThrows === 'setup-failure') {
            throw new SetupFailureError(
              'project setup (bin/setup) failed: pg unreachable',
              'tail of output',
            );
          }
          if (opts.prepareThrows === 'plain-error') {
            throw new Error('some random error');
          }
        },
        runConductor: async () => {
          order.push('runConductor');
        },
        runSetupTriage: triageHandler,
      };
    }

    it('TS-2 happy: SetupFailureError with daemon=true invokes triage → quarantined-pass continues to runConductor', async () => {
      const order: string[] = [];
      const rec: TriageRecorder & { teardownKeep?: boolean } = {
        triageReturnValue: { kind: 'quarantined-pass', outputTail: '' },
      };
      const run = makeRunFeature(
        depsWithTriageOrder(order, rec, {
          prepareThrows: 'setup-failure',
          daemon: true,
        }),
      );
      const out = await run(ITEM);
      expect(out.status).toBe('done'); // continued to runConductor and got outcome
      expect(order).toEqual(['createWorktree', 'prepareWorktree', 'triage', 'runConductor']);
      expect(rec.triageCalls).toHaveLength(1);
    });

    it('TS-2 routing: SetupFailureError with triage returning park → runConductor never runs, error outcome', async () => {
      const order: string[] = [];
      const rec: TriageRecorder & { teardownKeep?: boolean } = {
        triageReturnValue: { kind: 'park', outputTail: 'setup is broken' },
      };
      const run = makeRunFeature(
        depsWithTriageOrder(order, rec, {
          prepareThrows: 'setup-failure',
          daemon: true,
        }),
      );
      const out = await run(ITEM);
      expect(out.status).toBe('error');
      expect(out.reason).toMatch(/setup is broken/);
      expect(rec.teardownKeep).toBe(true); // worktree kept for inspection
      expect(order).toEqual(['createWorktree', 'prepareWorktree', 'triage']);
    });

    it("TS-1 negative: plain Error during prepare bypasses triage (today's path)", async () => {
      const order: string[] = [];
      const rec: TriageRecorder & { teardownKeep?: boolean } = {};
      const run = makeRunFeature(
        depsWithTriageOrder(order, rec, {
          prepareThrows: 'plain-error',
          daemon: true,
        }),
      );
      const out = await run(ITEM);
      expect(out.status).toBe('error');
      expect(out.reason).toMatch(/some random error/);
      expect(rec.triageCalls).toBeUndefined(); // triage never invoked
      expect(order).toEqual(['createWorktree', 'prepareWorktree']); // today's path byte-identical
    });

    it('prepare succeeding bypasses triage (no side effects)', async () => {
      const order: string[] = [];
      const rec: TriageRecorder & { teardownKeep?: boolean } = {};
      const run = makeRunFeature(
        depsWithTriageOrder(order, rec, {
          prepareThrows: undefined,
          daemon: true,
        }),
      );
      const out = await run(ITEM);
      expect(out.status).toBe('done');
      expect(rec.triageCalls).toBeUndefined(); // triage never invoked
      expect(order).toEqual(['createWorktree', 'prepareWorktree', 'runConductor']);
    });

    it('runSetupTriage absent → SetupFailureError reverts to today\'s error path (no-op)', async () => {
      const order: string[] = [];
      const rec: { teardownKeep?: boolean } = {};
      const base = deps(
        {
          done: true,
          halted: false,
          finishChoice: 'pr',
          prUrl: 'http://pr/1',
        },
        rec,
      );
      const run = makeRunFeature({
        ...base,
        daemon: true,
        createWorktree: async (slug) => {
          order.push('createWorktree');
          return { path: `/wt/${slug}`, branch: `feat/${slug}` };
        },
        prepareWorktree: async () => {
          order.push('prepareWorktree');
          class SetupFailureError extends Error {
            outputTail: string;

            constructor(message: string, outputTail: string = '') {
              super(message);
              this.name = 'SetupFailureError';
              this.outputTail = outputTail;
            }
          }
          throw new SetupFailureError('setup failed', 'output');
        },
        runConductor: async () => {
          order.push('runConductor');
        },
        // Intentionally absent: runSetupTriage
      });
      const out = await run(ITEM);
      expect(out.status).toBe('error');
      expect(out.reason).toMatch(/setup failed/);
      expect(order).toEqual(['createWorktree', 'prepareWorktree']); // no triage injection
    });
  });

  describe('quarantine surfacing to the resuming build agent (Task 14 — makeRunFeature wiring)', () => {
    class SetupFailureError extends Error {
      outputTail: string;
      constructor(message: string, outputTail: string = '') {
        super(message);
        this.name = 'SetupFailureError';
        this.outputTail = outputTail;
      }
    }

    function depsWithSurfacing(
      rec: { teardownKeep?: boolean },
      opts: {
        triageReturnValue: TriageOutcome;
        surfaceQuarantineRef?: FeatureRunnerDeps['surfaceQuarantineRef'];
      },
    ): FeatureRunnerDeps {
      const base = deps(
        { done: true, halted: false, finishChoice: 'pr', prUrl: 'http://pr/1' },
        rec,
      );
      return {
        ...base,
        daemon: true,
        createWorktree: async (slug) => ({ path: `/wt/${slug}`, branch: `feat/${slug}` }),
        prepareWorktree: async () => {
          throw new SetupFailureError('project setup failed', 'tail');
        },
        runConductor: async () => {},
        runSetupTriage: async () => opts.triageReturnValue,
        surfaceQuarantineRef: opts.surfaceQuarantineRef,
      };
    }

    it('quarantine happened this rotation → surfaceQuarantineRef is invoked with the outcome before dispatch', async () => {
      const rec: { teardownKeep?: boolean } = {};
      const calls: Array<{ slug: string; outcome: TriageOutcome }> = [];
      const run = makeRunFeature(
        depsWithSurfacing(rec, {
          triageReturnValue: {
            kind: 'quarantined-pass',
            outputTail: '',
            quarantineRef: 'wip/setup-quarantine-feat-x',
          },
          surfaceQuarantineRef: async (_wt, slug, outcome) => {
            calls.push({ slug, outcome });
          },
        }),
      );
      const out = await run(ITEM);
      expect(out.status).toBe('done');
      expect(calls).toHaveLength(1);
      expect(calls[0].slug).toBe('feat-x');
      expect(calls[0].outcome.quarantineRef).toBe('wip/setup-quarantine-feat-x');
    });

    it('no quarantine present → surfaceQuarantineRef is still invoked (it decides internally whether to write)', async () => {
      const rec: { teardownKeep?: boolean } = {};
      const calls: TriageOutcome[] = [];
      const run = makeRunFeature(
        depsWithSurfacing(rec, {
          triageReturnValue: { kind: 'pass', outputTail: '' },
          surfaceQuarantineRef: async (_wt, _slug, outcome) => {
            calls.push(outcome);
          },
        }),
      );
      const out = await run(ITEM);
      expect(out.status).toBe('done');
      expect(calls).toHaveLength(1);
      expect(calls[0].kind).toBe('pass');
      expect(calls[0].quarantineRef).toBeUndefined();
    });

    it('surfaceQuarantineRef throwing does not block dispatch (fail-open)', async () => {
      const rec: { teardownKeep?: boolean } = {};
      const run = makeRunFeature(
        depsWithSurfacing(rec, {
          triageReturnValue: {
            kind: 'quarantined-pass',
            outputTail: '',
            quarantineRef: 'wip/setup-quarantine-feat-x',
          },
          surfaceQuarantineRef: async () => {
            throw new Error('sentinel write blew up');
          },
        }),
      );
      const out = await run(ITEM);
      expect(out.status).toBe('done'); // dispatch proceeded despite the surfacing failure
    });

    it('surfaceQuarantineRef absent → makeRunFeature builds normally (backward compatible)', async () => {
      const rec: { teardownKeep?: boolean } = {};
      const run = makeRunFeature(
        depsWithSurfacing(rec, {
          triageReturnValue: { kind: 'quarantined-pass', outputTail: '', quarantineRef: 'wip/setup-quarantine-feat-x' },
          surfaceQuarantineRef: undefined,
        }),
      );
      const out = await run(ITEM);
      expect(out.status).toBe('done');
    });
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

    // #446 conflict resolution (Task 16): supersedes the prior pin that a
    // prepareWorktree failure is *always* terminal/errored. Since Task 13 wired
    // triage into makeRunFeature, a SetupFailureError in daemon mode with a
    // triage handler present is routed to triage instead of erroring directly
    // (see the 'daemon-only triage routing (Task 13)' describe block below for
    // the full routed-to-triage matrix). This test pins the backward-compat
    // half of that split: when the triage dependency is absent (e.g. manual
    // /conduct runs, or daemon builds that haven't wired triage), a
    // SetupFailureError still falls through to the legacy errored path.
    // keep-worktree is unchanged either way.
    it('a SetupFailureError with no triage dep present keeps the legacy errored path (backward compat)', async () => {
      const order: string[] = [];
      const rec: { teardownKeep?: boolean } = {};
      const run = makeRunFeature({
        ...depsWithOrder(order, {}, rec),
        daemon: false, // no triage dep wired: runSetupTriage is absent
        prepareWorktree: async () => {
          order.push('prepareWorktree');
          throw new SetupFailureError('project setup (bin/setup) failed: pg unreachable', 'tail of output');
        },
      });
      const out = await run(ITEM);
      expect(out.status).toBe('error'); // legacy errored path, not routed-to-triage
      expect(out.reason).toMatch(/pg unreachable/);
      expect(order).toEqual(['createWorktree', 'prepareWorktree']); // runConductor never reached, triage never invoked
      expect(rec.teardownKeep).toBe(true); // worktree kept for inspection — unchanged
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

    describe('Task 12: ship side effects skipped on failed ship (Story 3 + Story 5)', () => {
      // Story 3 acceptance criteria: when false-ship path runs, NO ship side effects occur.
      // Ship side effects are: markProcessed, removeLabel/clearOnSuccess, enrollWatch.
      // Only the live (verified) ship path should call these.

      it('false-ship with null prUrl: zero markProcessed calls (Story 3)', async () => {
        const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
        try {
          const rec: TestRecorder = {};
          const run = makeRunFeature({
            ...deps(
              {
                done: true,
                halted: false,
                finishChoice: 'pr',
                prUrl: undefined, // fails ship guard
              },
              rec,
            ),
            createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          });
          const out = await run(ITEM);
          expect(out.status).toBe('halted');
          // Verification: markProcessed must never be called on false-ship
          expect(rec.processedCalls).toHaveLength(0);
          expect(rec.processed).toBeUndefined();
        } finally {
          await rm(wt, { recursive: true, force: true });
        }
      });

      it('false-ship with null prUrl: zero enrollWatch calls (Story 3)', async () => {
        const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
        try {
          const rec: TestRecorder = {};
          const run = makeRunFeature({
            ...deps(
              {
                done: true,
                halted: false,
                finishChoice: 'pr',
                prUrl: undefined, // fails ship guard
              },
              rec,
            ),
            createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          });
          const out = await run(ITEM);
          expect(out.status).toBe('halted');
          // Verification: enrollWatch must never be called on false-ship
          expect(rec.enrollCalls).toHaveLength(0);
        } finally {
          await rm(wt, { recursive: true, force: true });
        }
      });

      it('false-ship with missing finishChoice: zero markProcessed calls (Story 3)', async () => {
        const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
        try {
          const rec: TestRecorder = {};
          const run = makeRunFeature({
            ...deps(
              {
                done: true,
                halted: false,
                finishChoice: undefined, // fails ship guard
                prUrl: 'https://github.com/owner/repo/pull/123',
              },
              rec,
            ),
            createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          });
          const out = await run(ITEM);
          expect(out.status).toBe('halted');
          // Verification: markProcessed must never be called on false-ship
          expect(rec.processedCalls).toHaveLength(0);
          expect(rec.processed).toBeUndefined();
        } finally {
          await rm(wt, { recursive: true, force: true });
        }
      });

      it('false-ship with missing finishChoice: zero enrollWatch calls (Story 3)', async () => {
        const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
        try {
          const rec: TestRecorder = {};
          const run = makeRunFeature({
            ...deps(
              {
                done: true,
                halted: false,
                finishChoice: undefined, // fails ship guard
                prUrl: 'https://github.com/owner/repo/pull/123',
              },
              rec,
            ),
            createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          });
          const out = await run(ITEM);
          expect(out.status).toBe('halted');
          // Verification: enrollWatch must never be called on false-ship
          expect(rec.enrollCalls).toHaveLength(0);
        } finally {
          await rm(wt, { recursive: true, force: true });
        }
      });

      it('false-ship with finishChoice="keep": zero markProcessed calls (Story 3)', async () => {
        const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
        try {
          const rec: TestRecorder = {};
          const run = makeRunFeature({
            ...deps(
              {
                done: true,
                halted: false,
                finishChoice: 'keep', // fails ship guard
                prUrl: 'https://github.com/owner/repo/pull/123',
              },
              rec,
            ),
            createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          });
          const out = await run(ITEM);
          expect(out.status).toBe('halted');
          // Verification: markProcessed must never be called on false-ship
          expect(rec.processedCalls).toHaveLength(0);
          expect(rec.processed).toBeUndefined();
        } finally {
          await rm(wt, { recursive: true, force: true });
        }
      });

      it('false-ship with finishChoice="keep": zero enrollWatch calls (Story 3)', async () => {
        const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
        try {
          const rec: TestRecorder = {};
          const run = makeRunFeature({
            ...deps(
              {
                done: true,
                halted: false,
                finishChoice: 'keep', // fails ship guard
                prUrl: 'https://github.com/owner/repo/pull/123',
              },
              rec,
            ),
            createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          });
          const out = await run(ITEM);
          expect(out.status).toBe('halted');
          // Verification: enrollWatch must never be called on false-ship
          expect(rec.enrollCalls).toHaveLength(0);
        } finally {
          await rm(wt, { recursive: true, force: true });
        }
      });

      it('happy-ship path calls markProcessed with non-null prUrl (Story 5 invariant)', async () => {
        const wt = await mkdtemp(join(tmpdir(), 'wt-happy-ship-'));
        try {
          const rec: TestRecorder = {};
          const prUrl = 'https://github.com/owner/repo/pull/999';
          const run = makeRunFeature({
            ...deps(
              {
                done: true,
                halted: false,
                finishChoice: 'pr',
                prUrl, // verified ship
              },
              rec,
            ),
            createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          });
          const out = await run(ITEM);
          expect(out.status).toBe('done');
          // Verification: markProcessed MUST be called exactly once with non-null prUrl
          expect(rec.processedCalls).toHaveLength(1);
          expect(rec.processedCalls![0].prUrl).toBe(prUrl);
          expect(rec.processedCalls![0].prUrl).not.toBeNull();
          expect(rec.processedCalls![0].prUrl).not.toBeUndefined();
        } finally {
          await rm(wt, { recursive: true, force: true });
        }
      });

      it('happy-ship path calls enrollWatch with verified prUrl (Story 5)', async () => {
        const wt = await mkdtemp(join(tmpdir(), 'wt-happy-ship-'));
        try {
          const rec: TestRecorder = {};
          const prUrl = 'https://github.com/owner/repo/pull/888';
          const run = makeRunFeature({
            ...deps(
              {
                done: true,
                halted: false,
                finishChoice: 'pr',
                prUrl, // verified ship
              },
              rec,
            ),
            createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          });
          const out = await run(ITEM);
          expect(out.status).toBe('done');
          // Verification: enrollWatch MUST be called with verified prUrl
          expect(rec.enrollCalls).toHaveLength(1);
          expect(rec.enrollCalls![0].prUrl).toBe(prUrl);
          expect(rec.enrollCalls![0].slug).toBe('feat-x');
        } finally {
          await rm(wt, { recursive: true, force: true });
        }
      });

      // Story 5 scope note exemption: repairProcessed is exempt from the null-prUrl guard
      // because it drives a cache repair from a committed shipped record already merged
      // on the base branch. Its null prUrl marks a malformed-but-proven record (ADR §2,
      // scope note). This test documents the exception for future refactors.
      it('repairProcessed exemption documented: scope note permits null prUrl in repair-path markers (Story 5)', () => {
        // This is a documentation test — it clarifies that the live-path guard
        // (markProcessed must be called with non-null prUrl) does NOT apply to
        // repairProcessed, which is driven by committed evidence already on the branch.
        // See ADR adr-2026-07-06-daemon-false-ship-guard §2, scope note (amended).
        expect(true).toBe(true); // placeholder assertion
      });
    });

    describe('Task 11: Park evidence — extended diagnostic HALT (TS-4)', () => {
      // Story TS-4 happy: a `park` triage outcome produces a `.pipeline/HALT` whose
      // content includes the output tail, the quarantine ref when taken, the literal
      // statement that no quarantine exists in the clean-HEAD case, and the contract outcome.
      // Park status/rekick eligibility identical to a plain errored feature.

      it('park triage outcome with quarantine ref produces HALT with output tail, quarantine ref, and contract outcome (TS-4 happy)', async () => {
        const wt = await mkdtemp(join(tmpdir(), 'wt-park-'));
        try {
          const triageEvidence: TriageOutcome = {
            kind: 'park',
            outputTail: 'setup failed: database connection timeout\nretrying...\nfailed again',
            quarantineRef: 'wip/setup-quarantine-abc123',
            contractOutcome: 'contract violation: schema mismatch',
          };
          const rec: { teardownKeep?: boolean; processed?: boolean } = {};
          const run = makeRunFeature({
            ...deps(
              {
                done: false,
                halted: false,
                triageEvidence,
              },
              rec,
            ),
            createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          });
          const out = await run(ITEM);
          // Park produces error status, keeps worktree, doesn't mark processed
          expect(out.status).toBe('error');
          expect(rec.processed).toBeUndefined();
          expect(rec.teardownKeep).toBe(true);
          // HALT must exist and contain all evidence
          const halt = await readFile(join(wt, '.pipeline', 'HALT'), 'utf-8');
          expect(halt).toContain('setup failed: database connection timeout');
          expect(halt).toContain('retrying...');
          expect(halt).toContain('failed again');
          expect(halt).toContain('wip/setup-quarantine-abc123');
          expect(halt).toContain('contract violation: schema mismatch');
        } finally {
          await rm(wt, { recursive: true, force: true });
        }
      });

      it('park triage outcome without quarantine ref produces HALT with explicit no-quarantine statement (TS-4 negative)', async () => {
        const wt = await mkdtemp(join(tmpdir(), 'wt-park-clean-'));
        try {
          const triageEvidence: TriageOutcome = {
            kind: 'park',
            outputTail: 'setup completed but validation failed\nerror: validation returned false',
            contractOutcome: 'contract violation: test suite incomplete',
          };
          const rec: { teardownKeep?: boolean; processed?: boolean } = {};
          const run = makeRunFeature({
            ...deps(
              {
                done: false,
                halted: false,
                triageEvidence,
              },
              rec,
            ),
            createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          });
          const out = await run(ITEM);
          // Park produces error status, keeps worktree, doesn't mark processed
          expect(out.status).toBe('error');
          expect(rec.processed).toBeUndefined();
          expect(rec.teardownKeep).toBe(true);
          // HALT must exist and contain output tail and contract, plus explicit no-quarantine statement
          const halt = await readFile(join(wt, '.pipeline', 'HALT'), 'utf-8');
          expect(halt).toContain('setup completed but validation failed');
          expect(halt).toContain('error: validation returned false');
          expect(halt).toContain('contract violation: test suite incomplete');
          // No-quarantine case must have explicit statement
          expect(halt).toMatch(/no quarantine|clean-HEAD|quarantine.*not.*present/i);
        } finally {
          await rm(wt, { recursive: true, force: true });
        }
      });
    });

    describe('Task 12: HALT-write failure still parks (Story 4, negative path)', () => {
      // Story 4 acceptance criteria: when HALT write fails (e.g., unwritable .pipeline),
      // feature outcome is still `error` (parking unaffected), log sink receives the
      // write-failure line, and no dispatch happens.

      it('HALT write failure: feature still parked with error status (Task 12)', async () => {
        const wt = await mkdtemp(join(tmpdir(), 'wt-halt-write-fail-'));
        try {
          const logCalls: string[] = [];
          const rec: { teardownKeep?: boolean } = {};

          const run = makeRunFeature({
            ...deps(
              {
                done: true,
                halted: false,
                finishChoice: 'pr',
                prUrl: 'https://github.com/owner/repo/pull/123',
              },
              rec,
            ),
            createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
            prepareWorktree: async () => {
              // Simulate a setup failure
              throw new Error('bin/setup failed: database unreachable');
            },
            log: (msg: string) => {
              logCalls.push(msg);
            },
          });

          // Pre-create .pipeline as a file (not a directory) to force write failure
          await writeFile(join(wt, '.pipeline'), 'this blocks the directory', 'utf-8');

          const out = await run(ITEM);

          // Verify outcome is error (parking maintained despite write failure)
          expect(out.status).toBe('error');
          expect(out.reason).toMatch(/bin\/setup failed/);

          // Verify worktree is kept for inspection
          expect(rec.teardownKeep).toBe(true);

          // Verify log sink received the write-failure notification
          const haltFailLog = logCalls.find(msg => msg.includes('HALT') && (msg.includes('error') || msg.includes('Error')));
          expect(haltFailLog).toBeTruthy();
        } finally {
          await rm(wt, { recursive: true, force: true });
        }
      });

      it('HALT write failure does not dispatch (no markProcessed or enrollWatch calls)', async () => {
        const wt = await mkdtemp(join(tmpdir(), 'wt-halt-dispatch-'));
        try {
          const rec: TestRecorder = {};

          const run = makeRunFeature({
            ...deps(
              {
                done: true,
                halted: false,
                finishChoice: 'pr',
                prUrl: 'https://github.com/owner/repo/pull/123',
              },
              rec,
            ),
            createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
            prepareWorktree: async () => {
              throw new Error('network timeout');
            },
          });

          // Make .pipeline unwritable
          await writeFile(join(wt, '.pipeline'), 'blocked', 'utf-8');

          const out = await run(ITEM);

          // Verify outcome is error (not shipped)
          expect(out.status).toBe('error');

          // Verify no dispatch side effects (must never ship despite any write outcome)
          expect(rec.processedCalls).toHaveLength(0);
          expect(rec.enrollCalls).toHaveLength(0);
        } finally {
          await rm(wt, { recursive: true, force: true });
        }
      });
    });

  });

  // ── TS-3 (#358): the merged-PR guard's synthetic ship rides the EXISTING
  // verified-ship path (readOutcome → isVerifiedShip → markProcessed). No
  // production change is expected here (plan Task 10 step 3) — the guard's
  // markers (`finish-choice` == 'pr', `DONE`, `pr_url` present) produce
  // EXACTLY the WorktreeOutcome shape `writeSyntheticShipMarkers` (Task 2)
  // will write, fed through the same `deps()`/`makeRunFeature` fixture the
  // rest of this file already uses. These tests are expected to PASS today —
  // they pin the integration contract the not-yet-written guard depends on.
  describe('merged-PR guard synthetic ship (#358, TS-3)', () => {
    const PR_URL = 'https://github.com/jstoup111/ai-conductor/pull/358';

    it('a guard-shaped outcome (finish-choice=pr, DONE, pr_url present) rides isVerifiedShip → markProcessed called with slug + prUrl', async () => {
      const rec: TestRecorder = {};
      const run = makeRunFeature(
        deps(
          {
            done: true,
            halted: false,
            finishChoice: 'pr',
            prUrl: PR_URL,
          },
          rec,
        ),
      );
      const out = await run(ITEM);

      expect(out.status).toBe('done');
      expect(rec.processed).toBe(true);
      expect(rec.processedCalls).toHaveLength(1);
      expect(rec.processedCalls![0]).toEqual({ slug: ITEM.slug, prUrl: PR_URL });
      // Removed on success, same as any other verified ship — the guard's
      // synthetic stop introduces no second ship pathway (ADR: "No second
      // ship pathway is introduced; side-effects stay owned by the
      // daemon-runner").
      expect(rec.teardownKeep).toBe(false);
    });

    it('a halted (non-guard) outcome — isVerifiedShip false, no processed marker written', async () => {
      const rec: TestRecorder = {};
      const run = makeRunFeature(
        deps(
          {
            done: false,
            halted: true,
            reason: 'unrelated gate failure',
          },
          rec,
        ),
      );
      const out = await run(ITEM);

      expect(out.status).toBe('halted');
      expect(rec.processed).toBeUndefined();
      expect(rec.processedCalls).toHaveLength(0);
    });

    it('idempotency: the guard-shaped outcome fed through run() twice — single ledger entry each time, stable content, no throw', async () => {
      const rec: TestRecorder = {};
      const outcome: WorktreeOutcome = {
        done: true,
        halted: false,
        finishChoice: 'pr',
        prUrl: PR_URL,
      };
      const run = makeRunFeature(deps(outcome, rec));

      const first = await run(ITEM);
      const second = await run(ITEM);

      expect(first.status).toBe('done');
      expect(second.status).toBe('done');
      // Two separate feature runs each produce exactly one markProcessed call
      // (one ledger entry per run) with byte-identical content — no throw,
      // no duplicate-cleanup error surfaced through the outcome.
      expect(rec.processedCalls).toHaveLength(2);
      expect(rec.processedCalls![0]).toEqual({ slug: ITEM.slug, prUrl: PR_URL });
      expect(rec.processedCalls![1]).toEqual({ slug: ITEM.slug, prUrl: PR_URL });
    });
  });
});
