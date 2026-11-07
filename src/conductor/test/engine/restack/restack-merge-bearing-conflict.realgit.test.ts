// Covers: task:3, task:8
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { makeGitRunner } from '../../../src/engine/rebase.js';
import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from '../slice-topology-fixture.js';
import { readConflictRecord } from '../../../src/engine/restack/restack-conflict-record.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { readRestackJournal } from '../../../src/engine/restack/restack-journal.js';
import { parseCommitSha, type CommitSha } from '../../../src/engine/restack/restack-types.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const envelopeFilesystem: SliceTopologyFixtureFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

function sha(value: string): CommitSha {
  const parsed = parseCommitSha(value.trim());
  if (!parsed) throw new Error(`expected full Git SHA: ${value}`);
  return parsed;
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => rm(repository, { recursive: true, force: true })));
});

async function fixture(q: 'carried' | 'not-carried' | 'empty') {
  const repo = await mkdtemp(join(tmpdir(), 'restack-merge-bearing-conflict-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, path: string, content: string) => {
    await writeFile(join(repo, path), content);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return sha((await git(['rev-parse', 'HEAD'])).stdout);
  };

  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.test']);
  await git(['config', 'user.name', 'Restack flatten refusal']);
  await writeFile(join(repo, '.git', 'info', 'exclude'), '.pipeline/\n');
  await commit('base', 'shared.txt', 'base\n');

  await git(['checkout', '-qb', 'feat/c1/demo']);
  const childOne = await commit('child one', 'child-one.txt', 'child one\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', childOne]);

  await git(['checkout', '-qb', 'feat/c2/demo']);
  await commit('child conflict', q === 'carried' ? 'child-conflict.txt' : 'shared.txt', 'child\n');

  if (q === 'carried') {
    await git(['checkout', '-q', 'main']);
    await commit('Q', 'shared.txt', 'Q\n');
    await git(['checkout', '-q', 'feat/c2/demo']);
    await git(['merge', '--no-ff', '--no-commit', 'main']).catch(() => undefined);
    await writeFile(join(repo, 'shared.txt'), 'child merge resolution\n');
    await git(['add', 'shared.txt']);
    await git(['commit', '-qm', 'merge carried Q']);
    await git(['checkout', '-q', 'main']);
  } else {
    await git(['checkout', '-qb', 'uncarried-side', childOne]);
    await commit('uncarried side', 'side.txt', 'side\n');
    await git(['checkout', '-q', 'feat/c2/demo']);
    await git(['merge', '--no-ff', '-m', 'merge uncarried Q', 'uncarried-side']);
    await git(['checkout', '-q', 'main']);
  }

  const merge = sha((await git(['rev-parse', 'feat/c2/demo'])).stdout);
  let newDefault: CommitSha;
  if (q === 'empty') {
    await writeFile(join(repo, 'shared.txt'), 'default\n');
    await writeFile(join(repo, 'side.txt'), 'side\n');
    await git(['add', 'shared.txt', 'side.txt']);
    await git(['commit', '-qm', 'new default carries merge']);
    newDefault = sha((await git(['rev-parse', 'HEAD'])).stdout);
  } else {
    newDefault = await commit('new default', 'shared.txt', 'default\n');
  }
  await git(['update-ref', 'refs/conductor/demo/closed/c2', merge]);
  await git(['checkout', '-qb', 'feat/daemon-demo', merge]);
  await commit('leaf', 'leaf.txt', 'leaf\n');
  await writeSliceTopologyFixture(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2, '3': 3 }, titles: ['Child 1', 'Child 2', 'Leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  }, envelopeFilesystem);

  return { repo, git, merge, newDefault };
}

async function stackRefs(subject: Awaited<ReturnType<typeof fixture>>): Promise<string> {
  return (await subject.git([
    'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/', 'refs/conductor/demo/closed/',
  ])).stdout;
}

describe('runRestack merge-bearing conflicts (real local Git)', () => {
  it('applies a settled merge-bearing conflict as a linear history and emits the existing merge audit', async () => {
    const subject = await fixture('not-carried');
    const events = new ConductorEventEmitter();
    const audits: unknown[] = [];
    events.on('rebase_merge_audit', (event) => { audits.push(event); });

    const result = await runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.newDefault,
      events, git: makeGitRunner(subject.repo), resolverCap: 1,
      resolver: async (context) => {
        await writeFile(join(context.projectRoot, 'shared.txt'), 'resolved\n');
        const git = makeGitRunner(context.projectRoot);
        await git(['add', 'shared.txt'], { env: context.environment });
        await git(['rebase', '--continue'], { env: context.environment });
        return { resolved: true };
      },
    });

    expect(result).toMatchObject({ kind: 'applied' });
    const tip = sha((await subject.git(['rev-parse', 'feat/c2/demo'])).stdout);
    expect((await subject.git(['rev-list', '--min-parents=2', `${subject.merge}..${tip}`])).stdout).toBe('');
    expect((await subject.git(['log', '--format=%B', `${subject.newDefault}..${tip}`])).stdout).toContain(`Flattened-merge: ${subject.merge}`);
    expect(audits).toEqual([expect.objectContaining({ flattenedMerges: [subject.merge] })]);
  });

  it.each([
    ['when Q is carried', 'carried'],
    ['when Q is not carried', 'not-carried'],
  ] as const)('%s dispatches a merge-bearing child to the resolver without a flatten refusal', async (_name, q) => {
    const subject = await fixture(q);
    const before = await stackRefs(subject);
    const events = new ConductorEventEmitter();
    const refusals: unknown[] = [];
    let resolverCalls = 0;
    events.on('restack_refused', (event) => { refusals.push(event); });

    const result = await runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'base-refresh',
      newDefault: subject.newDefault,
      events,
      git: makeGitRunner(subject.repo),
      resolver: async () => {
        resolverCalls += 1;
        return { resolved: false, reason: 'must not be called' };
      },
    });

    expect(result).toMatchObject({ kind: 'halted' });
    expect(resolverCalls).toBe(1);
    expect(await stackRefs(subject)).toBe(before);
    expect(refusals).toEqual([]);
    await expect(readRestackJournal(subject.repo, 'demo')).resolves.toMatchObject({
      kind: 'journal', journal: { state: 'aborted' },
    });
    const stagingRefs = await subject.git([
      'for-each-ref', '--format=%(refname) %(objectname)', 'refs/conductor/demo/restack/staging/',
    ]);
    expect(stagingRefs.stdout).toContain('refs/conductor/demo/restack/staging/c1 ');
    expect(stagingRefs.stdout).toContain(`refs/conductor/demo/restack/staging/c2 ${subject.merge}`);
    const halt = await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toMatch(/^restack conflict child 2/m);
    const record = await readConflictRecord(subject.repo, 'demo', { git: makeGitRunner(subject.repo) });
    if (record.kind !== 'record' || record.record.flattenedTip === undefined) throw new Error('expected flattened conflict hand-off');
    const flattenedTip = record.record.flattenedTip;
    expect(record.record.candidateSubjects).toEqual(['child conflict', q === 'carried' ? 'merge carried Q' : 'merge uncarried Q']);
    expect((await subject.git(['rev-parse', `${flattenedTip}^{tree}`])).stdout).toBe(
      (await subject.git(['rev-parse', `${subject.merge}^{tree}`])).stdout,
    );
    expect((await subject.git(['rev-list', '--min-parents=2', `${record.record.oldParent}..${flattenedTip}`])).stdout).toBe('');
    expect(halt).toContain(`git switch -c restack-resolve/demo/c2 ${flattenedTip}`);
    expect(halt).not.toContain(`git switch -c restack-resolve/demo/c2 ${subject.merge}`);
  });

  // Covers: task:5
  it('rejects a settled resolver tip that drops the flattened merge subject through the FR-9 guard', async () => {
    const subject = await fixture('not-carried');
    const before = await stackRefs(subject);
    let settledSubjects = '';

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.newDefault,
      git: makeGitRunner(subject.repo), resolverCap: 1,
      resolver: async (context) => {
        await writeFile(join(context.projectRoot, 'shared.txt'), 'resolved\n');
        const git = makeGitRunner(context.projectRoot);
        await git(['add', 'shared.txt'], { env: context.environment });
        await git(['rebase', '--continue'], { env: context.environment });
        await git(['reset', '--hard', 'HEAD^'], { env: context.environment });
        settledSubjects = (await git(['log', '--format=%s'], { env: context.environment })).stdout;
        return { resolved: true };
      },
    })).resolves.toMatchObject({ kind: 'halted' });

    const halt = await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toMatch(/^restack conflict child 2/m);
    expect(settledSubjects).toContain('child conflict');
    expect(settledSubjects).not.toContain('merge uncarried Q');
    expect(halt).toContain('feature commit(s) lost during resolution: merge uncarried Q');
    expect(await stackRefs(subject)).toBe(before);
  });

  // Covers: task:5
  it('refuses a settled resolver tip that writes outside child 2 ownership without moving stack refs', async () => {
    const subject = await fixture('not-carried');
    const before = await stackRefs(subject);

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.newDefault,
      git: makeGitRunner(subject.repo), resolverCap: 1,
      resolver: async (context) => {
        await writeFile(join(context.projectRoot, 'shared.txt'), 'resolved\n');
        await writeFile(join(context.projectRoot, 'outside-child-two.txt'), 'unowned\n');
        const git = makeGitRunner(context.projectRoot);
        await git(['add', 'shared.txt', 'outside-child-two.txt'], { env: context.environment });
        await git(['rebase', '--continue'], { env: context.environment });
        return { resolved: true };
      },
    })).resolves.toMatchObject({ kind: 'halted' });

    const halt = await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toMatch(/^restack refused \(replay-mismatch\) child 2/m);
    expect(halt).toContain('outside-child-two.txt');
    expect(await stackRefs(subject)).toBe(before);
  });

  // Covers: task:6
  it('omits an already-carried flattened merge from settled and recorded conflict candidates', async () => {
    const settled = await fixture('empty');
    const result = await runRestack({
      worktree: settled.repo, slug: 'demo', cause: 'base-refresh', newDefault: settled.newDefault,
      git: makeGitRunner(settled.repo), resolverCap: 1,
      resolver: async (context) => {
        await writeFile(join(context.projectRoot, 'shared.txt'), 'resolved\n');
        const git = makeGitRunner(context.projectRoot);
        await git(['add', 'shared.txt'], { env: context.environment });
        await git(['rebase', '--continue'], { env: context.environment });
        return { resolved: true };
      },
    });
    expect(result).toMatchObject({ kind: 'applied' });
    const settledSubjects = (await settled.git(['log', '--format=%s', `${settled.newDefault}..feat/c2/demo`])).stdout;
    expect(settledSubjects).not.toContain('merge uncarried Q');

    const unresolved = await fixture('empty');
    await expect(runRestack({
      worktree: unresolved.repo, slug: 'demo', cause: 'base-refresh', newDefault: unresolved.newDefault,
      git: makeGitRunner(unresolved.repo), resolver: async () => ({ resolved: false, reason: 'leave it for the operator' }),
    })).resolves.toMatchObject({ kind: 'halted' });
    await expect(readConflictRecord(unresolved.repo, 'demo')).resolves.toMatchObject({
      kind: 'record', record: { candidateSubjects: expect.not.arrayContaining(['merge uncarried Q']) },
    });
  });

  // Covers: task:6
  it('halts an unresolved merge-bearing conflict when no resolver is available without moving stack refs', async () => {
    const subject = await fixture('not-carried');
    const before = await stackRefs(subject);
    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.newDefault,
      git: makeGitRunner(subject.repo),
    })).resolves.toMatchObject({ kind: 'halted' });
    const halt = await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toMatch(/^restack conflict child 2/m);
    expect(halt).toContain('restack resolver unavailable');
    expect(await stackRefs(subject)).toBe(before);
  });

  // Covers: task:6
  it('limits an unsettled merge-bearing resolver to its cap before the ordinary conflict halt', async () => {
    const subject = await fixture('not-carried');
    let dispatches = 0;
    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.newDefault,
      git: makeGitRunner(subject.repo), resolverCap: 2,
      resolver: async () => {
        dispatches += 1;
        return { resolved: false, reason: 'unsettled' };
      },
    })).resolves.toMatchObject({ kind: 'halted' });
    const halt = await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8');
    expect(dispatches).toBeLessThanOrEqual(2);
    expect(halt).toMatch(/^restack conflict child 2/m);
  });
});
