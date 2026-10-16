// Covers: Task 201
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { writeRoutingTransaction } from '../../../src/engine/routing/route-record-store.js';
import { rejectedPinRefFor, repairMarkerRefFor, routeRecordRefFor } from '../../../src/engine/routing/routing-refs.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { journalRefFor, writeRestackJournalBlob, type RestackJournal } from '../../../src/engine/restack/restack-journal.js';
import { parseCommitSha, type CommitSha, type RestackOpId } from '../../../src/engine/restack/restack-types.js';

const roundId = parseRoundId('r1')!;
const branchRef = 'refs/heads/feat/c1/demo';

function sha(raw: string): CommitSha {
  const parsed = parseCommitSha(raw);
  if (!parsed) throw new Error(`expected commit sha, received ${raw}`);
  return parsed;
}

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'route-writers-journal-'));
  const git = makeGitRunner(repo);
  try {
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'routing@example.invalid']);
    await git(['config', 'user.name', 'Route writers']);
    await writeFile(join(repo, 'base.txt'), 'base\n');
    await git(['add', 'base.txt']);
    await git(['commit', '-qm', 'base']);
    const old = sha((await git(['rev-parse', 'HEAD'])).stdout.trim());
    await git(['commit', '--allow-empty', '-qm', 'next']);
    const next = sha((await git(['rev-parse', 'HEAD'])).stdout.trim());
    await git(['update-ref', branchRef, old]);
    await git(['update-ref', routeRecordRefFor('demo', roundId), old]);
    await git(['update-ref', repairMarkerRefFor('demo'), old]);
    return { repo, git, old, next };
  } catch (error) {
    await rm(repo, { recursive: true, force: true });
    throw error;
  }
}

async function refAt(git: GitRunner, ref: string): Promise<string | undefined> {
  const result = await git(['rev-parse', '-q', '--verify', ref]);
  return result.exitCode === 0 ? result.stdout.trim() : undefined;
}

async function writeMovedJournal(subject: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  const journal: RestackJournal = {
    opId: 'route-writers-journal' as RestackOpId,
    cause: 'feature-repair',
    committer: { name: 'Routing', email: 'routing@example.invalid', date: '2030-01-01T00:00:00Z' },
    dirtyPaths: [],
    refs: [],
    ranges: [],
    children: [],
    state: 'moved',
    owner: { host: 'test-host', pid: 1, processStartTime: '1' },
  };
  const blob = await writeRestackJournalBlob(subject.repo, journal);
  await subject.git(['update-ref', journalRefFor('demo'), blob]);
}

function allOps(subject: Awaited<ReturnType<typeof fixture>>) {
  return [
    { kind: 'update-branch' as const, ref: branchRef, old: subject.old, new: subject.next },
    { kind: 'create-pin' as const, ref: rejectedPinRefFor('demo', roundId, 1), new: subject.next },
    { kind: 'update-marker' as const, old: subject.old, new: subject.next },
  ];
}

describe('routing transaction journal fence (real local Git)', () => {
  it('refuses each new ref operation while a moved journal keeps every prior ref intact', async () => {
    for (const operation of ['update-branch', 'create-pin', 'update-marker'] as const) {
      const subject = await fixture();
      try {
        await writeMovedJournal(subject);
        const op = allOps(subject).find((candidate) => candidate.kind === operation);
        if (!op) throw new Error(`missing ${operation}`);

        expect(await writeRoutingTransaction(subject.repo, 'demo', [op])).toEqual({ kind: 'restack-journal-open' });
        expect(await refAt(subject.git, routeRecordRefFor('demo', roundId))).toBe(subject.old);
        expect(await refAt(subject.git, branchRef)).toBe(subject.old);
        expect(await refAt(subject.git, repairMarkerRefFor('demo'))).toBe(subject.old);
        expect(await refAt(subject.git, rejectedPinRefFor('demo', roundId, 1))).toBeUndefined();
      } finally {
        await rm(subject.repo, { recursive: true, force: true });
      }
    }
  });

  it('moves branch, pin and marker in one journal-fenced stdin transaction', async () => {
    const subject = await fixture();
    try {
      const calls: Array<{ readonly args: readonly string[]; readonly input?: string }> = [];
      const git: GitRunner = async (args, options) => {
        calls.push({ args, input: options?.input });
        return subject.git(args, options);
      };

      expect(await writeRoutingTransaction(subject.repo, 'demo', allOps(subject), { git })).toEqual({ kind: 'updated' });
      expect(await refAt(subject.git, branchRef)).toBe(subject.next);
      expect(await refAt(subject.git, rejectedPinRefFor('demo', roundId, 1))).toBe(subject.next);
      expect(await refAt(subject.git, repairMarkerRefFor('demo'))).toBe(subject.next);
      const writes = calls.filter((call) => call.args[0] === 'update-ref' && call.args[1] === '--stdin');
      expect(writes).toHaveLength(1);
      expect(writes[0]?.input).toContain(`verify ${journalRefFor('demo')} ${'0'.repeat(40)}`);
      expect(writes[0]?.input).toContain(`update ${branchRef} ${subject.next} ${subject.old}`);
      expect(writes[0]?.input).toContain(`update ${rejectedPinRefFor('demo', roundId, 1)} ${subject.next} ${'0'.repeat(40)}`);
      expect(writes[0]?.input).toContain(`update ${repairMarkerRefFor('demo')} ${subject.next} ${subject.old}`);
    } finally {
      await rm(subject.repo, { recursive: true, force: true });
    }
  });

  it('lets the journal verify reject a journal created after the read without moving any named ref', async () => {
    const subject = await fixture();
    try {
      let raced = false;
      const git: GitRunner = async (args, options) => {
        if (!raced && args[0] === 'update-ref' && args[1] === '--stdin') {
          raced = true;
          await subject.git(['update-ref', journalRefFor('demo'), subject.next]);
        }
        return subject.git(args, options);
      };

      expect(await writeRoutingTransaction(subject.repo, 'demo', allOps(subject), { git })).toEqual({ kind: 'cas-failed' });
      expect(await refAt(subject.git, branchRef)).toBe(subject.old);
      expect(await refAt(subject.git, rejectedPinRefFor('demo', roundId, 1))).toBeUndefined();
      expect(await refAt(subject.git, repairMarkerRefFor('demo'))).toBe(subject.old);
    } finally {
      await rm(subject.repo, { recursive: true, force: true });
    }
  });

  it('refuses branch and pin refs outside their fenced namespaces', async () => {
    const subject = await fixture();
    try {
      expect(await writeRoutingTransaction(subject.repo, 'demo', [
        { kind: 'update-branch', ref: 'refs/heads/main', old: subject.old, new: subject.next },
      ])).toEqual({ kind: 'unavailable' });
      expect(await writeRoutingTransaction(subject.repo, 'demo', [
        { kind: 'create-pin', ref: 'refs/conductor/other/rejected/r1/1', new: subject.next },
      ])).toEqual({ kind: 'unavailable' });
      expect(await refAt(subject.git, branchRef)).toBe(subject.old);
      expect(await refAt(subject.git, rejectedPinRefFor('demo', roundId, 1))).toBeUndefined();
    } finally {
      await rm(subject.repo, { recursive: true, force: true });
    }
  });
});
