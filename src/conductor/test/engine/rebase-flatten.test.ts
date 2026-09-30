// Covers: task:2
import { describe, expect, it } from 'vitest';

import { flattenRefusalRecipe, planFlattenedReplay, proveFlattenedReplay, type FlattenedReplayPlan, type GitRunner } from '../../src/engine/rebase.js';

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

it('formats the complete, concrete flatten-refusal recovery procedure', () => {
  expect(flattenRefusalRecipe('/worktree/feature', 'origin/main', 'first-parent', 'merge')).toBe(
    'park the feature, then run git -C /worktree/feature rebase -i --rebase-merges origin/main; at the merge stop, re-apply git diff first-parent merge; run git rebase --continue; then clear .pipeline/HALT and .pipeline/HALT.class before re-queueing',
  );
});

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
    if (args.join(' ') === ['rev-list', `${CONTENT_FIRST_PARENT}..${CONTENT_SECOND_PARENT}`].join(' ')) {
      return { exitCode: 0, stdout: `${CONTENT_SIDE_ONE}\n${CONTENT_SIDE_TWO}\n`, stderr: '' };
    }
    if (args.join(' ') === ['rev-list', `${CONTENT_TWO_FIRST_PARENT}..${CONTENT_TWO_SECOND_PARENT}`].join(' ')) {
      return { exitCode: 0, stdout: '', stderr: '' };
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
    expect(plan.absorptionPoints).toEqual([
      { from: CONTENT_SIDE_ONE, to: CONTENT_MERGE_AUTHOR_DIFFERS },
      { from: CONTENT_SIDE_TWO, to: CONTENT_MERGE_AUTHOR_DIFFERS },
      { from: ANCESTRY_ONLY_MERGE, to: ORDINARY_TWO },
      { from: ANCESTRY_ONLY_MERGE, to: CONTENT_MERGE_AUTHOR_DIFFERS },
      { from: ANCESTRY_ONLY_MERGE, to: CONTENT_MERGE_TWO },
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

describe('proveFlattenedReplay (Task 3)', () => {
  const HEAD_TREE = sha('h');
  const TARGET = sha('t');
  const TARGET_TREE = sha('u');
  const plan: FlattenedReplayPlan = {
    entries: [
      { kind: 'ordinary', sha: ORDINARY_ONE },
      { kind: 'flattened', sha: FLATTENED_CONTENT, mergeSha: CONTENT_MERGE_AUTHOR_DIFFERS, firstParent: CONTENT_FIRST_PARENT, subject: 'merge feature' },
    ],
    audit: { flattenedMerges: [CONTENT_MERGE_AUTHOR_DIFFERS], ancestryOnlyMerges: [], sideLineageCount: 0 },
    pairs: [{ from: CONTENT_MERGE_AUTHOR_DIFFERS, to: FLATTENED_CONTENT }],
    absorptionPoints: [],
  };

  function proofRunner(fail?: 'merge-tree' | 'commit-tree' | 'mismatch' | 'ordinary-conflict' | 'flattened-conflict') {
    const calls: GitCall[] = [];
    let mergeTrees = 0;
    const git: GitRunner = async (args, opts) => {
      calls.push({ args, input: opts?.input });
      if (args[0] === 'rev-parse' && args[1] === 'HEAD^{tree}') return { exitCode: 0, stdout: `${fail === 'mismatch' ? sha('m') : HEAD_TREE}\n`, stderr: '' };
      if (args[0] === 'merge-tree') {
        mergeTrees++;
        if (fail === 'merge-tree') return { exitCode: 2, stdout: '', stderr: 'unsupported' };
        if (fail === 'ordinary-conflict' && mergeTrees === 3) return { exitCode: 1, stdout: '', stderr: 'conflict' };
        if (fail === 'flattened-conflict' && mergeTrees === 4) return { exitCode: 1, stdout: 'CONFLICT (content): Merge conflict in src/flattened.ts\n', stderr: 'conflict' };
        return { exitCode: 0, stdout: `${mergeTrees <= 2 ? HEAD_TREE : TARGET_TREE}\n`, stderr: '' };
      }
      if (args[0] === 'commit-tree') {
        if (fail === 'commit-tree') return { exitCode: 2, stdout: '', stderr: 'object write failed' };
        return { exitCode: 0, stdout: `${sha(String(mergeTrees))}\n`, stderr: '' };
      }
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    };
    return { git, calls };
  }

  it('proves a tree-equal replay and dry-runs it onto the target without a rebase', async () => {
    const { git, calls } = proofRunner();
    await expect(proveFlattenedReplay(git, plan, MERGE_BASE, TARGET)).resolves.toEqual({
      kind: 'proven', inPlaceTree: HEAD_TREE, targetTree: TARGET_TREE,
    });
    expect(calls.map(({ args }) => args)).toEqual([
      ['merge-tree', '--write-tree', '--merge-base', `${ORDINARY_ONE}^`, MERGE_BASE, ORDINARY_ONE],
      ['commit-tree', HEAD_TREE, '-p', MERGE_BASE],
      ['merge-tree', '--write-tree', '--merge-base', `${FLATTENED_CONTENT}^`, sha('1'), FLATTENED_CONTENT],
      ['commit-tree', HEAD_TREE, '-p', sha('1')],
      ['rev-parse', 'HEAD^{tree}'],
      ['merge-tree', '--write-tree', '--merge-base', `${ORDINARY_ONE}^`, TARGET, ORDINARY_ONE],
      ['commit-tree', TARGET_TREE, '-p', TARGET],
      ['merge-tree', '--write-tree', '--merge-base', `${FLATTENED_CONTENT}^`, sha('3'), FLATTENED_CONTENT],
      ['commit-tree', TARGET_TREE, '-p', sha('3')],
    ]);
    expect(calls.some(({ args }) => ['rebase', 'update-ref', 'reset', 'checkout', 'add'].includes(args[0]))).toBe(false);
  });

  it('proves an all-ancestry-only plan from its base tree', async () => {
    const emptyPlan: FlattenedReplayPlan = { ...plan, entries: [] };
    const git: GitRunner = async (args) => {
      if (args[0] !== 'rev-parse') throw new Error(`unexpected git command: ${args.join(' ')}`);
      if (args[1] === `${MERGE_BASE}^{tree}` || args[1] === 'HEAD^{tree}') {
        return { exitCode: 0, stdout: `${HEAD_TREE}\n`, stderr: '' };
      }
      if (args[1] === `${TARGET}^{tree}`) return { exitCode: 0, stdout: `${TARGET_TREE}\n`, stderr: '' };
      throw new Error(`unexpected tree lookup: ${args[1]}`);
    };

    await expect(proveFlattenedReplay(git, emptyPlan, MERGE_BASE, TARGET)).resolves.toEqual({
      kind: 'proven', inPlaceTree: HEAD_TREE, targetTree: TARGET_TREE,
    });
  });

  it.each([
    ['tree mismatch', 'mismatch', 'tree mismatch'],
    ['failed merge-tree', 'merge-tree', 'merge-tree'],
    ['failed commit-tree', 'commit-tree', 'commit-tree'],
  ] as const)('refuses %s before mutation', async (_name, failure, reason) => {
    const { git, calls } = proofRunner(failure);
    await expect(proveFlattenedReplay(git, plan, MERGE_BASE, TARGET)).resolves.toMatchObject({ kind: 'refused', reason: expect.stringContaining(reason) });
    expect(calls.some(({ args }) => ['rebase', 'update-ref', 'reset', 'checkout', 'add'].includes(args[0]))).toBe(false);
  });

  it.each([
    ['ordinary-conflict', 0, ORDINARY_ONE, 'ordinary'],
    ['flattened-conflict', 1, FLATTENED_CONTENT, 'flattened'],
  ] as const)('reports the first target conflict with its replay kind', async (failure, index, sha, entryKind) => {
    const { git } = proofRunner(failure);
    await expect(proveFlattenedReplay(git, plan, MERGE_BASE, TARGET)).resolves.toMatchObject({
      kind: 'target_conflict', index, sha, entryKind,
    });
  });

  it('retains merge-tree conflicted paths for a flattened refusal before mutation', async () => {
    const { git } = proofRunner('flattened-conflict');
    await expect(proveFlattenedReplay(git, plan, MERGE_BASE, TARGET)).resolves.toMatchObject({
      kind: 'target_conflict',
      sha: FLATTENED_CONTENT,
      conflicts: ['src/flattened.ts'],
    });
  });
});
