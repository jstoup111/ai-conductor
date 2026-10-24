// Covers: task:rem-prd-audit-R1, task:rem-prd-audit-R14
import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from '../slice-topology-fixture.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import type { RestackResolver } from '../../../src/engine/restack/restack-resolver.js';
import { runStackPreflight } from '../../../src/engine/restack/stack-preflight.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const envelopeFilesystem: SliceTopologyFixtureFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => { await Promise.all(repositories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

/** The three-child stack: closed c1 (A1, A2), closed c2 (C1, C2), active leaf (L1) checked out. */
async function threeChildStack(prefix: string, files: { c2: string; c2Content: string }) {
  const repo = await mkdtemp(join(tmpdir(), prefix));
  repositories.push(repo);
  const git = async (args: string[]) => (await execFile('git', args, { cwd: repo })).stdout;
  const commit = async (message: string, path: string, value = `${message}\n`) => {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), value);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).trim();
  };
  const tip = async (revision: string) => (await git(['rev-parse', revision])).trim();
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'preflight@example.test']);
  await git(['config', 'user.name', 'Stack preflight sweep']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await git(['add', '.gitignore']);
  const base = await commit('base', 'src/c.ts', 'one\ntwo\n');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  await commit('A1', 'a1.txt');
  const closureOne = await commit('A2', 'a2.txt');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', closureOne]);
  await git(['checkout', '-qb', 'feat/c2/demo']);
  await commit('C1', 'c1.txt');
  const closureTwo = await commit('C2', files.c2, files.c2Content);
  await git(['update-ref', 'refs/conductor/demo/closed/c2', closureTwo]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  const leaf = await commit('L1', 'l1.txt');
  await writeSliceTopologyFixture(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { a: 1, b: 2, c: 3 }, titles: ['one', 'two', 'leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  }, envelopeFilesystem);
  const operatorCommitOnChildOne = async (path: string, value: string) => {
    await git(['checkout', '-q', 'feat/c1/demo']);
    const operator = await commit('operator X', path, value);
    await git(['checkout', '-q', 'feat/daemon-demo']);
    return operator;
  };
  return { repo, git, tip, base, closureOne, closureTwo, leaf, operatorCommitOnChildOne };
}

function recordEvents() {
  const events = new ConductorEventEmitter();
  const planned: { cause: string }[] = [];
  const refused: unknown[] = [];
  events.on('restack_planned', (event) => { if (event.type === 'restack_planned') planned.push({ cause: event.cause }); });
  events.on('restack_refused', (event) => { refused.push(event); });
  return { events, planned, refused };
}

async function absent(path: string): Promise<boolean> {
  return access(path).then(() => false, () => true);
}

describe('runStackPreflight sweep G5 (real local Git)', () => {
  // Covers: S9.1, task:rem-prd-audit-R1
  it('repairs an operator commit X past closed/c1 at resume by moving closed/c1 to X and replaying child 2 and the leaf onto it with no halt', async () => {
    const subject = await threeChildStack('stack-preflight-sweep-g5-repair-', { c2: 'c2.txt', c2Content: 'c2\n' });
    const operator = await subject.operatorCommitOnChildOne('operator.txt', 'X\n');
    const recorded = recordEvents();

    await expect(runStackPreflight({ worktree: subject.repo, slug: 'demo', events: recorded.events, git: makeGitRunner(subject.repo) }))
      .resolves.toEqual({ kind: 'repaired' });

    expect(recorded.planned).toEqual([{ cause: 'feature-repair' }]);
    expect(recorded.refused).toEqual([]);
    // closed/c1 moves to the operator's X; child 1's branch is adopted, not replayed.
    expect(await subject.tip('refs/conductor/demo/closed/c1')).toBe(operator);
    expect(await subject.tip('feat/c1/demo')).toBe(operator);
    // Child 2 is replayed onto X: exactly C1 and C2, the first one parented on X.
    const childTwo = (await subject.git(['log', '--reverse', '--format=%H %P %s', `${operator}..feat/c2/demo`]))
      .trim().split('\n').map((line) => line.split(' '));
    expect(childTwo.map((fields) => fields.at(-1))).toEqual(['C1', 'C2']);
    expect(childTwo[0]![1]).toBe(operator);
    expect(await subject.tip('feat/c2/demo')).not.toBe(subject.closureTwo);
    expect(await subject.tip('refs/conductor/demo/closed/c2')).toBe(await subject.tip('feat/c2/demo'));
    // The leaf is replayed onto the new child 2 and carries X.
    expect(await subject.tip('feat/daemon-demo^')).toBe(await subject.tip('feat/c2/demo'));
    expect(await subject.tip('feat/daemon-demo')).not.toBe(subject.leaf);
    expect(await subject.git(['show', 'feat/daemon-demo:operator.txt'])).toBe('X\n');
    // No needs-human halt.
    expect(await absent(join(subject.repo, '.pipeline', 'HALT'))).toBe(true);
    expect(await absent(join(subject.repo, '.pipeline', 'HALT.class'))).toBe(true);
  });

  // Covers: S6.1, task:rem-prd-audit-R14
  it('hands a conflicting child-2 replay to the resolver threaded through the preflight, replays the leaf onto the resolved tip, applies, and never replays child 1', async () => {
    const subject = await threeChildStack('stack-preflight-sweep-g5-resolver-', { c2: 'src/c.ts', c2Content: 'one\nchild\n' });
    // The operator's repair on child 1 conflicts with child 2's C2 on src/c.ts.
    const operator = await subject.operatorCommitOnChildOne('src/c.ts', 'one\noperator\n');
    const childOneCommits = (await subject.git(['rev-list', `${subject.base}..${operator}`])).trim().split('\n');
    const nativeGit = makeGitRunner(subject.repo);
    const replayed: string[] = [];
    const git: GitRunner = async (args, options) => {
      // A replay picks commit c as `merge-tree --merge-base c^1 <acc> c`.
      if (args[0] === 'merge-tree' && args.includes(`${args.at(-1)}^1`)) replayed.push(args.at(-1)!);
      return nativeGit(args, options);
    };
    let resolverCalls = 0;
    const resolver: RestackResolver = async ({ projectRoot, environment }) => {
      resolverCalls += 1;
      await writeFile(join(projectRoot, 'src', 'c.ts'), 'one\noperator\nchild\n');
      const resolverGit = (args: string[]) => execFile('git', args, { cwd: projectRoot, env: { ...process.env, ...environment } });
      await resolverGit(['add', 'src/c.ts']);
      await resolverGit(['rebase', '--continue']);
      return { resolved: true };
    };
    const recorded = recordEvents();

    await expect(runStackPreflight({
      worktree: subject.repo, slug: 'demo', events: recorded.events, git, resolver, resolverCap: 1,
    })).resolves.toEqual({ kind: 'repaired' });

    expect(resolverCalls).toBe(1);
    expect(recorded.refused).toEqual([]);
    // The resolved child 2 sits on X and keeps both sides' intent.
    expect(await subject.tip('refs/conductor/demo/closed/c1')).toBe(operator);
    const resolvedChildTwo = await subject.tip('feat/c2/demo');
    expect(await subject.git(['show', `${resolvedChildTwo}:src/c.ts`])).toBe('one\noperator\nchild\n');
    expect((await subject.git(['merge-base', '--is-ancestor', operator, resolvedChildTwo]))).toBe('');
    expect(await subject.tip('refs/conductor/demo/closed/c2')).toBe(resolvedChildTwo);
    // The leaf is replayed onto the resolved child-2 tip.
    expect(await subject.tip('feat/daemon-demo^')).toBe(resolvedChildTwo);
    expect(await subject.git(['show', 'feat/daemon-demo:l1.txt'])).toBe('L1\n');
    // Child 1 is never replayed (again): no child-1 commit reached the replay plumbing,
    // while child 2 and the leaf did.
    expect(replayed.length).toBeGreaterThan(0);
    expect(replayed.filter((commit) => childOneCommits.includes(commit))).toEqual([]);
    await expect(subject.git(['rev-parse', '--verify', 'refs/conductor/demo/restack/journal'])).rejects.toBeDefined();
    expect(await absent(join(subject.repo, '.pipeline', 'HALT'))).toBe(true);
  });
});
