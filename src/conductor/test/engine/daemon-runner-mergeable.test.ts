/**
 * Tests for PR-label wiring in daemon-runner and daemon.ts.
 *
 * FR-9  — enrollWatch called on done + prUrl, before teardown; not on halted/error.
 * FR-16 — clear-on-success: removeLabel('needs-remediation') + setReady on done;
 *          no-op when label absent; failure swallowed; never on halted/error.
 * FR-14 — sweepMergeableLabels called after each feature in daemon-runner; on
 *          startup and per idle-poll tick in daemon.ts; throw swallowed.
 */

import { describe, it, expect } from 'vitest';
import {
  makeRunFeature,
  type FeatureRunnerDeps,
  type WorktreeOutcome,
} from '../../src/engine/daemon-runner.js';
import { runDaemon, type DaemonDeps, type BacklogItem } from '../../src/engine/daemon.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';

// ── Shared constants ──────────────────────────────────────────────────────────

const PR_URL = 'https://github.com/x/y/pull/42';
const ITEM: BacklogItem = { slug: 'feat-x' };

// ── Base deps factory ─────────────────────────────────────────────────────────

function baseDeps(overrides: Partial<FeatureRunnerDeps> = {}): FeatureRunnerDeps {
  return {
    createWorktree: async (slug) => ({ path: `/wt/${slug}`, branch: `feat/${slug}` }),
    runConductor: async () => {},
    readOutcome: async (): Promise<WorktreeOutcome> => ({ done: false, halted: false }),
    teardownWorktree: async () => {},
    markProcessed: async () => {},
    daemon: false,
    provider: {
      invoke: async () => ({ success: true, output: '' }),
      invokeInteractive: async () => {},
    },
    project: 'test-project',
    ...overrides,
  };
}

// ── Fake gh runner ────────────────────────────────────────────────────────────

/**
 * Build a fake GhRunner that records every call.
 *  - `labels`  — labels to return in the `pr view` JSON response.
 *  - `throws`  — makes every call throw (to test error-swallowing).
 */
function makeGhFake(opts: { labels?: string[]; throws?: boolean } = {}): {
  runGh: GhRunner;
  calls: Array<string[]>;
} {
  const calls: Array<string[]> = [];
  const runGh: GhRunner = async (args) => {
    calls.push([...args]);
    if (opts.throws) throw new Error('gh runner failed');
    if (args[0] === 'pr' && args[1] === 'view') {
      const labelObjs = (opts.labels ?? []).map((name) => ({ name }));
      return {
        stdout: JSON.stringify({
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          statusCheckRollup: [],
          labels: labelObjs,
        }),
      };
    }
    return { stdout: '' };
  };
  return { runGh, calls };
}

// ─────────────────────────────────────────────────────────────────────────────
// FR-9: enrollWatch on done
// ─────────────────────────────────────────────────────────────────────────────

describe('FR-9: enrollWatch on done', () => {
  it('done + prUrl => enrollWatch called before teardown', async () => {
    const order: string[] = [];
    const enrollArgs: Array<{ root: string; prUrl: string; slug: string }> = [];

    const run = makeRunFeature(
      baseDeps({
        readOutcome: async () => ({ done: true, halted: false, prUrl: PR_URL }),
        projectRoot: '/project',
        enrollWatch: async (root, entry) => {
          enrollArgs.push({ root, prUrl: entry.prUrl, slug: entry.slug });
          order.push('enroll');
        },
        teardownWorktree: async () => {
          order.push('teardown');
        },
        markProcessed: async () => {
          order.push('markProcessed');
        },
      }),
    );

    const out = await run(ITEM);
    expect(out.status).toBe('done');
    expect(enrollArgs).toHaveLength(1);
    expect(enrollArgs[0].root).toBe('/project');
    expect(enrollArgs[0].prUrl).toBe(PR_URL);
    expect(enrollArgs[0].slug).toBe('feat-x');
    // enroll must precede teardown
    expect(order.indexOf('enroll')).toBeLessThan(order.indexOf('teardown'));
  });

  it('halted => enrollWatch NOT called', async () => {
    const enrollCalls: unknown[] = [];
    const run = makeRunFeature(
      baseDeps({
        readOutcome: async () => ({ done: false, halted: true, prUrl: PR_URL }),
        projectRoot: '/project',
        enrollWatch: async () => {
          enrollCalls.push(1);
        },
      }),
    );
    await run(ITEM);
    expect(enrollCalls).toHaveLength(0);
  });

  it('error (no marker) => enrollWatch NOT called', async () => {
    const enrollCalls: unknown[] = [];
    const run = makeRunFeature(
      baseDeps({
        readOutcome: async () => ({ done: false, halted: false }),
        projectRoot: '/project',
        enrollWatch: async () => {
          enrollCalls.push(1);
        },
      }),
    );
    await run(ITEM);
    expect(enrollCalls).toHaveLength(0);
  });

  it('done but no prUrl => enrollWatch NOT called', async () => {
    const enrollCalls: unknown[] = [];
    const run = makeRunFeature(
      baseDeps({
        readOutcome: async () => ({ done: true, halted: false }), // no prUrl
        projectRoot: '/project',
        enrollWatch: async () => {
          enrollCalls.push(1);
        },
      }),
    );
    await run(ITEM);
    expect(enrollCalls).toHaveLength(0);
  });

  it('enroll failure is swallowed => teardown + markProcessed still run', async () => {
    const rec: { teardown?: boolean; processed?: boolean } = {};
    const run = makeRunFeature(
      baseDeps({
        readOutcome: async () => ({ done: true, halted: false, prUrl: PR_URL }),
        projectRoot: '/project',
        enrollWatch: async () => {
          throw new Error('disk full');
        },
        teardownWorktree: async () => {
          rec.teardown = true;
        },
        markProcessed: async () => {
          rec.processed = true;
        },
      }),
    );
    const out = await run(ITEM);
    expect(out.status).toBe('done');
    expect(rec.processed).toBe(true);
    expect(rec.teardown).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-16: clear-on-success
// ─────────────────────────────────────────────────────────────────────────────

describe('FR-16: clear-on-success', () => {
  it('done PR with needs-remediation => removeLabel + setReady called', async () => {
    const { runGh, calls } = makeGhFake({ labels: ['needs-remediation'] });
    const run = makeRunFeature(
      baseDeps({
        readOutcome: async () => ({ done: true, halted: false, prUrl: PR_URL }),
        projectRoot: '/project',
        runGh,
        enrollWatch: async () => {}, // no-op to avoid disk I/O
      }),
    );
    await run(ITEM);

    // prMergeState: pr view call
    expect(calls.some((a) => a[0] === 'pr' && a[1] === 'view')).toBe(true);
    // removeLabel('needs-remediation'): REST DELETE .../labels/needs-remediation
    expect(
      calls.some(
        (a) =>
          a[0] === 'api' &&
          a.includes('DELETE') &&
          a.some((s) => /\/labels\/needs-remediation$/.test(s)),
      ),
    ).toBe(true);
    // setReady: pr ready
    expect(calls.some((a) => a[0] === 'pr' && a[1] === 'ready')).toBe(true);
  });

  it('done PR without needs-remediation => removeLabel + setReady NOT called', async () => {
    const { runGh, calls } = makeGhFake({ labels: ['some-other-label'] });
    const run = makeRunFeature(
      baseDeps({
        readOutcome: async () => ({ done: true, halted: false, prUrl: PR_URL }),
        projectRoot: '/project',
        runGh,
        enrollWatch: async () => {},
      }),
    );
    await run(ITEM);
    expect(
      calls.some((a) => a[0] === 'api' && a.includes('DELETE') && a.some((s) => /\/labels\//.test(s))),
    ).toBe(false);
    expect(calls.some((a) => a[0] === 'pr' && a[1] === 'ready')).toBe(false);
  });

  it('clear failure is swallowed => enroll + teardown still proceed', async () => {
    const { runGh } = makeGhFake({ throws: true });
    const enrollCalls: unknown[] = [];
    const rec: { teardown?: boolean } = {};
    const run = makeRunFeature(
      baseDeps({
        readOutcome: async () => ({ done: true, halted: false, prUrl: PR_URL }),
        projectRoot: '/project',
        runGh,
        enrollWatch: async () => {
          enrollCalls.push(1);
        },
        teardownWorktree: async () => {
          rec.teardown = true;
        },
      }),
    );
    const out = await run(ITEM);
    expect(out.status).toBe('done');
    expect(enrollCalls).toHaveLength(1); // enroll still ran
    expect(rec.teardown).toBe(true);    // teardown still ran
  });

  it('halted => clear NOT attempted (no gh calls)', async () => {
    const { runGh, calls } = makeGhFake({ labels: ['needs-remediation'] });
    const run = makeRunFeature(
      baseDeps({
        readOutcome: async () => ({ done: false, halted: true, prUrl: PR_URL }),
        projectRoot: '/project',
        runGh,
      }),
    );
    await run(ITEM);
    expect(calls.some((a) => a[0] === 'pr' && a[1] === 'view')).toBe(false);
    expect(calls.some((a) => a[0] === 'api' && a.some((s) => /\/labels\//.test(s)))).toBe(false);
    expect(calls.some((a) => a[0] === 'pr' && a[1] === 'ready')).toBe(false);
  });

  it('error (no marker) => clear NOT attempted', async () => {
    const { runGh, calls } = makeGhFake({ labels: ['needs-remediation'] });
    const run = makeRunFeature(
      baseDeps({
        readOutcome: async () => ({ done: false, halted: false }),
        projectRoot: '/project',
        runGh,
      }),
    );
    await run(ITEM);
    expect(calls.some((a) => a[0] === 'pr' && a[1] === 'view')).toBe(false);
  });

  it('clear + enroll order: removeLabel before enroll before teardown', async () => {
    const { runGh } = makeGhFake({ labels: ['needs-remediation'] });
    const order: string[] = [];
    const run = makeRunFeature(
      baseDeps({
        readOutcome: async () => ({ done: true, halted: false, prUrl: PR_URL }),
        projectRoot: '/project',
        runGh: async (args, opts) => {
          if (args[0] === 'pr' && args[1] === 'view') {
            order.push('prMergeState');
            return (await makeGhFake({ labels: ['needs-remediation'] }).runGh(args, opts));
          }
          if (args[0] === 'api' && args.includes('DELETE')) order.push('removeLabel');
          if (args[0] === 'pr' && args[1] === 'ready') order.push('setReady');
          return { stdout: '' };
        },
        enrollWatch: async () => {
          order.push('enroll');
        },
        teardownWorktree: async () => {
          order.push('teardown');
        },
      }),
    );
    await run(ITEM);
    expect(order.indexOf('removeLabel')).toBeLessThan(order.indexOf('enroll'));
    expect(order.indexOf('enroll')).toBeLessThan(order.indexOf('teardown'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-14: sweep cadence in daemon-runner
// ─────────────────────────────────────────────────────────────────────────────

describe('FR-14: sweep cadence in daemon-runner', () => {
  it('sweep called after done feature completes', async () => {
    const sweepCalls: unknown[] = [];
    const run = makeRunFeature(
      baseDeps({
        readOutcome: async () => ({ done: true, halted: false }),
        projectRoot: '/project',
        sweepMergeableLabels: async () => {
          sweepCalls.push(1);
        },
      }),
    );
    await run(ITEM);
    expect(sweepCalls).toHaveLength(1);
  });

  it('sweep called after halted feature', async () => {
    const sweepCalls: unknown[] = [];
    const run = makeRunFeature(
      baseDeps({
        readOutcome: async () => ({ done: false, halted: true }),
        projectRoot: '/project',
        sweepMergeableLabels: async () => {
          sweepCalls.push(1);
        },
      }),
    );
    await run(ITEM);
    expect(sweepCalls).toHaveLength(1);
  });

  it('sweep called after error (no marker) feature', async () => {
    const sweepCalls: unknown[] = [];
    const run = makeRunFeature(
      baseDeps({
        readOutcome: async () => ({ done: false, halted: false }),
        projectRoot: '/project',
        sweepMergeableLabels: async () => {
          sweepCalls.push(1);
        },
      }),
    );
    await run(ITEM);
    expect(sweepCalls).toHaveLength(1);
  });

  it('sweep throw is swallowed and does not disrupt feature processing', async () => {
    const run = makeRunFeature(
      baseDeps({
        readOutcome: async () => ({ done: true, halted: false, prUrl: PR_URL }),
        projectRoot: '/project',
        sweepMergeableLabels: async () => {
          throw new Error('network error');
        },
        enrollWatch: async () => {},
      }),
    );
    const out = await run(ITEM);
    expect(out.status).toBe('done'); // feature still completes
    expect(out.prUrl).toBe(PR_URL);
  });

  it('sweep NOT called when projectRoot is absent', async () => {
    const sweepCalls: unknown[] = [];
    const run = makeRunFeature(
      baseDeps({
        readOutcome: async () => ({ done: true, halted: false }),
        // no projectRoot
        sweepMergeableLabels: async () => {
          sweepCalls.push(1);
        },
      }),
    );
    await run(ITEM);
    expect(sweepCalls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-14: sweep cadence in daemon.ts (startup + idle poll)
// ─────────────────────────────────────────────────────────────────────────────

describe('FR-14: sweep cadence in daemon.ts', () => {
  it('sweep called on startup, before any feature is dispatched', async () => {
    const order: string[] = [];

    const deps: DaemonDeps = {
      discoverBacklog: async () => [{ slug: 'f0' }],
      runFeature: async (it) => {
        order.push(`dispatch:${it.slug}`);
        return { slug: it.slug, status: 'done' };
      },
      sweepMergeableLabels: async () => {
        order.push('sweep');
      },
    };
    await runDaemon(deps, { concurrency: 1, once: true });

    const firstSweep = order.indexOf('sweep');
    const firstDispatch = order.findIndex((e) => e.startsWith('dispatch:'));
    expect(firstSweep).toBeGreaterThanOrEqual(0);
    // The startup sweep runs (step 1 of daemon startup) before the loop dispatches.
    expect(firstSweep).toBeLessThan(firstDispatch);
  });

  it('sweep called once per idle poll tick (after each sleep)', async () => {
    let sleptCount = 0;
    let sweepCount = 0;

    const deps: DaemonDeps = {
      discoverBacklog: async () => [],
      runFeature: async (it) => ({ slug: it.slug, status: 'done' }),
      sleep: async () => {
        sleptCount++;
      },
      sweepMergeableLabels: async () => {
        sweepCount++;
      },
    };
    await runDaemon(deps, { concurrency: 1, once: false, maxIdlePolls: 3 });

    // 1 startup sweep + 3 idle-poll sweeps (one per sleep/tick).
    expect(sleptCount).toBe(3);
    expect(sweepCount).toBe(4); // startup + 3 idle
  });

  it('sweep throw is swallowed and does not disrupt the daemon loop', async () => {
    const deps: DaemonDeps = {
      discoverBacklog: async () => [{ slug: 'f0' }],
      runFeature: async (it) => ({ slug: it.slug, status: 'done' }),
      sweepMergeableLabels: async () => {
        throw new Error('sweep failed');
      },
    };
    const res = await runDaemon(deps, { concurrency: 1, once: true });
    expect(res.processed).toHaveLength(1);
    expect(res.processed[0].status).toBe('done');
  });
});
