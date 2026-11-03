// Covers: task:19
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { pushedTipRef } from '../../../src/engine/push-lease.js';
import { admitRound } from '../../../src/engine/routing/round-admission.js';
import { createRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { publishedStackTipPreflight } from '../../../src/engine/stack-publication.js';
import { writePublicationRecord, type PublicationRecord } from '../../../src/engine/stack-publication-record.js';

const roots: string[] = [];
const child = parseChildId(1)!;
const leaf = parseChildId(2)!;

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'round-admission-published-'));
  roots.push(root);
  const git = makeGitRunner(root);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'publication@example.test']);
  await git(['config', 'user.name', 'Publication']);
  await writeFile(join(root, 'base.txt'), 'base\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  const origin = join(root, 'origin.git');
  await git(['init', '--bare', '-q', '-b', 'main', origin]);
  await git(['remote', 'add', 'origin', origin]);
  const tips = new Map<string, string>();
  for (const branch of ['feat/c1/demo', 'feat/daemon-demo']) {
    await git(['branch', '-f', branch, 'HEAD']);
    await git(['push', '-q', 'origin', `HEAD:refs/heads/${branch}`]);
    const tip = (await git(['rev-parse', branch])).stdout.trim();
    await git(['update-ref', pushedTipRef('demo', branch), tip]);
    tips.set(branch, tip);
  }
  return { root, git, tips };
}

const publication: PublicationRecord = {
  version: 1,
  members: [
    { position: child, branch: 'feat/c1/demo', pr: 101 },
    { position: leaf, branch: 'feat/daemon-demo', pr: 500 },
  ],
};

describe('published-stack route admission', () => {
  it('admits an intact published stack without a published-stack refusal', async () => {
    const subject = await fixture();
    await writePublicationRecord(subject.root, 'demo', undefined, publication);
    const created = await createRouteRecord(subject.root, 'demo', {
      roundId: parseRoundId('r1')!, sealedAuthored: 1, kind: 'audit', items: [],
      allocation: { [child]: { remTaskIds: [], blockBodies: [] } },
    });
    if (created.kind !== 'created') throw new Error(created.kind);

    const events: unknown[] = [];
    const calls: string[][] = [];
    const git: GitRunner = async (args, options) => {
      calls.push([...args]);
      return subject.git(args, options);
    };
    await expect(admitRound(subject.root, 'demo', created.record, child, {
      git,
      persist: async (event) => { events.push(event); return 'persisted'; },
    })).resolves.toMatchObject({ kind: 'admitted' });
    expect(calls.filter((args) => args[0] === 'ls-remote')).toEqual([[
      'ls-remote', '--heads', 'origin', 'refs/heads/feat/c1/demo', 'refs/heads/feat/daemon-demo',
    ]]);
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'restack_refused', reason: 'published-stack' }));
  });

  it('reports a recorded closed member and #3268 from the preflight', async () => {
    const subject = await fixture();
    await writePublicationRecord(subject.root, 'demo', undefined, {
      ...publication,
      members: [{ ...publication.members[0]!, lastSeen: 'closed' }, publication.members[1]!],
    });

    await expect(publishedStackTipPreflight(subject.root, 'demo')).resolves.toMatchObject({
      kind: 'refused', member: { position: child, lastSeen: 'closed' }, detail: 'published stack member 1 changed or closed (#3268)',
    });
  });

  it('treats an unreadable all-member remote tip read as retryable and writes no admission transaction', async () => {
    const subject = await fixture();
    await writePublicationRecord(subject.root, 'demo', undefined, publication);
    const created = await createRouteRecord(subject.root, 'demo', {
      roundId: parseRoundId('r1')!, sealedAuthored: 1, kind: 'audit', items: [],
      allocation: { [child]: { remTaskIds: [], blockBodies: [] } },
    });
    if (created.kind !== 'created') throw new Error(created.kind);
    const calls: string[][] = [];
    const git: GitRunner = async (args, options) => {
      calls.push([...args]);
      if (args[0] === 'ls-remote') return { exitCode: 1, stdout: '', stderr: 'remote unavailable' };
      return subject.git(args, options);
    };

    await expect(publishedStackTipPreflight(subject.root, 'demo', { git })).resolves.toEqual({ kind: 'unreadable' });
    await expect(admitRound(subject.root, 'demo', created.record, child, { git })).resolves.toEqual({
      kind: 'refused', detail: 'routing admission refused: published stack tips are unreadable; retry',
    });
    expect(calls.filter((args) => args[0] === 'ls-remote')).toHaveLength(2);
    expect(calls.filter((args) => args[0] === 'update-ref')).toHaveLength(0);
  });

  it('allows a torn-down record through the existing admission path', async () => {
    const subject = await fixture();
    await writePublicationRecord(subject.root, 'demo', undefined, { ...publication, tornDown: true });
    const created = await createRouteRecord(subject.root, 'demo', {
      roundId: parseRoundId('r1')!, sealedAuthored: 1, kind: 'audit', items: [],
      allocation: { [child]: { remTaskIds: [], blockBodies: [] } },
    });
    if (created.kind !== 'created') throw new Error(created.kind);

    await expect(admitRound(subject.root, 'demo', created.record, child)).resolves.toMatchObject({ kind: 'admitted' });
  });
});
