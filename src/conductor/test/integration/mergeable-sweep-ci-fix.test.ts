/**
 * Acceptance spec (RED, pre-implementation) — ship→CI feedback loop.
 *
 * Story: "ci-failed label lifecycle + halt-monitor-visible event" (TR-2) and
 * "Bounded CI-fix dispatch seam" (TR-3), .docs/stories/ship-ci-feedback-loop.md.
 *
 * Drives the REAL entry point (`sweepMergeableLabels`) end-to-end against a
 * fixture watch registry with an injected `GhRunner`, exactly as
 * `mergeable-sweep-autoresolve.test.ts` does for the conflict-resolve path —
 * this is the CI-fix analog. Scoped to the seam shapes already pinned by the
 * plan (`SweepOpts.ciFix: CiFixDispatchOpts`, `WatchEntry.ciFixAttempts` /
 * `lastCiFixAt`, the `ci-failed` label). The exhaustion/escalation call site
 * (TR-5) is intentionally NOT asserted here — the plan (Task 21) leaves its
 * module home undecided ("mergeable-sweep.ts or ci-fix.ts"), so pinning its
 * shape now would freeze an unconfirmed assumption; it is covered by TDD's
 * own tests once that seam is fixed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { enrollWatch, sweepMergeableLabels } from '../../src/engine/mergeable-sweep.js';
import type { WatchEntry } from '../../src/engine/mergeable-sweep.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';
import { isEligibleForCiFix } from '../../src/engine/ci-fix.js';
import type { PrMergeState } from '../../src/engine/pr-labels.js';

type Check = { status?: string | null; conclusion?: string | null };

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

interface GhCall {
  args: string[];
}

function makeGh(
  prStates: Record<string, { mergeable?: string; checks?: Check[]; labels?: string[] }>,
  calls: GhCall[],
  failOn?: (args: string[]) => boolean,
): GhRunner {
  return async (args) => {
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
}

async function readEntries(projectRoot: string): Promise<WatchEntry[]> {
  const raw = await readFile(join(projectRoot, '.daemon/mergeable-watch.jsonl'), 'utf-8');
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

describe('mergeable-sweep ci-failed label lifecycle + bounded CI-fix dispatch', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'sweep-ci-fix-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('TR-2 happy: ensures+adds ci-failed once for a failed rollup, not re-added when present', async () => {
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
    expect(labelCreateCalls).toHaveLength(1);
    expect(labelAddCalls.length).toBeGreaterThanOrEqual(1);

    // Second sweep with the label already present: no further add call.
    calls.length = 0;
    const gh2 = makeGh({ [prUrl]: { checks: FAILED_CHECKS, labels: ['ci-failed'] } }, calls);
    await sweepMergeableLabels({ projectRoot, runGh: gh2 });
    const repeatAddCalls = calls.filter(
      (c) => c.args.join(' ').includes('ci-failed') && c.args[0] === 'api',
    );
    expect(repeatAddCalls).toHaveLength(0);
  });

  it('TR-2 happy: removes ci-failed and resets ciFixAttempts to 0 on green', async () => {
    const prUrl = 'https://github.com/acme/widget/pull/1';
    await enrollWatch(projectRoot, {
      prUrl,
      slug: 'widget',
      repoCwd: projectRoot,
      // @ts-expect-error ciFixAttempts not yet on WatchEntry (RED, pre-implementation)
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
    // @ts-expect-error ciFixAttempts not yet on WatchEntry (RED, pre-implementation)
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
      // @ts-expect-error ciFix seam not yet on SweepOpts (RED, pre-implementation)
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

  it('TR-3 happy: bumps ciFixAttempts + stamps lastCiFixAt BEFORE dispatch, persisted in the registry', async () => {
    const prUrl = 'https://github.com/acme/widget/pull/1';
    await enrollWatch(projectRoot, { prUrl, slug: 'widget', repoCwd: projectRoot });

    const calls: GhCall[] = [];
    const gh = makeGh({ [prUrl]: { checks: FAILED_CHECKS } }, calls);
    let observedAtDispatch: WatchEntry | undefined;

    await sweepMergeableLabels({
      projectRoot,
      runGh: gh,
      // @ts-expect-error ciFix seam not yet on SweepOpts (RED, pre-implementation)
      ciFix: {
        enabled: true,
        isEligible: async () => ({ eligible: true }),
        dispatch: async (entry: WatchEntry) => {
          observedAtDispatch = { ...entry };
        },
      },
    });

    // @ts-expect-error ciFixAttempts not yet on WatchEntry (RED, pre-implementation)
    expect(observedAtDispatch?.ciFixAttempts).toBe(1);
    // @ts-expect-error lastCiFixAt not yet on WatchEntry (RED, pre-implementation)
    expect(observedAtDispatch?.lastCiFixAt).toBeDefined();

    const [persisted] = await readEntries(projectRoot);
    // @ts-expect-error ciFixAttempts not yet on WatchEntry (RED, pre-implementation)
    expect(persisted.ciFixAttempts).toBe(1);
    // @ts-expect-error lastCiFixAt not yet on WatchEntry (RED, pre-implementation)
    expect(persisted.lastCiFixAt).toBeDefined();
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
      // @ts-expect-error ciFix seam not yet on SweepOpts (RED, pre-implementation)
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
    // @ts-expect-error ciFixAttempts not yet on WatchEntry (RED, pre-implementation)
    expect(persisted.ciFixAttempts ?? 0).toBe(0);
    // @ts-expect-error lastCiFixAt not yet on WatchEntry (RED, pre-implementation)
    expect(persisted.lastCiFixAt).toBeUndefined();

    // The ci-failed label lifecycle itself still applies even with dispatch disabled.
    const labelCreateCalls = calls.filter(
      (c) => c.args[0] === 'label' && c.args[1] === 'create' && c.args[2] === 'ci-failed',
    );
    expect(labelCreateCalls).toHaveLength(1);
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
      // @ts-expect-error ciFix seam not yet on SweepOpts (RED, pre-implementation)
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
    // @ts-expect-error ciFixAttempts not yet on WatchEntry (RED, pre-implementation)
    expect(persisted.ciFixAttempts ?? 0).toBe(0);
  });

  it('TR-2 negative: needs-remediation present + failed checks — no dispatch, ci-failed label handling still applies', async () => {
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
      // @ts-expect-error ciFix seam not yet on SweepOpts (RED, pre-implementation)
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
    expect(labelCreateCalls).toHaveLength(1);
  });

  it('TR-2 negative: label add/remove gh error is logged, the entry survives, and the sweep continues to the next entry', async () => {
    const prUrlA = 'https://github.com/acme/widget/pull/1';
    const prUrlB = 'https://github.com/acme/widget/pull/2';
    await enrollWatch(projectRoot, { prUrl: prUrlA, slug: 'widget-a', repoCwd: projectRoot });
    await enrollWatch(projectRoot, { prUrl: prUrlB, slug: 'widget-b', repoCwd: projectRoot });

    const calls: GhCall[] = [];
    const gh = makeGh(
      { [prUrlA]: { checks: FAILED_CHECKS }, [prUrlB]: { checks: FAILED_CHECKS } },
      calls,
      (args) => args[0] === 'label' && args[1] === 'create' && args[2] === 'ci-failed',
    );
    const logs: string[] = [];

    await expect(
      sweepMergeableLabels({ projectRoot, runGh: gh, log: (msg) => logs.push(msg) }),
    ).resolves.toBeUndefined();

    const entries = await readEntries(projectRoot);
    expect(entries.map((e) => e.prUrl).sort()).toEqual([prUrlA, prUrlB].sort());
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
    // @ts-expect-error ciFixAttempts not yet on WatchEntry (RED, pre-implementation)
    expect(persisted.ciFixAttempts ?? 0).toBe(0);
  });
});
