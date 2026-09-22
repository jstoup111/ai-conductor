// Covers: task:13

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readWatch,
  rewriteWatch,
  sweepMergeableLabels,
  type WatchEntry,
} from '../../src/engine/mergeable-sweep.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';

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

function fakeGh(state: string, removed: string[]): GhRunner {
  return async (args) => {
    if (args[0] === 'pr' && args[1] === 'view') return { stdout: state };
    if (args[0] === 'api' && args[1] === '--method' && args[2] === 'DELETE') {
      removed.push(args[3]);
    }
    return { stdout: '' };
  };
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
