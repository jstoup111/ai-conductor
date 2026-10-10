// Covers: task:6
import { describe, expect, it } from 'vitest';

import type { GitRunner } from '../../../src/engine/rebase.js';
import { replayChildRange, type CommitterStamp } from '../../../src/engine/restack/restack-replay.js';
import { parseChildId } from '../../../src/engine/child-context.js';
import { parseCommitSha, type ChildRange, type CommitSha } from '../../../src/engine/restack/restack-types.js';

const OLD_PARENT = sha('1'.repeat(40));
const OLD_TIP = sha('2'.repeat(40));
const NEW_PARENT = sha('3'.repeat(40));
const MERGED_TREE = sha('4'.repeat(40));
const ORIGINAL_TREE = sha('5'.repeat(40));
const ORIGINAL_PARENT_TREE = sha('6'.repeat(40));
const ACCUMULATOR_TREE = sha('7'.repeat(40));

function sha(value: string): CommitSha {
  const parsed = parseCommitSha(value);
  if (!parsed) throw new Error(`expected SHA: ${value}`);
  return parsed;
}

function range(): ChildRange {
  const child = parseChildId(1);
  if (!child) throw new Error('child 1 should be valid');
  return { child, oldParent: OLD_PARENT, oldTip: OLD_TIP, kind: 'active' };
}

function stamp(name: string): CommitterStamp {
  return { name, email: `${name.toLowerCase()}@example.test`, date: '2030-02-03T04:05:06Z' };
}

describe('replayChildRange invocation-local identity', () => {
  it('keeps concurrently interleaved replay identities isolated at each commit-tree invocation', async () => {
    const commits: Array<{ readonly replay: string; readonly environment: NodeJS.ProcessEnv | undefined }> = [];
    let releaseBothCommits!: () => void;
    const bothCommitsStarted = new Promise<void>((resolve) => { releaseBothCommits = resolve; });

    const gitFor = (replay: string): GitRunner => async (args, options) => {
      if (args[0] === 'config') return { exitCode: 0, stdout: 'false\n', stderr: '' };
      if (args[0] === 'rev-list') return { exitCode: 0, stdout: `${OLD_TIP}\n`, stderr: '' };
      if (args[0] === 'merge-tree') return { exitCode: 0, stdout: `${MERGED_TREE}\n`, stderr: '' };
      if (args[0] === 'rev-parse') {
        if (args[1] === `${OLD_TIP}^{tree}`) return { exitCode: 0, stdout: `${ORIGINAL_TREE}\n`, stderr: '' };
        if (args[1] === `${OLD_TIP}^1^{tree}`) return { exitCode: 0, stdout: `${ORIGINAL_PARENT_TREE}\n`, stderr: '' };
        return { exitCode: 0, stdout: `${ACCUMULATOR_TREE}\n`, stderr: '' };
      }
      if (args[0] === 'show' && args.some((arg) => arg.includes('%an%x00%ae%x00%aI'))) {
        return { exitCode: 0, stdout: `${replay} Author\x00${replay.toLowerCase()}@example.test\x002021-02-03T04:05:06Z`, stderr: '' };
      }
      if (args[0] === 'show') return { exitCode: 0, stdout: `${replay} message\n`, stderr: '' };
      if (args[0] === 'commit-tree') {
        commits.push({ replay, environment: options?.env });
        if (commits.length === 2) releaseBothCommits();
        await bothCommitsStarted;
        return { exitCode: 0, stdout: `${replay === 'Alpha' ? '8'.repeat(40) : '9'.repeat(40)}\n`, stderr: '' };
      }
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    };

    await Promise.all([
      replayChildRange(range(), NEW_PARENT, stamp('Alpha Committer'), gitFor('Alpha')),
      replayChildRange(range(), NEW_PARENT, stamp('Bravo Committer'), gitFor('Bravo')),
    ]);

    expect(commits).toHaveLength(2);
    for (const { replay, environment } of commits) {
      expect(environment).toMatchObject({
        GIT_AUTHOR_NAME: `${replay} Author`,
        GIT_AUTHOR_EMAIL: `${replay.toLowerCase()}@example.test`,
        GIT_AUTHOR_DATE: '2021-02-03T04:05:06Z',
        GIT_COMMITTER_NAME: `${replay === 'Alpha' ? 'Alpha' : 'Bravo'} Committer`,
        GIT_COMMITTER_EMAIL: `${replay === 'Alpha' ? 'alpha' : 'bravo'} committer@example.test`,
        GIT_COMMITTER_DATE: '2030-02-03T04:05:06Z',
      });
    }
  });
});
