// Covers: task:10
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../src/engine/child-context.js';
import { makeGitRunner, type GitRunner } from '../../src/engine/rebase.js';
import { readRefreshLedger, refreshLedgerRefFor, routedCommentTargets, type RefreshLedger } from '../../src/engine/stack-refresh-ledger.js';
import { parseRoundId } from '../../src/engine/routing/route-types.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];
const host = parseChildId(1)!;
const conflictChild = parseChildId(2)!;
const cleanChild = parseChildId(5)!;
const roundId = parseRoundId('r1')!;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const repository = await mkdtemp(join(tmpdir(), 'routed-fix-targets-'));
  roots.push(repository);
  const git = async (args: string[]) => execFile('git', args, { cwd: repository });
  const commit = async (message: string) => {
    await git(['add', '.']);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };

  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'routed-fix@example.test']);
  await git(['config', 'user.name', 'Routed fix targets']);
  await writeFile(join(repository, 'conflict.txt'), 'base\n');
  await commit('base');

  await git(['checkout', '-qb', 'feat/c1/demo']);
  await writeFile(join(repository, 'host.txt'), 'published host\n');
  const publishedHost = await commit('published host');

  await git(['checkout', '-qb', 'feat/c2/demo']);
  await writeFile(join(repository, 'conflict.txt'), 'published child\n');
  const publishedConflictChild = await commit('published child change');

  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await writeFile(join(repository, 'clean.txt'), 'clean child\n');
  const publishedCleanChild = await commit('published clean child change');

  await git(['checkout', '-q', 'feat/c1/demo']);
  await git(['reset', '--hard', 'main']);
  await writeFile(join(repository, 'conflict.txt'), 'rewritten host\n');
  await writeFile(join(repository, 'repair.txt'), 'routed repair\n');
  const recordedHost = await commit('routed host repair');

  await git(['checkout', '-q', 'feat/c2/demo']);
  await expect(git(['rebase', '--onto', recordedHost, publishedHost])).rejects.toMatchObject({ code: 1 });
  await writeFile(join(repository, 'conflict.txt'), 'resolved carried child change\n');
  await git(['add', 'conflict.txt']);
  await git(['-c', 'core.editor=true', 'rebase', '--continue']);
  const recordedConflictChild = (await git(['rev-parse', 'HEAD'])).stdout.trim();

  await git(['checkout', '-q', 'feat/daemon-demo']);
  await git(['rebase', '--onto', recordedConflictChild, publishedConflictChild]);
  const recordedCleanChild = (await git(['rev-parse', 'HEAD'])).stdout.trim();

  const ledger: RefreshLedger = {
    version: 1,
    members: {
      'feat/c1/demo': { position: host, pr: 101, publishedTip: publishedHost as never, recordedTip: recordedHost as never },
      'feat/c2/demo': { position: conflictChild, pr: 102, publishedTip: publishedConflictChild as never, recordedTip: recordedConflictChild as never },
      'feat/daemon-demo': { position: cleanChild, pr: 103, publishedTip: publishedCleanChild as never, recordedTip: recordedCleanChild as never },
    },
    rounds: [{ roundId, kind: 'audit', host, marker: '<!-- conductor:routed-fix:r1:101 -->' }],
    aboveOwed: [],
    posted: [],
  };
  const runner = makeGitRunner(repository);
  const blob = (await runner(['hash-object', '-w', '--stdin'], { input: JSON.stringify(ledger) })).stdout.trim();
  await git(['update-ref', refreshLedgerRefFor('demo'), blob]);
  return { repository, git: runner, recordedConflictChild };
}

describe('routedCommentTargets (real local Git)', () => {
  it('includes the routed round host, persists a changed above-child receipt, and keeps a sparse clean replay rebase-only', async () => {
    const subject = await fixture();

    const result = await routedCommentTargets({
      worktree: subject.repository,
      slug: 'demo',
      baseBranch: 'main',
      git: subject.git,
    });

    expect(result).toMatchObject({ kind: 'targets' });
    if (result.kind !== 'targets') throw new Error('expected routed comment targets');
    expect(result.targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'host', pr: 101, roundId, rebaseOnly: [103] }),
      expect.objectContaining({ kind: 'member-above', pr: 102, hostPr: 101 }),
    ]));
    expect(result.targets).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'member-above', pr: 103 }),
    ]));
    const stored = await readRefreshLedger(subject.repository, 'demo', { git: subject.git });
    expect(stored).toMatchObject({
      kind: 'ledger',
      ledger: {
        aboveOwed: [{
          pr: 102,
          hostPr: 101,
          newTip: subject.recordedConflictChild,
          marker: `<!-- conductor:routed-refresh:${subject.recordedConflictChild}:102 -->`,
        }],
      },
    });
  });

  it('returns a retryable result and records neither target nor rebase-only child when patch-id cannot run', async () => {
    const subject = await fixture();
    const patchIdFailure: GitRunner = async (args, options) => args[0] === 'patch-id'
      ? { exitCode: 1, stdout: '', stderr: 'patch-id unavailable' }
      : subject.git(args, options);

    const result = await routedCommentTargets({
      worktree: subject.repository,
      slug: 'demo',
      baseBranch: 'main',
      git: patchIdFailure,
    });

    expect(result).toMatchObject({ kind: 'retryable' });
    if (result.kind !== 'retryable') throw new Error('expected retryable target computation failure');
    expect(result).not.toHaveProperty('targets');
    expect(result).not.toHaveProperty('rebaseOnly');
    const stored = await readRefreshLedger(subject.repository, 'demo', { git: subject.git });
    expect(stored).toMatchObject({ kind: 'ledger', ledger: { aboveOwed: [] } });
  });
});
