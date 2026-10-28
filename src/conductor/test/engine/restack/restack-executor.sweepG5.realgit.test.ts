// Covers: task:rem-prd-audit-R15, task:rem-prd-audit-R16, task:rem-prd-audit-R18, task:rem-prd-audit-R17
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { advanceChildRegion } from '../../../src/engine/child-lifecycle.js';
import { resolveActiveChild } from '../../../src/engine/child-cursor.js';
import { writeSliceTopologyFixture } from '../slice-topology-fixture.js';
import { readVerdict } from '../../../src/engine/gate-verdicts.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];

const envelopeFilesystem = {
  readFile: (path: string) => readFile(path, 'utf8'),
  mkdir: (path: string) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path: string, contents: string) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

async function repository(prefix: string) {
  const repo = await mkdtemp(join(tmpdir(), prefix));
  repositories.push(repo);
  const git = async (args: string[]) => (await execFile('git', args, { cwd: repo })).stdout;
  const commit = async (message: string, file?: string, content?: string) => {
    if (file === undefined) {
      await git(['commit', '--allow-empty', '-qm', message]);
    } else {
      await mkdir(dirname(join(repo, file)), { recursive: true });
      await writeFile(join(repo, file), content ?? `${message}\n`);
      await git(['add', file]);
      await git(['commit', '-qm', message]);
    }
    return (await git(['rev-parse', 'HEAD'])).trim();
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.test']);
  await git(['config', 'user.name', 'Restack Sweep']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await git(['add', '.gitignore']);
  const sealStack = async (positions: readonly number[]) => writeSliceTopologyFixture(repo, {
    version: 1,
    slug: 'demo',
    runId: 'run-1',
    status: 'done',
    entries: [],
    sliceMembership: {
      taskSlices: Object.fromEntries(positions.map((position) => [String(position), position])),
      titles: positions.map((position) => `Child ${position}`),
    },
    storyOwnership: Object.fromEntries(positions.map((position) => [`S${position}`, position])),
  }, envelopeFilesystem);
  const tip = async (revision: string) => (await git(['rev-parse', revision])).trim();
  /** Map each commit subject in `range` to its SHA. */
  const bySubject = async (range: string) => new Map((await git(['log', '--format=%s%x09%H', range]))
    .split('\n').filter(Boolean).map((line) => line.split('\t') as [string, string]));
  return { repo, git, commit, sealStack, tip, bySubject };
}

describe('runRestack sweep G5 (real local Git)', () => {
  // Covers: S1.10, task:rem-prd-audit-R15
  it('moves an unentered pre-region halt-record leaf to its rewrite in the same base-refresh move, writes no leaf-moved ref, and later moves the leaf cleanly when child 2 closes', async () => {
    const subject = await repository('restack-sweep-g5-unentered-leaf-');
    const base = await subject.commit('base', 'base.txt', 'base\n');
    // The leaf received a pre-region halt record H; child 1 was created from it.
    await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
    const haltRecord = await subject.commit('halt record', '.docs/halted/demo.md', 'Status: halted\n');
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    await subject.commit('A1', 'a1.txt');
    const closureOne = await subject.commit('A2', 'a2.txt');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', closureOne]);
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    await subject.commit('C1', 'c1.txt');
    await subject.git(['checkout', '-q', 'main']);
    const advanced = await subject.commit('B-prime', 'base.txt', 'advanced\n');
    await subject.git(['update-ref', 'refs/remotes/origin/main', advanced]);
    await subject.git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
    await subject.git(['checkout', '-q', 'feat/c2/demo']);
    await subject.sealStack([1, 2, 3]);
    expect(await subject.tip('feat/daemon-demo')).toBe(haltRecord);
    expect(base).not.toBe(haltRecord);

    const events = new ConductorEventEmitter();
    const applied: { child: number; oldTip: string; newTip: string; opId: string }[] = [];
    events.on('restack_applied', (event) => {
      if (event.type === 'restack_applied') applied.push({ child: event.child, oldTip: event.oldTip, newTip: event.newTip, opId: event.opId });
    });

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced, events, git: makeGitRunner(subject.repo),
    })).resolves.toMatchObject({ kind: 'applied' });

    // H' is the rewrite of H inside the new child 1, on the advanced default.
    const rewrittenHalt = (await subject.bySubject(`${advanced}..refs/conductor/demo/closed/c1`)).get('halt record');
    expect(rewrittenHalt).toBeDefined();
    expect(rewrittenHalt).not.toBe(haltRecord);
    expect((await subject.git(['rev-parse', `${rewrittenHalt}^`])).trim()).toBe(advanced);
    expect(await subject.tip('feat/daemon-demo')).toBe(rewrittenHalt);
    // Same move: the leaf moved in the one restack operation that moved child 1.
    expect(applied.find((event) => event.child === 3)).toMatchObject({ oldTip: haltRecord, newTip: rewrittenHalt });
    expect(new Set(applied.map((event) => event.opId)).size).toBe(1);
    // An unentered leaf's move never writes the leaf-moved marker.
    await expect(subject.git(['show-ref', '--verify', '--quiet', 'refs/conductor/demo/leaf-moved'])).rejects.toBeDefined();

    // Child 2 later completes and closes: the leaf moves with no stray-commit refusal.
    const cursor = await resolveActiveChild(subject.repo, 'demo');
    if (cursor.kind !== 'active') throw new Error(`expected active child 2, got ${cursor.kind}`);
    expect(cursor.child).toBe(2);
    const childTwoTip = await subject.commit('C2', 'c2.txt');
    await expect(advanceChildRegion(subject.repo, 'demo', cursor, new ConductorEventEmitter()))
      .resolves.toEqual({ kind: 'completed' });
    expect(await subject.tip('refs/conductor/demo/closed/c2')).toBe(childTwoTip);
    expect(await subject.tip('feat/daemon-demo')).toBe(childTwoTip);
  });

  // Covers: S11.4, task:rem-prd-audit-R16
  it('translates evidence stamps, task-status commits, the retained suite proof and provenanceHeadSha to the new SHAs, including an empty evidence commit, when a restack applies', async () => {
    const subject = await repository('restack-sweep-g5-translation-');
    await subject.commit('base', 'base.txt', 'base\n');
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    const a1 = await subject.commit('A1', 'a1.txt');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', a1]);
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    const c1 = await subject.commit('C1', 'c1.txt');
    const evidence = await subject.commit('Evidence: checkpoint');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', evidence]);
    await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
    const l1 = await subject.commit('L1', 'l1.txt');
    await subject.git(['checkout', '-q', 'main']);
    const advanced = await subject.commit('B-prime', 'base.txt', 'advanced\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    await subject.sealStack([1, 2, 3]);
    const pipeline = join(subject.repo, '.pipeline');
    const leafStore = join(pipeline, 'children', '3');
    await mkdir(leafStore, { recursive: true });
    await writeFile(join(pipeline, 'task-evidence.json'), JSON.stringify({
      evidenceStamps: {
        T1: { sha: a1, citedShas: [a1, c1], verdictAnchor: evidence },
        T2: { sha: evidence },
      },
    }));
    await writeFile(join(pipeline, 'task-status.json'), JSON.stringify({
      tasks: [{ id: 'T1', status: 'completed', commit: a1.slice(0, 7) }, { id: 'T2', status: 'completed', commit: evidence }],
    }));
    await writeFile(join(pipeline, 'test-suite-evidence.json'), JSON.stringify({
      outcome: 'PASS', provenanceHeadSha: l1, driftLedger: [{ headSha: c1 }],
    }));
    await writeFile(join(leafStore, 'task-evidence.json'), JSON.stringify({ evidenceStamps: { T3: { sha: l1 } } }));
    await writeFile(join(leafStore, 'task-status.json'), JSON.stringify({ tasks: [{ id: 'T3', status: 'completed', commit: l1 }] }));
    await writeFile(join(leafStore, 'test-suite-evidence.json'), JSON.stringify({ outcome: 'PASS', provenanceHeadSha: l1 }));

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced, git: makeGitRunner(subject.repo),
    })).resolves.toMatchObject({ kind: 'applied' });

    const rewritten = await subject.bySubject(`${advanced}..feat/daemon-demo`);
    const [newA1, newC1, newEvidence, newL1] = ['A1', 'C1', 'Evidence: checkpoint', 'L1'].map((name) => rewritten.get(name));
    for (const [old, next] of [[a1, newA1], [c1, newC1], [evidence, newEvidence], [l1, newL1]] as const) {
      expect(next).toBeDefined();
      expect(next).not.toBe(old);
    }
    const json = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    expect(await json(join(pipeline, 'task-evidence.json'))).toMatchObject({
      evidenceStamps: {
        T1: { sha: newA1, citedShas: [newA1, newC1], verdictAnchor: newEvidence },
        T2: { sha: newEvidence },
      },
    });
    expect(await json(join(pipeline, 'task-status.json'))).toMatchObject({
      tasks: [{ commit: newA1!.slice(0, 7) }, { commit: newEvidence }],
    });
    expect(await json(join(pipeline, 'test-suite-evidence.json'))).toMatchObject({
      provenanceHeadSha: newL1, driftLedger: [{ headSha: newC1 }],
    });
    expect(await json(join(leafStore, 'task-evidence.json'))).toMatchObject({ evidenceStamps: { T3: { sha: newL1 } } });
    expect(await json(join(leafStore, 'task-status.json'))).toMatchObject({ tasks: [{ commit: newL1 }] });
    expect(await json(join(leafStore, 'test-suite-evidence.json'))).toMatchObject({ provenanceHeadSha: newL1 });
    expect(await json(join(pipeline, 'rebase-rewrites.json'))).toMatchObject({ [evidence]: newEvidence });
  });

  async function intermediateRepairStack(prefix: string) {
    const subject = await repository(prefix);
    await subject.commit('base', 'base.txt', 'base\n');
    const oldDefault = await subject.commit('old default', 'default.txt');
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    const closureOne = await subject.commit('closed child', 'closed.txt');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', closureOne]);
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    const childTwo = await subject.commit('intermediate child', 'active.txt');
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', childTwo]);
    await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
    const leaf = await subject.commit('leaf', 'leaf.txt');
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    const repair = await subject.commit('operator repair', 'repair.txt');
    // The default branch was fetched past the stack's old default before the repair runs.
    await subject.git(['checkout', '-q', 'main']);
    const fetched = await subject.commit('fetched advance', 'fetched.txt');
    await subject.git(['update-ref', 'refs/remotes/origin/main', fetched]);
    await subject.git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    await mkdir(join(subject.repo, '.pipeline'), { recursive: true });
    await writeFile(join(subject.repo, '.pipeline', 'conduct-state.json'), '{}');
    await subject.sealStack([1, 2, 3]);
    return { ...subject, oldDefault, closureOne, childTwo, leaf, repair, fetched };
  }

  // Covers: S11.8, task:rem-prd-audit-R18
  it('re-judges whole-feature gates after a feature-repair against the unchanged old default, not a freshly fetched origin/main', async () => {
    const subject = await intermediateRepairStack('restack-sweep-g5-repair-tuple-');

    await expect(runRestack({ worktree: subject.repo, slug: 'demo', cause: 'feature-repair', git: makeGitRunner(subject.repo) }))
      .resolves.toMatchObject({ kind: 'applied' });

    const completedHead = await subject.tip('HEAD');
    const rebase = await readVerdict(subject.repo, 'rebase');
    expect(rebase?.rebaseOperation).toMatchObject({
      cause: 'feature-repair',
      replay: { preRebaseHead: subject.leaf, mergeBase: subject.oldDefault, target: subject.oldDefault, completedHead },
    });
    expect(JSON.stringify(rebase?.rebaseOperation)).not.toContain(subject.fetched);
    // The repair did not carry the fetched default into the stack either.
    await expect(subject.git(['merge-base', '--is-ancestor', subject.fetched, 'feat/daemon-demo'])).rejects.toBeDefined();
  });

  // Covers: S11.10, task:rem-prd-audit-R17
  it('writes no rebase-rewrites entry for any child-1 or default-branch commit when a feature-repair restack moves only child 2 and the leaf', async () => {
    const subject = await intermediateRepairStack('restack-sweep-g5-repair-rewrites-');

    await expect(runRestack({ worktree: subject.repo, slug: 'demo', cause: 'feature-repair', git: makeGitRunner(subject.repo) }))
      .resolves.toMatchObject({ kind: 'applied' });

    // Only child 2 and the leaf were rebuilt; child 1 was adopted at the operator's commit.
    expect(await subject.tip('feat/c1/demo')).toBe(subject.repair);
    expect(await subject.tip('refs/conductor/demo/closed/c1')).toBe(subject.repair);
    expect(await subject.tip('feat/c2/demo')).not.toBe(subject.childTwo);
    expect(await subject.tip('feat/daemon-demo')).not.toBe(subject.leaf);
    const rewrites = JSON.parse(await readFile(join(subject.repo, '.pipeline', 'rebase-rewrites.json'), 'utf8')) as Record<string, string>;
    // Full and short forms of exactly the two rebuilt commits.
    expect(Object.keys(rewrites).sort()).toEqual(
      [subject.childTwo, subject.childTwo.slice(0, 7), subject.leaf, subject.leaf.slice(0, 7)].sort(),
    );
    const childOneAndDefault = (await subject.git(['rev-list', 'feat/c1/demo', 'main'])).split('\n').filter(Boolean);
    expect(childOneAndDefault).toEqual(expect.arrayContaining([subject.closureOne, subject.repair, subject.oldDefault, subject.fetched]));
    for (const commit of childOneAndDefault) {
      expect(rewrites[commit]).toBeUndefined();
      expect(rewrites[commit.slice(0, 7)]).toBeUndefined();
    }
  });
});
