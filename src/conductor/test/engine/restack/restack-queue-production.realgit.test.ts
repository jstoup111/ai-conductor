// Covers: task:31
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { writeCoverageBindingEnvelope } from '../../../src/engine/coverage-binding-envelope.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { readRevalidationQueue } from '../../../src/engine/routing/route-record-store.js';
import { revalidationQueueRefFor } from '../../../src/engine/routing/routing-refs.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { readRestackJournal, journalRefFor, writeRestackJournalBlob } from '../../../src/engine/restack/restack-journal.js';
import { recoverRestackJournal } from '../../../src/engine/restack/restack-recovery.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => rm(repository, { recursive: true, force: true })));
});

function recordingRunner(git: GitRunner) {
  const calls: Array<{ readonly args: string[]; readonly input?: string }> = [];
  return {
    calls,
    git: async (args: string[], options?: { input?: string }) => {
      calls.push({ args: [...args], ...(options?.input === undefined ? {} : { input: options.input }) });
      return git(args, options);
    },
  };
}

async function fixture(routingEnabled = true) {
  const repo = await mkdtemp(join(tmpdir(), 'restack-queue-production-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, path: string, contents: string) => {
    await writeFile(join(repo, path), contents);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };

  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack-queue@example.test']);
  await git(['config', 'user.name', 'Restack queue']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await git(['add', '.gitignore']);
  await commit('base', 'base.txt', 'base\n');

  await git(['checkout', '-qb', 'feat/c1/demo']);
  const c1 = await commit('closed child 1', 'one.ts', 'export const one = 1;\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
  await git(['checkout', '-qb', 'feat/c2/demo']);
  const c2 = await commit('closed child 2', 'two.ts', 'export const two = 2;\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c2', c2]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await commit('leaf', 'leaf.ts', 'export const leaf = true;\n');
  if (routingEnabled) {
    await mkdir(join(repo, '.ai-conductor'), { recursive: true });
    await writeFile(join(repo, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  route_whole_feature_fixes: true\n');
    await git(['add', '.ai-conductor/config.yml']);
    await git(['commit', '-qm', 'enable routed queue']);
  } else {
    await mkdir(join(repo, '.ai-conductor'), { recursive: true });
    await writeFile(join(repo, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  route_whole_feature_fixes: false\n');
    await git(['add', '.ai-conductor/config.yml']);
    await git(['commit', '-qm', 'disable routed queue']);
  }
  await git(['checkout', '-q', 'main']);
  const advanced = await commit('advance parseA', 'a.ts', 'export function parseA(value: string, radix = 10) { return Number.parseInt(value, radix); }\n');
  await git(['checkout', '-q', 'feat/daemon-demo']);
  await writeCoverageBindingEnvelope(repo, {
    version: 1,
    slug: 'demo',
    runId: 'queue-run',
    status: 'done',
    entries: [],
    sliceMembership: { taskSlices: { one: 1, two: 2, leaf: 3 }, titles: ['one', 'two', 'leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  }, {
    readFile: (path) => readFile(path, 'utf8'),
    mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
    writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
    rename,
  });
  return { repo, advanced, c1, c2, git: makeGitRunner(repo) };
}

async function seedQueue(subject: { readonly repo: string; readonly git: GitRunner }) {
  const written = await subject.git(['hash-object', '-w', '--stdin'], {
    input: JSON.stringify({ generation: 7, entries: [], outbox: [] }),
  });
  const blob = written.stdout.trim();
  await subject.git(['update-ref', revalidationQueueRefFor('demo'), blob]);
  return blob;
}

async function queueBlob(subject: { readonly repo: string; readonly git: GitRunner }) {
  return (await subject.git(['rev-parse', revalidationQueueRefFor('demo')])).stdout.trim();
}

async function leafOnlyFixture() {
  const repo = await mkdtemp(join(tmpdir(), 'restack-queue-leaf-only-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack-queue@example.test']);
  await git(['config', 'user.name', 'Restack queue']);
  await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await writeFile(join(repo, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  route_whole_feature_fixes: true\n');
  await writeFile(join(repo, 'base.txt'), 'base\n');
  await git(['add', '.ai-conductor/config.yml', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await writeFile(join(repo, 'leaf.ts'), 'export const leaf = true;\n');
  await git(['add', 'leaf.ts']);
  await git(['commit', '-qm', 'leaf']);
  await writeCoverageBindingEnvelope(repo, {
    version: 1,
    slug: 'demo',
    runId: 'leaf-only-queue-run',
    status: 'done',
    entries: [],
    sliceMembership: { taskSlices: { leaf: 1 }, titles: ['leaf'] },
    storyOwnership: { S1: 1 },
  }, {
    readFile: (path) => readFile(path, 'utf8'),
    mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
    writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
    rename,
  });
  return { repo, git: makeGitRunner(repo) };
}

describe('restack queue production (real local Git)', () => {
  // Covers: task:31
  it('writes an invalidated closed child to the queue only in the applied transaction', async () => {
    const subject = await fixture();
    const recorded = recordingRunner(subject.git);

    await expect(runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'base-refresh',
      newDefault: subject.advanced,
      git: recorded.git,
    })).resolves.toMatchObject({ kind: 'applied' });

    const queue = await readRevalidationQueue(subject.repo, 'demo', { git: subject.git });
    expect(queue).toMatchObject({
      kind: 'queue',
      queue: { entries: expect.arrayContaining([expect.objectContaining({ child: 2, position: 2, gates: expect.arrayContaining(['test_suite']) })]) },
    });
    if (queue.kind !== 'queue') throw new Error('queue was not readable');
    const childTwo = queue.queue.entries.find((entry) => entry.child === 2);
    expect(childTwo).toMatchObject({
      closureSha: (await subject.git(['rev-parse', 'refs/conductor/demo/closed/c2'])).stdout.trim(),
      replay: {
        oldParent: subject.c1,
        newParent: (await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).stdout.trim(),
      },
    });
    const queueTransactions = recorded.calls
      .filter((call) => call.args[0] === 'update-ref' && call.args[1] === '--stdin' && call.input?.includes(revalidationQueueRefFor('demo')))
      .map((call) => call.input!);
    expect(queueTransactions).toHaveLength(1);
    expect(queueTransactions[0]).toContain(journalRefFor('demo'));
  });

  // Covers: task:31
  it('does not name the queue ref when routing is off', async () => {
    const subject = await fixture(false);
    const queueOld = await seedQueue(subject);
    const recorded = recordingRunner(subject.git);

    await expect(runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'base-refresh',
      newDefault: subject.advanced,
      git: recorded.git,
    })).resolves.toMatchObject({ kind: 'applied' });

    expect(recorded.calls.some((call) => call.args.join(' ').includes(revalidationQueueRefFor('demo')) || call.input?.includes(revalidationQueueRefFor('demo')))).toBe(false);
    await expect(queueBlob(subject)).resolves.toBe(queueOld);
  });

  // Covers: task:31
  it('writes equivalent queue generations for base refresh, operator feature repair, and synced recovery', async () => {
    const baseRefresh = await fixture();
    await expect(runRestack({
      worktree: baseRefresh.repo,
      slug: 'demo',
      cause: 'base-refresh',
      newDefault: baseRefresh.advanced,
      git: baseRefresh.git,
    })).resolves.toMatchObject({ kind: 'applied' });
    const baseQueue = await readRevalidationQueue(baseRefresh.repo, 'demo', { git: baseRefresh.git });
    expect(baseQueue).toMatchObject({ kind: 'queue' });

    const repair = await fixture();
    await repair.git(['checkout', '-q', 'feat/c1/demo']);
    await mkdir(join(repair.repo, '.ai-conductor'), { recursive: true });
    await writeFile(join(repair.repo, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  route_whole_feature_fixes: true\n');
    await repair.git(['add', '.ai-conductor/config.yml']);
    await repair.git(['commit', '-qm', 'operator repair']);
    await expect(runRestack({
      worktree: repair.repo,
      slug: 'demo',
      cause: 'feature-repair',
      git: repair.git,
    })).resolves.toMatchObject({ kind: 'applied' });
    await expect(readRevalidationQueue(repair.repo, 'demo', { git: repair.git })).resolves.toMatchObject({
      kind: 'queue',
      queue: { entries: expect.arrayContaining([expect.objectContaining({ child: 2 })]) },
    });

    const recovery = await fixture();
    let interrupted = false;
    const crashBeforeApplied: GitRunner = async (args, options) => {
      if (!interrupted && args[0] === 'update-ref' && args[1] === '--stdin' && options?.input?.includes(revalidationQueueRefFor('demo'))) {
        interrupted = true;
        throw new Error('simulated crash after queue plan');
      }
      const result = await recovery.git(args, options);
      return result;
    };
    await expect(runRestack({
      worktree: recovery.repo,
      slug: 'demo',
      cause: 'base-refresh',
      newDefault: recovery.advanced,
      git: crashBeforeApplied,
    })).resolves.toMatchObject({ kind: 'unavailable' });
    const synced = await readRestackJournal(recovery.repo, 'demo', { git: recovery.git });
    if (synced.kind !== 'journal' || synced.journal.queueNew === undefined) throw new Error('queue plan was not journalled');
    const queueNew = synced.journal.queueNew;
    const dead = await writeRestackJournalBlob(recovery.repo, {
      ...synced.journal,
      owner: { host: 'dead-restack-owner', pid: 1, processStartTime: '0' },
    }, { git: recovery.git });
    await recovery.git(['update-ref', journalRefFor('demo'), dead, synced.blob]);
    await expect(recoverRestackJournal({ worktree: recovery.repo, slug: 'demo', git: recovery.git }))
      .resolves.toEqual({ kind: 'recovered', fromState: 'synced' });
    await expect(queueBlob(recovery)).resolves.toBe(queueNew);
    expect(baseQueue.kind === 'queue' && baseQueue.queue.entries.some((entry) => entry.child === 2)).toBe(true);
  });

  // Covers: task:31
  it('retains a pre-existing queue for rollback and a leaf-only restack', async () => {
    const rollback = await fixture();
    const rollbackQueue = await seedQueue(rollback);
    await rollback.git(['checkout', '-q', 'main']);
    await writeFile(join(rollback.repo, 'two.ts'), 'export const two = 3;\n');
    await rollback.git(['add', 'two.ts']);
    await rollback.git(['commit', '-qm', 'conflicting default change']);
    const conflictingDefault = (await rollback.git(['rev-parse', 'HEAD'])).stdout.trim();
    await rollback.git(['checkout', '-q', 'feat/daemon-demo']);
    await expect(runRestack({
      worktree: rollback.repo,
      slug: 'demo',
      cause: 'base-refresh',
      newDefault: conflictingDefault,
      git: rollback.git,
    })).resolves.not.toMatchObject({ kind: 'applied' });
    await expect(queueBlob(rollback)).resolves.toBe(rollbackQueue);

    const leafOnly = await leafOnlyFixture();
    const leafQueue = await seedQueue(leafOnly);
    await leafOnly.git(['commit', '--allow-empty', '-qm', 'leaf-only operator repair']);
    await expect(runRestack({
      worktree: leafOnly.repo,
      slug: 'demo',
      cause: 'feature-repair',
      git: leafOnly.git,
    })).resolves.toMatchObject({ kind: 'unavailable' });
    await expect(queueBlob(leafOnly)).resolves.toBe(leafQueue);
  });

  // Covers: task:31
  it('halts needs-human naming the queue ref when its applied compare-and-swap loses', async () => {
    const subject = await fixture();
    let raced = false;
    const racing: GitRunner = async (args, options) => {
      if (!raced && args[0] === 'update-ref' && args[1] === '--stdin' && options?.input?.includes(`create ${revalidationQueueRefFor('demo')}`)) {
        raced = true;
        const blob = await subject.git(['hash-object', '-w', '--stdin'], { input: JSON.stringify({ concurrent: true }) });
        await subject.git(['update-ref', revalidationQueueRefFor('demo'), blob.stdout.trim()]);
      }
      return subject.git(args, options);
    };

    await expect(runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'base-refresh',
      newDefault: subject.advanced,
      git: racing,
    })).resolves.toEqual({ kind: 'halted' });

    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(revalidationQueueRefFor('demo'));
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    const journal = await readRestackJournal(subject.repo, 'demo', { git: subject.git });
    if (journal.kind !== 'journal') throw new Error('restack journal was not retained after the lost queue CAS');
    const dead = await writeRestackJournalBlob(subject.repo, {
      ...journal.journal,
      owner: { host: 'dead-restack-owner', pid: 1, processStartTime: '0' },
    }, { git: subject.git });
    await subject.git(['update-ref', journalRefFor('demo'), dead, journal.blob]);

    await expect(recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: subject.git })).resolves.toEqual({ kind: 'halted' });
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(revalidationQueueRefFor('demo'));
  });
});
