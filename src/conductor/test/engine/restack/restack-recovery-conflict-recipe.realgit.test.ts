// Covers: task:4
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { readConflictRecord, resolutionRefFor, writeConflictRecord } from '../../../src/engine/restack/restack-conflict-record.js';
import { journalRefFor, readRestackJournal, writeRestackJournalBlob, type RestackJournal } from '../../../src/engine/restack/restack-journal.js';
import { recoverRestackJournal } from '../../../src/engine/restack/restack-recovery.js';
import { parseCommitSha, type CommitSha, type RestackOpId } from '../../../src/engine/restack/restack-types.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function sha(value: string): CommitSha {
  const parsed = parseCommitSha(value);
  if (!parsed) throw new Error(`expected SHA, got ${value}`);
  return parsed;
}

describe('planned feature-repair conflict recovery recipe (real local Git)', () => {
  it('emits a consumed resolution event after recovery persists the resolved child', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'restack-recovery-resolution-event-'));
    repositories.push(repo);
    const git = (args: string[]) => execFile('git', args, { cwd: repo });
    const commit = async (message: string, path: string, content: string) => {
      await writeFile(join(repo, path), content);
      await git(['add', path]);
      await git(['commit', '-qm', message]);
      return sha((await git(['rev-parse', 'HEAD'])).stdout.trim());
    };
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'restack@example.test']);
    await git(['config', 'user.name', 'Restack recovery']);
    await writeFile(join(repo, '.git', 'info', 'exclude'), '.pipeline/\n');
    const base = await commit('base', 'shared.txt', 'base\n');
    const first = parseChildId(1);
    const second = parseChildId(2);
    if (!first || !second) throw new Error('child ids should parse');
    await git(['checkout', '-qb', 'feat/c1/demo']);
    const firstBeforeRepair = await commit('child 1 original', 'child-one.txt', 'one\n');
    const rewrittenFirst = await commit('child 1 repair', 'shared.txt', 'repair\n');
    await git(['checkout', '-qb', 'feat/c2/demo', firstBeforeRepair]);
    const secondTip = await commit('child 2 conflicts', 'shared.txt', 'child two\n');
    await git(['checkout', '-qb', 'recorded-resolution', rewrittenFirst]);
    const resolutionTip = await commit('child 2 resolved', 'shared.txt', 'resolved\n');
    const parentTree = sha((await git(['rev-parse', `${rewrittenFirst}^{tree}`])).stdout.trim());
    await expect(writeConflictRecord(repo, 'demo', {
      opId: 'recovery-resolution-event' as RestackOpId,
      child: second, oldParent: firstBeforeRepair, oldTip: secondTip,
      newParent: rewrittenFirst, newParentTree: parentTree,
      candidateSubjects: ['child 2 conflicts'], commit: secondTip, paths: ['shared.txt'],
    }, { git: makeGitRunner(repo) })).resolves.toEqual({ kind: 'updated' });
    await git(['update-ref', resolutionRefFor('demo', second), resolutionTip]);
    await git(['checkout', '-q', 'feat/c2/demo']);
    const journal: RestackJournal = {
      opId: 'recovery-resolution-event' as RestackOpId,
      cause: 'feature-repair', newDefault: base,
      committer: { name: 'Restack recovery', email: 'restack@example.test', date: '2030-01-02T03:04:05Z' },
      dirtyPaths: [],
      refs: [
        { ref: 'refs/heads/feat/c1/demo' as never, oldSha: rewrittenFirst },
        { ref: 'refs/heads/feat/c2/demo' as never, oldSha: secondTip },
      ],
      ranges: [
        { child: first, oldParent: base, oldTip: rewrittenFirst, kind: 'active' },
        { child: second, oldParent: firstBeforeRepair, oldTip: secondTip, kind: 'active' },
      ],
      originatingChildren: [first],
      children: [{ child: first, status: 'pending' }, { child: second, status: 'pending' }],
      state: 'planned', owner: { host: 'dead-recovery-host', pid: 1, processStartTime: '0' },
    };
    const blob = await writeRestackJournalBlob(repo, journal);
    await git(['update-ref', journalRefFor('demo'), blob, '']);
    const events = new ConductorEventEmitter();
    const consumed: Array<Record<string, unknown>> = [];
    events.on('restack_resolution', (event) => { if (event.action === 'consumed') consumed.push(event); });

    await expect(recoverRestackJournal({ worktree: repo, slug: 'demo', events, git: makeGitRunner(repo) }))
      .resolves.toEqual({ kind: 'recovered', fromState: 'planned' });

    expect(consumed).toEqual([{
      type: 'restack_resolution', opId: 'recovery-resolution-event', child: 2, action: 'consumed', tip: expect.any(String),
    }]);
  });

  it('uses child 1\'s live rewritten tip and resolver candidates for child 2\'s durable record and halt recipe', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'restack-recovery-conflict-recipe-'));
    repositories.push(repo);
    const git = (args: string[]) => execFile('git', args, { cwd: repo });
    const commit = async (message: string, path: string, content: string) => {
      await writeFile(join(repo, path), content);
      await git(['add', path]);
      await git(['commit', '-qm', message]);
      return sha((await git(['rev-parse', 'HEAD'])).stdout.trim());
    };
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'restack@example.test']);
    await git(['config', 'user.name', 'Restack recovery recipe']);
    await writeFile(join(repo, '.git', 'info', 'exclude'), '.pipeline/\n');
    const base = await commit('base', 'shared.txt', 'base\n');
    const first = parseChildId(1);
    const second = parseChildId(2);
    if (!first || !second) throw new Error('child ids should parse');

    await git(['checkout', '-qb', 'feat/c1/demo']);
    const firstBeforeRepair = await commit('child 1 original', 'child-one.txt', 'one\n');
    const rewrittenFirst = await commit('child 1 repair', 'shared.txt', 'repair\n');
    await git(['checkout', '-qb', 'feat/c2/demo', firstBeforeRepair]);
    const secondTip = await commit('child 2 conflicts', 'shared.txt', 'child two\n');

    const journal: RestackJournal = {
      opId: 'recovery-conflict-recipe' as RestackOpId,
      cause: 'feature-repair',
      newDefault: base,
      committer: { name: 'Restack recovery recipe', email: 'restack@example.test', date: '2030-01-02T03:04:05Z' },
      dirtyPaths: [],
      refs: [
        { ref: 'refs/heads/feat/c1/demo' as never, oldSha: rewrittenFirst },
        { ref: 'refs/heads/feat/c2/demo' as never, oldSha: secondTip },
      ],
      ranges: [
        { child: first, oldParent: base, oldTip: rewrittenFirst, kind: 'active' },
        { child: second, oldParent: firstBeforeRepair, oldTip: secondTip, kind: 'active' },
      ],
      originatingChildren: [first],
      children: [{ child: first, status: 'pending' }, { child: second, status: 'pending' }],
      state: 'planned',
      owner: { host: 'dead-recovery-host', pid: 1, processStartTime: '0' },
    };
    const blob = await writeRestackJournalBlob(repo, journal);
    await git(['update-ref', journalRefFor('demo'), blob, '']);

    await expect(recoverRestackJournal({
      worktree: repo,
      slug: 'demo',
      git: makeGitRunner(repo),
      resolver: async () => ({ resolved: false, reason: 'declined' }),
      resolverCap: 1,
    })).resolves.toEqual({ kind: 'halted' });

    const record = await readConflictRecord(repo, 'demo', { git: makeGitRunner(repo) });
    const rewrittenTree = sha((await git(['rev-parse', `${rewrittenFirst}^{tree}`])).stdout.trim());
    expect(record).toMatchObject({
      kind: 'record',
      record: {
        opId: 'recovery-conflict-recipe', child: 2, oldParent: firstBeforeRepair, oldTip: secondTip,
        newParent: rewrittenFirst, newParentTree: rewrittenTree,
        candidateSubjects: ['child 2 conflicts'], commit: secondTip, paths: ['shared.txt'],
      },
    });
    await expect(readFile(join(repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    await expect(readFile(join(repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
      `Restack-Conflict: 2 recovery-conflict-recipe\ngit switch -c restack-resolve/demo/c2 ${secondTip}\ngit rebase --onto ${rewrittenFirst} ${firstBeforeRepair}\nai-conductor stack restack-resolve --slug demo --child 2 --tip <sha>`,
    );
    expect(await readRestackJournal(repo, 'demo')).toMatchObject({ kind: 'journal', journal: { state: 'aborted' } });
    await expect(git(['rev-parse', 'feat/c1/demo'])).resolves.toMatchObject({ stdout: `${rewrittenFirst}\n` });
    await expect(git(['rev-parse', 'feat/c2/demo'])).resolves.toMatchObject({ stdout: `${secondTip}\n` });
  });
});
