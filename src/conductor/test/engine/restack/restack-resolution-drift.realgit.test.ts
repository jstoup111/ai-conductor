// Covers: task:5, task:6
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { ConductorEventEmitter } from '../../../src/engine/conductor-event-emitter.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { dispatchStackRestackResolve } from '../../../src/engine/stack-restack-resolve-cli.js';
import { haltRecordPathFor } from '../../../src/engine/restack/halt-record-bookkeeping.js';
import { readConflictRecord, resolutionRefFor } from '../../../src/engine/restack/restack-conflict-record.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { parseCommitSha, type CommitSha } from '../../../src/engine/restack/restack-types.js';
import { sealStack } from './restack-sweepG2-fixture.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];

function sha(raw: string): CommitSha {
  const parsed = parseCommitSha(raw.trim());
  if (!parsed) throw new Error(`expected SHA, got ${raw}`);
  return parsed;
}

function child(value: number) {
  const parsed = parseChildId(value);
  if (!parsed) throw new Error(`expected child id, got ${value}`);
  return parsed;
}

interface Fixture {
  readonly repo: string;
  readonly git: (args: string[]) => Promise<{ readonly stdout: string; readonly stderr: string }>;
  readonly newDefault: CommitSha;
}

async function fixture(defaultPath = 'src/flag.ts'): Promise<Fixture> {
  const repo = await mkdtemp(join(tmpdir(), 'restack-resolution-drift-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (subject: string, path: string, content: string) => {
    await mkdir(join(repo, path, '..'), { recursive: true });
    await writeFile(join(repo, path), content);
    await git(['add', path]);
    await git(['commit', '-qm', subject]);
    return sha((await git(['rev-parse', 'HEAD'])).stdout);
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'resolution@example.test']);
  await git(['config', 'user.name', 'Resolution drift']);
  await commit('base', 'src/flag.ts', 'base\n');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const one = await commit('child one', 'src/one.ts', 'one\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', one]);
  await git(['checkout', '-qb', 'feat/c2/demo']);
  const two = await commit('child two', 'src/flag.ts', 'child\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c2', two]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await commit('leaf', 'src/leaf.ts', 'leaf\n');
  await git(['checkout', '-q', 'main']);
  const newDefault = await commit('default changes', defaultPath, 'default\n');
  await git(['checkout', '-q', 'feat/daemon-demo']);
  await sealStack(repo);
  return { repo, git, newDefault };
}

async function haltAndRecordTip(
  subject: Fixture,
  resolution = { child: '2', path: 'src/flag.ts', subject: 'child two' },
): Promise<RestackConflictRecord> {
  await expect(runRestack({
    worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.newDefault,
    git: makeGitRunner(subject.repo), resolver: async () => ({ resolved: false, reason: 'operator required' }), resolverCap: 1,
  })).resolves.toMatchObject({ kind: 'halted' });
  const stored = await readConflictRecord(subject.repo, 'demo', { git: makeGitRunner(subject.repo) });
  if (stored.kind !== 'record') throw new Error('expected conflict record');

  await subject.git(['checkout', '-qb', 'operator-resolution', stored.record.newParent]);
  await writeFile(join(subject.repo, resolution.path), 'resolved\n');
  await subject.git(['add', resolution.path]);
  await subject.git(['commit', '-qm', resolution.subject]);
  const tip = sha((await subject.git(['rev-parse', 'HEAD'])).stdout);
  await subject.git(['checkout', '-q', 'feat/daemon-demo']);

  await expect(dispatchStackRestackResolve({ slug: 'demo', child: resolution.child, tip }, {
    cwd: subject.repo,
    resolveMainRoot: async () => subject.repo,
    resolveWorktree: async () => subject.repo,
    acquireLease: async () => ({ kind: 'acquired' as const, lease: { release: async () => ({ ok: true as const }) } }),
    resolveOperator: async () => 'operator@example.test',
    print: () => undefined,
    git: makeGitRunner(subject.repo),
  })).resolves.toBe(0);
  return stored.record;
}

async function commitLeafHaltRecord(subject: Fixture, contents: string): Promise<CommitSha> {
  const path = haltRecordPathFor('demo');
  await mkdir(join(subject.repo, '.docs', 'halted'), { recursive: true });
  await writeFile(join(subject.repo, path), contents);
  await subject.git(['add', path]);
  await subject.git(['commit', '-qm', 'halt record: demo']);
  return sha((await subject.git(['rev-parse', 'HEAD'])).stdout);
}

async function commitHaltRecord(subject: Fixture, contents: string): Promise<CommitSha> {
  await subject.git(['checkout', '-q', 'main']);
  const path = haltRecordPathFor('demo');
  await mkdir(join(subject.repo, '.docs', 'halted'), { recursive: true });
  await writeFile(join(subject.repo, path), contents);
  await subject.git(['add', path]);
  await subject.git(['commit', '-qm', 'halt record: demo']);
  const result = sha((await subject.git(['rev-parse', 'HEAD'])).stdout);
  await subject.git(['checkout', '-q', 'feat/daemon-demo']);
  return result;
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

describe('recorded resolution parent-tree drift (real local Git)', () => {
  it('consumes a recorded --tip when child 3 only gained this feature’s halt record after its recorded tip', async () => {
    const subject = await fixture('src/leaf.ts');
    await haltAndRecordTip(subject, { child: '3', path: 'src/leaf.ts', subject: 'leaf' });
    await commitLeafHaltRecord(subject, 'Status: resolved\n');
    const events: unknown[] = [];
    const emitter = new ConductorEventEmitter();
    emitter.on('restack_resolution', (event) => events.push(event));

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.newDefault,
      events: emitter, git: makeGitRunner(subject.repo), resolver: async () => ({ resolved: false, reason: 'must not resolve' }), resolverCap: 1,
    })).resolves.toMatchObject({ kind: 'applied' });

    expect(events).toContainEqual(expect.objectContaining({ type: 'restack_resolution', action: 'consumed', child: 3 }));
  });

  it('does not consume a recorded --tip when child 3 gained a mixed halt-record commit', async () => {
    const subject = await fixture('src/leaf.ts');
    await haltAndRecordTip(subject, { child: '3', path: 'src/leaf.ts', subject: 'leaf' });
    await mkdir(join(subject.repo, '.docs', 'halted'), { recursive: true });
    await writeFile(join(subject.repo, haltRecordPathFor('demo')), 'Status: resolved\n');
    await writeFile(join(subject.repo, 'src', 'a.ts'), 'changed\n');
    await subject.git(['add', '.docs/halted/demo.md', 'src/a.ts']);
    await subject.git(['commit', '-qm', 'mixed halt record']);

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.newDefault,
      git: makeGitRunner(subject.repo), resolver: async () => ({ resolved: false, reason: 'must not resolve' }), resolverCap: 1,
    })).resolves.toMatchObject({ kind: 'halted' });

    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('range');
    await expect(makeGitRunner(subject.repo)(['rev-parse', '-q', '--verify', resolutionRefFor('demo', child(3))])).resolves.toMatchObject({ exitCode: 0 });
  });

  it('does not consume a recorded --tip when child 3 gained a halt-record merge commit', async () => {
    const subject = await fixture('src/leaf.ts');
    await haltAndRecordTip(subject, { child: '3', path: 'src/leaf.ts', subject: 'leaf' });
    await subject.git(['checkout', '-qb', 'halt-record-side']);
    await commitLeafHaltRecord(subject, 'Status: resolved\nUpdated: once\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    await subject.git(['merge', '--no-ff', 'halt-record-side', '-m', 'merge halt record']);

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.newDefault,
      git: makeGitRunner(subject.repo), resolver: async () => ({ resolved: false, reason: 'must not resolve' }), resolverCap: 1,
    })).resolves.toMatchObject({ kind: 'halted' });

    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('range');
    await expect(makeGitRunner(subject.repo)(['rev-parse', '-q', '--verify', resolutionRefFor('demo', child(3))])).resolves.toMatchObject({ exitCode: 0 });
  });

  it('consumes a recorded --tip when the rebuilt parent only gained this feature’s halt record', async () => {
    const subject = await fixture();
    const record = await haltAndRecordTip(subject);
    await commitHaltRecord(subject, 'Status: halted\n');
    const advanced = await commitHaltRecord(subject, 'Status: resolved\n');
    const events: unknown[] = [];
    const emitter = new ConductorEventEmitter();
    emitter.on('restack_resolution', (event) => events.push(event));

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced,
      events: emitter, git: makeGitRunner(subject.repo), resolver: async () => ({ resolved: false, reason: 'must not resolve' }), resolverCap: 1,
    })).resolves.toMatchObject({ kind: 'applied' });

    expect(events).toContainEqual(expect.objectContaining({ type: 'restack_resolution', action: 'consumed', child: 2 }));
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).rejects.toThrow();
    await expect(makeGitRunner(subject.repo)(['rev-parse', '-q', '--verify', resolutionRefFor('demo', child(2))])).resolves.toMatchObject({ exitCode: 1 });
    expect(record.newParent).not.toBe(advanced);
  });

  it.each([
    ['another feature halt record', '.docs/halted/other.md', 'other\n'],
    ['this feature halt record plus feature content', '.docs/halted/demo.md', 'Status: halted\n'],
  ])('does not consume a resolution when the rebuilt parent changes at %s', async (_label, path, contents) => {
    const subject = await fixture();
    await haltAndRecordTip(subject);
    await subject.git(['checkout', '-q', 'main']);
    await mkdir(join(subject.repo, path, '..'), { recursive: true });
    await writeFile(join(subject.repo, path), contents);
    if (path === '.docs/halted/demo.md') await writeFile(join(subject.repo, 'src', 'a.ts'), 'changed\n');
    await subject.git(['add', '.']);
    await subject.git(['commit', '-qm', 'parent changes']);
    const advanced = sha((await subject.git(['rev-parse', 'HEAD'])).stdout);
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced,
      git: makeGitRunner(subject.repo), resolver: async () => ({ resolved: false, reason: 'must not resolve' }), resolverCap: 1,
    })).resolves.toMatchObject({ kind: 'halted' });
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('parent-tree');
  });

  it.each(['live', 'recorded'] as const)('halts without moving stack refs when masking the %s tree fails', async (failedTree) => {
    const subject = await fixture();
    await haltAndRecordTip(subject);
    const advanced = await commitHaltRecord(subject, 'Status: halted\n');
    const before = (await subject.git([
      'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/feat/', 'refs/conductor/demo/closed/',
    ])).stdout;
    const native = makeGitRunner(subject.repo);
    let calls = 0;
    const failing: GitRunner = async (args, options) => {
      if (args[0] === 'read-tree' && ++calls === (failedTree === 'live' ? 1 : 2)) return { exitCode: 1, stdout: '', stderr: 'masked tree unavailable' };
      return native(args, options);
    };

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced,
      git: failing, resolver: async () => ({ resolved: false, reason: 'must not resolve' }), resolverCap: 1,
    })).resolves.toMatchObject({ kind: 'halted' });

    expect((await subject.git([
      'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/feat/', 'refs/conductor/demo/closed/',
    ])).stdout).toBe(before);
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('parent-tree');
  });
});
