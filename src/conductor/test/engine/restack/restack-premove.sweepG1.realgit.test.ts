import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { EventPersister } from '../../../src/engine/event-persister.js';
import { readRestackJournal } from '../../../src/engine/restack/restack-journal.js';

import { createProtectedArtifactSeal } from '../../../src/engine/protected-artifact-seal.js';
import { writeCoverageBindingEnvelope, type CoverageBindingEnvelopeFilesystem } from '../../../src/engine/coverage-binding-envelope.js';
import { makeGitRunner, REBASE_UNTRACKED_QUARANTINE_DIR } from '../../../src/engine/rebase.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

async function fixture(
  advance: { path: string; content: string } = { path: 'base.txt', content: 'base advanced\n' },
  extraAdvances: readonly { path: string; content: string }[] = [],
) {
  const repo = await mkdtemp(join(tmpdir(), 'restack-premove-sweep-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, path: string, content: string) => {
    await mkdir(join(repo, path, '..'), { recursive: true });
    await writeFile(join(repo, path), content);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };

  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.test']);
  await git(['config', 'user.name', 'Restack pre-move']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\nbuild/\n');
  await git(['add', '.gitignore']);
  await commit('base', 'src/a.ts', 'base\n');
  await commit('base text', 'base.txt', 'base\n');

  await git(['checkout', '-qb', 'feat/c1/demo']);
  const c1 = await commit('C1', 'c1.txt', 'c1\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
  await git(['checkout', '-qb', 'feat/c2/demo']);
  const c2 = await commit('C2', 'c2.txt', 'c2\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c2', c2]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await commit('L1', 'leaf.txt', 'leaf\n');
  const oldLeaf = (await git(['rev-parse', 'HEAD'])).stdout.trim();

  await git(['checkout', '-q', 'main']);
  let advancedDefault = await commit('base advance', advance.path, advance.content);
  for (const extra of extraAdvances) advancedDefault = await commit('base advance', extra.path, extra.content);
  await git(['checkout', '-q', 'feat/daemon-demo']);
  await writeCoverageBindingEnvelope(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2, '3': 3 }, titles: ['Child 1', 'Child 2', 'Leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  }, envelopeFilesystem);
  return { repo, git, oldLeaf, advancedDefault };
}

async function restack(subject: Awaited<ReturnType<typeof fixture>>, events?: ConductorEventEmitter) {
  return runRestack({
    worktree: subject.repo,
    slug: 'demo',
    cause: 'base-refresh',
    newDefault: subject.advancedDefault,
    events,
    git: makeGitRunner(subject.repo),
  });
}


type Subject = Awaited<ReturnType<typeof fixture>>;

/** Every stack ref: branches, closures and markers, excluding the operation's own journal and staging refs. */
async function refSnapshot(subject: Subject): Promise<string> {
  return (await subject.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/', 'refs/conductor/'])).stdout
    .split('\n').filter((line) => !line.startsWith('refs/conductor/demo/restack/')).join('\n');
}

async function tipOf(subject: Subject, name: string): Promise<string> {
  return (await subject.git(['rev-parse', name])).stdout.trim();
}

async function appendTo(subject: Subject, branch: string, path: string) {
  await subject.git(['checkout', '-q', branch]);
  await writeFile(join(subject.repo, path), `${path}\n`);
  await subject.git(['add', path]);
  await subject.git(['commit', '-qm', `repair ${path}`]);
  const appended = await tipOf(subject, 'HEAD');
  await subject.git(['checkout', '-q', 'feat/daemon-demo']);
  return appended;
}

async function persisted(subject: Subject, run: (events: ConductorEventEmitter) => Promise<unknown>) {
  const events = new ConductorEventEmitter();
  const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
  persister.start();
  let result: unknown;
  try {
    result = await run(events);
  } finally {
    persister.stop();
  }
  const refusals = (await readFile(join(subject.repo, '.pipeline', 'events.jsonl'), 'utf8').catch(() => '')).trim().split('\n')
    .filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((record) => record.type === 'restack_refused')
    .map(({ ts: _ts, ...record }) => record);
  return { result, refusals };
}

async function worktreeElsewhere(subject: Subject, branch: string): Promise<string> {
  const other = await mkdtemp(join(tmpdir(), 'restack-premove-sweep-other-'));
  repositories.push(other);
  await subject.git(['worktree', 'add', '-q', other, branch]);
  return other;
}

function repair(subject: Subject, events?: ConductorEventEmitter) {
  return runRestack({ worktree: subject.repo, slug: 'demo', cause: 'feature-repair', events, git: makeGitRunner(subject.repo) });
}

describe('runRestack pre-move checks (sweep G1, real local Git)', () => {
  // Covers: S4.6, task:9
  it('refuses checked-out-elsewhere for a moving child branch, including child 2 in a two-origin repair, but not an unchanged child 1', async () => {
    const baseRefresh = await fixture();
    const elsewhere = await worktreeElsewhere(baseRefresh, 'feat/c1/demo');
    const before = await refSnapshot(baseRefresh);
    const refused = await persisted(baseRefresh, (events) => restack(baseRefresh, events));
    expect(refused.result).toEqual({ kind: 'halted' });
    expect(refused.refusals).toEqual([{ type: 'restack_refused', reason: 'checked-out-elsewhere', detail: elsewhere }]);
    expect(await refSnapshot(baseRefresh)).toBe(before);
    expect(await readRestackJournal(baseRefresh.repo, 'demo')).toMatchObject({ kind: 'journal', journal: { state: 'aborted' } });

    const childTwoElsewhere = await fixture();
    await appendTo(childTwoElsewhere, 'feat/c1/demo', 'repair-one.txt');
    await appendTo(childTwoElsewhere, 'feat/c2/demo', 'repair-two.txt');
    const c2Worktree = await worktreeElsewhere(childTwoElsewhere, 'feat/c2/demo');
    const beforeTwo = await refSnapshot(childTwoElsewhere);
    const refusedTwo = await persisted(childTwoElsewhere, (events) => repair(childTwoElsewhere, events));
    expect(refusedTwo.result).toEqual({ kind: 'halted' });
    expect(refusedTwo.refusals).toEqual([{ type: 'restack_refused', reason: 'checked-out-elsewhere', detail: c2Worktree }]);
    expect(await refSnapshot(childTwoElsewhere)).toBe(beforeTwo);

    const childOneElsewhere = await fixture();
    const repairedOne = await appendTo(childOneElsewhere, 'feat/c1/demo', 'repair-one.txt');
    const repairedTwo = await appendTo(childOneElsewhere, 'feat/c2/demo', 'repair-two.txt');
    await worktreeElsewhere(childOneElsewhere, 'feat/c1/demo');
    const accepted = await persisted(childOneElsewhere, (events) => repair(childOneElsewhere, events));
    expect(accepted.result).toMatchObject({ kind: 'applied' });
    expect(accepted.refusals).toEqual([]);
    expect(await tipOf(childOneElsewhere, 'feat/c1/demo')).toBe(repairedOne);
    expect(await tipOf(childOneElsewhere, 'refs/conductor/demo/closed/c1')).toBe(repairedOne);
    const newTwo = await tipOf(childOneElsewhere, 'feat/c2/demo');
    expect(newTwo).not.toBe(repairedTwo);
    await expect(childOneElsewhere.git(['merge-base', '--is-ancestor', repairedOne, newTwo])).resolves.toBeDefined();
    expect((await childOneElsewhere.git(['show', `${newTwo}:repair-two.txt`])).stdout).toBe('repair-two.txt\n');
    expect((await childOneElsewhere.git(['show', 'feat/daemon-demo:repair-one.txt'])).stdout).toBe('repair-one.txt\n');
  });

  // Covers: S5.5, task:9
  it('refuses dirty-overlap on src/a.ts before any ref moves, leaving the edit in place and no stash', async () => {
    const subject = await fixture({ path: 'src/a.ts', content: 'advanced\n' });
    await writeFile(join(subject.repo, 'src', 'a.ts'), 'operator edit\n');
    const before = await refSnapshot(subject);

    const { result, refusals } = await persisted(subject, (events) => restack(subject, events));

    expect(result).toEqual({ kind: 'halted' });
    expect(refusals).toEqual([{ type: 'restack_refused', reason: 'dirty-overlap', detail: 'src/a.ts' }]);
    expect(await refSnapshot(subject)).toBe(before);
    await expect(readFile(join(subject.repo, 'src', 'a.ts'), 'utf8')).resolves.toBe('operator edit\n');
    expect((await subject.git(['status', '--porcelain'])).stdout).toBe(' M src/a.ts\n');
    expect((await subject.git(['stash', 'list'])).stdout).toBe('');
    await expect(subject.git(['rev-parse', '--verify', 'refs/stash'])).rejects.toBeDefined();
  });

  // Covers: S5.3, S5.6, task:9
  it('quarantines a colliding untracked tmp/out.txt and applies, and maps an unwritable quarantine to sync-collision without throwing or moving refs', async () => {
    const applied = await fixture({ path: 'tmp/out.txt', content: 'tracked output\n' });
    await mkdir(join(applied.repo, 'tmp'), { recursive: true });
    await writeFile(join(applied.repo, 'tmp', 'out.txt'), 'untracked output\n');
    await expect(restack(applied)).resolves.toMatchObject({ kind: 'applied' });
    await expect(readFile(join(applied.repo, REBASE_UNTRACKED_QUARANTINE_DIR, 'tmp', 'out.txt'), 'utf8')).resolves.toBe('untracked output\n');
    await expect(readFile(join(applied.repo, 'tmp', 'out.txt'), 'utf8')).resolves.toBe('tracked output\n');
    expect(await tipOf(applied, 'feat/daemon-demo')).not.toBe(applied.oldLeaf);

    const readOnly = await fixture({ path: 'tmp/out.txt', content: 'tracked output\n' });
    await mkdir(join(readOnly.repo, 'tmp'), { recursive: true });
    await writeFile(join(readOnly.repo, 'tmp', 'out.txt'), 'untracked output\n');
    const quarantine = join(readOnly.repo, REBASE_UNTRACKED_QUARANTINE_DIR);
    await mkdir(quarantine, { recursive: true });
    await chmod(quarantine, 0o555);
    const before = await refSnapshot(readOnly);
    try {
      const { result, refusals } = await persisted(readOnly, (events) => restack(readOnly, events));
      expect(result).toEqual({ kind: 'halted' });
      expect(refusals).toEqual([{ type: 'restack_refused', reason: 'sync-collision', detail: 'tmp/out.txt' }]);
      expect(await refSnapshot(readOnly)).toBe(before);
      await expect(readFile(join(readOnly.repo, 'tmp', 'out.txt'), 'utf8')).resolves.toBe('untracked output\n');
    } finally {
      await chmod(quarantine, 0o755);
    }
  });

  // Covers: S5.7, task:9
  it('halts on an already-violated protected-artifact seal before any ref moves', async () => {
    const subject = await fixture();
    await mkdir(join(subject.repo, '.docs', 'plans'), { recursive: true });
    await writeFile(join(subject.repo, '.docs', 'plans', 'demo.md'), 'approved\n');
    await subject.git(['add', '.docs/plans/demo.md']);
    await subject.git(['commit', '-qm', 'add approved plan']);
    await createProtectedArtifactSeal({ projectRoot: subject.repo, baselineCommit: await tipOf(subject, 'HEAD') });
    await writeFile(join(subject.repo, '.docs', 'plans', 'demo.md'), 'mutated\n');
    const before = await refSnapshot(subject);

    await expect(restack(subject)).resolves.toEqual({ kind: 'halted' });

    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('protected-artifact seal error');
    expect(await refSnapshot(subject)).toBe(before);
    await expect(readFile(join(subject.repo, '.docs', 'plans', 'demo.md'), 'utf8')).resolves.toBe('mutated\n');
  });

  // Covers: S5.8, task:9
  it('applies while an ignored build-output file is modified and treats it as no dirty work', async () => {
    const subject = await fixture();
    await mkdir(join(subject.repo, 'build'), { recursive: true });
    await writeFile(join(subject.repo, 'build', 'output.txt'), 'first build\n');
    await writeFile(join(subject.repo, 'build', 'output.txt'), 'rebuilt output\n');
    expect((await subject.git(['status', '--porcelain', '--ignored'])).stdout).toContain('!! build/');

    const { result, refusals } = await persisted(subject, (events) => restack(subject, events));

    expect(result).toMatchObject({ kind: 'applied' });
    expect(refusals).toEqual([]);
    expect(await tipOf(subject, 'feat/daemon-demo')).not.toBe(subject.oldLeaf);
    await expect(readFile(join(subject.repo, 'build', 'output.txt'), 'utf8')).resolves.toBe('rebuilt output\n');
  });
});
