// Covers: task:48
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { leafBranchFor } from '../../../src/engine/feature-branch-identity.js';
import { readKickbackLedger } from '../../../src/engine/kickback-ledger.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { writeFrozenBlocks } from '../../../src/engine/remediation-append.js';
import { enterHostRegion } from '../../../src/engine/routing/host-region-entry.js';
import { admitRound } from '../../../src/engine/routing/round-admission.js';
import { createRouteRecord, readRouteRecord, writeRoutingTransaction } from '../../../src/engine/routing/route-record-store.js';
import { closureRefFor } from '../../../src/engine/routing/routing-refs.js';
import { parseRoundId, type RouteRecord } from '../../../src/engine/routing/route-types.js';
import { writeRestackJournalBlob, type RestackJournal } from '../../../src/engine/restack/restack-journal.js';
import type { RestackOpId } from '../../../src/engine/restack/restack-types.js';
import { seedTaskStatus } from '../../../src/engine/task-seed.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const child = parseChildId(1)!;
const roundId = parseRoundId('r1')!;
const planPath = '.docs/plans/demo.md';
const roots: string[] = [];

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(kind: RouteRecord['kind'] = 'audit') {
  const repo = await mkdtemp(join(tmpdir(), 'host-region-entry-'));
  roots.push(repo);
  const git = makeGitRunner(repo);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'host-region@example.invalid']);
  await git(['config', 'user.name', 'Host region']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await mkdir(join(repo, '.docs', 'plans'), { recursive: true });
  await writeFile(join(repo, planPath), '### Task T1: Existing work\n');
  await git(['add', '.gitignore', planPath]);
  await git(['commit', '-qm', 'ignore pipeline']);
  await git(['checkout', '-qb', 'feat/c1/demo']);
  await writeFile(join(repo, 'child.txt'), 'closed child\n');
  await git(['add', 'child.txt']);
  await git(['commit', '-qm', 'closed child']);
  const closure = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await git(['update-ref', closureRefFor('demo', child), closure]);
  await git(['checkout', '-qb', leafBranchFor('demo')]);
  await writeFile(join(repo, 'leaf.txt'), 'leaf\n');
  await git(['add', 'leaf.txt']);
  await git(['commit', '-qm', 'leaf']);
  await mkdir(join(repo, '.pipeline', 'children', '1'), { recursive: true });
  await writeFile(join(repo, '.pipeline', 'conduct-state.json'), JSON.stringify({ feature_desc: 'demo' }));
  await writeFile(join(repo, '.pipeline', 'children', '1', 'conduct-state.json'), JSON.stringify({
    acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
  }));
  const created = await createRouteRecord(repo, 'demo', {
    roundId, kind,
    items: [{ findingId: 'finding', kind, owner: child, host: child, reason: 'task-slice', fallback: [] }],
    allocation: { [child]: {
      remTaskIds: ['rem-prd-audit-T1'],
      blockBodies: [
        '### Task rem-prd-audit-T1: Repair routed task\n' +
        '**Child:** 1\n' +
        '**Round:** r1\n',
      ],
    } },
  });
  if (created.kind !== 'created') throw new Error(`create route record: ${created.kind}`);
  const admitted = await admitRound(repo, 'demo', created.record, child, { git });
  if (admitted.kind !== 'admitted') throw new Error(`admit route record: ${admitted.detail}`);
  return { repo, git, closure };
}

function entered(subject: Awaited<ReturnType<typeof fixture>>, git: GitRunner = subject.git) {
  return enterHostRegion({
    worktree: subject.repo, slug: 'demo', roundId, host: child,
    emitter: new ConductorEventEmitter(), git, planPath,
  });
}

describe('routed host region entry (real local Git)', () => {
  // Covers: task:48
  it('pins the closed host base before switching and restages only its region', async () => {
    const subject = await fixture();
    const calls: Array<{ readonly args: readonly string[]; readonly input?: string }> = [];
    const traced: GitRunner = async (args, options) => {
      calls.push({ args, input: options?.input });
      return subject.git(args, options);
    };

    await expect(entered(subject, traced)).resolves.toMatchObject({ kind: 'entered', pinnedBase: subject.closure });
    await expect(subject.git(['symbolic-ref', '--short', 'HEAD'])).resolves.toMatchObject({ stdout: 'feat/c1/demo' });
    await expect(readFile(join(subject.repo, '.pipeline', 'children', '1', 'conduct-state.json'), 'utf8').then(JSON.parse))
      .resolves.toMatchObject({ acceptance_specs: 'pending', build: 'pending', test_suite: 'pending', build_review: 'pending' });
    await expect(readRouteRecord(subject.repo, 'demo', roundId)).resolves.toMatchObject({
      kind: 'record', record: { hosts: { 1: 'repairing' }, entry: { pinnedBase: subject.closure } },
    });
    const pin = calls.findIndex((call) => call.args[0] === 'update-ref' && call.args[1] === '--stdin');
    const switchCall = calls.findIndex((call) => call.args[0] === 'switch');
    expect(pin).toBeGreaterThanOrEqual(0);
    expect(switchCall).toBeGreaterThan(pin);
    expect(calls.some((call) => call.args[0] === 'commit')).toBe(false);
  });

  // Covers: task:48
  it('keeps an admitted host untouched on a dirty-tree refusal and reuses a crash-surviving pin', async () => {
    const subject = await fixture();
    await writeFile(join(subject.repo, 'dirty.txt'), 'uncommitted\n');
    await expect(entered(subject)).resolves.toMatchObject({ kind: 'refused', detail: expect.stringContaining('dirty.txt') });
    await expect(readRouteRecord(subject.repo, 'demo', roundId)).resolves.toMatchObject({
      kind: 'record', record: { hosts: { 1: 'admitted' }, entry: { pinnedBase: subject.closure } },
    });
    await subject.git(['clean', '-fq']);

    const second = await fixture();
    let pinned = false;
    const crashing: GitRunner = async (args, options) => {
      const result = await second.git(args, options);
      if (!pinned && args[0] === 'update-ref' && args[1] === '--stdin') pinned = true;
      if (pinned && args[0] === 'symbolic-ref') throw new Error('crash after pin');
      return result;
    };
    await expect(entered(second, crashing)).resolves.toMatchObject({ kind: 'refused', detail: 'cannot determine current branch before host switch' });
    const afterCrash = await readRouteRecord(second.repo, 'demo', roundId);
    if (afterCrash.kind !== 'record') throw new Error('missing record after crash');
    await expect(entered(second)).resolves.toMatchObject({ kind: 'entered', pinnedBase: afterCrash.record.entry?.pinnedBase });
    await expect(readRouteRecord(second.repo, 'demo', roundId)).resolves.toMatchObject({
      kind: 'record', record: { entry: { pinnedBase: afterCrash.record.entry?.pinnedBase } },
    });
  });

  // Covers: task:48
  it('switches a repairing host to its branch and returns resume without restaging or committing', async () => {
    const subject = await fixture();
    await expect(entered(subject)).resolves.toMatchObject({ kind: 'entered' });
    const stored = await readRouteRecord(subject.repo, 'demo', roundId);
    if (stored.kind !== 'record') throw new Error('missing record');
    const repairing: RouteRecord = { ...stored.record, hosts: { ...stored.record.hosts, [child]: 'repairing' } };
    await expect(writeRoutingTransaction(subject.repo, 'demo', [{ kind: 'update-record', previous: stored, record: repairing }]))
      .resolves.toEqual({ kind: 'updated' });
    const before = await readFile(join(subject.repo, '.pipeline', 'children', '1', 'conduct-state.json'), 'utf8');
    const commits = (await subject.git(['rev-list', '--count', 'HEAD'])).stdout;
    await subject.git(['switch', leafBranchFor('demo')]);

    await expect(entered(subject)).resolves.toMatchObject({ kind: 'resume', pinnedBase: subject.closure });
    await expect(subject.git(['symbolic-ref', '--short', 'HEAD'])).resolves.toMatchObject({ stdout: 'feat/c1/demo' });
    await expect(readFile(join(subject.repo, '.pipeline', 'children', '1', 'conduct-state.json'), 'utf8')).resolves.toBe(before);
    await expect(subject.git(['rev-list', '--count', 'HEAD'])).resolves.toMatchObject({ stdout: commits });
  });

  // Covers: task:48
  it('refuses the deferred revalidate restage and any non-terminal restack journal', async () => {
    const revalidate = await fixture('revalidate');
    await expect(entered(revalidate)).resolves.toMatchObject({ kind: 'refused', detail: expect.stringContaining('#3212') });

    const subject = await fixture();
    const journal: RestackJournal = {
      opId: 'host-region-entry' as RestackOpId, cause: 'feature-repair',
      committer: { name: 'Host region', email: 'host-region@example.invalid', date: '2030-01-01T00:00:00Z' },
      dirtyPaths: [], refs: [], ranges: [], children: [], state: 'moved',
      owner: { host: 'test', pid: 1, processStartTime: '1' },
    };
    const blob = await writeRestackJournalBlob(subject.repo, journal, { git: subject.git });
    await subject.git(['update-ref', 'refs/conductor/demo/restack/journal', blob]);
    await expect(entered(subject)).resolves.toMatchObject({ kind: 'refused', detail: expect.stringContaining('non-terminal') });
    const untouched = await readRouteRecord(subject.repo, 'demo', roundId);
    expect(untouched).toMatchObject({ kind: 'record' });
    if (untouched.kind === 'record') expect(untouched.record).not.toHaveProperty('entry');
  });

  // Covers: task:49
  it('writes the frozen body verbatim, seeds it, and moves the host to repairing after its append commit', async () => {
    const subject = await fixture();

    await expect(entered(subject)).resolves.toMatchObject({ kind: 'entered' });

    const plan = await readFile(join(subject.repo, planPath), 'utf8');
    const body = '### Task rem-prd-audit-T1: Repair routed task\n**Child:** 1\n**Round:** r1\n';
    expect(plan).toContain(body);
    await expect(subject.git(['show', '-s', '--format=%(trailers:key=Round,valueonly)', 'HEAD']))
      .resolves.toMatchObject({ stdout: 'r1\n' });
    await expect(readFile(join(subject.repo, '.pipeline', 'task-status.json'), 'utf8').then(JSON.parse))
      .resolves.toMatchObject({ tasks: expect.arrayContaining([expect.objectContaining({ id: 'rem-prd-audit-T1', status: 'pending' })]) });
    const record = await readRouteRecord(subject.repo, 'demo', roundId);
    expect(record).toMatchObject({ kind: 'record', record: { hosts: { 1: 'repairing' } } });
    if (record.kind !== 'record') throw new Error('missing route record');
    expect(record.record.outbox).toContainEqual(expect.objectContaining({
      event: expect.objectContaining({ type: 'routed_repair_phase', phase: 'repairing', credit: true }),
    }));
    await expect(readKickbackLedger(subject.repo, child)).resolves.toMatchObject({
      routedRepairCredit: { roundId: 'r1' },
    });
  });

  // Covers: task:49
  it('replays identical frozen blocks without appending or committing, and refuses an unallocated body', async () => {
    const subject = await fixture();
    const stored = await readRouteRecord(subject.repo, 'demo', roundId);
    if (stored.kind !== 'record') throw new Error('missing record');
    const allocation = stored.record.allocation[child]!;
    const first = await writeFrozenBlocks({ worktree: subject.repo, planPath, roundId, host: child, allocation, slug: 'demo', git: subject.git });
    expect(first).toMatchObject({ kind: 'written' });
    const head = (await subject.git(['rev-parse', 'HEAD'])).stdout;
    const before = await readFile(join(subject.repo, planPath), 'utf8');

    await expect(writeFrozenBlocks({ worktree: subject.repo, planPath, roundId, host: child, allocation, slug: 'demo', git: subject.git }))
      .resolves.toMatchObject({ kind: 'noop' });
    await expect(readFile(join(subject.repo, planPath), 'utf8')).resolves.toBe(before);
    await expect(subject.git(['rev-parse', 'HEAD'])).resolves.toMatchObject({ stdout: head });

    await expect(writeFrozenBlocks({
      worktree: subject.repo, planPath, roundId, host: child, slug: 'demo', git: subject.git,
      allocation: { remTaskIds: ['rem-prd-audit-T1'], blockBodies: ['### Task rem-prd-audit-other: Wrong allocation\n'] },
    })).resolves.toMatchObject({ kind: 'refused', detail: expect.stringContaining('rem-prd-audit-other') });
  });

  // Covers: task:49
  it('restores the plan when the guarded append is refused by a moving restack journal', async () => {
    const subject = await fixture();
    const stored = await readRouteRecord(subject.repo, 'demo', roundId);
    if (stored.kind !== 'record') throw new Error('missing record');
    const beforePlan = await readFile(join(subject.repo, planPath), 'utf8');
    const journal: RestackJournal = {
      opId: 'frozen-append' as RestackOpId, cause: 'feature-repair',
      committer: { name: 'Host region', email: 'host-region@example.invalid', date: '2030-01-01T00:00:00Z' },
      dirtyPaths: [], refs: [], ranges: [], children: [], state: 'moved',
      owner: { host: 'test', pid: 1, processStartTime: '1' },
    };
    const blob = await writeRestackJournalBlob(subject.repo, journal, { git: subject.git });
    await subject.git(['update-ref', 'refs/conductor/demo/restack/journal', blob]);

    await expect(writeFrozenBlocks({
      worktree: subject.repo, planPath, roundId, host: child, slug: 'demo',
      allocation: stored.record.allocation[child]!, git: subject.git,
    })).resolves.toMatchObject({ kind: 'refused', detail: expect.stringContaining('restack journal') });
    await expect(readFile(join(subject.repo, planPath), 'utf8')).resolves.toBe(beforePlan);
    await expect(readRouteRecord(subject.repo, 'demo', roundId)).resolves.toMatchObject({ blob: stored.blob });
  });

  // Covers: task:50
  it('halts an admitted host on a conflicting frozen block without allocating a second id', async () => {
    const subject = await fixture();
    await subject.git(['switch', 'feat/c1/demo']);
    await writeFile(join(subject.repo, planPath), [
      '### Task T1: Existing work',
      '### Task rem-prd-audit-T1: Conflicting local rewrite',
      '**Child:** 1',
      '**Round:** r1',
      '',
    ].join('\n'));
    await subject.git(['add', planPath]);
    await subject.git(['commit', '-qm', 'add conflicting frozen block']);
    const childHead = (await subject.git(['rev-parse', 'HEAD'])).stdout;
    await subject.git(['switch', leafBranchFor('demo')]);

    await expect(entered(subject)).resolves.toMatchObject({
      kind: 'halted', detail: expect.stringContaining('rem-prd-audit-T1'),
    });
    await expect(readRouteRecord(subject.repo, 'demo', roundId)).resolves.toMatchObject({
      kind: 'record', record: { hosts: { 1: 'admitted' } },
    });
    await expect(subject.git(['rev-parse', 'feat/c1/demo'])).resolves.toMatchObject({ stdout: childHead });
    await expect(readFile(join(subject.repo, planPath), 'utf8')).resolves.not.toContain('rem-prd-audit-T1-2');
  });

  // Covers: task:50
  it('halts an admitted host and leaves no later region transition when its append commit is rejected', async () => {
    const subject = await fixture();
    const hook = join(subject.repo, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\nexit 1\n');
    await chmod(hook, 0o755);

    await expect(entered(subject)).resolves.toMatchObject({
      kind: 'halted', detail: expect.stringContaining('pre-commit hook failed'),
    });
    await expect(readRouteRecord(subject.repo, 'demo', roundId)).resolves.toMatchObject({
      kind: 'record', record: { hosts: { 1: 'admitted' } },
    });
    await expect(readFile(join(subject.repo, '.docs', 'plans', 'demo.md'), 'utf8'))
      .resolves.not.toContain('### Task rem-prd-audit-T1:');
  });

  // Covers: task:50
  it('writes a single-host round on the leaf and pins the pre-append leaf tip', async () => {
    const subject = await fixture();
    const leafTip = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim();
    await subject.git(['update-ref', '-d', closureRefFor('demo', child)]);

    await expect(entered(subject)).resolves.toMatchObject({ kind: 'entered', pinnedBase: leafTip });
    await expect(subject.git(['symbolic-ref', '--short', 'HEAD']))
      .resolves.toMatchObject({ stdout: leafBranchFor('demo') });
    await expect(readRouteRecord(subject.repo, 'demo', roundId)).resolves.toMatchObject({
      kind: 'record', record: { entry: { pinnedBase: leafTip }, hosts: { 1: 'repairing' } },
    });
    await expect(readFile(join(subject.repo, planPath), 'utf8')).resolves.toContain('### Task rem-prd-audit-T1:');
  });

  // Covers: task:47
  it('converges after every durable region-entry boundary without duplicating frozen tasks', async () => {
    const resumeAfter = async (boundary: 'pin' | 'append' | 'seed' | 'repairing') => {
      const subject = await fixture();
      const stored = await readRouteRecord(subject.repo, 'demo', roundId);
      if (stored.kind !== 'record') throw new Error('missing record');
      const allocation = stored.record.allocation[child]!;

      if (boundary === 'pin') {
        const crashing: GitRunner = async (args, options) => {
          const result = await subject.git(args, options);
          if (args[0] === 'update-ref' && args[1] === '--stdin') throw new Error('crash after entry pin');
          return result;
        };
        await expect(entered(subject, crashing)).resolves.toMatchObject({ kind: 'refused' });
      } else {
        await expect(writeFrozenBlocks({
          worktree: subject.repo, planPath, roundId, host: child, allocation, slug: 'demo', git: subject.git,
        })).resolves.toMatchObject({ kind: 'written' });
        if (boundary === 'seed' || boundary === 'repairing') {
          await seedTaskStatus(subject.repo, planPath, undefined, { childBase: { slug: 'demo', child } });
        }
        if (boundary === 'repairing') await expect(entered(subject)).resolves.toMatchObject({ kind: 'entered' });
      }

      await expect(entered(subject)).resolves.toMatchObject({ kind: boundary === 'repairing' ? 'resume' : 'entered' });
      await expect(readRouteRecord(subject.repo, 'demo', roundId)).resolves.toMatchObject({
        kind: 'record', record: { hosts: { 1: 'repairing' } },
      });
      await expect(readFile(join(subject.repo, planPath), 'utf8').then((plan) =>
        plan.match(/^### Task rem-prd-audit-T1:/gm),
      )).resolves.toHaveLength(1);
      await expect(subject.git(['for-each-ref', '--format=%(refname)', 'refs/conductor/demo/routes/']))
        .resolves.toMatchObject({ stdout: 'refs/conductor/demo/routes/r1' });
    };

    for (const boundary of ['pin', 'append', 'seed', 'repairing'] as const) await resumeAfter(boundary);
  });

  // Covers: task:56
  it('halts an audit host only when its host-local BUILD projection is already complete', async () => {
    const subject = await fixture();
    const checkCompletion = async (_dir: string, step: string, context: { activeChild?: number }) => {
      expect(step).toBe('build');
      expect(context.activeChild).toBe(child);
      return { done: true };
    };

    await expect(enterHostRegion({
      worktree: subject.repo, slug: 'demo', roundId, host: child,
      emitter: new ConductorEventEmitter(), git: subject.git, planPath, checkCompletion,
    })).resolves.toMatchObject({ kind: 'halted', outcome: 'derived-already-complete' });
    await expect(readRouteRecord(subject.repo, 'demo', roundId)).resolves.toMatchObject({
      kind: 'record', record: { hosts: { 1: 'admitted' } },
    });
  });

  // Covers: task:56
  it('does not halt an audit host when its frozen task remains dispatchable', async () => {
    const subject = await fixture();
    const checkCompletion = async () => ({ done: false, reason: 'rem-prd-audit-T1 is pending' });

    await expect(enterHostRegion({
      worktree: subject.repo, slug: 'demo', roundId, host: child,
      emitter: new ConductorEventEmitter(), git: subject.git, planPath, checkCompletion,
    })).resolves.toMatchObject({ kind: 'entered' });
    await expect(readRouteRecord(subject.repo, 'demo', roundId)).resolves.toMatchObject({
      kind: 'record', record: { hosts: { 1: 'repairing' } },
    });
  });
});
