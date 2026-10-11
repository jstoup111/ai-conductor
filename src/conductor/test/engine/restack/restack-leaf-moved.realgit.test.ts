// Covers: task:20
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { moveLeaf } from '../../../src/engine/child-lifecycle.js';
import { applyRestackMove, type RestackMoveRef } from '../../../src/engine/restack/restack-move.js';
import {
  createRestackJournal,
  journalRefFor,
  readRestackJournal,
  writeRestackJournalBlob,
  type RestackJournalDraft,
} from '../../../src/engine/restack/restack-journal.js';
import { parseCommitSha, parseRefName, type CommitSha, type RefName, type RestackOpId } from '../../../src/engine/restack/restack-types.js';

const execFile = promisify(execFileCallback);
const repos: string[] = [];

afterEach(async () => {
  await Promise.all(repos.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

function sha(value: string): CommitSha {
  const parsed = parseCommitSha(value);
  if (!parsed) throw new Error(`invalid SHA ${value}`);
  return parsed;
}

function ref(value: string): RefName {
  const parsed = parseRefName(value);
  if (!parsed) throw new Error(`invalid ref ${value}`);
  return parsed;
}

async function readyLeafMove(kind: 'leaf-active' | 'leaf-unentered') {
  const repo = await mkdtemp(join(tmpdir(), 'restack-leaf-moved-'));
  repos.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.invalid']);
  await git(['config', 'user.name', 'Restack leaf marker']);
  await writeFile(join(repo, 'base.txt'), 'base\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  const base = sha((await git(['rev-parse', 'HEAD'])).stdout.trim());
  await git(['update-ref', 'refs/remotes/origin/main', base]);
  await git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await writeFile(join(repo, 'leaf.txt'), 'old\n');
  await git(['add', 'leaf.txt']);
  await git(['commit', '-qm', 'old leaf']);
  const oldSha = sha((await git(['rev-parse', 'HEAD'])).stdout.trim());
  await git(['checkout', '-q', 'main']);
  await git(['checkout', '-qb', 'new-leaf']);
  await writeFile(join(repo, 'leaf.txt'), 'new\n');
  await git(['add', 'leaf.txt']);
  await git(['commit', '-qm', 'new leaf']);
  const newSha = sha((await git(['rev-parse', 'HEAD'])).stdout.trim());
  await git(['checkout', '-q', 'feat/daemon-demo']);

  const leaf = ref('refs/heads/feat/daemon-demo');
  const child = parseChildId(2);
  if (!child) throw new Error('invalid child');
  const draft: RestackJournalDraft = {
    opId: `leaf-${kind}` as RestackOpId,
    cause: 'base-refresh',
    committer: { name: 'Restack', email: 'restack@example.invalid', date: '2030-01-01T00:00:00Z' },
    dirtyPaths: [],
    refs: [{ ref: leaf, oldSha }],
    ranges: [{ child, oldParent: base, oldTip: oldSha, kind }],
    children: [{ child, status: 'replayed' }],
  };
  const created = await createRestackJournal(repo, 'demo', draft);
  if (created.kind !== 'created') throw new Error('journal was not created');
  const readyBlob = await writeRestackJournalBlob(repo, { ...created.journal.journal, state: 'ready' });
  await git(['update-ref', journalRefFor('demo'), readyBlob, created.journal.blob]);
  const found = await readRestackJournal(repo, 'demo');
  if (found.kind !== 'journal') throw new Error('ready journal missing');
  const moves: readonly RestackMoveRef[] = [{ ref: leaf, oldSha, newSha, child }];
  return { repo, git, found, moves, newSha };
}

describe('leaf-moved restack transaction (real local Git)', () => {
  it('creates the marker when the move rewrites an active leaf', async () => {
    const fixture = await readyLeafMove('leaf-active');

    await expect(applyRestackMove(fixture.repo, fixture.found, fixture.moves)).resolves.toMatchObject({ kind: 'moved' });
    await expect(fixture.git(['rev-parse', '--verify', 'refs/conductor/demo/leaf-moved']))
      .resolves.toMatchObject({ stdout: `${fixture.newSha}\n` });
  });

  it('does not create the marker when the same transaction moves an unentered leaf', async () => {
    const fixture = await readyLeafMove('leaf-unentered');

    await expect(applyRestackMove(fixture.repo, fixture.found, fixture.moves)).resolves.toMatchObject({ kind: 'moved' });
    await expect(fixture.git(['show-ref', '--verify', '--quiet', 'refs/conductor/demo/leaf-moved']))
      .rejects.toMatchObject({ code: 1 });
    await expect(moveLeaf(fixture.repo, 'demo', fixture.newSha)).resolves.toEqual({ kind: 'completed' });
  });
});
