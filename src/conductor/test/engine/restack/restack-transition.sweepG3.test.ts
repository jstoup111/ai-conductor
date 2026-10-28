import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId, pipelinePathFor } from '../../../src/engine/child-context.js';
import { writeSliceTopologyFixture } from '../slice-topology-fixture.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { readVerdict, writeVerdict } from '../../../src/engine/gate-verdicts.js';
import { readKickbackLedger } from '../../../src/engine/kickback-ledger.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { applyRestackTransition } from '../../../src/engine/restack/restack-transition.js';
import { parseCommitSha, parseRefName, type RestackCause } from '../../../src/engine/restack/restack-types.js';
import { readState } from '../../../src/engine/state.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const directories: string[] = [];
const OP_ID = 'restack-op-sweep-1';

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function sha(value: string) {
  return parseCommitSha(value.repeat(40).slice(0, 40))!;
}

const leaf = parseChildId(2)!;

/** The leaf child 2 is active; its judged build_review is on a file the replay changes. */
async function activeLeafWithJudgedReview() {
  const root = await mkdtemp(join(tmpdir(), 'restack-transition-sweep-'));
  directories.push(root);
  await mkdir(pipelinePathFor(root, '', leaf), { recursive: true });
  await writeFile(join(root, '.pipeline', 'conduct-state.json'), JSON.stringify({}));
  await writeFile(pipelinePathFor(root, 'conduct-state.json', leaf), JSON.stringify({ build_review: 'done' }));
  await writeVerdict(root, 'build_review', { satisfied: true, checkedAt: 1, reason: 'approved' }, leaf);
  await writeFile(pipelinePathFor(root, 'kickback-ledger.json', leaf), JSON.stringify({
    version: 1,
    gates: { build_review: { count: 1, cumulative: 2, laps: 3, treeHash: null, lastReason: '', priorVerdict: true, resolvedBefore: 0 } },
  }));
  return root;
}

// The replay changes the reviewed file; git is the process boundary here.
const changedReplayGit = async (args: string[]) => {
  if (args[0] === 'diff') return { exitCode: 0, stdout: 'src/child.ts\n', stderr: '' };
  if (args[0] === 'merge-base') return { exitCode: 0, stdout: `${sha('b')}\n`, stderr: '' };
  if (args[0] === 'merge-tree') return { exitCode: 0, stdout: `${sha('e')}\n`, stderr: '' };
  if (args[0] === 'rev-parse') return { exitCode: 0, stdout: `${sha('f')}\n`, stderr: '' };
  return { exitCode: 0, stdout: '', stderr: '' };
};

function transitionFor(root: string, cause: RestackCause, events: ConductorEventEmitter) {
  return applyRestackTransition({
    worktree: root,
    cause,
    opId: OP_ID,
    oldDefault: sha('a'),
    newDefault: sha('b'),
    activeChild: leaf,
    ranges: [{ child: leaf, oldParent: sha('b'), oldTip: sha('c'), kind: 'leaf-active' }],
    moves: [{ ref: parseRefName('refs/heads/feat/daemon-demo')!, child: leaf, oldSha: sha('c'), newSha: sha('d') }],
    git: changedReplayGit,
    events,
  });
}

async function persistedEvents(root: string): Promise<Array<Record<string, unknown>>> {
  return (await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8'))
    .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('applyRestackTransition cause-scoped refunds (sweep)', () => {
  // Covers: task:21
  it('credits a base-refresh build_review invalidation once in the active child ledger under the restack opId, even when applied twice', async () => {
    const root = await activeLeafWithJudgedReview();
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await transitionFor(root, 'base-refresh', events);
      const afterFirst = await readKickbackLedger(root, leaf);
      expect(afterFirst.gates.build_review?.cumulative).toBe(0);
      expect(afterFirst.convergenceCreditReceipts).toEqual({ [OP_ID]: { gate: 'build_review' } });

      await transitionFor(root, 'base-refresh', events);
      const afterSecond = await readKickbackLedger(root, leaf);
      expect(afterSecond.gates.build_review).toEqual(afterFirst.gates.build_review);
      expect(afterSecond.convergenceCreditReceipts).toEqual({ [OP_ID]: { gate: 'build_review' } });
    } finally {
      persister.stop();
    }

    const credited = (await persistedEvents(root)).filter((event) => event.type === 'kickback' && event.convergenceCredit !== undefined);
    expect(credited).toHaveLength(1);
    expect(credited[0]).toMatchObject({ from: 'rebase', to: 'build_review', convergenceCredit: { gate: 'build_review' } });
    const leafState = await readState(pipelinePathFor(root, 'conduct-state.json', leaf));
    expect(leafState.ok && leafState.value.build_review).toBe('pending');
  });

  // Covers: task:21
  it('credits no laps for a feature-repair invalidation, records the cause, and a real feature-repair restack persists no rebase_changed', async () => {
    const root = await activeLeafWithJudgedReview();
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await transitionFor(root, 'feature-repair', events);
    } finally {
      persister.stop();
    }
    const ledger = await readKickbackLedger(root, leaf);
    expect(ledger.gates.build_review?.cumulative).toBe(2);
    expect(ledger.convergenceCreditReceipts ?? {}).toEqual({});
    expect((await readVerdict(root, 'build_review', leaf))).toMatchObject({ satisfied: false, kickback: { from: 'rebase', cause: 'feature-repair' } });
    expect((await readVerdict(root, 'rebase'))?.rebaseOperation).toMatchObject({ id: OP_ID, cause: 'feature-repair' });
    expect((await persistedEvents(root)).filter((event) => event.convergenceCredit !== undefined)).toEqual([]);

    // A complete feature-repair restack through the executor, on real Git.
    const repo = await mkdtemp(join(tmpdir(), 'restack-repair-events-'));
    directories.push(repo);
    const git = async (args: string[]) => (await execFile('git', args, { cwd: repo })).stdout.trim();
    const commit = async (message: string, file: string) => {
      await writeFile(join(repo, file), `${message}\n`);
      await git(['add', file]);
      await git(['commit', '-qm', message]);
      return git(['rev-parse', 'HEAD']);
    };
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'repair@example.test']);
    await git(['config', 'user.name', 'Repair events']);
    await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
    await git(['add', '.gitignore']);
    await commit('base', 'base.txt');
    await git(['checkout', '-qb', 'feat/c1/demo']);
    await git(['update-ref', 'refs/conductor/demo/closed/c1', await commit('A1', 'a1.txt')]);
    await commit('operator repair', 'repair.txt');
    await git(['checkout', '-qb', 'feat/daemon-demo', 'refs/conductor/demo/closed/c1']);
    await commit('L1', 'l1.txt');
    await writeSliceTopologyFixture(repo, {
      version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
      sliceMembership: { taskSlices: { '1': 1, '2': 2 }, titles: ['Child 1', 'Leaf'] },
      storyOwnership: { S1: 1, S2: 2 },
    }, {
      readFile: (path: string) => readFile(path, 'utf8'),
      mkdir: (path: string) => mkdir(path, { recursive: true }).then(() => undefined),
      writeFile: (path: string, contents: string) => writeFile(path, contents, 'utf8'),
      rename,
    });
    const restackEvents = new ConductorEventEmitter();
    const restackPersister = new EventPersister(join(repo, '.pipeline', 'events.jsonl'), restackEvents);
    restackPersister.start();
    try {
      await expect(runRestack({ worktree: repo, slug: 'demo', cause: 'feature-repair', events: restackEvents, git: makeGitRunner(repo) }))
        .resolves.toMatchObject({ kind: 'applied' });
    } finally {
      restackPersister.stop();
    }
    const types = (await persistedEvents(repo)).map((event) => event.type);
    expect(types).toContain('restack_applied');
    expect(types).not.toContain('rebase_changed');
  });
});
