// Covers: task:6, task:9
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from '../slice-topology-fixture.js';
import { detectStackRestackResolveCommand } from '../../../src/cli.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { dispatchStackRestackResolve } from '../../../src/engine/stack-restack-resolve-cli.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { conflictFlattenedTipRefFor, conflictParentRefFor, conflictRecordRefFor, readConflictRecord, refusedTipRefFor } from '../../../src/engine/restack/restack-conflict-record.js';
import { readRestackJournal } from '../../../src/engine/restack/restack-journal.js';
import type { RestackResolver } from '../../../src/engine/restack/restack-resolver.js';
import { parseCommitSha, type CommitSha } from '../../../src/engine/restack/restack-types.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const envelopeFilesystem: SliceTopologyFixtureFilesystem = {
  readFile: (path) => readFile(path, 'utf8'), mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'), rename,
};

function sha(raw: string): CommitSha {
  const parsed = parseCommitSha(raw.trim());
  if (!parsed) throw new Error(`expected SHA: ${raw}`);
  return parsed;
}

afterEach(async () => { await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true }))); });

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'restack-refused-tip-'));
  repositories.push(repo);
  const git = (args: string[], env?: NodeJS.ProcessEnv) => execFile('git', args, { cwd: repo, ...(env === undefined ? {} : { env }) });
  const commit = async (subject: string, paths: string[]) => {
    await git(['add', ...paths]); await git(['commit', '-qm', subject]); return sha((await git(['rev-parse', 'HEAD'])).stdout);
  };
  await git(['init', '-q', '-b', 'main']); await git(['config', 'user.email', 'restack@example.test']); await git(['config', 'user.name', 'Restack refused tip']);
  await mkdir(join(repo, 'src'), { recursive: true }); await mkdir(join(repo, 'tests'), { recursive: true }); await writeFile(join(repo, '.git', 'info', 'exclude'), '.pipeline/\n');
  await writeFile(join(repo, 'src/c.ts'), 'one\ntwo\n'); await writeFile(join(repo, 'src/other.ts'), 'old\n'); await writeFile(join(repo, 'tests/b.test.ts'), 'old parent test\n'); await commit('base', ['src/c.ts', 'src/other.ts', 'tests/b.test.ts']);
  await git(['checkout', '-qb', 'feat/c1/demo']); await writeFile(join(repo, 'c1.txt'), 'child one\n'); const c1 = await commit('C1', ['c1.txt']); await git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
  await git(['checkout', '-qb', 'feat/c2/demo']); await writeFile(join(repo, 'src/c.ts'), 'one\nchild\n'); await commit('C2', ['src/c.ts']);
  await git(['checkout', '-qb', 'side-c2', 'feat/c1/demo']); await writeFile(join(repo, 'merge.txt'), 'side\n'); await commit('side C2', ['merge.txt']);
  await git(['checkout', '-q', 'feat/c2/demo']); await git(['merge', '--no-ff', '-qm', 'merge side C2', 'side-c2']); const c2 = sha((await git(['rev-parse', 'HEAD'])).stdout); await git(['update-ref', 'refs/conductor/demo/closed/c2', c2]);
  await git(['checkout', '-qb', 'feat/daemon-demo']); await writeFile(join(repo, 'leaf.txt'), 'leaf\n'); await commit('L1', ['leaf.txt']);
  await git(['checkout', '-q', 'main']); await writeFile(join(repo, 'src/c.ts'), 'one\nmain\n'); await writeFile(join(repo, 'tests/a.test.ts'), 'parent test\n'); await writeFile(join(repo, 'tests/b.test.ts'), 'parent changed test\n'); const newDefault = await commit('main advance', ['src/c.ts', 'tests/a.test.ts', 'tests/b.test.ts']); await git(['checkout', '-q', 'feat/daemon-demo']);
  await writeSliceTopologyFixture(repo, { version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [], sliceMembership: { taskSlices: { '1': 1, '2': 2, '3': 3 }, titles: ['Child 1', 'Child 2', 'Leaf'] }, storyOwnership: { S1: 1, S2: 2, S3: 3 } }, envelopeFilesystem);
  return { repo, git, c2, newDefault };
}

function refusingResolver(kind: 'unowned' | 'delete' | 'restore'): RestackResolver { return async ({ projectRoot, environment }) => {
  await writeFile(join(projectRoot, 'src/c.ts'), 'one\nresolved child\n');
  if (kind === 'unowned') await writeFile(join(projectRoot, 'src/other.ts'), 'resolver changed other\n');
  if (kind === 'restore') await writeFile(join(projectRoot, 'tests/b.test.ts'), 'old parent test\n');
  const git = (args: string[]) => execFile('git', args, { cwd: projectRoot, env: { ...process.env, ...environment } });
  if (kind === 'delete') await git(['rm', 'tests/a.test.ts']);
  await git(['add', '-A']); await git(['rebase', '--continue']); return { resolved: true };
}; }

function resolveCommand(tip: string) {
  const command = detectStackRestackResolveCommand(['node', 'ai-conductor', 'stack', 'restack-resolve', '--slug', 'demo', '--child', '2', '--tip', tip]);
  if (!command) throw new Error('restack-resolve command did not parse');
  return command;
}

function resolveDeps(repo: string) {
  return {
    resolveMainRoot: async () => repo,
    resolveWorktree: async () => repo,
    acquireLease: async () => ({ kind: 'acquired' as const, lease: { release: async () => ({ ok: true as const }) } }),
    resolveOperator: async () => 'operator@example.test',
    print: () => undefined,
  };
}

describe('refused resolver tip (real local Git)', () => {
  it.each([
    ['unowned', 'src/other.ts (unowned)'],
    ['delete', 'tests/a.test.ts (parent-revert)'],
    ['restore', 'tests/b.test.ts (parent-revert)'],
  ] as const)('pins a %s resolver tip and takes an operator-recoverable conflict halt', async (kind, refusal) => {
    const subject = await fixture(); const events = new ConductorEventEmitter(); const observed: unknown[] = []; const conflicts: unknown[] = [];
    const branchesBefore = (await subject.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/', 'refs/conductor/demo/closed/'])).stdout;
    events.on('restack_refused', (event) => { observed.push(event); });
    events.on('restack_conflict', (event) => { conflicts.push(event); });
    await expect(runRestack({ worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.newDefault, events, git: makeGitRunner(subject.repo), resolver: refusingResolver(kind), resolverCap: 1 })).resolves.toMatchObject({ kind: 'halted' });
    const refusedTip = sha((await subject.git(['rev-parse', refusedTipRefFor('demo')])).stdout);
    expect(refusedTip).not.toBe(subject.c2);
    await expect(readConflictRecord(subject.repo, 'demo')).resolves.toMatchObject({ kind: 'record', record: { child: 2 } });
    expect(sha((await subject.git(['rev-parse', conflictParentRefFor('demo')])).stdout)).toMatch(/^[0-9a-f]{40}$/);
    const halt = await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain('Restack-Conflict: 2 '); expect(halt).toContain(refusedTipRefFor('demo')); expect(halt).toContain(refusal);
    expect(halt).toContain(`git switch -c restack-resolve/demo/c2 ${refusedTip}`); expect(halt).toContain('stack restack-resolve --slug demo --child 2 --tip <sha>'); expect(halt).toContain('--decision "<answer>"');
    await expect(subject.git(['rev-parse', '--verify', conflictFlattenedTipRefFor('demo')])).resolves.toMatchObject({ stdout: expect.stringMatching(/^[0-9a-f]{40}\n$/) });
    expect(observed).toContainEqual(expect.objectContaining({ reason: 'replay-mismatch', child: 2, detail: expect.stringContaining(refusal) }));
    expect(conflicts).toContainEqual(expect.objectContaining({ type: 'restack_conflict', child: 2 }));
    await expect(readRestackJournal(subject.repo, 'demo')).resolves.toMatchObject({ kind: 'journal', journal: { state: 'aborted' } });
    expect((await subject.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/', 'refs/conductor/demo/closed/'])).stdout).toBe(branchesBefore);
  });

  it('consumes an operator tip rebuilt from the refused resolver tip after its unowned change is dropped', async () => {
    const subject = await fixture();
    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.newDefault,
      git: makeGitRunner(subject.repo), resolver: refusingResolver('unowned'), resolverCap: 1,
    })).resolves.toMatchObject({ kind: 'halted' });
    const refused = sha((await subject.git(['rev-parse', refusedTipRefFor('demo')])).stdout);

    await subject.git(['checkout', '-qb', 'operator-resolution', refused]);
    await subject.git(['checkout', subject.newDefault, '--', 'src/other.ts']);
    await subject.git(['add', 'src/other.ts']);
    await subject.git(['commit', '--amend', '--no-edit']);
    const operatorTip = sha((await subject.git(['rev-parse', 'HEAD'])).stdout);
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);

    await expect(dispatchStackRestackResolve(resolveCommand(operatorTip), resolveDeps(subject.repo))).resolves.toBe(0);
    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.newDefault,
      git: makeGitRunner(subject.repo),
    })).resolves.toMatchObject({ kind: 'applied' });

    for (const name of [refusedTipRefFor('demo'), conflictRecordRefFor('demo'), conflictParentRefFor('demo')]) {
      await expect(subject.git(['rev-parse', '-q', '--verify', name])).rejects.toMatchObject({ code: 1 });
    }
  });

  // Covers: task:7
  it('keeps the needs-human halt when the refused-tip compare-and-swap pin loses a race', async () => {
    const subject = await fixture();
    const branchesBefore = (await subject.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/', 'refs/conductor/demo/closed/'])).stdout;
    const native = makeGitRunner(subject.repo);
    let raced = false;
    const racingGit: GitRunner = async (args, options) => {
      if (!raced && args[0] === 'update-ref' && args[1] === '--stdin'
        && options?.input?.includes(`update ${refusedTipRefFor('demo')} `)) {
        raced = true;
        await native(['update-ref', refusedTipRefFor('demo'), subject.c2]);
      }
      return native(args, options);
    };

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.newDefault,
      git: racingGit, resolver: refusingResolver('unowned'), resolverCap: 1,
    })).resolves.toMatchObject({ kind: 'halted' });

    const halt = await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8');
    expect(raced).toBe(true);
    expect(halt).toContain('restack conflict child 2');
    expect(halt).toContain('src/other.ts (unowned)');
    expect(halt).toContain('refused tip could not be pinned');
    expect((await subject.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/', 'refs/conductor/demo/closed/'])).stdout).toBe(branchesBefore);
  });

  // Covers: task:11
  it('clears a prior refused tip when a later unresolved conflict replaces its record', async () => {
    const subject = await fixture();
    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.newDefault,
      git: makeGitRunner(subject.repo), resolver: refusingResolver('unowned'), resolverCap: 1,
    })).resolves.toMatchObject({ kind: 'halted' });
    const refusedTip = sha((await subject.git(['rev-parse', refusedTipRefFor('demo')])).stdout);
    const firstConflict = await readConflictRecord(subject.repo, 'demo');
    if (firstConflict.kind !== 'record') throw new Error('expected first conflict record');

    await rm(join(subject.repo, '.pipeline', 'HALT'));
    await rm(join(subject.repo, '.pipeline', 'HALT.class'));

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.newDefault,
      git: makeGitRunner(subject.repo), resolver: async () => ({ resolved: false, reason: 'operator required' }), resolverCap: 1,
    })).resolves.toMatchObject({ kind: 'halted' });

    await expect(makeGitRunner(subject.repo)(['rev-parse', '-q', '--verify', refusedTipRefFor('demo')])).resolves.toMatchObject({ exitCode: 1 });
    const secondConflict = await readConflictRecord(subject.repo, 'demo');
    expect(secondConflict).toMatchObject({ kind: 'record', record: { child: 2 } });
    if (secondConflict.kind !== 'record') throw new Error('expected second conflict record');
    expect(secondConflict.record.opId).not.toBe(firstConflict.record.opId);
    const halt = await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain(`git switch -c restack-resolve/demo/c2 ${secondConflict.record.oldTip}`);
    expect(halt).not.toContain(refusedTip);
  });
});
