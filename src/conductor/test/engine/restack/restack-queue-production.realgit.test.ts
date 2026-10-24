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
  const base = await commit('base', 'base.txt', 'base\n');

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
    const recorded = recordingRunner(subject.git);

    await expect(runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'base-refresh',
      newDefault: subject.advanced,
      git: recorded.git,
    })).resolves.toMatchObject({ kind: 'applied' });

    expect(recorded.calls.some((call) => call.args.join(' ').includes(revalidationQueueRefFor('demo')) || call.input?.includes(revalidationQueueRefFor('demo')))).toBe(false);
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
