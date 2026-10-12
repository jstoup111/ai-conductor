import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { EventPersister } from '../../../src/engine/event-persister.js';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import {
  createRestackJournal,
  journalRefFor,
  pinStagingRef,
  readRestackJournal,
  writeRestackJournalBlob,
  type RestackJournalDraft,
  type StoredRestackJournal,
} from '../../../src/engine/restack/restack-journal.js';
import {
  applyRestackMove,
  haltRestack,
  type RestackMoveRef,
} from '../../../src/engine/restack/restack-move.js';
import { parseCommitSha, parseRefName, type CommitSha, type RefName, type RestackOpId } from '../../../src/engine/restack/restack-types.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const repos: string[] = [];

afterEach(async () => {
  await Promise.all(repos.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

function sha(raw: string): CommitSha {
  const value = parseCommitSha(raw);
  if (!value) throw new Error(`invalid SHA ${raw}`);
  return value;
}

function ref(raw: string): RefName {
  const value = parseRefName(raw);
  if (!value) throw new Error(`invalid ref ${raw}`);
  return value;
}

function child(value: number) {
  const parsed = parseChildId(value);
  if (!parsed) throw new Error(`invalid child ${value}`);
  return parsed;
}

async function createFixture() {
  const repo = await mkdtemp(join(tmpdir(), 'restack-move-sweep-'));
  repos.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.invalid']);
  await git(['config', 'user.name', 'Restack move']);
  await writeFile(join(repo, 'base.txt'), 'base\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  const base = sha((await git(['rev-parse', 'HEAD'])).stdout.trim());

  await git(['checkout', '-qb', 'feat/c1/demo']);
  await writeFile(join(repo, 'c1.txt'), 'old c1\n');
  await git(['add', 'c1.txt']);
  await git(['commit', '-qm', 'old c1']);
  const oldC1 = sha((await git(['rev-parse', 'HEAD'])).stdout.trim());
  await git(['checkout', '-qb', 'feat/c2/demo']);
  await writeFile(join(repo, 'c2.txt'), 'old c2\n');
  await git(['add', 'c2.txt']);
  await git(['commit', '-qm', 'old c2']);
  const oldC2 = sha((await git(['rev-parse', 'HEAD'])).stdout.trim());
  await git(['update-ref', 'refs/conductor/demo/closed/c1', oldC1]);
  await git(['update-ref', 'refs/conductor/demo/closed/c2', oldC2]);

  await git(['checkout', '-q', 'main']);
  await git(['checkout', '-qb', 'new-c1', 'main']);
  await writeFile(join(repo, 'c1.txt'), 'new c1\n');
  await git(['add', 'c1.txt']);
  await git(['commit', '-qm', 'new c1']);
  const newC1 = sha((await git(['rev-parse', 'HEAD'])).stdout.trim());
  await git(['checkout', '-qb', 'new-c2']);
  await writeFile(join(repo, 'c2.txt'), 'new c2\n');
  await git(['add', 'c2.txt']);
  await git(['commit', '-qm', 'new c2']);
  const newC2 = sha((await git(['rev-parse', 'HEAD'])).stdout.trim());
  await git(['checkout', '-q', 'main']);

  const refs = [
    { ref: ref('refs/heads/feat/c1/demo'), oldSha: oldC1 },
    { ref: ref('refs/conductor/demo/closed/c1'), oldSha: oldC1 },
    { ref: ref('refs/heads/feat/c2/demo'), oldSha: oldC2 },
    { ref: ref('refs/conductor/demo/closed/c2'), oldSha: oldC2 },
  ];
  const draft: RestackJournalDraft = {
    opId: 'move-op' as RestackOpId,
    cause: 'feature-repair',
    committer: { name: 'Restack', email: 'restack@example.invalid', date: '2030-01-01T00:00:00Z' },
    dirtyPaths: [],
    refs,
    ranges: [
      { child: child(1), oldParent: base, oldTip: oldC1, kind: 'closed' },
      { child: child(2), oldParent: oldC1, oldTip: oldC2, kind: 'closed' },
    ],
    children: [{ child: child(1), status: 'replayed' }, { child: child(2), status: 'replayed' }],
  };
  const created = await createRestackJournal(repo, 'demo', draft);
  if (created.kind !== 'created') throw new Error('journal was not created');
  await pinStagingRef(repo, 'demo', child(1), newC1);
  await pinStagingRef(repo, 'demo', child(2), newC2);
  const readyBlob = await writeRestackJournalBlob(repo, { ...created.journal.journal, state: 'ready' });
  await git(['update-ref', journalRefFor('demo'), readyBlob, created.journal.blob]);
  const stored = await readRestackJournal(repo, 'demo');
  if (stored.kind !== 'journal') throw new Error('journal was not ready');
  const moves: readonly RestackMoveRef[] = [
    { ref: refs[0].ref, oldSha: oldC1, newSha: newC1, child: child(1) },
    { ref: refs[1].ref, oldSha: oldC1, newSha: newC1, child: child(1) },
    { ref: refs[2].ref, oldSha: oldC2, newSha: newC2, child: child(2) },
    { ref: refs[3].ref, oldSha: oldC2, newSha: newC2, child: child(2) },
  ];
  return { repo, git, stored, refs, moves, newC1, newC2 };
}

async function journal(repo: string): Promise<StoredRestackJournal> {
  const found = await readRestackJournal(repo, 'demo');
  if (found.kind !== 'journal') throw new Error('journal missing');
  return found;
}


async function refValues(git: (args: string[]) => Promise<{ stdout: string }>, names: readonly string[]): Promise<string[]> {
  return Promise.all(names.map(async (name) => (await git(['rev-parse', name])).stdout.trim()));
}

function recordRefusals(events: ConductorEventEmitter): unknown[] {
  const records: unknown[] = [];
  events.on('restack_refused', (event) => { records.push(event); });
  return records;
}

describe('journaled restack move (sweep G1, real local Git)', () => {
  // Covers: S4.1, S4.2, task:7
  it('moves every branch, closure ref and the ready journal to moved in one transaction, and a lock on any single ref leaves every ref old', async () => {
    const fixture = await createFixture();
    const transactions: string[] = [];
    const git = makeGitRunner(fixture.repo);
    const moved = await applyRestackMove(fixture.repo, fixture.stored, fixture.moves, {
      git: async (args, options) => {
        if (args[0] === 'update-ref') transactions.push(`${args.join(' ')}\n${options?.input ?? ''}`);
        return git(args, options);
      },
    });
    expect(moved.kind).toBe('moved');
    if (moved.kind !== 'moved') return;
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.split('\n')).toEqual([
      'update-ref --stdin',
      'start',
      ...fixture.moves.map((move) => `update ${move.ref} ${move.newSha} ${move.oldSha}`),
      `update ${journalRefFor('demo')} ${moved.journal.blob} ${fixture.stored.blob}`,
      'prepare',
      'commit',
      '',
    ]);
    expect(await refValues(fixture.git, fixture.moves.map((move) => move.ref))).toEqual(fixture.moves.map((move) => move.newSha));
    expect((await journal(fixture.repo)).journal.state).toBe('moved');

    for (const lockedMove of fixture.moves) {
      const subject = await createFixture();
      const lock = join(subject.repo, '.git', `${lockedMove.ref}.lock`);
      await writeFile(lock, 'held\n');
      const refused = await applyRestackMove(subject.repo, subject.stored, subject.moves, { retries: 0 });
      expect(refused).toMatchObject({ kind: 'refused', reason: 'lock-unavailable' });
      expect(await refValues(subject.git, subject.moves.map((move) => move.ref))).toEqual(subject.moves.map((move) => move.oldSha));
      expect((await journal(subject.repo)).journal.state).not.toBe('moved');
      await unlink(lock);
    }
  });

  // Covers: S4.3, task:7
  it('leaves every other ref old, aborts the journal and halts stack-ref-changed naming the concurrently moved branch', async () => {
    const fixture = await createFixture();
    await fixture.git(['update-ref', 'refs/heads/feat/c2/demo', fixture.newC1, fixture.refs[2]!.oldSha]);
    const events = new ConductorEventEmitter();
    const refused = recordRefusals(events);

    const result = await applyRestackMove(fixture.repo, fixture.stored, fixture.moves, { events });

    expect(result).toMatchObject({ kind: 'refused', reason: 'stack-ref-changed', detail: 'refs/heads/feat/c2/demo' });
    expect(await refValues(fixture.git, fixture.refs.map((entry) => entry.ref))).toEqual([
      fixture.refs[0]!.oldSha,
      fixture.refs[1]!.oldSha,
      fixture.newC1,
      fixture.refs[3]!.oldSha,
    ]);
    expect((await journal(fixture.repo)).journal.state).toBe('aborted');
    expect(refused).toEqual([{ type: 'restack_refused', reason: 'stack-ref-changed', detail: 'refs/heads/feat/c2/demo' }]);
    await expect(readFile(join(fixture.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    await expect(readFile(join(fixture.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('restack refused (stack-ref-changed)\nrefs/heads/feat/c2/demo');
  });

  // Covers: S4.4, S4.5, task:7
  it('halts lock-unavailable naming the lock with every ref old after the retry budget, and applies when the lock clears within it', async () => {
    const exhausted = await createFixture();
    const lock = join(exhausted.repo, '.git', 'refs', 'conductor', 'demo', 'closed', 'c1.lock');
    await writeFile(lock, 'held\n');
    const events = new ConductorEventEmitter();
    const refused = recordRefusals(events);
    let sleeps = 0;

    const stopped = await applyRestackMove(exhausted.repo, exhausted.stored, exhausted.moves, {
      retries: 2,
      events,
      sleep: async () => { sleeps += 1; },
    });

    expect(sleeps).toBe(2);
    expect(stopped).toMatchObject({ kind: 'refused', reason: 'lock-unavailable', detail: lock });
    expect(await refValues(exhausted.git, exhausted.refs.map((entry) => entry.ref))).toEqual(exhausted.refs.map((entry) => entry.oldSha));
    expect((await journal(exhausted.repo)).journal.state).toBe('aborted');
    expect(refused).toEqual([{ type: 'restack_refused', reason: 'lock-unavailable', detail: lock }]);
    await expect(readFile(join(exhausted.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');

    const released = await createFixture();
    const briefLock = join(released.repo, '.git', 'refs', 'conductor', 'demo', 'closed', 'c1.lock');
    await writeFile(briefLock, 'held\n');
    const applied = await applyRestackMove(released.repo, released.stored, released.moves, {
      retries: 2,
      sleep: async () => { await unlink(briefLock); },
    });
    expect(applied.kind).toBe('moved');
    expect(await refValues(released.git, released.moves.map((move) => move.ref))).toEqual(released.moves.map((move) => move.newSha));
    await expect(readFile(join(released.repo, '.pipeline', 'HALT'), 'utf8')).rejects.toThrow();
  });

  // Covers: task:7
  it('persists child on a child-naming haltRestack refusal and omits it otherwise in events.jsonl', async () => {
    const fixture = await createFixture();
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(fixture.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await haltRestack(fixture.repo, 'replay-mismatch', events, { child: child(2), detail: 'src/g.ts' });
      await haltRestack(fixture.repo, 'cascade-cap', events, { child: child(1) });
      await haltRestack(fixture.repo, 'lock-unavailable', events, { detail: 'refs/heads/feat/c2/demo.lock' });
      await haltRestack(fixture.repo, 'published-stack', events);
    } finally {
      persister.stop();
    }
    const records = (await readFile(join(fixture.repo, '.pipeline', 'events.jsonl'), 'utf8')).trim().split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((record) => record.type === 'restack_refused')
      .map(({ ts: _ts, ...record }) => record);
    expect(records).toEqual([
      { type: 'restack_refused', reason: 'replay-mismatch', child: 2, detail: 'src/g.ts' },
      { type: 'restack_refused', reason: 'cascade-cap', child: 1 },
      { type: 'restack_refused', reason: 'lock-unavailable', detail: 'refs/heads/feat/c2/demo.lock' },
      { type: 'restack_refused', reason: 'published-stack' },
    ]);
  });
});
