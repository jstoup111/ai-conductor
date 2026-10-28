// Covers: task:27
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseChildId } from '../../src/engine/child-context.js';
import { enrollWatch, sweepMergeableLabels } from '../../src/engine/mergeable-sweep.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { readPublicationRecord, writePublicationRecord, type PublicationRecord } from '../../src/engine/stack-publication-record.js';
import type { ConductorEvent } from '../../src/types/events.js';

const cleanup: string[] = [];
const repo = 'jstoup111/ai-conductor';
const leafUrl = `https://github.com/${repo}/pull/500`;

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture(record: PublicationRecord): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mergeable-sweep-stack-lifecycle-'));
  cleanup.push(root);
  await execa('git', ['init', '-b', 'main', root]);
  await execa('git', ['config', 'user.email', 'stack@example.invalid'], { cwd: root });
  await execa('git', ['config', 'user.name', 'Stack lifecycle'], { cwd: root });
  await expect(writePublicationRecord(root, 'demo', undefined, record)).resolves.toEqual({ kind: 'updated' });
  await enrollWatch(root, { prUrl: leafUrl, slug: 'demo', repoCwd: root });
  return root;
}

function openLeaf() {
  return {
    state: 'OPEN' as const, mergeable: 'MERGEABLE' as const,
    hasFailingOrPendingChecks: false, labels: [], checksOutcome: 'none' as const, isDraft: false,
  };
}

const threeMembers = (): PublicationRecord => ({
  version: 1,
  members: [
    { position: parseChildId(1)!, branch: 'feat/c1/demo', pr: 101 },
    { position: parseChildId(3)!, branch: 'feat/c3/demo', pr: 103 },
    { position: parseChildId(5)!, branch: 'feat/daemon-demo', pr: 500 },
  ],
});

function lifecycleGh(states: Record<number, 'OPEN' | 'MERGED' | 'CLOSED'>, reverted: number[] = []) {
  return vi.fn(async (args: string[]) => {
    if (args[0] === 'api') return { stdout: '{}' };
    if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ state: states[Number(args[2])] }) };
    if (args[0] === 'pr' && args[1] === 'list') {
      const number = Number((args[args.indexOf('--search') + 1] ?? '').match(/#(\d+)/)?.[1]);
      const member = Number.isNaN(number) ? 101 : number;
      return { stdout: JSON.stringify(reverted.includes(member) ? [{ number: 777, body: `Reverts ${repo}#${member}` }] : []) };
    }
    throw new Error(`unexpected gh argv: ${args.join(' ')}`);
  });
}

describe('stacked mergeable sweep lifecycle (Task 27)', () => {
  it('observes merged, closed, and reverted lower members, then persists only lastSeen', async () => {
    const root = await fixture(threeMembers());
    const events: ConductorEvent[] = [];
    const gh = lifecycleGh({ 101: 'MERGED', 103: 'CLOSED' }, [101]);

    await sweepMergeableLabels({
      projectRoot: root, runGh: gh, tracker: { readPullRequestMergeState: async () => openLeaf() },
      publicationRecordDependencies: { git: makeGitRunner(root) }, onEvent: (event) => events.push(event),
    });

    expect(gh.mock.calls[0]![0]).toEqual(['api', `repos/${repo}/stacks?pull_request=500`]);
    expect(events).toEqual([
      { type: 'stack_member_lifecycle', child: 1, pr: 101, state: 'reverted', eventId: 'demo:1:reverted' },
      { type: 'stack_member_lifecycle', child: 3, pr: 103, state: 'closed', eventId: 'demo:3:closed' },
    ]);
    const stored = await readPublicationRecord(root, 'demo');
    expect(stored).toMatchObject({ kind: 'record' });
    if (stored.kind !== 'record') throw new Error('expected publication record');
    expect(stored.record.members.map((member) => member.lastSeen)).toEqual(['reverted', 'closed', undefined]);
  });

  it('re-emits an unacknowledged observation with its stable id, then stays quiet once recorded', async () => {
    const root = await fixture(threeMembers());
    const events: ConductorEvent[] = [];
    const realGit = makeGitRunner(root);
    let refuseWrite = true;
    const git = async (args: string[], options?: { input?: string }) => {
      if (refuseWrite && args[0] === 'hash-object') throw new Error('crash before CAS');
      return realGit(args, options);
    };
    const gh = lifecycleGh({ 101: 'MERGED', 103: 'OPEN' });
    const options = {
      projectRoot: root, runGh: gh, tracker: { readPullRequestMergeState: async () => openLeaf() },
      publicationRecordDependencies: { git }, onEvent: (event: ConductorEvent) => events.push(event),
    };

    await sweepMergeableLabels(options);
    refuseWrite = false;
    await sweepMergeableLabels(options);
    await sweepMergeableLabels(options);

    expect(events.filter((event) => event.type === 'stack_member_lifecycle')).toEqual([
      expect.objectContaining({ eventId: 'demo:1:merged' }),
      expect.objectContaining({ eventId: 'demo:1:merged' }),
    ]);
    const stored = await readPublicationRecord(root, 'demo');
    expect(stored).toMatchObject({ kind: 'record' });
    if (stored.kind !== 'record') throw new Error('expected publication record');
    expect(stored.record.members.map((member) => member.lastSeen)).toEqual(['merged', undefined, undefined]);
  });

  it('does no stack read or stack event for an N=1 publication', async () => {
    const root = await fixture({ version: 1, members: [{ position: parseChildId(1)!, branch: 'feat/daemon-demo', pr: 500 }] });
    const gh = vi.fn();
    const events: ConductorEvent[] = [];

    await sweepMergeableLabels({
      projectRoot: root, runGh: gh, tracker: { readPullRequestMergeState: async () => openLeaf() },
      publicationRecordDependencies: { git: makeGitRunner(root) }, onEvent: (event) => events.push(event),
    });

    expect(gh).not.toHaveBeenCalled();
    expect(events.filter((event) => event.type.startsWith('stack_'))).toEqual([]);
  });
});
