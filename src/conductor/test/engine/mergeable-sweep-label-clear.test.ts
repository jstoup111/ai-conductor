// Covers: task:13

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readWatch,
  rewriteWatch,
  maybeClearConflictLabel,
  sweepMergeableLabels,
  type WatchEntry,
} from '../../src/engine/mergeable-sweep.js';
import type { GhRunner, PrMergeState } from '../../src/engine/pr-labels.js';
import type { GithubOperationRunner } from '../../src/engine/github-operations.js';

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

function stateJson(mergeable: string, labels: string[] = []): string {
  return JSON.stringify({
    state: 'OPEN',
    mergeable,
    statusCheckRollup: [],
    labels: labels.map((name) => ({ name })),
    isDraft: false,
  });
}

/** Reads answer from `state`; guarded label removals are recorded in `removed`. */
function fakeGh(state: string, removed: string[]): GhRunner & GithubOperationRunner {
  const read: GhRunner = async (args) => {
    if (args[0] === 'pr' && args[1] === 'view') return { stdout: state };
    return { stdout: '' };
  };
  return Object.assign(read, {
    run: async (request: Parameters<GithubOperationRunner['run']>[0]) => {
      if (request.operation === 'pull-request.label.remove' && request.target.kind === 'pull-request') {
        const label = request.payload && 'label' in request.payload ? String(request.payload.label) : '';
        removed.push(`repos/${request.target.repository}/issues/${request.target.number}/labels/${label}`);
      }
      return {};
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
