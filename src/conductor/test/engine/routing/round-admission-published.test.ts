// Covers: task:23
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { admitRound } from '../../../src/engine/routing/round-admission.js';
import { createRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
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
  return { root, git };
}

const publication: PublicationRecord = {
  version: 1,
  members: [
    { position: child, branch: 'feat/c1/demo', pr: 101 },
    { position: leaf, branch: 'feat/daemon-demo', pr: 500 },
  ],
};

describe('published-stack route admission', () => {
  it('refuses before its transaction writes a route or marker ref', async () => {
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
      return subject.git(args, options);
    };
    await expect(admitRound(subject.root, 'demo', created.record, child, { git })).resolves.toEqual({
      kind: 'refused', detail: 'routing admission refused: published-stack',
    });
    expect(calls.some((args) => args[0] === 'update-ref')).toBe(false);
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
