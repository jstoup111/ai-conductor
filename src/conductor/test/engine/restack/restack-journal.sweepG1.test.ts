import { execFile as execFileCallback, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import {
  createRestackJournal,
  isJournalOwnerAlive,
  journalRefFor,
  journalStateUpdateLines,
  pinStagingRef,
  readRestackJournal,
  replaceAppliedJournalWithFollowOn,
  stagingRefFor,
  updateRestackChildStatus,
  writeRestackJournalBlob,
  type RestackJournalDraft,
  type StoredRestackJournal,
} from '../../../src/engine/restack/restack-journal.js';
import {
  isLegalJournalTransition,
  parseCommitSha,
  parseRefName,
  type CommitSha,
  type JournalState,
  type RestackOpId,
} from '../../../src/engine/restack/restack-types.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

function sha(raw: string): CommitSha {
  const value = parseCommitSha(raw.trim());
  if (!value) throw new Error(`invalid sha: ${raw}`);
  return value;
}

function child(value: number) {
  const parsed = parseChildId(value);
  if (!parsed) throw new Error(`invalid child: ${value}`);
  return parsed;
}

async function createRepo() {
  const repo = await mkdtemp(join(tmpdir(), 'restack-journal-sweep-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.invalid']);
  await git(['config', 'user.name', 'Restack journal sweep']);
  await writeFile(join(repo, 'base.txt'), 'base\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  const base = sha((await git(['rev-parse', 'HEAD'])).stdout);
  return { repo, git, base };
}

function draft(oldSha: CommitSha, cause: 'feature-repair' | 'base-refresh' = 'feature-repair', opId = 'journal-op'): RestackJournalDraft {
  return {
    opId: opId as RestackOpId,
    cause,
    committer: { name: 'Journal Committer', email: 'journal@example.test', date: '2030-02-03T04:05:06Z' },
    dirtyPaths: [],
    refs: [{ ref: parseRefName('refs/heads/feat/c1/demo')!, oldSha }],
    ranges: [{ child: child(1), oldParent: oldSha, oldTip: oldSha, kind: 'active' }],
    children: [{ child: child(1), status: 'pending' }, { child: child(2), status: 'pending' }],
  };
}

async function refs(git: (args: string[]) => Promise<{ stdout: string }>): Promise<string> {
  return (await git(['for-each-ref', '--format=%(refname) %(objectname)'])).stdout;
}

async function stored(repo: string): Promise<StoredRestackJournal> {
  const result = await readRestackJournal(repo, 'demo');
  if (result.kind !== 'journal') throw new Error(`journal is ${result.kind}`);
  return result;
}

/** Records every update-ref invocation, then delegates to real Git. */
function recordingGit(repo: string, recorded: { args: readonly string[]; input?: string }[]): GitRunner {
  const real = makeGitRunner(repo);
  return async (args, options) => {
    if (args[0] === 'update-ref') recorded.push({ args: [...args], ...(options?.input === undefined ? {} : { input: options.input }) });
    return real(args, options);
  };
}

describe('ref-backed restack journal (sweep G1, real local Git)', () => {
  // Covers: S4.8, task:4
  it('creates the journal ref with an empty expected old value, refuses a competing create on the spine, and trusts only a running same-host owner', async () => {
    const fixture = await createRepo();
    const recorded: { args: readonly string[]; input?: string }[] = [];
    const events = new ConductorEventEmitter();
    const refused: unknown[] = [];
    events.on('restack_refused', (event) => { refused.push(event); });

    const first = await createRestackJournal(fixture.repo, 'demo', draft(fixture.base), events, { git: recordingGit(fixture.repo, recorded) });
    expect(first.kind).toBe('created');
    if (first.kind !== 'created') return;
    expect(recorded).toEqual([{ args: ['update-ref', 'refs/conductor/demo/restack/journal', first.journal.blob, ''] }]);
    expect(sha((await fixture.git(['rev-parse', journalRefFor('demo')])).stdout)).toBe(first.journal.blob);
    const blobBefore = (await fixture.git(['cat-file', 'blob', first.journal.blob])).stdout;
    const refsBefore = await refs(fixture.git);

    const second = await createRestackJournal(fixture.repo, 'demo', draft(fixture.base, 'base-refresh', 'competing-op'), events);
    expect(second).toEqual({ kind: 'refused', reason: 'restack-outstanding' });
    expect(refused).toEqual([{ type: 'restack_refused', reason: 'restack-outstanding' }]);
    expect(await refs(fixture.git)).toBe(refsBefore);
    expect((await fixture.git(['cat-file', 'blob', first.journal.blob])).stdout).toBe(blobBefore);
    expect((await stored(fixture.repo)).journal.opId).toBe('journal-op');

    const owner = (await stored(fixture.repo)).journal.owner;
    expect(owner.host).not.toBe('');
    expect(owner.pid).toBe(process.pid);
    expect(owner.processStartTime).toMatch(/^\d+$/);
    await expect(isJournalOwnerAlive(owner)).resolves.toBe(true);
    await expect(isJournalOwnerAlive({ ...owner, host: `${owner.host}-elsewhere` })).resolves.toBe(false);
    await expect(isJournalOwnerAlive({ ...owner, processStartTime: String(Number(owner.processStartTime) + 1) })).resolves.toBe(false);

    // A real process that has exited: same host, its own recorded start time, but no longer running.
    // Wait for the child to prove its event loop is live before taking its /proc identity: `spawn()`
    // gives us a PID before the child has necessarily reached its timer.
    const exited = spawn(process.execPath, ['-e', 'process.stdout.write("ready\\n"); setInterval(() => {}, 30000)'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const exitedPid = exited.pid!;
    const closed = new Promise<void>((resolve, reject) => {
      exited.once('exit', () => resolve());
      exited.once('error', reject);
    });
    const ready = new Promise<void>((resolve, reject) => {
      let output = '';
      exited.stdout!.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes('ready\n')) resolve();
      });
      exited.once('error', reject);
      exited.once('exit', (code, signal) => reject(new Error(`owner probe exited before ready (code=${code}, signal=${signal})`)));
    });
    try {
      await ready;
      const stat = await readFile(`/proc/${exitedPid}/stat`, 'utf8');
      const exitedStart = stat.slice(stat.lastIndexOf(') ') + 2).trim().split(/\s+/)[19]!;
      const exitedOwner = { host: owner.host, pid: exitedPid, processStartTime: exitedStart };
      await expect(isJournalOwnerAlive(exitedOwner)).resolves.toBe(true);
      exited.kill('SIGKILL');
      await closed;
      await expect(isJournalOwnerAlive(exitedOwner)).resolves.toBe(false);
    } finally {
      if (!exited.killed) {
        exited.kill('SIGKILL');
        await closed;
      }
    }
  });

  // Covers: S4.8, task:4
  it('replaces only the exact applied blob naming the follow-on, refuses other planners against it, and deletes staging refs in the same transaction', async () => {
    const fixture = await createRepo();
    expect((await createRestackJournal(fixture.repo, 'demo', { ...draft(fixture.base), followOnCause: 'base-refresh' })).kind).toBe('created');
    const planned = await stored(fixture.repo);
    const appliedBlob = await writeRestackJournalBlob(fixture.repo, { ...planned.journal, state: 'applied' });
    await fixture.git(['update-ref', journalRefFor('demo'), appliedBlob, planned.blob]);
    await pinStagingRef(fixture.repo, 'demo', child(1), fixture.base);
    await pinStagingRef(fixture.repo, 'demo', child(2), fixture.base);
    const applied = await stored(fixture.repo);
    const refsWhileApplied = await refs(fixture.git);

    // Any other planner against the applied journal is refused, and nothing changes.
    expect(await createRestackJournal(fixture.repo, 'demo', draft(fixture.base, 'base-refresh', 'other-planner')))
      .toEqual({ kind: 'refused', reason: 'restack-outstanding' });
    // A follow-on that the applied journal does not name is refused.
    expect(await replaceAppliedJournalWithFollowOn(fixture.repo, 'demo', applied, draft(fixture.base, 'feature-repair', 'wrong-cause')))
      .toEqual({ kind: 'refused', reason: 'restack-outstanding' });
    // A caller holding a stale applied blob is refused once the live blob differs.
    const liveBlob = await writeRestackJournalBlob(fixture.repo, { ...applied.journal, dirtyPaths: ['changed-live'] });
    await fixture.git(['update-ref', journalRefFor('demo'), liveBlob, applied.blob]);
    expect(await replaceAppliedJournalWithFollowOn(fixture.repo, 'demo', applied, draft(fixture.base, 'base-refresh', 'stale-follow-on')))
      .toEqual({ kind: 'refused', reason: 'restack-outstanding' });
    expect((await stored(fixture.repo)).blob).toBe(liveBlob);
    await fixture.git(['update-ref', journalRefFor('demo'), applied.blob, liveBlob]);
    expect(await refs(fixture.git)).toBe(refsWhileApplied);

    const recorded: { args: readonly string[]; input?: string }[] = [];
    const replaced = await replaceAppliedJournalWithFollowOn(fixture.repo, 'demo', applied, draft(fixture.base, 'base-refresh', 'follow-on'), {
      git: recordingGit(fixture.repo, recorded),
    });
    expect(replaced.kind).toBe('created');
    if (replaced.kind !== 'created') return;
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.args).toEqual(['update-ref', '--stdin']);
    expect(recorded[0]!.input!.split('\n')).toEqual([
      'start',
      `update ${journalRefFor('demo')} ${replaced.journal.blob} ${applied.blob}`,
      `delete ${stagingRefFor('demo', child(1))} ${fixture.base}`,
      `delete ${stagingRefFor('demo', child(2))} ${fixture.base}`,
      'prepare',
      'commit',
      '',
    ]);
    expect((await stored(fixture.repo)).journal).toMatchObject({ opId: 'follow-on', state: 'planned', cause: 'base-refresh' });
    expect((await fixture.git(['for-each-ref', 'refs/conductor/demo/restack/staging/'])).stdout).toBe('');
  });

  // Covers: task:4
  it('produces CAS update-ref lines from the previous blob for every legal transition and throws for every illegal one', async () => {
    const fixture = await createRepo();
    expect((await createRestackJournal(fixture.repo, 'demo', draft(fixture.base))).kind).toBe('created');
    const planned = await stored(fixture.repo);
    const states: readonly JournalState[] = ['planned', 'ready', 'moved', 'synced', 'applied', 'aborted', 'rolling-back'];
    const nextBlob = sha('e'.repeat(40));
    let legal = 0;
    for (const from of states) {
      const previous: StoredRestackJournal = { ...planned, blob: sha(`${states.indexOf(from)}`.repeat(40)), journal: { ...planned.journal, state: from } };
      for (const to of states) {
        if (isLegalJournalTransition(from, to)) {
          legal += 1;
          expect(journalStateUpdateLines(previous, nextBlob, to)).toEqual([`update refs/conductor/demo/restack/journal ${nextBlob} ${previous.blob}`]);
        } else {
          expect(() => journalStateUpdateLines(previous, nextBlob, to)).toThrow(`illegal restack journal transition: ${from} -> ${to}`);
        }
      }
    }
    expect(legal).toBe(8);

    // The emitted line is a working `update-ref --stdin` CAS from the previous blob.
    const readyBlob = await writeRestackJournalBlob(fixture.repo, { ...planned.journal, state: 'ready' });
    const lines = journalStateUpdateLines(planned, readyBlob, 'ready');
    await makeGitRunner(fixture.repo)(['update-ref', '--stdin'], { input: ['start', ...lines, 'prepare', 'commit', ''].join('\n') });
    expect((await stored(fixture.repo)).journal.state).toBe('ready');
    const stale = await makeGitRunner(fixture.repo)(['update-ref', '--stdin'], { input: ['start', ...lines, 'prepare', 'commit', ''].join('\n') });
    expect(stale.exitCode).not.toBe(0);
  });

  // Covers: task:4
  it('reads non-JSON and schema-invalid journal blobs as unreadable and keeps a staged commit reachable through gc', async () => {
    const fixture = await createRepo();
    const git = makeGitRunner(fixture.repo);
    const writeBlob = async (contents: string) => sha((await git(['hash-object', '-w', '--stdin'], { input: contents })).stdout);
    expect((await createRestackJournal(fixture.repo, 'demo', draft(fixture.base))).kind).toBe('created');
    const valid = await stored(fixture.repo);
    const invalidBlobs = [
      await writeBlob('{not-json'),
      await writeBlob(JSON.stringify({ ...valid.journal, state: 'exploded' })),
      await writeBlob(JSON.stringify({ ...valid.journal, owner: { host: 'h', pid: 'not-a-pid', processStartTime: '1' } })),
      await writeBlob(JSON.stringify({ ...valid.journal, refs: [{ ref: 'heads/main', oldSha: fixture.base }] })),
      await writeBlob(JSON.stringify({ ...valid.journal, children: [{ child: 1, status: 'finished' }] })),
    ];
    let previous = valid.blob;
    for (const blob of invalidBlobs) {
      await fixture.git(['update-ref', journalRefFor('demo'), blob, previous]);
      expect(await readRestackJournal(fixture.repo, 'demo')).toEqual({ kind: 'unreadable', blob });
      previous = blob;
    }

    await fixture.git(['checkout', '-qb', 'orphaned']);
    await writeFile(join(fixture.repo, 'orphan.txt'), 'pinned\n');
    await fixture.git(['add', 'orphan.txt']);
    await fixture.git(['commit', '-qm', 'orphaned']);
    const orphaned = sha((await fixture.git(['rev-parse', 'HEAD'])).stdout);
    await fixture.git(['checkout', '-q', 'main']);
    await fixture.git(['branch', '-D', 'orphaned']);
    expect(await pinStagingRef(fixture.repo, 'demo', child(2), orphaned)).toBe(true);
    expect(sha((await fixture.git(['rev-parse', 'refs/conductor/demo/restack/staging/c2'])).stdout)).toBe(orphaned);
    await fixture.git(['reflog', 'expire', '--expire=now', '--all']);
    await fixture.git(['gc', '--prune=now', '--quiet']);
    expect((await fixture.git(['cat-file', '-t', orphaned])).stdout.trim()).toBe('commit');
    expect((await fixture.git(['show', `${orphaned}:orphan.txt`])).stdout).toBe('pinned\n');
  });

  // Covers: task:4
  it('records a planned child status and its staging tip in one CAS transaction and writes neither ref when the live blob changed', async () => {
    const fixture = await createRepo();
    expect((await createRestackJournal(fixture.repo, 'demo', draft(fixture.base))).kind).toBe('created');
    const planned = await stored(fixture.repo);
    const recorded: { args: readonly string[]; input?: string }[] = [];

    const replayed = await updateRestackChildStatus(
      fixture.repo, 'demo', planned, child(2), 'replayed', fixture.base, new Map([[fixture.base, fixture.base]]),
      { git: recordingGit(fixture.repo, recorded) },
    );
    expect(replayed.kind).toBe('updated');
    if (replayed.kind !== 'updated') return;
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.input!.split('\n')).toEqual([
      'start',
      `update ${journalRefFor('demo')} ${replayed.journal.blob} ${planned.blob}`,
      `update ${stagingRefFor('demo', child(2))} ${fixture.base} `,
      'prepare',
      'commit',
      '',
    ]);
    const afterReplay = await stored(fixture.repo);
    expect(afterReplay.journal.state).toBe('planned');
    expect(afterReplay.journal.children).toEqual([
      { child: child(1), status: 'pending' },
      { child: child(2), status: 'replayed', rewrites: [{ from: fixture.base, to: fixture.base }] },
    ]);

    const resolved = await updateRestackChildStatus(fixture.repo, 'demo', afterReplay, child(2), 'resolved', fixture.base, new Map());
    expect(resolved.kind).toBe('updated');
    expect((await stored(fixture.repo)).journal).toMatchObject({ state: 'planned', children: [{ status: 'pending' }, { status: 'resolved' }] });

    const live = await stored(fixture.repo);
    const concurrent = await writeRestackJournalBlob(fixture.repo, { ...live.journal, dirtyPaths: ['other-writer'] });
    await fixture.git(['update-ref', journalRefFor('demo'), concurrent, live.blob]);
    const refsBefore = await refs(fixture.git);
    expect(await updateRestackChildStatus(fixture.repo, 'demo', live, child(1), 'replayed', fixture.base, new Map())).toEqual({ kind: 'stale' });
    expect(await refs(fixture.git)).toBe(refsBefore);
    expect(sha((await fixture.git(['rev-parse', journalRefFor('demo')])).stdout)).toBe(concurrent);
    expect((await makeGitRunner(fixture.repo)(['rev-parse', '-q', '--verify', stagingRefFor('demo', child(1))])).exitCode).toBe(1);
  });
});
