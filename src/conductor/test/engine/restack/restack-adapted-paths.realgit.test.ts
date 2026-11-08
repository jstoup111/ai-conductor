// Covers: task:1, task:2, task:3
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { parseChildId } from '../../../src/engine/child-context.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from '../slice-topology-fixture.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { journalRefFor } from '../../../src/engine/restack/restack-journal.js';
import { adaptedPathsFor, checkPathOwnership, checkResolvedTipOwnership } from '../../../src/engine/restack/restack-ownership.js';
import { parseCommitSha, type CommitSha } from '../../../src/engine/restack/restack-types.js';
import type { RestackResolver } from '../../../src/engine/restack/restack-resolver.js';
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
  if (!parsed) throw new Error(`expected full SHA: ${value}`);
  return parsed;
}

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'restack-adapted-paths-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const write = async (path: string, contents: string) => {
    await mkdir(join(repo, path, '..'), { recursive: true });
    await writeFile(join(repo, path), contents);
  };
  const commit = async (subject: string) => {
    await git(['add', '-A']);
    await git(['commit', '-qm', subject]);
    return sha((await git(['rev-parse', 'HEAD'])).stdout);
  };

  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.test']);
  await git(['config', 'user.name', 'Restack adapted paths']);
  await Promise.all([
    write('tests/b.test.ts', 'old parent test\n'),
    write('src/c.ts', 'old c\n'),
    write('src/main.ts', 'old main\n'),
    write('src/other.ts', 'old other\n'),
  ]);
  const oldParent = await commit('base');

  await git(['checkout', '-qb', 'child']);
  await Promise.all([
    write('src/c.ts', 'child c\n'),
    write('src/main.ts', 'child main\n'),
  ]);
  const oldTip = await commit('child owns c and main');

  await git(['checkout', '-q', 'main']);
  await Promise.all([
    write('tests/a.test.ts', 'parent added test\n'),
    write('tests/b.test.ts', 'parent changed test\n'),
    write('src/c.ts', 'parent c\n'),
  ]);
  const newParent = await commit('parent changes tests and c');

  const tip = async (name: string, change: () => Promise<void>) => {
    await git(['checkout', '-qB', `tip-${name}`, newParent]);
    await change();
    return commit(`resolved ${name}`);
  };

  return {
    git,
    write,
    tip,
    runner: makeGitRunner(repo),
    range: { child: parseChildId(2)!, oldParent, oldTip, kind: 'closed' as const },
    newParent,
  };
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

describe('resolved restack tip ownership (real local Git)', () => {
  it('accepts parent-test adaptations and reports their sorted adapted paths', async () => {
    const subject = await fixture();
    const adaptAdded = await subject.tip('adapt-added', () => subject.write('tests/a.test.ts', 'adapted added test\n'));
    const adaptChanged = await subject.tip('adapt-changed', () => subject.write('tests/b.test.ts', 'adapted changed test\n'));

    await expect(checkResolvedTipOwnership(subject.range, subject.newParent, adaptAdded, subject.runner)).resolves.toEqual({
      kind: 'accepted', adaptedPaths: ['tests/a.test.ts'],
    });
    await expect(adaptedPathsFor(subject.range, subject.newParent, adaptAdded, subject.runner)).resolves.toEqual(['tests/a.test.ts']);
    await expect(checkResolvedTipOwnership(subject.range, subject.newParent, adaptChanged, subject.runner)).resolves.toEqual({
      kind: 'accepted', adaptedPaths: ['tests/b.test.ts'],
    });
    await expect(adaptedPathsFor(subject.range, subject.newParent, adaptChanged, subject.runner)).resolves.toEqual(['tests/b.test.ts']);
    await expect(checkPathOwnership(subject.range, subject.newParent, adaptChanged, subject.runner)).resolves.toEqual({
      kind: 'refused', paths: ['tests/b.test.ts'],
    });
  });

  it('refuses parent reverts and paths outside the owned and parent-delta sets', async () => {
    const subject = await fixture();
    const deleteAdded = await subject.tip('delete-added', () => subject.git(['rm', 'tests/a.test.ts']).then(() => undefined));
    const restoreChanged = await subject.tip('restore-changed', () => subject.write('tests/b.test.ts', 'old parent test\n'));
    const unowned = await subject.tip('unowned', () => subject.write('src/other.ts', 'resolver changed other\n'));
    const mixed = await subject.tip('mixed', async () => {
      await Promise.all([
        subject.write('tests/a.test.ts', 'adapted added test\n'),
        subject.write('src/other.ts', 'resolver changed other\n'),
      ]);
    });

    await expect(checkResolvedTipOwnership(subject.range, subject.newParent, deleteAdded, subject.runner)).resolves.toEqual({
      kind: 'refused', paths: [{ path: 'tests/a.test.ts', cause: 'parent-revert' }],
    });
    await expect(checkResolvedTipOwnership(subject.range, subject.newParent, restoreChanged, subject.runner)).resolves.toEqual({
      kind: 'refused', paths: [{ path: 'tests/b.test.ts', cause: 'parent-revert' }],
    });
    await expect(checkResolvedTipOwnership(subject.range, subject.newParent, unowned, subject.runner)).resolves.toEqual({
      kind: 'refused', paths: [{ path: 'src/other.ts', cause: 'unowned' }],
    });
    await expect(checkResolvedTipOwnership(subject.range, subject.newParent, mixed, subject.runner)).resolves.toEqual({
      kind: 'refused', paths: [{ path: 'src/other.ts', cause: 'unowned' }],
    });
  });
});

async function restackFixture({
  addThenRevert = false,
  cleanReplay = false,
}: {
  readonly addThenRevert?: boolean;
  readonly cleanReplay?: boolean;
} = {}) {
  const repo = await mkdtemp(join(tmpdir(), 'restack-adapted-executor-'));
  repositories.push(repo);
  const git = (args: string[], env?: NodeJS.ProcessEnv) => execFile('git', args, {
    cwd: repo,
    ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
  });
  const write = async (path: string, contents: string) => {
    await mkdir(join(repo, path, '..'), { recursive: true });
    await writeFile(join(repo, path), contents);
  };
  const commit = async (subject: string) => {
    await git(['add', '-A']);
    await git(['commit', '-qm', subject]);
    return sha((await git(['rev-parse', 'HEAD'])).stdout);
  };
  const tip = async (revision: string) => (await git(['rev-parse', revision])).stdout.trim();

  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.test']);
  await git(['config', 'user.name', 'Restack adapted executor']);
  await write('.gitignore', '.pipeline/\n');
  await write('src/c.ts', 'one\ntwo\n');
  await write('tests/b.test.ts', 'base test\n');
  await commit('base');

  await git(['checkout', '-qb', 'feat/c1/demo']);
  await write('c1.txt', 'child one\n');
  const c1 = await commit('C1');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);

  await git(['checkout', '-qb', 'feat/c2/demo']);
  if (addThenRevert) {
    await write('tests/b.test.ts', 'base test\nshared line\n');
    await commit('C2 add parent line');
    await write('tests/b.test.ts', 'base test\n');
    await commit('C3 revert parent line');
  } else if (cleanReplay) {
    await write('src/main.ts', 'child main\n');
    await commit('C2 clean replay');
  } else {
    await write('src/c.ts', 'one\nchild\n');
    await commit('C2 conflict');
  }
  const c2 = await tip('HEAD');
  await git(['update-ref', 'refs/conductor/demo/closed/c2', c2]);

  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await write('leaf.txt', 'leaf\n');
  await commit('L1');

  await git(['checkout', '-q', 'feat/c1/demo']);
  await write('src/c.ts', 'one\nparent\n');
  await write('tests/a.test.ts', 'parent test\n');
  await write('tests/b.test.ts', addThenRevert ? 'base test\nshared line\n' : 'parent changed test\n');
  await commit('repair child one');
  await git(['checkout', '-q', 'feat/daemon-demo']);
  await writeSliceTopologyFixture(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2, '3': 3 }, titles: ['Child 1', 'Child 2', 'Leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  }, envelopeFilesystem);

  return { repo, git, write, tip };
}

async function persistedAppliedPaths(repo: string): Promise<Map<number, string[]>> {
  const records = (await readFile(join(repo, '.pipeline', 'events.jsonl'), 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; child?: number; adaptedPaths?: string[] });
  return new Map(records
    .filter((record): record is { type: 'restack_applied'; child: number; adaptedPaths: string[] } => record.type === 'restack_applied' && record.child !== undefined)
    .map((record) => [record.child, record.adaptedPaths]));
}

describe('runRestack resolved-tip and clean-replay ownership (real local Git)', () => {
  it('accepts an adapting resolver tip, records child 2 as resolved, and replays child 3 onto it', async () => {
    const subject = await restackFixture();
    const journalChildren: unknown[] = [];
    const nativeGit = makeGitRunner(subject.repo);
    const git: GitRunner = async (args, options) => {
      if (args[0] === 'update-ref' && args[1] === '--stdin' && options?.input?.includes(journalRefFor('demo'))) {
        const line = options.input.split('\n').find((candidate) => candidate.startsWith(`update ${journalRefFor('demo')} `));
        const blob = line?.split(' ')[2];
        if (blob) journalChildren.push(JSON.parse((await nativeGit(['cat-file', 'blob', blob])).stdout).children);
      }
      return nativeGit(args, options);
    };
    const resolver: RestackResolver = async ({ projectRoot, environment }) => {
      const resolverGit = (args: string[]) => execFile('git', args, { cwd: projectRoot, env: { ...process.env, ...environment } });
      await writeFile(join(projectRoot, 'src/c.ts'), 'one\nresolved child\n');
      await writeFile(join(projectRoot, 'tests/a.test.ts'), 'adapted parent test\n');
      await resolverGit(['add', 'src/c.ts', 'tests/a.test.ts']);
      await resolverGit(['rebase', '--continue']);
      return { resolved: true };
    };

    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await expect(runRestack({
        worktree: subject.repo, slug: 'demo', cause: 'feature-repair', events, git, resolver, resolverCap: 1,
      })).resolves.toMatchObject({ kind: 'applied' });
    } finally {
      persister.stop();
    }

    expect(journalChildren).toContainEqual(expect.arrayContaining([expect.objectContaining({ child: 2, status: 'resolved' })]));
    expect(journalChildren.flat()).not.toContainEqual(expect.objectContaining({ adaptedPaths: expect.anything() }));
    const appliedPaths = await persistedAppliedPaths(subject.repo);
    expect(appliedPaths.get(2)).toEqual(['tests/a.test.ts']);
    expect(appliedPaths.get(3)).toEqual([]);
    const resolvedChild = await subject.tip('feat/c2/demo');
    expect(await subject.git(['show', 'feat/c2/demo:tests/a.test.ts'])).toMatchObject({ stdout: 'adapted parent test\n' });
    expect(await subject.git(['merge-base', '--is-ancestor', resolvedChild, 'feat/daemon-demo'])).toMatchObject({ stdout: '' });
  });

  it('persists the resolved child\'s changed parent test as an adapted path', async () => {
    const subject = await restackFixture();
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    const resolver: RestackResolver = async ({ projectRoot, environment }) => {
      const resolverGit = (args: string[]) => execFile('git', args, { cwd: projectRoot, env: { ...process.env, ...environment } });
      await writeFile(join(projectRoot, 'src/c.ts'), 'one\nresolved child\n');
      await writeFile(join(projectRoot, 'tests/b.test.ts'), 'adapted changed test\n');
      await resolverGit(['add', 'src/c.ts', 'tests/b.test.ts']);
      await resolverGit(['rebase', '--continue']);
      return { resolved: true };
    };
    try {
      await expect(runRestack({
        worktree: subject.repo, slug: 'demo', cause: 'feature-repair', events,
        git: makeGitRunner(subject.repo), resolver, resolverCap: 1,
      })).resolves.toMatchObject({ kind: 'applied' });
    } finally {
      persister.stop();
    }

    expect((await persistedAppliedPaths(subject.repo)).get(2)).toEqual(['tests/b.test.ts']);
  });

  it('persists no adapted paths for a conflict-free replay', async () => {
    const subject = await restackFixture({ cleanReplay: true });
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await expect(runRestack({
        worktree: subject.repo, slug: 'demo', cause: 'feature-repair', events, git: makeGitRunner(subject.repo),
      })).resolves.toMatchObject({ kind: 'applied' });
    } finally {
      persister.stop();
    }

    expect((await persistedAppliedPaths(subject.repo)).get(2)).toEqual([]);
  });

  it('persists no adapted paths when a resolved tip changes only owned paths', async () => {
    const subject = await restackFixture();
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    const resolver: RestackResolver = async ({ projectRoot, environment }) => {
      const resolverGit = (args: string[]) => execFile('git', args, { cwd: projectRoot, env: { ...process.env, ...environment } });
      await writeFile(join(projectRoot, 'src/c.ts'), 'one\nresolved child\n');
      await resolverGit(['add', 'src/c.ts']);
      await resolverGit(['rebase', '--continue']);
      return { resolved: true };
    };
    try {
      await expect(runRestack({
        worktree: subject.repo, slug: 'demo', cause: 'feature-repair', events,
        git: makeGitRunner(subject.repo), resolver, resolverCap: 1,
      })).resolves.toMatchObject({ kind: 'applied' });
    } finally {
      persister.stop();
    }

    expect((await persistedAppliedPaths(subject.repo)).get(2)).toEqual([]);
  });

  it('keeps a clean add-then-revert replay strict when the repaired parent adds the reverted line', async () => {
    const subject = await restackFixture({ addThenRevert: true });
    const before = (await subject.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/', 'refs/conductor/demo/closed/'])).stdout;
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await expect(runRestack({ worktree: subject.repo, slug: 'demo', cause: 'feature-repair', events, git: makeGitRunner(subject.repo) }))
        .resolves.toMatchObject({ kind: 'halted' });
    } finally {
      persister.stop();
    }

    expect((await subject.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/', 'refs/conductor/demo/closed/'])).stdout).toBe(before);
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('tests/b.test.ts');
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    const eventsJson = await readFile(join(subject.repo, '.pipeline', 'events.jsonl'), 'utf8');
    expect(eventsJson.split('\n').filter(Boolean).map((line) => JSON.parse(line) as { type: string; reason?: string; detail?: string }))
      .toContainEqual(expect.objectContaining({ type: 'restack_refused', reason: 'replay-mismatch', detail: expect.stringContaining('tests/b.test.ts') }));
  });
});
