/**
 * Acceptance spec (RED, pre-implementation) — ship→CI feedback loop.
 *
 * Story: native-check CI failure observation + halt-monitor-visible event (TR-2) and
 * "Bounded CI-fix dispatch seam" (TR-3), .docs/stories/ship-ci-feedback-loop.md.
 *
 * Drives the REAL entry point (`sweepMergeableLabels`) end-to-end against a
 * fixture watch registry with an injected `GhRunner`, exactly as
 * `mergeable-sweep-autoresolve.test.ts` does for the conflict-resolve path —
 * this is the CI-fix analog. Scoped to the seam shapes already pinned by the
 * plan (`SweepOpts.ciFix: CiFixDispatchOpts`, `WatchEntry.ciFixAttempts` /
 * `lastCiFixAt`, and retirement of the redundant `ci-failed` label). The exhaustion/escalation call site
 * (TR-5) is intentionally NOT asserted here — the plan (Task 21) leaves its
 * module home undecided ("mergeable-sweep.ts or ci-fix.ts"), so pinning its
 * shape now would freeze an unconfirmed assumption; it is covered by TDD's
 * own tests once that seam is fixed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { enrollWatch, sweepMergeableLabels } from '../../src/engine/mergeable-sweep.js';
import type { WatchEntry } from '../../src/engine/mergeable-sweep.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';
import type {
  GithubOperationRequest,
  GithubOperationRunner,
  GithubOperationRunnerResponse,
} from '../../src/engine/github-operations.js';
import { isEligibleForCiFix } from '../../src/engine/ci-fix.js';
import { classifyCiContextFailure } from '../../src/engine/daemon-ci-fix.js';
import type { PrMergeState } from '../../src/engine/pr-labels.js';

type Check = {
  status?: string | null;
  conclusion?: string | null;
  state?: string | null;
  name?: string;
  context?: string;
};

function prViewJson(opts: {
  mergeable?: string;
  checks?: Check[];
  labels?: string[];
}): { stdout: string } {
  return {
    stdout: JSON.stringify({
      state: 'OPEN',
      mergeable: opts.mergeable ?? 'MERGEABLE',
      statusCheckRollup: opts.checks ?? [],
      labels: (opts.labels ?? []).map((name) => ({ name })),
    }),
  };
}

const FAILED_CHECKS: Check[] = [
  { status: 'COMPLETED', conclusion: 'SUCCESS' },
  { status: 'COMPLETED', conclusion: 'FAILURE' },
];
const GREEN_CHECKS: Check[] = [
  { status: 'COMPLETED', conclusion: 'SUCCESS' },
  { status: 'COMPLETED', conclusion: 'SUCCESS' },
];
const PENDING_CHECKS: Check[] = [{ status: 'IN_PROGRESS', conclusion: null }];
/** One terminal failure while another check is still running (rollup classifies as `failed`). */
const FAILED_WITH_RUNNING_CHECKS: Check[] = [
  { status: 'COMPLETED', conclusion: 'FAILURE' },
  { status: 'IN_PROGRESS', conclusion: null },
];
const FAILED_WITH_COMPLETED_COMMIT_STATUS: Check[] = [
  { status: 'COMPLETED', conclusion: 'FAILURE', name: 'unit' },
  { state: 'SUCCESS', context: 'external-status' },
];
const FAILED_WITH_PENDING_COMMIT_STATUS: Check[] = [
  { status: 'COMPLETED', conclusion: 'FAILURE', name: 'unit' },
  { state: 'PENDING', context: 'external-status' },
];

interface GhCall {
  args: string[];
}

function makeGh(
  prStates: Record<string, { mergeable?: string; checks?: Check[]; labels?: string[] }>,
  calls: GhCall[],
  failOn?: (args: string[]) => boolean,
): GhRunner & GithubOperationRunner {
  const gh: GhRunner = async (args) => {
    calls.push({ args: [...args] });
    if (failOn?.(args)) {
      throw new Error('simulated gh failure');
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      const prUrl = args[2] as string;
      return prViewJson(prStates[prUrl] ?? {});
    }
    if (args[0] === 'label' && args[1] === 'create') return { stdout: '' };
    if (args[0] === 'api') return { stdout: '' };
    return { stdout: '' };
  };
  const operations: GithubOperationRunner = {
    async run(request: GithubOperationRequest): Promise<GithubOperationRunnerResponse> {
      if (request.target.kind !== 'pull-request') {
        throw new Error(`unexpected target: ${request.target.kind}`);
      }
      if (request.operation !== 'pull-request.label.remove') {
        throw new Error(`unexpected operation: ${request.operation}`);
      }
      const label = request.payload && 'label' in request.payload ? request.payload.label : undefined;
      if (typeof label !== 'string') throw new Error('missing label payload');
      await gh([
        'api', '--method', 'DELETE',
        `repos/${request.target.repository}/issues/${request.target.number}/labels/${encodeURIComponent(label)}`,
      ], { cwd: '/fixture' });
      return {};
    },
  };
  return Object.assign(gh, operations);
}

async function readEntries(projectRoot: string): Promise<WatchEntry[]> {
  const raw = await readFile(join(projectRoot, '.daemon/mergeable-watch.jsonl'), 'utf-8');
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

describe('mergeable-sweep native CI state + bounded CI-fix dispatch', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'sweep-ci-fix-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it.each([
    ['auth', { readFailure: { kind: 'runner', error: new Error('401 unauthorized') } }, 'auth'],
    ['permission', { readFailure: { kind: 'runner', error: new Error('403 forbidden') } }, 'permission'],
    ['timeout', { readFailure: { kind: 'runner', error: new Error('timed out') } }, 'timeout'],
    ['api', { readFailure: { kind: 'runner', error: new Error('upstream unavailable') } }, 'api'],
    ['malformed context', { contextFailure: { kind: 'invalid-rollup' } }, 'malformed-context'],
    ['empty failed context', { readFailure: { kind: 'runner', error: new Error() } }, 'api'],
  ] as const)('emits %s context diagnostics without provider dispatch or reserving an attempt', async (_label, failure, reason) => {
    const prUrl = 'https://github.com/acme/widget/pull/1';
    const priorTimestamp = '2026-07-01T00:00:00.000Z';
    await enrollWatch(projectRoot, {
      prUrl, slug: 'widget', repoCwd: projectRoot, ciFixAttempts: 1, lastCiFixAt: priorTimestamp,
    });
    const state: PrMergeState = {
      state: 'UNKNOWN', mergeable: 'UNKNOWN', hasFailingOrPendingChecks: false,
      labels: [], checksOutcome: 'failed', statusCheckRollup: [], ...failure,
    };
    const diagnostics: string[] = [];
    const dispatch = vi.fn();

    await sweepMergeableLabels({
      projectRoot,
      tracker: { readPullRequestMergeState: async () => state },
      ciFix: {
        enabled: true,
        isEligible: async () => ({ eligible: true }),
        dispatch,
        diagnostic: async (_entry, selectedState) => {
          diagnostics.push(classifyCiContextFailure(selectedState));
        },
      },
    });

    expect(diagnostics).toEqual([reason]);
    expect(dispatch).not.toHaveBeenCalled();
    expect(await readEntries(projectRoot)).toMatchObject([{
      ciFixAttempts: 1, lastCiFixAt: priorTimestamp,
    }]);
  });

  it('TR-2 happy: relies on failed native checks and removes a legacy ci-failed label', async () => {
    const prUrl = 'https://github.com/acme/widget/pull/1';
    await enrollWatch(projectRoot, { prUrl, slug: 'widget', repoCwd: projectRoot });

    const calls: GhCall[] = [];
    const gh = makeGh({ [prUrl]: { checks: FAILED_CHECKS } }, calls);

    await sweepMergeableLabels({ projectRoot, runGh: gh });

    const labelCreateCalls = calls.filter(
      (c) => c.args[0] === 'label' && c.args[1] === 'create' && c.args[2] === 'ci-failed',
    );
    const labelAddCalls = calls.filter(
      (c) => c.args.join(' ').includes('ci-failed') && c.args[0] === 'api',
    );
    expect(labelCreateCalls).toHaveLength(0);
    expect(labelAddCalls).toHaveLength(0);

    // A legacy label is removed when the next reconciliation observes it.
    calls.length = 0;
    const gh2 = makeGh({ [prUrl]: { checks: FAILED_CHECKS, labels: ['ci-failed'] } }, calls);
    await sweepMergeableLabels({ projectRoot, runGh: gh2 });
    const removalCalls = calls.filter(
      (c) => c.args[0] === 'api' && c.args[2] === 'DELETE' && c.args.join(' ').includes('ci-failed'),
    );
    expect(removalCalls).toHaveLength(1);
  });

  it('TR-2 happy: removes ci-failed and resets ciFixAttempts to 0 on green', async () => {
    const prUrl = 'https://github.com/acme/widget/pull/1';
    await enrollWatch(projectRoot, {
      prUrl,
      slug: 'widget',
      repoCwd: projectRoot,
      ciFixAttempts: 2,
    });

    const calls: GhCall[] = [];
    const gh = makeGh({ [prUrl]: { checks: GREEN_CHECKS, labels: ['ci-failed'] } }, calls);

    await sweepMergeableLabels({ projectRoot, runGh: gh });

    const removeCalls = calls.filter(
      (c) => c.args[0] === 'api' && c.args.join(' ').includes('ci-failed'),
    );
    expect(removeCalls.length).toBeGreaterThanOrEqual(1);

    const [persisted] = await readEntries(projectRoot);
    expect(persisted.ciFixAttempts).toBe(0);
  });

  it('TR-2 happy: pending checks are a no-op (no label change, no dispatch)', async () => {
    const prUrl = 'https://github.com/acme/widget/pull/1';
    await enrollWatch(projectRoot, { prUrl, slug: 'widget', repoCwd: projectRoot });

    const calls: GhCall[] = [];
    const gh = makeGh({ [prUrl]: { checks: PENDING_CHECKS } }, calls);
    const dispatched: WatchEntry[] = [];

    await sweepMergeableLabels({
      projectRoot,
      runGh: gh,
      ciFix: {
        enabled: true,
        isEligible: async () => ({ eligible: true }),
        dispatch: async (entry: WatchEntry) => {
          dispatched.push(entry);
        },
      },
    });

    const ciFailedCalls = calls.filter((c) => c.args.join(' ').includes('ci-failed'));
    expect(ciFailedCalls).toHaveLength(0);
    expect(dispatched).toHaveLength(0);
  });

  it('a failed rollup with a still-running check is deferred: no dispatch, no attempt burn', async () => {
    const prUrl = 'https://github.com/acme/widget/pull/1';
    await enrollWatch(projectRoot, { prUrl, slug: 'widget', repoCwd: projectRoot });

    const calls: GhCall[] = [];
    const gh = makeGh({ [prUrl]: { checks: FAILED_WITH_RUNNING_CHECKS } }, calls);
    const dispatched: WatchEntry[] = [];

    await sweepMergeableLabels({
      projectRoot,
      runGh: gh,
      ciFix: {
        enabled: true,
        // Real eligibility: the rollup is `failed`, but one check has not
        // reached a terminal state, so remediation must wait for the next tick.
        isEligible: async (entry: WatchEntry, state: PrMergeState) =>
          isEligibleForCiFix(entry, state, {}, new Date()),
        dispatch: async (entry: WatchEntry) => {
          dispatched.push(entry);
        },
      },
    });

    expect(dispatched).toHaveLength(0);
    const [persisted] = await readEntries(projectRoot);
    expect(persisted.ciFixAttempts ?? 0).toBe(0);
    expect(persisted.lastCiFixAt).toBeUndefined();

    // Deferring never paints a harness status on top of GitHub's own checks.
    const ciFailedLabelCalls = calls.filter((c) => c.args.join(' ').includes('ci-failed'));
    expect(ciFailedLabelCalls).toHaveLength(0);
  });

  it('a failed check plus a completed commit status dispatches once and persists its attempt', async () => {
    const prUrl = 'https://github.com/acme/widget/pull/1';
    await enrollWatch(projectRoot, { prUrl, slug: 'widget', repoCwd: projectRoot });

    const calls: GhCall[] = [];
    const gh = makeGh({ [prUrl]: { checks: FAILED_WITH_COMPLETED_COMMIT_STATUS } }, calls);
    const dispatched: WatchEntry[] = [];

    await sweepMergeableLabels({
      projectRoot,
      runGh: gh,
      ciFix: {
        enabled: true,
        isEligible: async (entry: WatchEntry, state: PrMergeState) =>
          isEligibleForCiFix(entry, state, {}, new Date()),
        dispatch: async (entry: WatchEntry) => {
          dispatched.push(entry);
        },
      },
    });

    expect(dispatched).toHaveLength(1);
    const [persisted] = await readEntries(projectRoot);
    expect(persisted.ciFixAttempts).toBe(1);
  });

  it('a failed check plus a pending commit status defers without dispatching or burning an attempt', async () => {
    const prUrl = 'https://github.com/acme/widget/pull/1';
    await enrollWatch(projectRoot, { prUrl, slug: 'widget', repoCwd: projectRoot });

    const calls: GhCall[] = [];
    const gh = makeGh({ [prUrl]: { checks: FAILED_WITH_PENDING_COMMIT_STATUS } }, calls);
    const dispatched: WatchEntry[] = [];

    await sweepMergeableLabels({
      projectRoot,
      runGh: gh,
      ciFix: {
        enabled: true,
        isEligible: async (entry: WatchEntry, state: PrMergeState) =>
          isEligibleForCiFix(entry, state, {}, new Date()),
        dispatch: async (entry: WatchEntry) => {
          dispatched.push(entry);
        },
      },
    });

    expect(dispatched).toHaveLength(0);
    const [persisted] = await readEntries(projectRoot);
    expect(persisted.ciFixAttempts ?? 0).toBe(0);
  });

  it('TR-3 happy: bumps ciFixAttempts + stamps lastCiFixAt BEFORE dispatch, persisted in the registry', async () => {
    const prUrl = 'https://github.com/acme/widget/pull/1';
    await enrollWatch(projectRoot, { prUrl, slug: 'widget', repoCwd: projectRoot });

    const calls: GhCall[] = [];
    const gh = makeGh({ [prUrl]: { checks: FAILED_CHECKS } }, calls);
    let observedAtDispatch: WatchEntry | undefined;

    await sweepMergeableLabels({
      projectRoot,
      runGh: gh,
      ciFix: {
        enabled: true,
        isEligible: async () => ({ eligible: true }),
        dispatch: async (entry: WatchEntry) => {
          observedAtDispatch = { ...entry };
        },
      },
    });

    expect(observedAtDispatch?.ciFixAttempts).toBe(1);
    expect(observedAtDispatch?.lastCiFixAt).toBeDefined();

    const [persisted] = await readEntries(projectRoot);
    expect(persisted.ciFixAttempts).toBe(1);
    expect(persisted.lastCiFixAt).toBeDefined();
  });

  it.each([
    ['not-started', async () => ({ kind: 'not-started' as const }), true],
    ['branch-gone', async () => ({ kind: 'branch-gone' as const }), true],
    ['noop', async () => ({ kind: 'noop' as const }), false],
    ['failed', async () => ({ kind: 'failed' as const, stage: 'provider' as const }), false],
    ['published', async () => ({ kind: 'published' as const }), false],
    ['unknown result', async () => undefined, false],
    ['thrown dispatch', async () => { throw new Error('ambiguous dispatch failure'); }, false],
  ])('reconciles the reservation only for direct %s proof', async (_name, dispatch, refunds) => {
    const prUrl = 'https://github.com/acme/widget/pull/1';
    const priorTimestamp = '2026-07-01T00:00:00.000Z';
    await enrollWatch(projectRoot, {
      prUrl,
      slug: 'widget',
      repoCwd: projectRoot,
      ciFixAttempts: 1,
      lastCiFixAt: priorTimestamp,
      ciFailureDetected: true,
    });
    const calls: GhCall[] = [];
    const observedAtDispatch: WatchEntry[] = [];

    await sweepMergeableLabels({
      projectRoot,
      runGh: makeGh({ [prUrl]: { checks: FAILED_CHECKS } }, calls),
      ciFix: {
        enabled: true,
        isEligible: async () => ({ eligible: true }),
        dispatch: async (reserved) => {
          observedAtDispatch.push({ ...reserved });
          return dispatch();
        },
        now: () => new Date('2026-07-08T12:00:00.000Z'),
      },
    });

    expect(observedAtDispatch).toMatchObject([{
      ciFixAttempts: 2,
      lastCiFixAt: '2026-07-08T12:00:00.000Z',
      ciFailureDetected: true,
    }]);
    const [persisted] = await readEntries(projectRoot);
    expect(persisted).toMatchObject({
      ciFixAttempts: refunds ? 1 : 2,
      lastCiFixAt: refunds ? priorTimestamp : '2026-07-08T12:00:00.000Z',
      ciFailureDetected: true,
    });
  });

  it('refunds an absent prior timestamp without erasing this sweep’s failure detection', async () => {
    const prUrl = 'https://github.com/acme/widget/pull/1';
    await enrollWatch(projectRoot, { prUrl, slug: 'widget', repoCwd: projectRoot });

    await sweepMergeableLabels({
      projectRoot,
      runGh: makeGh({ [prUrl]: { checks: FAILED_CHECKS } }, []),
      ciFix: {
        enabled: true,
        isEligible: async () => ({ eligible: true }),
        dispatch: async () => ({ kind: 'not-started' }),
        now: () => new Date('2026-07-08T12:00:00.000Z'),
      },
    });

    const [persisted] = await readEntries(projectRoot);
    expect(persisted).toMatchObject({ ciFixAttempts: 0, ciFailureDetected: true });
    expect(persisted.lastCiFixAt).toBeUndefined();
  });

  it('leaves local publication charged until a later remote-green sweep resets it', async () => {
    const prUrl = 'https://github.com/acme/widget/pull/1';
    await enrollWatch(projectRoot, {
      prUrl, slug: 'widget', repoCwd: projectRoot, ciFixAttempts: 1,
      lastCiFixAt: '2026-07-01T00:00:00.000Z', ciFailureDetected: true,
    });

    await sweepMergeableLabels({
      projectRoot,
      runGh: makeGh({ [prUrl]: { checks: FAILED_CHECKS } }, []),
      ciFix: {
        enabled: true,
        isEligible: async () => ({ eligible: true }),
        dispatch: async () => ({ kind: 'published' }),
        now: () => new Date('2026-07-08T12:00:00.000Z'),
      },
    });
    expect((await readEntries(projectRoot))[0]).toMatchObject({
      ciFixAttempts: 2,
      ciFailureDetected: true,
    });

    await sweepMergeableLabels({
      projectRoot,
      runGh: makeGh({ [prUrl]: { checks: GREEN_CHECKS } }, []),
    });
    expect((await readEntries(projectRoot))[0]).toMatchObject({
      ciFixAttempts: 0,
      ciFailureDetected: false,
    });
  });

  it('TR-3 happy: dispatches at most once per tick — a second eligible failed entry is deferred', async () => {
    const prUrlA = 'https://github.com/acme/widget/pull/1';
    const prUrlB = 'https://github.com/acme/widget/pull/2';
    await enrollWatch(projectRoot, { prUrl: prUrlA, slug: 'widget-a', repoCwd: projectRoot });
    await enrollWatch(projectRoot, { prUrl: prUrlB, slug: 'widget-b', repoCwd: projectRoot });

    const calls: GhCall[] = [];
    const gh = makeGh(
      { [prUrlA]: { checks: FAILED_CHECKS }, [prUrlB]: { checks: FAILED_CHECKS } },
      calls,
    );
    const dispatched: WatchEntry[] = [];
    const logs: string[] = [];

    await sweepMergeableLabels({
      projectRoot,
      runGh: gh,
      log: (msg) => logs.push(msg),
      ciFix: {
        enabled: true,
        isEligible: async () => ({ eligible: true }),
        dispatch: async (entry: WatchEntry) => {
          dispatched.push(entry);
        },
      },
    });

    expect(dispatched).toHaveLength(1);
    expect(logs.some((l) => l.toLowerCase().includes('defer'))).toBe(true);
  });

  it('TR-3 negative: disabled config (ciFix absent) leaves the CI-fix path fully inert — no dispatch, no attempt bump', async () => {
    const prUrl = 'https://github.com/acme/widget/pull/1';
    await enrollWatch(projectRoot, { prUrl, slug: 'widget', repoCwd: projectRoot });

    const calls: GhCall[] = [];
    const gh = makeGh({ [prUrl]: { checks: FAILED_CHECKS } }, calls);

    // No `ciFix` opt at all — mirrors the disabled-config default.
    await sweepMergeableLabels({ projectRoot, runGh: gh });

    const [persisted] = await readEntries(projectRoot);
    expect(persisted.ciFixAttempts ?? 0).toBe(0);
    expect(persisted.lastCiFixAt).toBeUndefined();

    // Disabling dispatch does not reintroduce the retired label.
    const labelCreateCalls = calls.filter(
      (c) => c.args[0] === 'label' && c.args[1] === 'create' && c.args[2] === 'ci-failed',
    );
    expect(labelCreateCalls).toHaveLength(0);
  });

  it('TR-3 negative: a CONFLICTING + failed entry skips CI-fix (conflict precedence) — no ciFixAttempts burn', async () => {
    const prUrl = 'https://github.com/acme/widget/pull/1';
    await enrollWatch(projectRoot, { prUrl, slug: 'widget', repoCwd: projectRoot });

    const calls: GhCall[] = [];
    const gh = makeGh({ [prUrl]: { mergeable: 'CONFLICTING', checks: FAILED_CHECKS } }, calls);
    const dispatched: WatchEntry[] = [];

    await sweepMergeableLabels({
      projectRoot,
      runGh: gh,
      ciFix: {
        enabled: true,
        // Real isEligibleForCiFix (ci-fix.ts, Task 13) rejects CONFLICTING; this
        // fixture's injected check stands in for that gate at the sweep boundary
        // being exercised here — the sweep must still end up with zero dispatch
        // and zero counter burn regardless of which module enforces the gate.
        isEligible: async () => ({ eligible: false, reason: 'conflict-precedence' }),
        dispatch: async (entry: WatchEntry) => {
          dispatched.push(entry);
        },
      },
    });

    expect(dispatched).toHaveLength(0);
    const [persisted] = await readEntries(projectRoot);
    expect(persisted.ciFixAttempts ?? 0).toBe(0);
  });

  it('TR-2 negative: needs-remediation present + failed checks — no dispatch or ci-failed label', async () => {
    const prUrl = 'https://github.com/acme/widget/pull/1';
    await enrollWatch(projectRoot, { prUrl, slug: 'widget', repoCwd: projectRoot });

    const calls: GhCall[] = [];
    const gh = makeGh(
      { [prUrl]: { checks: FAILED_CHECKS, labels: ['needs-remediation'] } },
      calls,
    );
    const dispatched: WatchEntry[] = [];

    await sweepMergeableLabels({
      projectRoot,
      runGh: gh,
      ciFix: {
        enabled: true,
        isEligible: async (entry: WatchEntry, state: PrMergeState) => {
          // Use the actual eligibility check which includes the needs-remediation gate
          return isEligibleForCiFix(entry, state, {}, new Date());
        },
        dispatch: async (entry: WatchEntry) => {
          dispatched.push(entry);
        },
      },
    });

    expect(dispatched).toHaveLength(0);
    const labelCreateCalls = calls.filter(
      (c) => c.args[0] === 'label' && c.args[1] === 'create' && c.args[2] === 'ci-failed',
    );
    expect(labelCreateCalls).toHaveLength(0);
  });

  it('TR-2 negative: label add/remove gh error is logged, the entry survives, and the sweep continues to the next entry', async () => {
    const prUrlA = 'https://github.com/acme/widget/pull/1';
    const prUrlB = 'https://github.com/acme/widget/pull/2';
    await enrollWatch(projectRoot, { prUrl: prUrlA, slug: 'widget-a', repoCwd: projectRoot });
    await enrollWatch(projectRoot, { prUrl: prUrlB, slug: 'widget-b', repoCwd: projectRoot });

    const calls: GhCall[] = [];
    const gh = makeGh(
      {
        [prUrlA]: { checks: FAILED_CHECKS, labels: ['ci-failed'] },
        [prUrlB]: { checks: FAILED_CHECKS, labels: ['ci-failed'] },
      },
      calls,
      (args) => args[0] === 'api' && args[2] === 'DELETE' && args.join(' ').includes('/issues/1/'),
    );
    const logs: string[] = [];
    const dispatched: string[] = [];

    await expect(
      sweepMergeableLabels({
        projectRoot,
        runGh: gh,
        log: (msg) => logs.push(msg),
        ciFix: {
          enabled: true,
          isEligible: async () => ({ eligible: true }),
          dispatch: async (entry) => {
            dispatched.push(entry.prUrl);
          },
        },
      }),
    ).resolves.toBeUndefined();

    const entries = await readEntries(projectRoot);
    expect(entries.map((e) => e.prUrl).sort()).toEqual([prUrlA, prUrlB].sort());
    expect(dispatched).toEqual([prUrlA]);
    expect(logs.some((line) => line.includes(prUrlB) && line.includes('deferring'))).toBe(true);
    expect(logs.length).toBeGreaterThan(0);
  });

  it('TR-3 happy: a legacy watch entry with no ciFixAttempts field normalizes to 0', async () => {
    const prUrl = 'https://github.com/acme/widget/pull/1';
    // Written without ciFixAttempts/lastCiFixAt — simulates a pre-feature registry line.
    await enrollWatch(projectRoot, { prUrl, slug: 'widget', repoCwd: projectRoot });

    const calls: GhCall[] = [];
    const gh = makeGh({ [prUrl]: {} }, calls);

    await sweepMergeableLabels({ projectRoot, runGh: gh });

    const [persisted] = await readEntries(projectRoot);
    expect(persisted.ciFixAttempts ?? 0).toBe(0);
  });

  it('setup-only needs-human restores the attempt and leaves an operator-clearable label', async () => {
    const prUrl = 'https://github.com/acme/widget/pull/1';
    await enrollWatch(projectRoot, { prUrl, slug: 'widget', repoCwd: projectRoot, ciFixAttempts: 1 });
    const calls: GhCall[] = [];
    const gh = makeGh({ [prUrl]: { checks: FAILED_CHECKS } }, calls);

    await sweepMergeableLabels({
      projectRoot,
      runGh: gh,
      ciFix: {
        enabled: true,
        isEligible: async () => ({ eligible: true }),
        dispatch: async () => ({ kind: 'needs-human' }),
      },
    });

    const [persisted] = await readEntries(projectRoot);
    expect(persisted.ciFixAttempts).toBe(1);
    expect(calls.some((call) => call.args.join(' ').includes('needs-remediation'))).toBe(true);
  });
});
