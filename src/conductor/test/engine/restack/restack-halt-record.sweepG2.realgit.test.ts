import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { renderHaltRecord, supersedeHaltRecordText } from '../../../src/engine/halt-record.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { journalRefFor, writeRestackJournalBlob, type RestackJournal } from '../../../src/engine/restack/restack-journal.js';
import { recoverRestackJournal } from '../../../src/engine/restack/restack-recovery.js';
import type { RestackResolver } from '../../../src/engine/restack/restack-resolver.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { createSweepRepository, removeAll, sealStack, stackRefs } from './restack-sweepG2-fixture.js';

const cleanup: string[] = [];

function haltedRecord(haltedAt: string): string {
  return renderHaltRecord({
    slug: 'demo', haltClass: 'needs-human', step: 'build', phase: 'BUILD', branch: 'feat/demo',
    headSha: 'a'.repeat(40), haltedAt, haltBody: 'halted for review\n',
  });
}

function resolvedRecord(haltedAt: string, resolvedAt: string): string {
  return supersedeHaltRecordText(haltedRecord(haltedAt), { cause: 'operator resume', resolvedAt });
}

afterEach(async () => {
  await removeAll(cleanup);
});

/**
 * Child 1 is repaired by appending a halt record; child 2's own range already
 * holds a different halt record for the same slug, so replaying child 2 onto
 * the repaired child 1 meets an add/add conflict on `.docs/halted/demo.md`.
 */
async function haltRecordStack(mixed: boolean) {
  const subject = await createSweepRepository('restack-halt-record-sweep-', cleanup);
  await subject.commit('base', 'src/c.ts', 'base\n');
  await subject.git(['checkout', '-qb', 'feat/c1/demo']);
  const c1 = await subject.commit('C1', 'c1.txt', 'c1\n');
  await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
  await subject.git(['checkout', '-qb', 'feat/c2/demo']);
  await subject.write('.docs/halted/demo.md', haltedRecord('2026-10-26T12:05:00.000Z'));
  if (mixed) await subject.write('src/c.ts', 'upper child source\n');
  await subject.git(['add', '-A']);
  await subject.git(['commit', '-qm', 'upper child halt record']);
  const c2 = await subject.commit('C2', 'c2.txt', 'c2\n');
  await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', c2]);
  await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
  await subject.commit('L1', 'leaf.txt', 'leaf\n');
  await subject.git(['checkout', '-q', 'feat/c1/demo']);
  await subject.write('.docs/halted/demo.md', resolvedRecord('2026-10-26T09:00:00.000Z', '2026-10-26T10:00:00.000Z'));
  if (mixed) await subject.write('src/c.ts', 'lower child source\n');
  await subject.git(['add', '-A']);
  await subject.git(['commit', '-qm', 'lower child halt record']);
  // Appended work makes child 1 a repair origin (Task 5): a halt record alone
  // keeps a moved child out of every replay range.
  await subject.commit('C1 appended', 'c1-appended.txt', 'appended\n');
  await subject.git(['checkout', '-q', 'feat/daemon-demo']);
  await sealStack(subject.repo);
  return subject;
}

describe('restack halt-record conflicts sweep (real local Git)', () => {
  // Covers: S6.4, task:6
  it("keeps child 2's newer halt record and dispatches no resolver when child 1's and child 2's ranges conflict only on the halt record", async () => {
    const subject = await haltRecordStack(false);
    let dispatched = 0;
    const resolver: RestackResolver = async () => { dispatched += 1; return { resolved: false, reason: 'must not be dispatched' }; };
    const events = new ConductorEventEmitter();
    const conflicts: unknown[] = [];
    events.on('restack_conflict', (event) => { conflicts.push(event); });

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'feature-repair', events, resolver, resolverCap: 1, git: makeGitRunner(subject.repo),
    })).resolves.toMatchObject({ kind: 'applied' });

    expect({ dispatched, conflicts }).toEqual({ dispatched: 0, conflicts: [] });
    expect((await subject.git(['show', 'feat/c1/demo:.docs/halted/demo.md'])).stdout).toContain('Resolved at: 2026-10-26T10:00:00.000Z');
    expect((await subject.git(['show', 'feat/c2/demo:.docs/halted/demo.md'])).stdout).toMatch(/^# Halt record\n\nStatus: halted/m);
    expect((await subject.git(['show', 'feat/daemon-demo:.docs/halted/demo.md'])).stdout).toMatch(/^# Halt record\n\nStatus: halted/m);
    expect((await subject.git(['merge-base', '--is-ancestor', 'feat/c1/demo', 'feat/c2/demo'])).stdout).toBe('');
  });

  // Covers: S6.9, task:6
  it('hands only src/c.ts to resolveRestackConflict when a conflict also includes the halt record', async () => {
    const subject = await haltRecordStack(true);
    const before = await stackRefs(subject);
    const dispatched: string[][] = [];
    const resolver: RestackResolver = async (context) => {
      dispatched.push([...context.conflicts].sort());
      return { resolved: false, reason: 'mixed conflict left for the operator' };
    };
    const events = new ConductorEventEmitter();
    const conflicts: Array<{ paths: string[] }> = [];
    events.on('restack_conflict', (event) => { conflicts.push(event as unknown as { paths: string[] }); });

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'feature-repair', events, resolver, resolverCap: 1, git: makeGitRunner(subject.repo),
    })).resolves.toEqual({ kind: 'halted' });

    expect(dispatched).toEqual([['src/c.ts']]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.paths).toEqual(['src/c.ts']);
    const halt = await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain('src/c.ts');
    expect(halt).not.toContain('.docs/halted/demo.md');
    expect(await stackRefs(subject)).toBe(before);
  });

  // Covers: task:6
  it('recovers a planned journal to the same child 2 halt-record tip as an uninterrupted restack', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-02-03T04:05:06.000Z'));
    try {
      const subject = await haltRecordStack(false);
      const [first, second, leaf] = [parseChildId(1), parseChildId(2), parseChildId(3)];
      if (!first || !second || !leaf) throw new Error('fixture child ids must parse');
      const [base, c1Tip, c1Closed, c2Tip, c2Closed, leafTip] = await Promise.all([
        subject.rev('refs/conductor/demo/closed/c1^'), subject.rev('feat/c1/demo'),
        subject.rev('refs/conductor/demo/closed/c1'), subject.rev('feat/c2/demo'),
        subject.rev('refs/conductor/demo/closed/c2'), subject.rev('feat/daemon-demo'),
      ]);
      const journal: RestackJournal = {
        opId: 'halt-record-recovery-parity' as never,
        cause: 'feature-repair', committer: { name: 'Restack Sweep', email: 'restack-sweep@example.test', date: '2030-02-03T04:05:06.000Z' },
        dirtyPaths: [], originatingChildren: [first],
        refs: [
          { ref: 'refs/heads/feat/c1/demo' as never, oldSha: c1Tip }, { ref: 'refs/conductor/demo/closed/c1' as never, oldSha: c1Closed },
          { ref: 'refs/heads/feat/c2/demo' as never, oldSha: c2Tip }, { ref: 'refs/conductor/demo/closed/c2' as never, oldSha: c2Closed },
          { ref: 'refs/heads/feat/daemon-demo' as never, oldSha: leafTip },
        ],
        ranges: [
          { child: first, oldParent: base, oldTip: c1Tip, kind: 'closed' },
          { child: second, oldParent: c1Closed, oldTip: c2Tip, kind: 'closed' },
          { child: leaf, oldParent: c2Closed, oldTip: leafTip, kind: 'leaf-active' },
        ],
        children: [{ child: first, status: 'pending' }, { child: second, status: 'pending' }, { child: leaf, status: 'pending' }],
        state: 'planned', owner: { host: 'dead-recovery-host', pid: 1, processStartTime: '0' },
      };
      await expect(runRestack({
        worktree: subject.repo, slug: 'demo', cause: 'feature-repair', git: makeGitRunner(subject.repo),
      })).resolves.toMatchObject({ kind: 'applied' });
      const expected = (await subject.git(['rev-parse', 'feat/c2/demo'])).stdout.trim();
      await subject.git(['update-ref', 'refs/heads/feat/c1/demo', c1Tip]);
      await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', c1Closed]);
      await subject.git(['update-ref', 'refs/heads/feat/c2/demo', c2Tip]);
      await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', c2Closed]);
      await subject.git(['update-ref', 'refs/heads/feat/daemon-demo', leafTip]);
      await subject.git(['reset', '--hard', leafTip]);
      const blob = await writeRestackJournalBlob(subject.repo, journal);
      await subject.git(['update-ref', journalRefFor('demo'), blob, '']);

      await expect(recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) }))
        .resolves.toEqual({ kind: 'recovered', fromState: 'planned' });
      const actual = (await subject.git(['rev-parse', 'feat/c2/demo'])).stdout.trim();
      expect(actual).toBe(expected);
      expect((await subject.git(['log', '-1', '--format=%s', actual])).stdout.trim()).toBe('halt record: demo');
    } finally {
      vi.useRealTimers();
    }
  });
});
