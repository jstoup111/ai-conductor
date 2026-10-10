// Covers: task:7
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

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
  rollbackRestackMove,
  verifyRestackMove,
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
  const repo = await mkdtemp(join(tmpdir(), 'restack-move-'));
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

describe('journaled restack move (real local Git)', () => {
  it('moves branches, closure refs, and ready-to-moved journal state in one CAS transaction; any locked ref leaves all old', async () => {
    const fixture = await createFixture();
    const input: string[] = [];
    const lock = join(fixture.repo, '.git', 'refs', 'conductor', 'demo', 'closed', 'c2.lock');
    await writeFile(lock, 'held\n');
    const git = makeGitRunner(fixture.repo);
    const result = await applyRestackMove(fixture.repo, fixture.stored, fixture.moves, {
      git: async (args, options) => {
        if (args[0] === 'update-ref' && args[1] === '--stdin') input.push(options?.input ?? '');
        return git(args, options);
      },
      retries: 0,
    });
    expect(result.kind).toBe('refused');
    expect(input).toHaveLength(1);
    expect(input[0]).toContain('start\n');
    for (const move of fixture.moves) {
      expect(input[0]).toContain(`update ${move.ref} ${move.newSha} ${move.oldSha}`);
    }
    expect(input[0]).toContain(`update ${journalRefFor('demo')}`);
    for (const entry of fixture.refs) {
      expect((await fixture.git(['rev-parse', entry.ref])).stdout.trim()).toBe(entry.oldSha);
    }
    expect((await journal(fixture.repo)).journal.state).toBe('aborted');
  });

  it('aborts and halts stack-ref-changed when a concurrent update invalidates one expected old value', async () => {
    const fixture = await createFixture();
    await fixture.git(['update-ref', 'refs/heads/feat/c2/demo', fixture.newC1, fixture.refs[2].oldSha]);
    const events = new ConductorEventEmitter();
    const refused: unknown[] = [];
    events.on('restack_refused', (event) => refused.push(event));

    const result = await applyRestackMove(fixture.repo, fixture.stored, fixture.moves, { events });
    expect(result).toMatchObject({ kind: 'refused', reason: 'stack-ref-changed', detail: 'refs/heads/feat/c2/demo' });
    expect((await journal(fixture.repo)).journal.state).toBe('aborted');
    expect(refused).toEqual([{ type: 'restack_refused', reason: 'stack-ref-changed', detail: 'refs/heads/feat/c2/demo' }]);
    await expect(fixture.git(['rev-parse', 'refs/heads/feat/c1/demo'])).resolves.toMatchObject({ stdout: `${fixture.refs[0].oldSha}\n` });
  });

  it('retries lock failures only within the bounded budget and applies once the lock is released', async () => {
    const exhausted = await createFixture();
    const locked = join(exhausted.repo, '.git', 'refs', 'heads', 'feat', 'c2', 'demo.lock');
    await writeFile(locked, 'held\n');
    const stopped = await applyRestackMove(exhausted.repo, exhausted.stored, exhausted.moves, { retries: 1, sleep: async () => {} });
    expect(stopped).toMatchObject({ kind: 'refused', reason: 'lock-unavailable', detail: expect.stringContaining('demo.lock') });
    expect((await journal(exhausted.repo)).journal.state).toBe('aborted');
    expect((await exhausted.git(['rev-parse', 'refs/heads/feat/c1/demo'])).stdout.trim()).toBe(exhausted.refs[0].oldSha);

    const released = await createFixture();
    const releaseLock = join(released.repo, '.git', 'refs', 'heads', 'feat', 'c2', 'demo.lock');
    await writeFile(releaseLock, 'held\n');
    const applied = await applyRestackMove(released.repo, released.stored, released.moves, {
      retries: 1,
      sleep: async () => { await unlink(releaseLock); },
    });
    expect(applied.kind).toBe('moved');
    expect((await journal(released.repo)).journal.state).toBe('moved');
    for (const move of released.moves) {
      expect((await released.git(['rev-parse', move.ref])).stdout.trim()).toBe(move.newSha);
    }
  });

  it('rolls every ref back and halts verification-failed when a moved tree differs from staging', async () => {
    const fixture = await createFixture();
    const applied = await applyRestackMove(fixture.repo, fixture.stored, fixture.moves);
    if (applied.kind !== 'moved') throw new Error('move did not apply');
    await fixture.git(['update-ref', 'refs/conductor/demo/restack/staging/c2', fixture.newC1]);
    const verified = await verifyRestackMove(fixture.repo, applied.journal, fixture.moves);
    expect(verified).toMatchObject({ kind: 'failed', detail: expect.stringContaining('tree') });
    if (verified.kind !== 'failed') throw new Error('verification unexpectedly passed');
    const rolledBack = await rollbackRestackMove(fixture.repo, applied.journal, fixture.moves);
    expect(rolledBack.kind).toBe('aborted');
    for (const entry of fixture.refs) {
      expect((await fixture.git(['rev-parse', entry.ref])).stdout.trim()).toBe(entry.oldSha);
    }
    const events = new ConductorEventEmitter();
    const refused = collectRefusals(events);
    await haltRestack(fixture.repo, 'verification-failed', events, { detail: verified.detail });
    expect(refused).toEqual([{ type: 'restack_refused', reason: 'verification-failed', detail: verified.detail }]);
  });

  it('persists child on named restack refusals and omits it otherwise', async () => {
    const fixture = await createFixture();
    const events = new ConductorEventEmitter();
    const refused = collectRefusals(events);
    await haltRestack(fixture.repo, 'range-not-ancestor', events, { child: child(2), detail: 'child range' });
    await haltRestack(fixture.repo, 'lock-unavailable', events, { detail: 'lock' });
    expect(refused).toEqual([
      { type: 'restack_refused', reason: 'range-not-ancestor', child: child(2), detail: 'child range' },
      { type: 'restack_refused', reason: 'lock-unavailable', detail: 'lock' },
    ]);
    await expect(readFile(join(fixture.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
  });
});

function collectRefusals(events: ConductorEventEmitter): unknown[] {
  const records: unknown[] = [];
  events.on('restack_refused', (event) => records.push(event));
  return records;
}
