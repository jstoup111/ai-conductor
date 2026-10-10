// Covers: task:13

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readWatch,
  rewriteWatch,
  maybeClearConflictLabel,
  maybeClearReadinessLabel,
  sweepMergeableLabels,
  type WatchEntry,
} from '../../src/engine/mergeable-sweep.js';
import type { GhRunner, PrMergeState } from '../../src/engine/pr-labels.js';
import type { GithubOperationRunner, GithubOperationRunnerResponse } from '../../src/engine/github-operations.js';

const PR_URL = 'https://github.com/acme/widgets/pull/7';
const legacyEntry = { prUrl: PR_URL, slug: 'widgets', repoCwd: '/repo' };
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempProject(): Promise<string> {
  const project = await mkdtemp(join(tmpdir(), 'mergeable-sweep-label-clear-'));
  tempDirs.push(project);
  return project;
}

function stateJson(
  mergeable: string,
  labels: string[] = [],
  statusCheckRollup: Array<{ status: string; conclusion?: string }> = [],
): string {
  return JSON.stringify({
    state: 'OPEN',
    mergeable,
    mergeStateStatus: mergeable === 'CONFLICTING' ? 'DIRTY' : 'CLEAN',
    statusCheckRollup,
    labels: labels.map((name) => ({ name })),
    isDraft: false,
  });
}

/** Reads answer from `state`; guarded label removals are recorded in `removed`. */
function fakeGh(
  state: string,
  removed: string[],
  added: string[] = [],
  refuseLabelRemoval = false,
): GhRunner & GithubOperationRunner {
  const read: GhRunner = async (args) => {
    if (args[0] === 'pr' && args[1] === 'view') return { stdout: state };
    return { stdout: '' };
  };
  return Object.assign(read, {
    run: async (request: Parameters<GithubOperationRunner['run']>[0]) => {
      if (request.operation === 'pull-request.label.remove' && request.target.kind === 'pull-request') {
        const label = request.payload && 'label' in request.payload ? String(request.payload.label) : '';
        removed.push(`repos/${request.target.repository}/issues/${request.target.number}/labels/${label}`);
        if (refuseLabelRemoval) return { kind: 'refused' as const, reason: 'other-owner' as const };
      }
      if (request.operation === 'pull-request.label.add' && request.target.kind === 'pull-request') {
        const label = request.payload && 'label' in request.payload ? String(request.payload.label) : '';
        added.push(`repos/${request.target.repository}/issues/${request.target.number}/labels/${label}`);
      }
      return {} as GithubOperationRunnerResponse;
    },
  });
}

describe('sweepMergeableLabels — escalation cause registry', () => {
  it('persists conflict-resolution after an escalated autoresolve dispatch', async () => {
    const project = await tempProject();
    await rewriteWatch(project, [legacyEntry]);

    const logs: string[] = [];
    await sweepMergeableLabels({
      projectRoot: project,
      log: (message) => logs.push(message),
      runGh: fakeGh(stateJson('CONFLICTING'), []),
      autoresolve: {
        enabled: true,
        isEligible: async () => ({ eligible: true }),
        dispatch: async () => ({ kind: 'escalated' }),
      },
    });

    expect(logs).toEqual([]);
    await expect(readWatch(project)).resolves.toMatchObject([
      { ...legacyEntry, escalationCause: 'conflict-resolution' },
    ]);
  });

  it('round-trips a legacy labeled entry without a cause and leaves its label alone', async () => {
    const project = await tempProject();
    const daemonDir = join(project, '.daemon');
    await writeFile(join(project, '.daemon/mergeable-watch.jsonl'), `${JSON.stringify(legacyEntry)}\n`)
      .catch(async () => {
        await (await import('node:fs/promises')).mkdir(daemonDir, { recursive: true });
        await writeFile(join(daemonDir, 'mergeable-watch.jsonl'), `${JSON.stringify(legacyEntry)}\n`);
      });
    const removed: string[] = [];

    const loaded = await readWatch(project);
    expect(loaded[0].escalationCause).toBeUndefined();
    await sweepMergeableLabels({
      projectRoot: project,
      runGh: fakeGh(stateJson('MERGEABLE', ['needs-remediation']), removed),
    });

    expect(removed).toEqual([]);
    const saved = JSON.parse(await readFile(join(daemonDir, 'mergeable-watch.jsonl'), 'utf8')) as WatchEntry;
    expect(saved).not.toHaveProperty('escalationCause');
  });
});

describe('maybeClearConflictLabel', () => {
  const caused: WatchEntry = { ...legacyEntry, escalationCause: 'conflict-resolution' };
  const mergeable: PrMergeState = {
    state: 'OPEN', mergeable: 'MERGEABLE', hasFailingOrPendingChecks: false,
    labels: ['needs-remediation'], checksOutcome: 'none',
  };

  it('removes exactly once and records a retry for an eligible clear', async () => {
    const removed: string[] = [];
    const result = await maybeClearConflictLabel(caused, mergeable, fakeGh('', removed));
    expect(removed).toHaveLength(1);
    expect(result).toMatchObject({ escalationCause: 'conflict-resolution', labelClearAttempts: 1 });
  });

  it('keeps the label state for conflicts, unreadable state, halt markers, and unattributed entries', async () => {
    const unsafe: PrMergeState[] = [
      { ...mergeable, mergeable: 'CONFLICTING' },
      { ...mergeable, readFailure: { kind: 'runner', error: new Error('unreadable') } },
      { ...mergeable, hasHaltBodyMarker: true },
    ];
    for (const state of unsafe) {
      const removed: string[] = [];
      await expect(maybeClearConflictLabel(caused, state, fakeGh('', removed))).resolves.toEqual(caused);
      expect(removed).toEqual([]);
    }
    const removed: string[] = [];
    await expect(maybeClearConflictLabel(legacyEntry, mergeable, fakeGh('', removed))).resolves.toEqual(legacyEntry);
    expect(removed).toEqual([]);
  });

  describe('retry cap', () => {
    it('caps retries at three, clears the cause, and logs once without another removal', async () => {
      const removed: string[] = [];
      const logs: string[] = [];
      const result = await maybeClearConflictLabel(
        { ...caused, labelClearAttempts: 3 }, mergeable, fakeGh('', removed), (line) => logs.push(line),
      );
      expect(result).not.toHaveProperty('escalationCause');
      expect(result).not.toHaveProperty('labelClearAttempts');
      expect(removed).toEqual([]);
      expect(logs).toEqual([`[mergeable-sweep] label clear retry cap reached for ${PR_URL}`]);
    });
  });
});

// Covers: task:7
describe('maybeClearReadinessLabel', () => {
  const caused: WatchEntry = { ...legacyEntry, escalationCause: 'shipped-readiness' };
  const readable: PrMergeState = {
    state: 'OPEN', mergeable: 'MERGEABLE', hasFailingOrPendingChecks: false,
    labels: ['needs-remediation'], checksOutcome: 'green',
  };

  it.each(['ready', 'conflicting', 'ci-failing'] as const)(
    'removes a shipped-readiness label after the %s verdict recovers it',
    async (verdict) => {
      const removed: string[] = [];
      const result = await maybeClearReadinessLabel(caused, readable, verdict, fakeGh('', removed));
      expect(removed).toHaveLength(1);
      expect(result).toMatchObject({ escalationCause: 'shipped-readiness', labelClearAttempts: 1 });
    },
  );

  it.each(['no-checks', 'draft', 'ci-pending', 'indeterminate'] as const)(
    'holds a shipped-readiness label for the %s verdict',
    async (verdict) => {
      const removed: string[] = [];
      await expect(maybeClearReadinessLabel(caused, readable, verdict, fakeGh('', removed)))
        .resolves.toEqual(caused);
      expect(removed).toEqual([]);
    },
  );

  it('holds for halt markers and read failures, then clears only the recorded shipped cause', async () => {
    for (const state of [
      { ...readable, hasHaltBodyMarker: true },
      { ...readable, readFailure: { kind: 'runner' as const, error: new Error('unreadable') } },
    ]) {
      const removed: string[] = [];
      await expect(maybeClearReadinessLabel(caused, state, 'ready', fakeGh('', removed)))
        .resolves.toEqual(caused);
      expect(removed).toEqual([]);
    }
    for (const entry of [legacyEntry, { ...legacyEntry, escalationCause: 'conflict-resolution' as const }]) {
      const removed: string[] = [];
      await expect(maybeClearReadinessLabel(entry, readable, 'ready', fakeGh('', removed)))
        .resolves.toEqual(entry);
      expect(removed).toEqual([]);
    }
  });

  it('drops a stale cause when the label is already absent', async () => {
    const result = await maybeClearReadinessLabel(
      caused,
      { ...readable, labels: [] },
      'ready',
      fakeGh('', []),
    );
    expect(result).not.toHaveProperty('escalationCause');
    expect(result).not.toHaveProperty('labelClearAttempts');
  });

  it('caps three failed removals across ticks, leaves the label, and drops only the cause', async () => {
    const project = await tempProject();
    const removed: string[] = [];
    const logs: string[] = [];
    await rewriteWatch(project, [caused]);

    const gh = fakeGh(
      stateJson('MERGEABLE', ['needs-remediation'], [{ status: 'COMPLETED', conclusion: 'SUCCESS' }]),
      removed,
      [],
      true,
    );
    for (let tick = 0; tick < 4; tick += 1) {
      await sweepMergeableLabels({ projectRoot: project, runGh: gh, log: (line) => logs.push(line) });
    }

    expect(removed).toEqual([
      'repos/acme/widgets/issues/7/labels/needs-remediation',
      'repos/acme/widgets/issues/7/labels/needs-remediation',
      'repos/acme/widgets/issues/7/labels/needs-remediation',
    ]);
    expect(logs).toEqual([`[mergeable-sweep] readiness label clear retry cap reached for ${PR_URL}`]);
    const [persisted] = await readWatch(project);
    expect(persisted).toMatchObject(legacyEntry);
    expect(persisted).not.toHaveProperty('escalationCause');
    expect(persisted).not.toHaveProperty('labelClearAttempts');
  });
});

describe('sweepMergeableLabels — shipped-readiness recovery ordering', () => {
  it('clears the recovered readiness label before reconciling mergeable in the same tick', async () => {
    const project = await tempProject();
    const removed: string[] = [];
    const added: string[] = [];
    await rewriteWatch(project, [{ ...legacyEntry, escalationCause: 'shipped-readiness' }]);

    await sweepMergeableLabels({
      projectRoot: project,
      runGh: fakeGh(
        stateJson('MERGEABLE', ['needs-remediation'], [{ status: 'COMPLETED', conclusion: 'SUCCESS' }]),
        removed,
        added,
      ),
    });

    expect(removed).toEqual(['repos/acme/widgets/issues/7/labels/needs-remediation']);
    expect(added).toEqual(['repos/acme/widgets/issues/7/labels/mergeable']);
  });

  it('clears a recovered ci-failing readiness label before choosing its CI-fix candidate', async () => {
    const project = await tempProject();
    const removed: string[] = [];
    const selected: WatchEntry[] = [];
    await rewriteWatch(project, [{ ...legacyEntry, escalationCause: 'shipped-readiness' }]);

    await sweepMergeableLabels({
      projectRoot: project,
      runGh: fakeGh(
        stateJson('MERGEABLE', ['needs-remediation'], [{ status: 'COMPLETED', conclusion: 'FAILURE' }]),
        removed,
      ),
      ciFix: {
        enabled: true,
        isEligible: async () => ({ eligible: true }),
        dispatch: async (entry) => { selected.push(entry); },
      },
    });

    expect(removed).toEqual(['repos/acme/widgets/issues/7/labels/needs-remediation']);
    expect(selected).toHaveLength(1);
  });

  it('leaves human, CI-exhaustion, and conflict labels sticky without adding mergeable', async () => {
    for (const entry of [
      legacyEntry,
      { ...legacyEntry, escalationCause: 'conflict-resolution' as const },
    ]) {
      const project = await tempProject();
      const removed: string[] = [];
      const added: string[] = [];
      await rewriteWatch(project, [entry]);

      await sweepMergeableLabels({
        projectRoot: project,
        runGh: fakeGh(
          stateJson('MERGEABLE', ['needs-remediation'], [{ status: 'COMPLETED', conclusion: 'SUCCESS' }]),
          removed,
          added,
        ),
      });

      expect(removed).toEqual([]);
      expect(added).toEqual([]);
    }
  });
});
