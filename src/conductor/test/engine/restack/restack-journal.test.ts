// Covers: task:1
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import {
  createRestackJournal,
  isJournalOwnerAlive,
  journalRefFor,
  journalStateUpdateLines,
  pinStagingRef,
  readRestackJournal,
  recordRoutedApplyPlan,
  replaceAppliedJournalWithFollowOn,
  stagingRefFor,
  updateRestackChildStatus,
  writeRestackJournalBlob,
  type RestackJournalDraft,
} from '../../../src/engine/restack/restack-journal.js';
import { parseCommitSha, parseRefName, type CommitSha, type RefName, type RestackOpId } from '../../../src/engine/restack/restack-types.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);

function sha(raw: string): CommitSha {
  const value = parseCommitSha(raw);
  if (!value) throw new Error(`invalid sha: ${raw}`);
  return value;
}

function ref(raw: string): RefName {
  const value = parseRefName(raw);
  if (!value) throw new Error(`invalid ref: ${raw}`);
  return value;
}

function child(value: number) {
  const parsed = parseChildId(value);
  if (!parsed) throw new Error(`invalid child: ${value}`);
  return parsed;
}

async function createRepo() {
  const repo = await mkdtemp(join(tmpdir(), 'restack-journal-'));
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  try {
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'restack@example.invalid']);
    await git(['config', 'user.name', 'Restack journal']);
    await writeFile(join(repo, 'base.txt'), 'base\n');
    await git(['add', 'base.txt']);
    await git(['commit', '-qm', 'base']);
    return { repo, git };
  } catch (error) {
    await rm(repo, { recursive: true, force: true });
    throw error;
  }
}

function draft(oldSha: CommitSha, cause: 'feature-repair' | 'base-refresh' = 'feature-repair'): RestackJournalDraft {
  return {
    opId: 'journal-op' as RestackOpId,
    cause,
    committer: { name: 'Journal Committer', email: 'journal@example.test', date: '2030-02-03T04:05:06Z' },
    dirtyPaths: ['local.txt'],
    refs: [{ ref: ref('refs/heads/feat/c1/demo'), oldSha }],
    ranges: [{ child: child(1), oldParent: oldSha, oldTip: oldSha, kind: 'active' }],
    children: [{ child: child(1), status: 'pending' }, { child: child(2), status: 'pending' }],
  };
}

async function readCreated(repo: string, slug = 'demo') {
  const result = await readRestackJournal(repo, slug);
  expect(result.kind).toBe('journal');
  if (result.kind !== 'journal') throw new Error('journal was not readable');
  return result;
}

describe('ref-backed restack journal (real local Git)', () => {
  it('round-trips a routed apply plan and its invalidation set', async () => {
    const fixture = await createRepo();
    try {
      const oldSha = sha((await fixture.git(['rev-parse', 'HEAD'])).stdout.trim());
      const routed = {
        roundId: parseRoundId('r1')!,
        host: child(1),
        routeOld: sha('1111111111111111111111111111111111111111'),
        markerOld: sha('2222222222222222222222222222222222222222'),
        queueOld: sha('3333333333333333333333333333333333333333'),
        routeNew: sha('4444444444444444444444444444444444444444'),
        queueNew: sha('5555555555555555555555555555555555555555'),
      };
      const invalidation = [{ child: child(2), gates: ['test_suite', 'build_review'] as const }];

      expect((await createRestackJournal(fixture.repo, 'demo', { ...draft(oldSha), routed, invalidation })).kind).toBe('created');

      const stored = await readCreated(fixture.repo);
      expect(stored.journal).toMatchObject({ routed, invalidation });
    } finally {
      await rm(fixture.repo, { recursive: true, force: true });
    }
  });

  it('fails closed on malformed routed values', async () => {
    const fixture = await createRepo();
    try {
      const oldSha = sha((await fixture.git(['rev-parse', 'HEAD'])).stdout.trim());
      const routed = {
        roundId: parseRoundId('r1')!,
        host: child(1),
        routeOld: sha('1111111111111111111111111111111111111111'),
        markerOld: sha('2222222222222222222222222222222222222222'),
      };
      expect((await createRestackJournal(fixture.repo, 'demo', { ...draft(oldSha), routed })).kind).toBe('created');
      const stored = await readCreated(fixture.repo);

      for (const malformed of [
        { ...routed, host: 0 },
        { ...routed, routeOld: '1111111' },
        { ...routed, roundId: 'x1' },
      ]) {
        const blob = sha((await makeGitRunner(fixture.repo)(['hash-object', '-w', '--stdin'], {
          input: JSON.stringify({ ...stored.journal, routed: malformed }),
        })).stdout.trim());
        await fixture.git(['update-ref', journalRefFor('demo'), blob]);
        await expect(readRestackJournal(fixture.repo, 'demo')).resolves.toEqual({ kind: 'unreadable', blob });
      }
    } finally {
      await rm(fixture.repo, { recursive: true, force: true });
    }
  });

  it('records a routed apply plan from synced by CAS and refuses a stale journal', async () => {
    const fixture = await createRepo();
    try {
      const oldSha = sha((await fixture.git(['rev-parse', 'HEAD'])).stdout.trim());
      const routed = {
        roundId: parseRoundId('r1')!,
        host: child(1),
        routeOld: sha('1111111111111111111111111111111111111111'),
        markerOld: sha('2222222222222222222222222222222222222222'),
        queueOld: sha('3333333333333333333333333333333333333333'),
      };
      const applyPlan = {
        routeNew: sha('4444444444444444444444444444444444444444'),
        queueNew: sha('5555555555555555555555555555555555555555'),
        invalidation: [{ child: child(2), gates: ['test_suite', 'build_review'] as const }],
      };
      expect((await createRestackJournal(fixture.repo, 'demo', { ...draft(oldSha), routed })).kind).toBe('created');
      const planned = await readCreated(fixture.repo);

      await expect(recordRoutedApplyPlan(fixture.repo, planned, applyPlan)).resolves.toEqual({ kind: 'stale' });
      expect((await fixture.git(['rev-parse', journalRefFor('demo')])).stdout.trim()).toBe(planned.blob);

      const syncedBlob = await writeRestackJournalBlob(fixture.repo, { ...planned.journal, state: 'synced' });
      await fixture.git(['update-ref', journalRefFor('demo'), syncedBlob, planned.blob]);
      const synced = await readCreated(fixture.repo);

      await recordRoutedApplyPlan(fixture.repo, synced, applyPlan);

      const recorded = await readCreated(fixture.repo);
      expect(recorded.journal).toMatchObject({
        routed: { ...routed, routeNew: applyPlan.routeNew, queueNew: applyPlan.queueNew },
        invalidation: applyPlan.invalidation,
      });

      const concurrentBlob = await writeRestackJournalBlob(fixture.repo, {
        ...recorded.journal,
        dirtyPaths: ['changed-by-another-planner'],
      });
      await fixture.git(['update-ref', journalRefFor('demo'), concurrentBlob, recorded.blob]);

      await expect(recordRoutedApplyPlan(fixture.repo, recorded, applyPlan)).resolves.toEqual({ kind: 'stale' });
      expect((await fixture.git(['rev-parse', journalRefFor('demo')])).stdout.trim()).toBe(concurrentBlob);
    } finally {
      await rm(fixture.repo, { recursive: true, force: true });
    }
  });

  it('creates once with a create-only CAS, records a live owner, and refuses competing planners on the event spine', async () => {
    const fixture = await createRepo();
    try {
      const oldSha = sha((await fixture.git(['rev-parse', 'HEAD'])).stdout.trim());
      const events = new ConductorEventEmitter();
      const refused: unknown[] = [];
      events.on('restack_refused', (event) => { refused.push(event); });

      const first = await createRestackJournal(fixture.repo, 'demo', draft(oldSha), events);
      expect(first.kind).toBe('created');
      const stored = await readCreated(fixture.repo);
      const blobBefore = (await fixture.git(['cat-file', 'blob', stored.blob])).stdout;
      expect(stored.journal.owner.host).not.toBe('');
      expect(stored.journal.owner.pid).toBe(process.pid);
      expect(stored.journal.owner.processStartTime).not.toBe('');
      await expect(isJournalOwnerAlive(stored.journal.owner)).resolves.toBe(true);
      await expect(isJournalOwnerAlive({ ...stored.journal.owner, host: 'another-host' })).resolves.toBe(false);
      await expect(isJournalOwnerAlive({ ...stored.journal.owner, processStartTime: 'not-this-process' })).resolves.toBe(false);

      const second = await createRestackJournal(fixture.repo, 'demo', draft(oldSha), events);
      expect(second).toEqual({ kind: 'refused', reason: 'restack-outstanding' });
      expect(refused).toEqual([{ type: 'restack_refused', reason: 'restack-outstanding' }]);
      expect((await fixture.git(['cat-file', 'blob', stored.blob])).stdout).toBe(blobBefore);
      expect((await fixture.git(['rev-parse', journalRefFor('demo')])).stdout.trim()).toBe(stored.blob);
    } finally {
      await rm(fixture.repo, { recursive: true, force: true });
    }
  });

  it('replaces only the exact applied follow-on journal and deletes its staging refs atomically', async () => {
    const fixture = await createRepo();
    try {
      const oldSha = sha((await fixture.git(['rev-parse', 'HEAD'])).stdout.trim());
      const initial = { ...draft(oldSha), followOnCause: 'base-refresh' as const };
      expect((await createRestackJournal(fixture.repo, 'demo', initial)).kind).toBe('created');
      const planned = await readCreated(fixture.repo);
      const applied = { ...planned.journal, state: 'applied' as const };
      const appliedBlob = await writeRestackJournalBlob(fixture.repo, applied);
      await fixture.git(['update-ref', journalRefFor('demo'), appliedBlob, planned.blob]);
      await pinStagingRef(fixture.repo, 'demo', child(1), oldSha);
      const storedApplied = await readCreated(fixture.repo);

      const replacement = await replaceAppliedJournalWithFollowOn(
        fixture.repo,
        'demo',
        storedApplied,
        draft(oldSha, 'base-refresh'),
      );
      expect(replacement.kind).toBe('created');
      expect((await makeGitRunner(fixture.repo)(['rev-parse', '-q', '--verify', stagingRefFor('demo', child(1))])).exitCode).toBe(1);
      const current = await readCreated(fixture.repo);
      expect(current.journal.cause).toBe('base-refresh');

      const competing = await createRestackJournal(fixture.repo, 'demo', draft(oldSha));
      expect(competing).toEqual({ kind: 'refused', reason: 'restack-outstanding' });
    } finally {
      await rm(fixture.repo, { recursive: true, force: true });
    }
  });

  it('produces CAS state-update lines and rejects illegal state transitions', async () => {
    const fixture = await createRepo();
    try {
      const oldSha = sha((await fixture.git(['rev-parse', 'HEAD'])).stdout.trim());
      expect((await createRestackJournal(fixture.repo, 'demo', draft(oldSha))).kind).toBe('created');
      const stored = await readCreated(fixture.repo);
      const readyBlob = await writeRestackJournalBlob(fixture.repo, { ...stored.journal, state: 'ready' });

      expect(journalStateUpdateLines(stored, readyBlob, 'ready')).toEqual([
        `update ${journalRefFor('demo')} ${readyBlob} ${stored.blob}`,
      ]);
      expect(() => journalStateUpdateLines(stored, readyBlob, 'synced')).toThrow('illegal restack journal transition');
    } finally {
      await rm(fixture.repo, { recursive: true, force: true });
    }
  });

  it('fails closed on unreadable blobs and keeps staged commits reachable through pruning', async () => {
    const fixture = await createRepo();
    try {
      const malformedResult = await makeGitRunner(fixture.repo)(['hash-object', '-w', '--stdin'], { input: '{not-json' });
      const malformed = sha(malformedResult.stdout.trim());
      await fixture.git(['update-ref', journalRefFor('demo'), malformed, '']);
      expect(await readRestackJournal(fixture.repo, 'demo')).toEqual({ kind: 'unreadable', blob: malformed });

      await fixture.git(['checkout', '-qb', 'orphaned']);
      await writeFile(join(fixture.repo, 'orphan.txt'), 'pinned\n');
      await fixture.git(['add', 'orphan.txt']);
      await fixture.git(['commit', '-qm', 'orphaned']);
      const orphaned = sha((await fixture.git(['rev-parse', 'HEAD'])).stdout.trim());
      await fixture.git(['checkout', '-q', 'main']);
      await fixture.git(['branch', '-D', 'orphaned']);
      await pinStagingRef(fixture.repo, 'demo', child(2), orphaned);
      await fixture.git(['reflog', 'expire', '--expire=now', '--all']);
      await fixture.git(['gc', '--prune=now']);
      await expect(fixture.git(['cat-file', '-e', `${orphaned}^{commit}`])).resolves.toBeDefined();
    } finally {
      await rm(fixture.repo, { recursive: true, force: true });
    }
  });

  it('changes one planned child and pins its staged tip in one CAS transaction', async () => {
    const fixture = await createRepo();
    try {
      const oldSha = sha((await fixture.git(['rev-parse', 'HEAD'])).stdout.trim());
      expect((await createRestackJournal(fixture.repo, 'demo', draft(oldSha))).kind).toBe('created');
      const stored = await readCreated(fixture.repo);

      const changed = await updateRestackChildStatus(fixture.repo, 'demo', stored, child(2), 'replayed', oldSha, new Map([[oldSha, oldSha]]));
      expect(changed.kind).toBe('updated');
      const after = await readCreated(fixture.repo);
      expect(after.journal.state).toBe('planned');
      expect(after.journal.children).toContainEqual({ child: child(2), status: 'replayed', rewrites: [{ from: oldSha, to: oldSha }] });
      expect((await fixture.git(['rev-parse', stagingRefFor('demo', child(2))])).stdout.trim()).toBe(oldSha);

      const stale = after;
      const concurrentBlob = await writeRestackJournalBlob(fixture.repo, {
        ...after.journal,
        dirtyPaths: ['changed-by-another-planner'],
      });
      await fixture.git(['update-ref', journalRefFor('demo'), concurrentBlob, stale.blob]);
      const failed = await updateRestackChildStatus(fixture.repo, 'demo', stale, child(1), 'resolved', oldSha, new Map());
      expect(failed).toEqual({ kind: 'stale' });
      expect((await makeGitRunner(fixture.repo)(['rev-parse', '-q', '--verify', stagingRefFor('demo', child(1))])).exitCode).toBe(1);
    } finally {
      await rm(fixture.repo, { recursive: true, force: true });
    }
  });
});
