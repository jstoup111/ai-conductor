// Covers: task:10
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseChildId } from '../../../src/engine/child-context.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { readConflictRecord, recordAnswer } from '../../../src/engine/restack/restack-conflict-record.js';
import { readRestackJournal } from '../../../src/engine/restack/restack-journal.js';
import { requestRoutedExit } from '../../../src/engine/routing/routed-exit.js';
import { closureRefFor, repairMarkerRefFor, routeRecordRefFor } from '../../../src/engine/routing/routing-refs.js';
import { emptyUnsettledReceipt, parseRoundId, type RouteRecord } from '../../../src/engine/routing/route-types.js';
import { createSweepRepository, removeAll, sealStack } from './restack-sweepG2-fixture.js';

const cleanup: string[] = [];
const host = parseChildId(1)!;
const child = parseChildId(2)!;
const roundId = parseRoundId('r1')!;

afterEach(async () => removeAll(cleanup));

async function fixture() {
  const subject = await createSweepRepository('restack-decision-delivery-', cleanup);
  await subject.write('.ai-conductor/config.yml', 'stacked_prs:\n  enabled: true\n  route_whole_feature_fixes: true\n');
  await subject.git(['add', '.ai-conductor/config.yml']);
  await subject.git(['commit', '-qm', 'configure stack']);
  await subject.commit('base', 'base.txt', 'base\n');
  await subject.git(['checkout', '-qb', 'feat/c1/demo']);
  const closedOne = await subject.commit('closed one', 'one.txt', 'one\n');
  await subject.git(['update-ref', closureRefFor('demo', host), closedOne]);
  await subject.git(['checkout', '-qb', 'feat/c2/demo']);
  const closedTwo = await subject.commit('closed two', 'two.txt', 'two\n');
  await subject.git(['update-ref', closureRefFor('demo', child), closedTwo]);
  await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
  await subject.commit('leaf', 'leaf.txt', 'leaf\n');
  await sealStack(subject.repo);
  await subject.git(['checkout', '-q', 'feat/c1/demo']);
  await subject.commit('routed fix touching child 2', 'two.txt', 'routed\n');
  const git = makeGitRunner(subject.repo);
  const route: RouteRecord = {
    roundId, kind: 'audit', phase: 'open',
    items: [{ findingId: 'finding-1', kind: 'audit', owner: host, host, reason: 'repair', fallback: [] }],
    allocation: { [host]: { remTaskIds: ['rem-1'], blockBodies: ['### Task rem-1\n'] } },
    hosts: { [host]: 'repairing' }, currentHostIndex: 0, receipt: emptyUnsettledReceipt(), outbox: [],
    entry: { host, pinnedBase: closedOne, tree: (await git(['rev-parse', `${closedOne}^{tree}`])).stdout.trim() as never },
  };
  const blob = (await git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(route) })).stdout.trim();
  const marker = (await git(['hash-object', '-w', '--stdin'], { input: JSON.stringify({ host, roundId }) })).stdout.trim();
  await git(['update-ref', routeRecordRefFor('demo', roundId), blob]);
  await git(['update-ref', repairMarkerRefFor('demo'), marker]);
  return { ...subject, git, closedOne, closedTwo };
}

describe('restack decision delivery (real local Git)', () => {
  it('delivers a matching decision, journals it, then deletes it only with the applied move', async () => {
    const subject = await fixture();
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline/events.jsonl'), events);
    persister.start();
    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host, git: subject.git, events,
      resolver: async () => ({ resolved: false as const, reason: 'need an operator choice' }), resolverCap: 1,
    })).resolves.toMatchObject({ kind: 'halted' });
    const conflict = await readConflictRecord(subject.repo, 'demo', { git: subject.git });
    if (conflict.kind !== 'record') throw new Error('expected recorded conflict');
    await expect(recordAnswer(subject.repo, 'demo', { kind: 'decision', decision: {
      child, oldParent: conflict.record.oldParent, oldTip: conflict.record.oldTip,
      commit: conflict.record.commit, paths: conflict.record.paths,
      answer: 'keep upstream', operator: 'operator@example.test',
    } }, { git: subject.git })).resolves.toEqual({ kind: 'updated' });
    const resolver = vi.fn(async ({ projectRoot, environment }) => {
      await writeFile(join(projectRoot, 'two.txt'), 'two\nrouted\n');
      const local = makeGitRunner(projectRoot);
      await local(['add', 'two.txt'], { env: environment });
      await local(['rebase', '--continue'], { env: environment });
      return { resolved: true as const };
    });
    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host, git: subject.git, events, resolver, resolverCap: 1 }))
      .resolves.toEqual({ kind: 'restacked' });
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ operatorDecision: expect.objectContaining({ answer: 'keep upstream' }) }));
    const eventLines = (await readFile(join(subject.repo, '.pipeline/events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    expect(eventLines).toContainEqual(expect.objectContaining({ type: 'restack_decision', action: 'applied', child }));
    await expect(subject.git(['rev-parse', '-q', '--verify', 'refs/conductor/demo/restack/decision/c2'])).resolves.toMatchObject({ exitCode: 1 });
    await expect(subject.git(['rev-parse', '-q', '--verify', 'refs/conductor/demo/restack/conflict/record'])).resolves.toMatchObject({ exitCode: 1 });
    await expect(subject.git(['rev-parse', '-q', '--verify', 'refs/conductor/demo/restack/conflict/parent'])).resolves.toMatchObject({ exitCode: 1 });
    await expect(readRestackJournal(subject.repo, 'demo', { git: subject.git })).resolves.toEqual({ kind: 'missing' });
  });
});
