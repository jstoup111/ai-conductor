// Covers: task:25, task:rem-prd-audit-25-s14-1-order
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { leafBranchFor } from '../../../src/engine/feature-branch-identity.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import {
  abandonOperatorRound,
  checkDeclareOperatorRound,
  declareOperatorRound,
  openOperatorRound,
} from '../../../src/engine/routing/operator-round.js';
import { drainOutbox, readRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { closureRefFor } from '../../../src/engine/routing/routing-refs.js';
import { operatorRoundEvent } from '../../../src/engine/routing/routing-events.js';
import { requestRoutedExit } from '../../../src/engine/routing/routed-exit.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { sealStack } from '../restack/restack-sweepG2-fixture.js';

const roots: string[] = [];
const child = parseChildId(1)!;
const roundId = parseRoundId('r1')!;

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'operator-round-events-'));
  roots.push(repo);
  const git = makeGitRunner(repo);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'operator-round-events@example.invalid']);
  await git(['config', 'user.name', 'Operator round events']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await writeFile(join(repo, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 2\n  route_whole_feature_fixes: true\n');
  await git(['add', '.gitignore', '.ai-conductor/config.yml']);
  await git(['commit', '-qm', 'initial']);
  await git(['checkout', '-qb', 'feat/c1/demo']);
  await writeFile(join(repo, 'child.txt'), 'closed child\n');
  await git(['add', 'child.txt']);
  await git(['commit', '-qm', 'closed child']);
  const closure = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await git(['update-ref', closureRefFor('demo', child), closure]);
  await writeFile(join(repo, 'reviewer-edit.txt'), 'reviewer edit\n');
  await git(['add', 'reviewer-edit.txt']);
  await git(['commit', '-qm', 'reviewer edit']);
  await git(['checkout', '-qb', leafBranchFor('demo'), closure]);
  await writeFile(join(repo, 'leaf.txt'), 'leaf\n');
  await git(['add', 'leaf.txt']);
  await git(['commit', '-qm', 'leaf']);
  await sealStack(repo, [1, 2]);
  await git(['checkout', 'feat/c1/demo']);
  await mkdir(join(repo, '.pipeline', 'children', '1'), { recursive: true });
  await writeFile(join(repo, '.pipeline', 'children', '1', 'conduct-state.json'), JSON.stringify({
    acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
  }));
  return { repo, git };
}

describe('operator round events', () => {
  it('emits an identified spine occurrence carrying the landing work order', () => {
    const event = operatorRoundEvent(
      parseRoundId('r1')!,
      { origin: 'land', reason: 'repair reviewer edit', operator: 'operator', entryStep: 'acceptance_specs', carried: [], otherTips: {}, priorRegion: { statuses: { acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done' }, verdicts: {} } },
      parseChildId(1)!,
      'declared',
    );
    expect(event).toMatchObject({ type: 'operator_round', roundId: 'r1', child: 1, origin: 'land', reason: 'repair reviewer edit', action: 'declared' });
    expect(event).not.toHaveProperty('phase');
    expect(event.eventId).toEqual(expect.any(String));
    expect(event.occurredAt).toEqual(expect.any(String));
  });

  it('persists an abandoned landing in action order exactly once per replayed event id', async () => {
    const subject = await fixture();
    await expect(openOperatorRound({
      worktree: subject.repo, slug: 'demo', roundId, host: child,
      reason: 'land reviewer edits', operator: 'operator@example.test', carried: [],
      emitter: new ConductorEventEmitter(), git: subject.git,
    })).resolves.toMatchObject({ kind: 'opened' });
    const checked = await checkDeclareOperatorRound({ worktree: subject.repo, slug: 'demo', roundId, host: child, git: subject.git });
    if (checked.kind !== 'accepted') throw new Error(checked.detail);
    await expect(declareOperatorRound({ worktree: subject.repo, slug: 'demo', roundId, host: child, checked, git: subject.git }))
      .resolves.toEqual({ kind: 'declared' });
    await expect(abandonOperatorRound({ worktree: subject.repo, slug: 'demo', roundId, host: child, git: subject.git }))
      .resolves.toEqual({ kind: 'abandoned' });

    const stored = await readRouteRecord(subject.repo, 'demo', roundId, { git: subject.git });
    if (stored.kind !== 'record') throw new Error('missing operator route record');
    const eventsPath = join(subject.repo, '.pipeline', 'events.jsonl');
    const persister = new EventPersister(eventsPath, new ConductorEventEmitter());
    let removalAttempts = 0;
    const flakyGit: GitRunner = async (args, options) => {
      if (args[0] === 'update-ref' && args[1] === '--stdin' && ++removalAttempts === 2) {
        return { exitCode: 1, stdout: '', stderr: 'simulated CAS retry' };
      }
      return subject.git(args, options);
    };
    await expect(drainOutbox(subject.repo, stored, (event) => persister.persistDurably(event), { git: flakyGit }))
      .resolves.toEqual({ kind: 'unavailable' });
    const replay = await readRouteRecord(subject.repo, 'demo', roundId, { git: subject.git });
    if (replay.kind !== 'record') throw new Error('missing replayable operator route record');
    await expect(drainOutbox(subject.repo, replay, (event) => persister.persistDurably(event), { git: flakyGit }))
      .resolves.toEqual({ kind: 'drained' });

    const events = (await readFile(eventsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    const operatorEvents = events.filter((event) => event.type === 'operator_round');
    expect(operatorEvents).toMatchObject([
      { roundId: 'r1', child: 1, origin: 'land', action: 'opened', reason: 'land reviewer edits' },
      { roundId: 'r1', child: 1, origin: 'land', action: 'declared', reason: 'land reviewer edits' },
      { roundId: 'r1', child: 1, origin: 'land', action: 'abandoned', reason: 'land reviewer edits' },
    ]);
    expect(operatorEvents).toHaveLength(3);
    expect(new Set(operatorEvents.map((event) => event.eventId)).size).toBe(operatorEvents.length);
    expect(removalAttempts).toBeGreaterThan(2);
    expect(events).toContainEqual(expect.objectContaining({ type: 'remediation_routed', roundId: 'r1', kind: 'operator' }));
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'child_revalidated' }));
  });

  it('persists an opened, declared, and exited landing in durable spine order', async () => {
    const subject = await fixture();
    await expect(openOperatorRound({
      worktree: subject.repo, slug: 'demo', roundId, host: child,
      reason: 'land reviewer edits', operator: 'operator@example.test', carried: [],
      emitter: new ConductorEventEmitter(), git: subject.git,
    })).resolves.toMatchObject({ kind: 'opened' });
    const checked = await checkDeclareOperatorRound({ worktree: subject.repo, slug: 'demo', roundId, host: child, git: subject.git });
    if (checked.kind !== 'accepted') throw new Error(checked.detail);
    await expect(declareOperatorRound({ worktree: subject.repo, slug: 'demo', roundId, host: child, checked, git: subject.git }))
      .resolves.toEqual({ kind: 'declared' });
    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host: child, git: subject.git }))
      .resolves.toEqual({ kind: 'restacked' });

    const eventsPath = join(subject.repo, '.pipeline', 'events.jsonl');
    const events = (await readFile(eventsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(events.map((event) => event.type)).toEqual([
      'routed_repair_phase',
      'operator_round',
      'remediation_routed',
      'routed_repair_phase',
      'operator_round',
      'routed_repair_phase',
      'routed_repair_phase',
    ]);
    expect(events[2]).toMatchObject({ type: 'remediation_routed', roundId: 'r1', kind: 'operator', child: 1 });
    expect(events.filter((event) => event.type === 'routed_repair_phase')).toMatchObject([
      { roundId: 'r1', host: 1, child: 1, phase: 'admitted', credit: false },
      { roundId: 'r1', host: 1, child: 1, phase: 'repairing', credit: true },
      { roundId: 'r1', host: 1, child: 1, phase: 'built', credit: false },
      { roundId: 'r1', host: 1, child: 1, phase: 'restacked', credit: false },
    ]);
    const operatorEvents = events.filter((event) => event.type === 'operator_round');
    expect(operatorEvents).toHaveLength(2);
    expect(operatorEvents).toMatchObject([
      { roundId: 'r1', child: 1, origin: 'land', action: 'opened', reason: 'land reviewer edits' },
      { roundId: 'r1', child: 1, origin: 'land', action: 'declared', reason: 'land reviewer edits' },
    ]);
  });
});
