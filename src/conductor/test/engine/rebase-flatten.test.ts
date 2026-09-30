// Covers: task:2
import { describe, expect, it } from 'vitest';

import { planFlattenedReplay, type GitRunner } from '../../src/engine/rebase.js';

const sha = (digit: string) => digit.repeat(40);

const MERGE_BASE = sha('0');
const ORDINARY_ONE = sha('1');
const ANCESTRY_ONLY_MERGE = sha('2');
const ORDINARY_TWO = sha('3');
const CONTENT_MERGE_AUTHOR_DIFFERS = sha('4');
const CONTENT_MERGE_TWO = sha('5');
const ANCESTRY_SIDE_ONE = sha('6');
const ANCESTRY_SIDE_TWO = sha('7');
const CONTENT_SIDE_ONE = sha('8');
const CONTENT_SIDE_TWO = sha('9');

const ANCESTRY_FIRST_PARENT = sha('a');
const CONTENT_FIRST_PARENT = sha('b');
const CONTENT_TWO_FIRST_PARENT = sha('c');
const ANCESTRY_SECOND_PARENT = sha('d');
const CONTENT_SECOND_PARENT = sha('e');
const CONTENT_TWO_SECOND_PARENT = sha('f');
const ANCESTRY_TREE = sha('A');
const CONTENT_FIRST_PARENT_TREE = sha('B');
const CONTENT_TREE = sha('C');
const CONTENT_TWO_FIRST_PARENT_TREE = sha('D');
const CONTENT_TWO_TREE = sha('E');
const FLATTENED_CONTENT = sha('F');
const FLATTENED_CONTENT_TWO = sha('e');

type GitCall = { args: string[]; input?: string };

function flattenFixture(): { git: GitRunner; calls: GitCall[] } {
  const calls: GitCall[] = [];
  const firstParent = [
    ORDINARY_ONE,
    ANCESTRY_ONLY_MERGE,
    ORDINARY_TWO,
    CONTENT_MERGE_AUTHOR_DIFFERS,
    CONTENT_MERGE_TWO,
  ];
  const allCommits = [
    ...firstParent,
    ANCESTRY_SIDE_ONE,
    ANCESTRY_SIDE_TWO,
    CONTENT_SIDE_ONE,
    CONTENT_SIDE_TWO,
  ];
  const trees = new Map<string, string>([
    [`${ANCESTRY_ONLY_MERGE}^{tree}`, ANCESTRY_TREE],
    [`${ANCESTRY_ONLY_MERGE}^1^{tree}`, ANCESTRY_TREE],
    [`${CONTENT_MERGE_AUTHOR_DIFFERS}^{tree}`, CONTENT_TREE],
    [`${CONTENT_MERGE_AUTHOR_DIFFERS}^1^{tree}`, CONTENT_FIRST_PARENT_TREE],
    [`${CONTENT_MERGE_TWO}^{tree}`, CONTENT_TWO_TREE],
    [`${CONTENT_MERGE_TWO}^1^{tree}`, CONTENT_TWO_FIRST_PARENT_TREE],
  ]);

  const git: GitRunner = async (args, opts) => {
    calls.push({ args, input: opts?.input });
    if (args.join(' ') === ['rev-list', '--reverse', '--first-parent', `${MERGE_BASE}..HEAD`].join(' ')) {
      return { exitCode: 0, stdout: `${firstParent.join('\n')}\n`, stderr: '' };
    }
    if (args.join(' ') === ['rev-list', `${MERGE_BASE}..HEAD`].join(' ')) {
      return { exitCode: 0, stdout: `${allCommits.join('\n')}\n`, stderr: '' };
    }
    const parentLines = new Map<string, string>([
      [ORDINARY_ONE, `${ORDINARY_ONE} ${MERGE_BASE}\n`],
      [ANCESTRY_ONLY_MERGE, `${ANCESTRY_ONLY_MERGE} ${ANCESTRY_FIRST_PARENT} ${ANCESTRY_SECOND_PARENT}\n`],
      [ORDINARY_TWO, `${ORDINARY_TWO} ${ANCESTRY_ONLY_MERGE}\n`],
      [CONTENT_MERGE_AUTHOR_DIFFERS, `${CONTENT_MERGE_AUTHOR_DIFFERS} ${CONTENT_FIRST_PARENT} ${CONTENT_SECOND_PARENT}\n`],
      [CONTENT_MERGE_TWO, `${CONTENT_MERGE_TWO} ${CONTENT_TWO_FIRST_PARENT} ${CONTENT_TWO_SECOND_PARENT}\n`],
    ]);
    if (args[0] === 'rev-list' && args[1] === '--parents' && args[2] === '-n' && args[3] === '1') {
      const stdout = parentLines.get(args[4]);
      return { exitCode: stdout ? 0 : 1, stdout: stdout ?? '', stderr: '' };
    }
    if (args[0] === 'rev-parse') {
      const stdout = trees.get(args[1]);
      return { exitCode: stdout ? 0 : 1, stdout: stdout ? `${stdout}\n` : '', stderr: '' };
    }
    if (args.join(' ') === ['show', '-s', '--format=%an%n%ae%n%cn%n%ce%n%s', CONTENT_MERGE_AUTHOR_DIFFERS].join(' ')) {
      return { exitCode: 0, stdout: 'Ada Author\nada@example.test\nCasey Committer\ncasey@example.test\nmerge feature with authored content\n', stderr: '' };
    }
    if (args.join(' ') === ['show', '-s', '--format=%an%n%ae%n%cn%n%ce%n%s', CONTENT_MERGE_TWO].join(' ')) {
      return { exitCode: 0, stdout: 'Bryn Author\nbryn@example.test\nDana Committer\ndana@example.test\nmerge follow-up content\n', stderr: '' };
    }
    if (args[0] === '-c' && args[4] === 'commit-tree') {
      const flattened = args[5] === CONTENT_TREE ? FLATTENED_CONTENT : FLATTENED_CONTENT_TWO;
      return { exitCode: 0, stdout: `${flattened}\n`, stderr: '' };
    }
    throw new Error(`unexpected git command: ${args.join(' ')}`);
  };
  return { git, calls };
}

describe('planFlattenedReplay (Task 2)', () => {
  it('flattens only content-bearing first-parent merges without replaying side lineage', async () => {
    const { git, calls } = flattenFixture();

    const plan = await planFlattenedReplay(git, MERGE_BASE);

    expect(plan.entries).toEqual([
      { kind: 'ordinary', sha: ORDINARY_ONE },
      { kind: 'ordinary', sha: ORDINARY_TWO },
      {
        kind: 'flattened',
        sha: FLATTENED_CONTENT,
        mergeSha: CONTENT_MERGE_AUTHOR_DIFFERS,
        firstParent: CONTENT_FIRST_PARENT,
        subject: 'merge feature with authored content',
      },
      {
        kind: 'flattened',
        sha: FLATTENED_CONTENT_TWO,
        mergeSha: CONTENT_MERGE_TWO,
        firstParent: CONTENT_TWO_FIRST_PARENT,
        subject: 'merge follow-up content',
      },
    ]);
    expect(plan.audit).toEqual({
      flattenedMerges: [CONTENT_MERGE_AUTHOR_DIFFERS, CONTENT_MERGE_TWO],
      ancestryOnlyMerges: [ANCESTRY_ONLY_MERGE],
      sideLineageCount: 4,
    });
    expect(plan.pairs).toEqual([
      { from: CONTENT_MERGE_AUTHOR_DIFFERS, to: FLATTENED_CONTENT },
      { from: CONTENT_MERGE_TWO, to: FLATTENED_CONTENT_TWO },
    ]);

    for (const merge of [ANCESTRY_ONLY_MERGE, CONTENT_MERGE_AUTHOR_DIFFERS, CONTENT_MERGE_TWO]) {
      expect(calls.filter(({ args }) => args[0] === 'rev-parse' && args[1] === `${merge}^{tree}`)).toHaveLength(1);
      expect(calls.filter(({ args }) => args[0] === 'rev-parse' && args[1] === `${merge}^1^{tree}`)).toHaveLength(1);
    }
    expect(plan.entries.map((entry) => entry.sha)).not.toContain(ANCESTRY_SIDE_ONE);
    expect(plan.entries.map((entry) => entry.sha)).not.toContain(CONTENT_SIDE_ONE);

    expect(calls.filter(({ args }) => args[0] === 'commit-tree')).toHaveLength(0);
    const flattenedCommits = calls.filter(({ args }) => args[4] === 'commit-tree');
    expect(flattenedCommits).toHaveLength(2);
    expect(flattenedCommits[0]).toMatchObject({
      args: ['-c', 'user.name=Ada Author', '-c', 'user.email=ada@example.test', 'commit-tree', CONTENT_TREE, '-p', CONTENT_FIRST_PARENT],
      input: 'merge feature with authored content\n\nFlattened-merge: ' + CONTENT_MERGE_AUTHOR_DIFFERS + '\n',
    });
    expect(flattenedCommits[1]).toMatchObject({
      args: ['-c', 'user.name=Bryn Author', '-c', 'user.email=bryn@example.test', 'commit-tree', CONTENT_TWO_TREE, '-p', CONTENT_TWO_FIRST_PARENT],
      input: 'merge follow-up content\n\nFlattened-merge: ' + CONTENT_MERGE_TWO + '\n',
    });

    expect(calls.some(({ args }) => ['rebase', 'update-ref', 'reset', 'checkout', 'add'].includes(args[0]))).toBe(false);
  });

  it('fails closed when it cannot classify a first-parent entry', async () => {
    const { git } = flattenFixture();
    const unavailableParents: GitRunner = async (args, opts) =>
      args.join(' ') === ['rev-list', '--parents', '-n', '1', CONTENT_MERGE_AUTHOR_DIFFERS].join(' ')
        ? { exitCode: 128, stdout: '', stderr: 'missing object' }
        : git(args, opts);

    await expect(planFlattenedReplay(unavailableParents, MERGE_BASE))
      .rejects.toThrow(`could not read parents for replay entry ${CONTENT_MERGE_AUTHOR_DIFFERS}`);
  });
});
