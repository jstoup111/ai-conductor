// Covers: task:16
// A planned fold has a source-to-placement plan, not generic replay ranges.
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import {
  createRestackJournal,
  journalRefFor,
  readRestackJournal,
  writeRestackJournalBlob,
  type RestackJournal,
} from '../../../src/engine/restack/restack-journal.js';
import { recoverRestackJournal } from '../../../src/engine/restack/restack-recovery.js';
import { createRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import type { FoldCommitPlan } from '../../../src/engine/restack/fold-types.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import type { CommitSha, RestackOpId } from '../../../src/engine/restack/restack-types.js';
import { writeSliceTopologyFixture } from '../slice-topology-fixture.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const DEAD_OWNER = { host: 'dead-fold-recovery-host', pid: 1, processStartTime: '0' } as const;

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

function child(value: number) {
  const parsed = parseChildId(value);
  if (!parsed) throw new Error(`invalid child ${value}`);
  return parsed;
}

async function fixture(options: { readonly stampedOwner?: boolean } = {}) {
  const repo = await mkdtemp(join(tmpdir(), 'restack-fold-recovery-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, path: string, content: string): Promise<CommitSha> => {
    await writeFile(join(repo, path), content);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim() as CommitSha;
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'fold-recovery@example.test']);
  await git(['config', 'user.name', 'Fold recovery']);
  const base = await commit('base', 'base.txt', 'base\n');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const c1 = await commit('child one', 'one.txt', 'one\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
  await git(['checkout', '-qb', 'feat/c2/demo']);
  const c2 = await commit('child two', 'two.txt', 'two\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c2', c2]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  const foldedSource = await commit(
    options.stampedOwner ? 'deferred repair\n\nRound: r1\nOwner: c1' : 'deferred repair',
    'deferred.txt',
    'deferred\n',
  );
  const leaf = await commit('leaf build', 'leaf.txt', 'leaf\n');
  const route = await createRouteRecord(repo, 'demo', {
    roundId: parseRoundId('r1')!, kind: 'audit', sealedAuthored: 1, execution: 'leaf',
    items: [{ findingId: 'finding-c1', kind: 'audit', owner: child(1), host: child(1), reason: 'repair', fallback: [] }],
    allocation: { [child(1)]: { remTaskIds: [], blockBodies: [] } },
    placements: { [child(1)]: { state: 'deferred', leafEntryTip: c2, exitTip: foldedSource } },
  }, { git: makeGitRunner(repo) });
  if (route.kind !== 'created') throw new Error(`could not create deferred fold route: ${route.kind}`);
  await writeSliceTopologyFixture(repo, {
    version: 1, slug: 'demo', runId: 'fold-run', status: 'done', entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2, '3': 3 }, titles: ['Child 1', 'Child 2', 'Leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  });
  return { repo, git, base, c1, c2, foldedSource, leaf };
}

async function snapshot(git: (args: string[]) => Promise<{ stdout: string }>) {
  const refs = [
    'refs/heads/feat/c1/demo',
    'refs/conductor/demo/closed/c1',
    'refs/heads/feat/c2/demo',
    'refs/conductor/demo/closed/c2',
    'refs/heads/feat/daemon-demo',
  ];
  return Object.fromEntries(await Promise.all(refs.map(async (name) => [name, (await git(['rev-parse', name])).stdout.trim()])));
}

describe('planned fold recovery (real local Git)', () => {
  it('rolls every ref back rather than generically replaying an interrupted FoldPlan', async () => {
    const subject = await fixture();
    const before = await snapshot(subject.git);
    const foldPlan: readonly FoldCommitPlan[] = [{
      sha: subject.foldedSource,
      roundId: parseRoundId('r1')!,
      owner: child(1),
      parts: [{ kind: 'whole', child: child(1), paths: [], reason: 'owner' }],
    }];
    const created = await createRestackJournal(subject.repo, 'demo', {
      opId: 'planned-fold-recovery' as RestackOpId,
      cause: 'fold',
      foldPlan,
      committer: { name: 'Fold recovery', email: 'fold-recovery@example.test', date: '2030-01-02T03:04:05Z' },
      dirtyPaths: [],
      refs: Object.entries(before).map(([ref, oldSha]) => ({ ref: ref as never, oldSha: oldSha as CommitSha })),
      ranges: [
        { child: child(1), oldParent: subject.base, oldTip: subject.c1, kind: 'closed' },
        { child: child(2), oldParent: subject.c1, oldTip: subject.c2, kind: 'closed' },
        { child: child(3), oldParent: subject.c2, oldTip: subject.leaf, kind: 'leaf-active' },
      ],
      children: [child(1), child(2), child(3)].map((value) => ({ child: value, status: 'pending' as const })),
    }, undefined, { git: makeGitRunner(subject.repo) });
    if (created.kind !== 'created') throw new Error(`could not create planned fold journal: ${created.kind}`);

    // The journal write is durable; process death happens before staging or a move.
    const abandoned: RestackJournal = { ...created.journal.journal, owner: DEAD_OWNER };
    const abandonedBlob = await writeRestackJournalBlob(subject.repo, abandoned, { git: makeGitRunner(subject.repo) });
    await subject.git(['update-ref', journalRefFor('demo'), abandonedBlob, created.journal.blob]);

    await expect(recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) }))
      .resolves.toEqual({ kind: 'recovered', fromState: 'planned' });

    expect(await snapshot(subject.git)).toEqual(before);
    expect(await readRestackJournal(subject.repo, 'demo')).toEqual({ kind: 'missing' });
    expect((await subject.git(['log', '--format=%B', 'feat/c1/demo', 'feat/daemon-demo'])).stdout)
      .not.toContain('Folded-from:');
  });

  it('leaves every ref untouched when a fold refuses its invalid owner before moving', async () => {
    const subject = await fixture();
    const before = await snapshot(subject.git);

    await expect(runRestack({ worktree: subject.repo, slug: 'demo', cause: 'fold', git: makeGitRunner(subject.repo) }))
      .resolves.toMatchObject({ kind: 'halted' });

    expect(await snapshot(subject.git)).toEqual(before);
    await expect(recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) }))
      .resolves.not.toMatchObject({ kind: 'live-owner' });
  });

  it('aborts its journal and leaves every ref untouched when the folded leaf tree differs', async () => {
    const subject = await fixture({ stampedOwner: true });
    const before = await snapshot(subject.git);
    const native = makeGitRunner(subject.repo);
    const mismatchedTree = async (...args: Parameters<typeof native>) => {
      const result = await native(...args);
      if (args[0][0] === 'rev-parse' && args[0][1]?.endsWith('^{tree}') && args[0][1] !== `${subject.leaf}^{tree}`) {
        return { ...result, stdout: `${subject.base}\n` };
      }
      return result;
    };

    await expect(runRestack({ worktree: subject.repo, slug: 'demo', cause: 'fold', git: mismatchedTree }))
      .resolves.toMatchObject({ kind: 'halted' });

    expect(await snapshot(subject.git)).toEqual(before);
    await expect(recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) }))
      .resolves.not.toMatchObject({ kind: 'live-owner' });
  });

  it('rolls back every ref and releases its journal when fold move verification fails', async () => {
    const subject = await fixture({ stampedOwner: true });
    const before = await snapshot(subject.git);
    const native = makeGitRunner(subject.repo);
    let moved = false;
    const verificationFailure = async (...args: Parameters<typeof native>) => {
      const result = await native(...args);
      if (args[0][0] === 'update-ref' && args[0][1] === '--stdin' && args[1]?.input?.includes('update refs/heads/feat/c1/demo ')) moved = true;
      if (moved && args[0].join(' ') === 'rev-parse --verify refs/heads/feat/c1/demo') {
        return { ...result, stdout: `${subject.c1}\n` };
      }
      return result;
    };

    await expect(runRestack({ worktree: subject.repo, slug: 'demo', cause: 'fold', git: verificationFailure }))
      .resolves.toMatchObject({ kind: 'halted' });

    expect(await snapshot(subject.git)).toEqual(before);
    await expect(recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) }))
      .resolves.not.toMatchObject({ kind: 'live-owner' });
  });
});
