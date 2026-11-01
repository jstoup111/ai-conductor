// Covers: task:10, task:13, task:15
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseChildId } from '../../../src/engine/child-context.js';
import { resolveActiveChild } from '../../../src/engine/child-cursor.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { readConflictRecord, recordAnswer } from '../../../src/engine/restack/restack-conflict-record.js';
import { readRestackJournal } from '../../../src/engine/restack/restack-journal.js';
import { readRevalidationQueue } from '../../../src/engine/routing/route-record-store.js';
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

async function childThreeConflictFixture() {
  const subject = await createSweepRepository('restack-decision-child-three-', cleanup);
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
  await subject.git(['checkout', '-qb', 'feat/c3/demo']);
  const closedThree = await subject.commit('closed three', 'three.txt', 'child three\n');
  await subject.git(['update-ref', closureRefFor('demo', parseChildId(3)!), closedThree]);
  await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
  await subject.commit('leaf', 'leaf.txt', 'leaf\n');
  await sealStack(subject.repo);
  await subject.git(['checkout', '-q', 'feat/c1/demo']);
  await subject.commit('routed fix touching child 3', 'three.txt', 'routed\n');
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
  // Covers: task:15
  it('preserves the pre-decision conflict hand-off when no decision or resolution is recorded', async () => {
    const subject = await fixture();
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline/events.jsonl'), events);
    persister.start();
    const resolver = vi.fn(async () => ({ resolved: false as const, reason: 'no decision supplied' }));

    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host, git: subject.git, events, resolver, resolverCap: 1 }))
      .resolves.toMatchObject({ kind: 'halted' });

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledWith(expect.not.objectContaining({ operatorDecision: expect.anything() }));
    const conflict = await readConflictRecord(subject.repo, 'demo', { git: subject.git });
    if (conflict.kind !== 'record') throw new Error('expected recorded conflict');
    const halt = await readFile(join(subject.repo, '.pipeline/HALT'), 'utf8');
    const preDecisionConflictHalt = [
      `restack conflict child ${child}`,
      `commit ${conflict.record.commit}; paths: ${conflict.record.paths.join(', ')}`,
      'no decision supplied',
      `Restack-Conflict: ${child} ${conflict.record.opId}`,
      `git switch -c restack-resolve/demo/c${child} ${conflict.record.oldTip}`,
      `git rebase --onto ${conflict.record.newParent} ${conflict.record.oldParent}`,
      `ai-conductor stack restack-resolve --slug demo --child ${child} --tip <sha>`,
    ].join('\n');
    expect(halt).toBe(`${preDecisionConflictHalt}\nai-conductor stack restack-resolve --slug demo --child ${child} --decision "<answer>"\n`);
    const eventLines = (await readFile(join(subject.repo, '.pipeline/events.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    expect(eventLines).not.toContainEqual(expect.objectContaining({ type: 'restack_decision' }));
  });

  // Covers: task:15
  it('keeps the applied refs, journal lifecycle, and events on the pre-decision path', async () => {
    const subject = await fixture();
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline/events.jsonl'), events);
    persister.start();
    const resolver = vi.fn(async ({ projectRoot, environment }) => {
      await writeFile(join(projectRoot, 'two.txt'), 'two\nrouted\n');
      const local = makeGitRunner(projectRoot);
      await local(['add', 'two.txt'], { env: environment });
      await local(['rebase', '--continue'], { env: environment });
      return { resolved: true as const };
    });

    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host, git: subject.git, events, resolver, resolverCap: 1 }))
      .resolves.toEqual({ kind: 'restacked' });

    expect(resolver).toHaveBeenCalledWith(expect.not.objectContaining({ operatorDecision: expect.anything() }));
    const appliedRefs = (await subject.git(['for-each-ref', '--format=%(refname)', 'refs/heads/feat/', 'refs/conductor/demo/closed/']))
      .stdout.trim().split('\n').filter(Boolean);
    expect(appliedRefs).toEqual([
      'refs/conductor/demo/closed/c1',
      'refs/conductor/demo/closed/c2',
      'refs/heads/feat/c1/demo',
      'refs/heads/feat/c2/demo',
      'refs/heads/feat/daemon-demo',
    ]);
    await expect(readRestackJournal(subject.repo, 'demo', { git: subject.git })).resolves.toEqual({ kind: 'missing' });
    const eventLines = (await readFile(join(subject.repo, '.pipeline/events.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    expect(eventLines).toContainEqual(expect.objectContaining({ type: 'restack_planned' }));
    expect(eventLines).toContainEqual(expect.objectContaining({ type: 'restack_applied' }));
    expect(eventLines).not.toContainEqual(expect.objectContaining({ type: 'restack_decision' }));
  });

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
    const resolvedChild = (await subject.git(['rev-parse', 'refs/heads/feat/c2/demo'])).stdout.trim();
    await expect(subject.git(['rev-parse', 'refs/conductor/demo/closed/c2'])).resolves.toMatchObject({
      exitCode: 0, stdout: resolvedChild,
    });
    const queue = await readRevalidationQueue(subject.repo, 'demo', { git: subject.git });
    expect(queue).toMatchObject({ kind: 'queue', queue: { entries: expect.any(Array) } });
    if (queue.kind !== 'queue') throw new Error('expected routed revalidation queue');
    expect(queue.queue.entries.map((entry) => entry.child)).toEqual([child, parseChildId(3)!]);
    await expect(resolveActiveChild(subject.repo, 'demo', { git: subject.git })).resolves.not.toMatchObject({
      kind: 'divergent', check: 'closed-child-rewritten',
    });
    const eventLines = (await readFile(join(subject.repo, '.pipeline/events.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(eventLines).toContainEqual(expect.objectContaining({ type: 'restack_decision', action: 'applied', child }));
    await expect(subject.git(['rev-parse', '-q', '--verify', 'refs/conductor/demo/restack/decision/c2'])).resolves.toMatchObject({ exitCode: 1 });
    await expect(subject.git(['rev-parse', '-q', '--verify', 'refs/conductor/demo/restack/conflict/record'])).resolves.toMatchObject({ exitCode: 1 });
    await expect(subject.git(['rev-parse', '-q', '--verify', 'refs/conductor/demo/restack/conflict/parent'])).resolves.toMatchObject({ exitCode: 1 });
    await expect(readRestackJournal(subject.repo, 'demo', { git: subject.git })).resolves.toEqual({ kind: 'missing' });
  });

  it('does not emit an applied decision from the executor when its conflict refs are absent', async () => {
    const subject = await fixture();
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline/events.jsonl'), events);
    persister.start();
    await expect(recordAnswer(subject.repo, 'demo', { kind: 'decision', decision: {
      child, oldParent: subject.closedOne, oldTip: subject.closedTwo, commit: subject.closedTwo,
      paths: ['two.txt'], answer: 'keep upstream', operator: 'operator@example.test',
    } }, { git: subject.git })).resolves.toEqual({ kind: 'updated' });
    const resolver = vi.fn(async () => ({ resolved: false as const, reason: 'must not be dispatched' }));

    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host, git: subject.git, events, resolver, resolverCap: 1 }))
      .resolves.toMatchObject({ kind: 'halted' });

    expect(resolver).not.toHaveBeenCalled();
    const eventLines = (await readFile(join(subject.repo, '.pipeline/events.jsonl'), 'utf8').catch(() => ''))
      .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    expect(eventLines).not.toContainEqual(expect.objectContaining({ type: 'restack_decision', action: 'applied', child }));
  });

  // Covers: task:11, task:13
  it('keeps an ignored decision while escalating its answer, recipe, and fresh conflict record', async () => {
    const subject = await fixture();
    const events = new ConductorEventEmitter();
    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host, git: subject.git, events,
      resolver: async () => ({ resolved: false as const, reason: 'initial operator choice' }), resolverCap: 1,
    })).resolves.toMatchObject({ kind: 'halted' });
    const firstConflict = await readConflictRecord(subject.repo, 'demo', { git: subject.git });
    if (firstConflict.kind !== 'record') throw new Error('expected initial conflict record');
    await expect(recordAnswer(subject.repo, 'demo', { kind: 'decision', decision: {
      child, oldParent: firstConflict.record.oldParent, oldTip: firstConflict.record.oldTip,
      commit: firstConflict.record.commit, paths: firstConflict.record.paths,
      answer: "keep upstream's resolveReviewScope seam", operator: 'operator@example.test',
    } }, { git: subject.git })).resolves.toEqual({ kind: 'updated' });
    const decision = await subject.git(['rev-parse', '--verify', 'refs/conductor/demo/restack/decision/c2']);
    const featureRefs = await subject.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/feat/']);
    const closedRefs = await subject.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/conductor/demo/closed/']);

    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host, git: subject.git, events,
      resolver: vi.fn(async () => ({ resolved: false as const, reason: 'resolver rejected the supplied seam' })), resolverCap: 1,
    })).resolves.toMatchObject({ kind: 'halted' });

    const halt = await readFile(join(subject.repo, '.pipeline/HALT'), 'utf8');
    expect(halt).toContain("operator decision applied: keep upstream's resolveReviewScope seam");
    expect(halt).toContain('resolver rejected the supplied seam');
    expect(halt).toContain('git switch -c restack-resolve/demo/c2');
    expect(halt).toContain('git rebase --onto');
    const conflict = await readConflictRecord(subject.repo, 'demo', { git: subject.git });
    if (conflict.kind !== 'record') throw new Error('expected refreshed conflict record');
    expect(halt).toContain(`Restack-Conflict: 2 ${conflict.record.opId}`);
    await expect(subject.git(['rev-parse', '--verify', 'refs/conductor/demo/restack/decision/c2']))
      .resolves.toMatchObject({ exitCode: 0, stdout: decision.stdout.trim() });
    await expect(subject.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/feat/']))
      .resolves.toMatchObject({ stdout: featureRefs.stdout });
    await expect(subject.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/conductor/demo/closed/']))
      .resolves.toMatchObject({ stdout: closedRefs.stdout });
  });

  // Covers: task:14
  it('reports a stale decision without delivering it to the resolver', async () => {
    const subject = await fixture();
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline/events.jsonl'), events);
    persister.start();
    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host, git: subject.git, events,
      resolver: async () => ({ resolved: false as const, reason: 'initial operator choice' }), resolverCap: 1,
    })).resolves.toMatchObject({ kind: 'halted' });
    const conflict = await readConflictRecord(subject.repo, 'demo', { git: subject.git });
    if (conflict.kind !== 'record') throw new Error('expected initial conflict record');
    await expect(recordAnswer(subject.repo, 'demo', { kind: 'decision', decision: {
      child, oldParent: conflict.record.oldParent, oldTip: subject.closedOne,
      commit: conflict.record.commit, paths: conflict.record.paths,
      answer: "keep upstream's resolveReviewScope seam", operator: 'operator@example.test',
    } }, { git: subject.git })).resolves.toEqual({ kind: 'updated' });
    const resolver = vi.fn(async () => ({ resolved: false as const, reason: 'resolver needs a current answer' }));

    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host, git: subject.git, events, resolver, resolverCap: 1 }))
      .resolves.toMatchObject({ kind: 'halted' });

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledWith(expect.not.objectContaining({ operatorDecision: expect.anything() }));
    const halt = await readFile(join(subject.repo, '.pipeline/HALT'), 'utf8');
    expect(halt).toContain("stale operator decision: keep upstream's resolveReviewScope seam");
    expect(halt).toContain('--tip <sha>');
    expect(halt).toContain('--decision "<answer>"');
    const eventsWritten = (await readFile(join(subject.repo, '.pipeline/events.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(eventsWritten).toContainEqual(expect.objectContaining({
      type: 'restack_decision', action: 'stale', child,
      commit: conflict.record.commit, paths: conflict.record.paths,
    }));
  });

  // Covers: task:14
  it('reports an unreadable decision without delivering it to the resolver', async () => {
    const subject = await fixture();
    const events = new ConductorEventEmitter();
    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host, git: subject.git, events,
      resolver: async () => ({ resolved: false as const, reason: 'initial operator choice' }), resolverCap: 1,
    })).resolves.toMatchObject({ kind: 'halted' });
    const malformed = (await subject.git(['hash-object', '-w', '--stdin'], { input: '{not json' })).stdout.trim();
    await subject.git(['update-ref', 'refs/conductor/demo/restack/decision/c2', malformed]);
    const resolver = vi.fn(async () => ({ resolved: false as const, reason: 'resolver needs a readable answer' }));

    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host, git: subject.git, events, resolver, resolverCap: 1 }))
      .resolves.toMatchObject({ kind: 'halted' });

    expect(resolver).toHaveBeenCalledWith(expect.not.objectContaining({ operatorDecision: expect.anything() }));
    await expect(readFile(join(subject.repo, '.pipeline/HALT'), 'utf8'))
      .resolves.toContain('unreadable operator decision at refs/conductor/demo/restack/decision/c2');
  });

  // Covers: task:13
  it('does not deliver child 2\'s decision while replaying child 3', async () => {
    const subject = await childThreeConflictFixture();
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline/events.jsonl'), events);
    persister.start();
    await expect(recordAnswer(subject.repo, 'demo', { kind: 'decision', decision: {
      child, oldParent: subject.closedOne, oldTip: subject.closedTwo, commit: subject.closedTwo,
      paths: ['two.txt'], answer: 'keep child two unchanged', operator: 'operator@example.test',
    } }, { git: subject.git })).resolves.toEqual({ kind: 'updated' });
    const resolver = vi.fn(async () => ({ resolved: false as const, reason: 'child three still conflicts' }));

    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host, git: subject.git, events, resolver, resolverCap: 1 }))
      .resolves.toMatchObject({ kind: 'halted' });

    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ conflicts: ['three.txt'] }));
    expect(resolver).toHaveBeenCalledWith(expect.not.objectContaining({ operatorDecision: expect.anything() }));
    const eventLines = (await readFile(join(subject.repo, '.pipeline/events.jsonl'), 'utf8').catch(() => ''))
      .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    expect(eventLines).not.toContainEqual(expect.objectContaining({ type: 'restack_decision', action: 'applied', child: 3 }));
  });
});
