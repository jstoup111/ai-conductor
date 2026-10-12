// Covers: S4.8, S9.13, task:rem-prd-audit-R1-2, task:rem-prd-audit-R2, task:rem-prd-audit-R3
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { writeCoverageBindingEnvelope } from '../../../src/engine/coverage-binding-envelope.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import {
  journalRefFor,
  readRestackJournal,
  writeRestackJournalBlob,
} from '../../../src/engine/restack/restack-journal.js';
import { runStackPreflight } from '../../../src/engine/restack/stack-preflight.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import type { ConductorEvent } from '../../../src/types/index.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];

const envelopeFilesystem = {
  readFile: (path: string) => readFile(path, 'utf8'),
  mkdir: (path: string) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path: string, contents: string) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

/** Three-child stack with an operator commit X appended past closed/c1. */
async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'restack-outstanding-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, path: string, value: string) => {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), value);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'outstanding@example.test']);
  await git(['config', 'user.name', 'Restack outstanding']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await git(['add', '.gitignore']);
  await git(['commit', '-qm', 'ignore pipeline']);
  await commit('base', 'base.txt', 'base\n');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const closedOne = await commit('closed one', 'one.txt', 'one\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', closedOne]);
  await git(['checkout', '-qb', 'feat/c2/demo']);
  const closedTwo = await commit('closed two', 'two.txt', 'two\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c2', closedTwo]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await commit('leaf', 'leaf.txt', 'leaf\n');
  await git(['checkout', '-q', 'feat/c1/demo']);
  const operatorX = await commit('operator change', 'operator.txt', 'X\n');
  await git(['checkout', '-q', 'feat/daemon-demo']);
  await writeCoverageBindingEnvelope(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { a: 1, b: 2, c: 3 }, titles: ['one', 'two', 'leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  }, envelopeFilesystem);
  const refs = async () => (await git(['for-each-ref', '--format=%(refname) %(objectname)'])).stdout;
  return { repo, git, commit, operatorX, refs };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function recordEvents(emitter: ConductorEventEmitter, types: readonly ConductorEvent['type'][]): ConductorEvent[] {
  const seen: ConductorEvent[] = [];
  for (const type of types) emitter.on(type, (event) => { seen.push(event); });
  return seen;
}

async function haltMarkerExists(repo: string): Promise<boolean> {
  return readFile(join(repo, '.pipeline', 'HALT'), 'utf8').then(() => true, () => false);
}

describe('restack-outstanding refusals (real local Git)', () => {
  // Covers: S4.8, task:rem-prd-audit-R1-2, task:rem-prd-audit-R2
  it('a CLI resume losing the journal race to a daemon dispatch refuses once with restack-outstanding and leaves the winner to apply', async () => {
    const subject = await fixture();
    const journalRef = journalRefFor('demo');

    // The CLI resume (loser) is held exactly at its journal-create CAS, after
    // it planned the repair, so the daemon dispatch can win the race.
    const loserAtCreate = deferred();
    const releaseLoser = deferred();
    const realGit = makeGitRunner(subject.repo);
    const loserGit: GitRunner = async (args, options) => {
      if (args[0] === 'update-ref' && args[1] === journalRef && args[3] === '') {
        loserAtCreate.resolve();
        await releaseLoser.promise;
      }
      return realGit(args, options);
    };
    const cliEvents = new ConductorEventEmitter();
    const cliSeen = recordEvents(cliEvents, ['restack_refused', 'restack_planned', 'restack_applied']);
    const cliResume = runStackPreflight({ worktree: subject.repo, slug: 'demo', events: cliEvents, git: loserGit });
    await loserAtCreate.promise;

    // The daemon dispatch (winner) creates its journal and is held right after.
    const winnerPlanned = deferred<string>();
    const releaseWinner = deferred();
    const daemonEvents = new ConductorEventEmitter();
    const daemonSeen = recordEvents(daemonEvents, ['restack_refused', 'restack_planned', 'restack_applied']);
    daemonEvents.on('restack_planned', async (event) => {
      if (event.type === 'restack_planned') winnerPlanned.resolve(event.opId);
      await releaseWinner.promise;
    });
    const daemonDispatch = runStackPreflight({ worktree: subject.repo, slug: 'demo', events: daemonEvents, git: makeGitRunner(subject.repo) });
    const winnerOpId = await winnerPlanned.promise;
    const refsWhileWinnerOwnsJournal = await subject.refs();
    const winnerJournal = await readRestackJournal(subject.repo, 'demo');
    expect(winnerJournal).toMatchObject({ kind: 'journal', journal: { opId: winnerOpId, state: 'planned' } });

    releaseLoser.resolve();
    await expect(cliResume).resolves.toEqual({ kind: 'halted' });

    expect(cliSeen).toEqual([expect.objectContaining({ type: 'restack_refused', reason: 'restack-outstanding' })]);
    // No journal of its own, no ref moved, no halt-record commit, and the
    // winner's journal is untouched (same blob, same state).
    expect(await subject.refs()).toBe(refsWhileWinnerOwnsJournal);
    await expect(readRestackJournal(subject.repo, 'demo')).resolves.toEqual(winnerJournal);
    expect(await haltMarkerExists(subject.repo)).toBe(false);
    await expect(subject.git(['show', 'HEAD:.docs/halted/demo.md'])).rejects.toBeDefined();

    releaseWinner.resolve();
    await expect(daemonDispatch).resolves.toEqual({ kind: 'repaired' });
    expect(daemonSeen.filter((event) => event.type === 'restack_refused')).toEqual([]);
    expect(daemonSeen.filter((event) => event.type === 'restack_applied').length).toBe(3);
    expect((await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).stdout.trim()).toBe(subject.operatorX);
    expect((await subject.git(['show', 'feat/daemon-demo:operator.txt'])).stdout).toBe('X\n');
    await expect(subject.git(['rev-parse', '--verify', journalRef])).rejects.toBeDefined();
    expect(await haltMarkerExists(subject.repo)).toBe(false);
  });

  // Covers: S9.13, task:rem-prd-audit-R1-2, task:rem-prd-audit-R3
  it('an unrelated restack against an applied repair journal with a pending follow-on is refused without a halt and the next preflight applies the follow-on', async () => {
    const subject = await fixture();
    await subject.git(['checkout', '-q', 'main']);
    const advanced = await subject.commit('base advance', 'base.txt', 'advanced\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);

    // The repair reaches applied and durably names its base-refresh follow-on.
    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'feature-repair', followOnCause: 'base-refresh', git: makeGitRunner(subject.repo),
    })).resolves.toMatchObject({ kind: 'applied' });
    const applied = await readRestackJournal(subject.repo, 'demo');
    if (applied.kind !== 'journal') throw new Error('repair journal should remain for its follow-on');
    expect(applied.journal).toMatchObject({ state: 'applied', followOnCause: 'base-refresh' });
    // The repairing process then exits before the follow-on starts.
    const orphaned = await writeRestackJournalBlob(subject.repo, {
      ...applied.journal, owner: { host: 'exited-repair-host', pid: 1, processStartTime: '0' },
    });
    await subject.git(['update-ref', journalRefFor('demo'), orphaned, applied.blob]);
    const refsBefore = await subject.refs();
    const headBefore = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim();

    const unrelatedEvents = new ConductorEventEmitter();
    const unrelatedSeen = recordEvents(unrelatedEvents, ['restack_refused', 'restack_planned']);
    const unrelated = await runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced, events: unrelatedEvents, git: makeGitRunner(subject.repo),
    });

    expect(unrelated).toEqual({ kind: 'refused', reason: 'restack-outstanding' });
    expect(unrelatedSeen).toEqual([expect.objectContaining({ type: 'restack_refused', reason: 'restack-outstanding' })]);
    expect(await haltMarkerExists(subject.repo)).toBe(false);
    expect((await subject.git(['rev-parse', 'HEAD'])).stdout.trim()).toBe(headBefore);
    expect(await subject.refs()).toBe(refsBefore);

    const preflightEvents = new ConductorEventEmitter();
    const preflightSeen = recordEvents(preflightEvents, ['restack_planned', 'restack_refused']);
    await expect(runStackPreflight({ worktree: subject.repo, slug: 'demo', events: preflightEvents, git: makeGitRunner(subject.repo) }))
      .resolves.toEqual({ kind: 'clear' });

    expect(preflightSeen).toEqual([expect.objectContaining({ type: 'restack_planned', cause: 'base-refresh' })]);
    expect(preflightSeen[0]).not.toMatchObject({ opId: applied.journal.opId });
    await expect(subject.git(['rev-parse', '--verify', journalRefFor('demo')])).rejects.toBeDefined();
    await expect(subject.git(['merge-base', '--is-ancestor', advanced, 'feat/c1/demo'])).resolves.toMatchObject({ stdout: '' });
    await expect(subject.git(['merge-base', '--is-ancestor', 'feat/c1/demo', 'feat/daemon-demo'])).resolves.toMatchObject({ stdout: '' });
    expect((await subject.git(['show', 'feat/daemon-demo:operator.txt'])).stdout).toBe('X\n');
    expect(await haltMarkerExists(subject.repo)).toBe(false);
  });
});
