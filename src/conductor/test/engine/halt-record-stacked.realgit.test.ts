// Covers: task:13, task:14
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { haltRecordPath, supersedeHaltRecord } from '../../src/engine/halt-record.js';
import { haltRecordRefFor, readHaltRecordRef } from '../../src/engine/halt-record-ref.js';
import { writeHaltMarker } from '../../src/engine/halt-marker.js';
import { journalRefFor, writeRestackJournalBlob, type RestackJournal } from '../../src/engine/restack/restack-journal.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from './slice-topology-fixture.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];

const filesystem: SliceTopologyFixtureFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('stacked halt records (real local Git)', () => {
  it('stores an operator halt in the ref without moving feature branches or pushing', async () => {
    const subject = await fixture({ durable: true });
    const events = new ConductorEventEmitter();
    const paths: string[] = [];
    events.on('halt_record_written', (event) => {
      if (event.type === 'halt_record_written') paths.push(event.path);
    });
    const before = await featureTips(subject.worktree);

    await expect(writeHaltMarker(subject.worktree, 'operator decision required\n', 'needs-human', events, subject.remote))
      .resolves.toEqual({ status: 'written' });

    await expect(readHaltRecordRef(subject.worktree, 'demo')).resolves.toMatchObject({
      kind: 'record', source: 'ref', text: expect.stringContaining('Status: halted\n'),
    });
    await expect(readHaltRecordRef(subject.worktree, 'demo')).resolves.toMatchObject({
      kind: 'record', text: expect.stringContaining('Child: 2\n'),
    });
    expect(await featureTips(subject.worktree)).toEqual(before);
    expect(await status(subject.worktree)).not.toContain('.docs/halted/demo.md');
    expect(subject.pushes).toEqual([]);
    expect(paths).toEqual([haltRecordRefFor('demo')]);
  });

  it('keeps branch-visible records and publication for an unstacked leaf', async () => {
    const subject = await fixture();
    const before = await head(subject.worktree);

    await expect(writeHaltMarker(subject.worktree, 'operator decision required\n', 'needs-human', undefined, subject.remote))
      .resolves.toEqual({ status: 'written' });

    expect(await head(subject.worktree)).not.toBe(before);
    await expect(readFile(join(subject.worktree, haltRecordPath('demo')), 'utf8')).resolves.toContain('Status: halted\n');
    expect(subject.pushes).toHaveLength(1);
    await expect(refExists(subject.worktree, haltRecordRefFor('demo'))).resolves.toBe(false);
  });

  it('keeps the HALT and reports failures without creating a branch commit', async () => {
    const gitError = await fixture();
    const gitErrorEvents = failures(gitError.worktree);
    await mkdir(join(gitError.worktree, '.pipeline', 'children'), { recursive: true });
    await rm(join(gitError.worktree, '.pipeline', 'children'), { recursive: true });
    await writeFile(join(gitError.worktree, '.pipeline', 'children'), 'not a directory\n');
    const beforeGitError = await head(gitError.worktree);

    await expect(writeHaltMarker(gitError.worktree, 'operator decision required\n', 'needs-human', gitErrorEvents.events))
      .resolves.toEqual({ status: 'written' });

    expect(await head(gitError.worktree)).toBe(beforeGitError);
    await expect(readFile(join(gitError.worktree, '.pipeline', 'HALT'), 'utf8')).resolves.toBe('operator decision required\n');
    expect(gitErrorEvents.paths).toEqual([haltRecordPath('demo')]);

    const casFailure = await fixture({ durable: true });
    const casFailureEvents = failures(casFailure.worktree);
    const commonDir = (await casFailure.git(['rev-parse', '--git-common-dir'])).stdout.trim();
    await mkdir(join(commonDir, 'refs', 'conductor', 'demo', 'halt-record'), { recursive: true });
    await writeFile(join(commonDir, 'refs', 'conductor', 'demo', 'halt-record', 'blocker'), 'block\n');
    const beforeCasFailure = await head(casFailure.worktree);

    await expect(writeHaltMarker(casFailure.worktree, 'operator decision required\n', 'needs-human', casFailureEvents.events))
      .resolves.toEqual({ status: 'written' });

    expect(await head(casFailure.worktree)).toBe(beforeCasFailure);
    await expect(readFile(join(casFailure.worktree, '.pipeline', 'HALT'), 'utf8')).resolves.toBe('operator decision required\n');
    expect(casFailureEvents.paths).toEqual([haltRecordPath('demo')]);
  });

  it('does not record a mechanical halt on a stacked feature', async () => {
    const mechanical = await fixture({ durable: true });
    await expect(writeHaltMarker(mechanical.worktree, 'retry later\n', 'mechanical', undefined, mechanical.remote))
      .resolves.toEqual({ status: 'written' });
    await expect(refExists(mechanical.worktree, haltRecordRefFor('demo'))).resolves.toBe(false);
  });

  it('records through a live ready journal without moving its refs', async () => {
    const journal = await fixture({ durable: true });
    const journalBlob = await liveReadyJournal(journal.worktree);
    const before = await featureTips(journal.worktree);
    await expect(writeHaltMarker(journal.worktree, 'operator decision required\n', 'needs-human', undefined, journal.remote))
      .resolves.toEqual({ status: 'written' });

    expect((await journal.git(['rev-parse', journalRefFor('demo')])).stdout.trim()).toBe(journalBlob);
    expect(await featureTips(journal.worktree)).toEqual(before);
    await expect(refExists(journal.worktree, haltRecordRefFor('demo'))).resolves.toBe(true);
  });

  it('clears a stacked halt on the record ref while preserving its audit trail and every feature tip', async () => {
    const subject = await fixture({ durable: true });
    const before = await featureTips(subject.worktree);
    await writeHaltMarker(subject.worktree, 'operator decision required\n', 'needs-human', undefined, subject.remote);

    await expect(supersedeHaltRecord(subject.worktree, 'demo', 'operator resume', subject.remote)).resolves.toEqual({ kind: 'written', path: haltRecordRefFor('demo') });

    await expect(readHaltRecordRef(subject.worktree, 'demo')).resolves.toMatchObject({
      kind: 'record', source: 'ref', text: expect.stringContaining('Status: resolved\nResolution cause: operator resume\n'),
    });
    await expect(readHaltRecordRef(subject.worktree, 'demo')).resolves.toMatchObject({
      kind: 'record', text: expect.stringContaining('operator decision required\n'),
    });
    expect(await featureTips(subject.worktree)).toEqual(before);
    await expect(subject.git(['log', '-p', haltRecordRefFor('demo')])).resolves.toMatchObject({
      stdout: expect.stringContaining('+Status: halted'),
    });
    await expect(subject.git(['log', '-p', haltRecordRefFor('demo')])).resolves.toMatchObject({
      stdout: expect.stringContaining('+Status: resolved'),
    });
  });

  it('leaves the closed first child equal to its closed ref after halting and clearing', async () => {
    const subject = await fixture({ durable: true });
    await writeHaltMarker(subject.worktree, 'operator decision required\n', 'needs-human', undefined, subject.remote);
    await expect(supersedeHaltRecord(subject.worktree, 'demo', 'operator resume', subject.remote)).resolves.toMatchObject({ kind: 'written' });

    await expect(subject.git(['rev-parse', 'refs/heads/feat/c1/demo'])).resolves.toMatchObject({
      stdout: (await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).stdout,
    });
  });

  it('leaves the active leaf unchanged and never pushes while halting and clearing', async () => {
    const subject = await fixture({ durable: true });
    const before = await head(subject.worktree);
    await writeHaltMarker(subject.worktree, 'operator decision required\n', 'needs-human', undefined, subject.remote);
    await expect(supersedeHaltRecord(subject.worktree, 'demo', 'operator resume', subject.remote)).resolves.toMatchObject({ kind: 'written' });

    expect(await head(subject.worktree)).toBe(before);
    expect(subject.pushes).toEqual([]);
  });

  it('upgrades a committed stacked halt to a resolved record ref without a branch commit', async () => {
    const subject = await fixture({ durable: true });
    await mkdir(join(subject.worktree, '.docs', 'halted'), { recursive: true });
    await writeFile(join(subject.worktree, haltRecordPath('demo')), 'Status: halted\n\n## HALT\n\nlegacy halt\n');
    await subject.git(['add', haltRecordPath('demo')]);
    await subject.git(['commit', '-qm', 'legacy halt record']);
    const before = await featureTips(subject.worktree);

    await expect(supersedeHaltRecord(subject.worktree, 'demo', 'operator resume', subject.remote)).resolves.toEqual({ kind: 'written', path: haltRecordRefFor('demo') });

    await expect(readHaltRecordRef(subject.worktree, 'demo')).resolves.toMatchObject({
      kind: 'record', source: 'ref', text: expect.stringContaining('Status: resolved\nResolution cause: operator resume\n'),
    });
    expect(await featureTips(subject.worktree)).toEqual(before);
  });

  it('returns noop without creating a record ref when no stacked halt record exists', async () => {
    const subject = await fixture({ durable: true });

    await expect(supersedeHaltRecord(subject.worktree, 'demo', 'operator resume', subject.remote)).resolves.toEqual({ kind: 'noop' });

    await expect(refExists(subject.worktree, haltRecordRefFor('demo'))).resolves.toBe(false);
  });
});

async function fixture(options: { durable?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'halt-record-stacked-'));
  roots.push(root);
  const main = join(root, 'main');
  const worktree = join(root, 'demo');
  await mkdir(main);
  const mainGit = (args: string[]) => execFile('git', args, { cwd: main });
  const git = (args: string[]) => execFile('git', args, { cwd: worktree });
  await mainGit(['init', '-q', '-b', 'main']);
  await mainGit(['config', 'user.email', 'halt-record@example.test']);
  await mainGit(['config', 'user.name', 'Halt record']);
  await writeFile(join(main, '.gitignore'), '.pipeline/\n');
  await writeFile(join(main, 'base.txt'), 'base\n');
  await mainGit(['add', '.']);
  await mainGit(['commit', '-qm', 'base']);
  await mainGit(['worktree', 'add', '-q', '-b', 'feat/daemon-demo', worktree]);
  if (options.durable) {
    await git(['branch', 'feat/c1/demo']);
    await writeSliceTopologyFixture(worktree, {
      version: 1,
      slug: 'demo',
      runId: 'run-1',
      status: 'done',
      entries: [],
      sliceMembership: { taskSlices: { '1': 1, '2': 2 }, titles: ['Child 1', 'Child 2'] },
      storyOwnership: { S1: 1, S2: 2 },
    }, filesystem);
    const tip = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    await git(['update-ref', 'refs/conductor/demo/closed/c1', tip]);
  }
  const pushes: string[][] = [];
  return {
    worktree,
    git,
    pushes,
    remote: {
      git: async (args: string[]) => ({ stdout: args[0] === 'rev-parse' ? `${'a'.repeat(40)}\n` : '' }),
      remoteGit: async (args: readonly string[]) => {
        pushes.push([...args]);
        return { kind: 'executed' as const, targets: [] };
      },
    },
  };
}

function failures(worktree: string) {
  const events = new ConductorEventEmitter();
  const paths: string[] = [];
  events.on('halt_record_write_failed', (event) => {
    if (event.type === 'halt_record_write_failed') paths.push(event.path);
  });
  return { events, paths, worktree };
}

async function head(worktree: string): Promise<string> {
  return (await execFile('git', ['rev-parse', 'HEAD'], { cwd: worktree })).stdout.trim();
}

async function status(worktree: string): Promise<string> {
  return (await execFile('git', ['status', '--porcelain'], { cwd: worktree })).stdout;
}

async function featureTips(worktree: string): Promise<string> {
  return (await execFile('git', ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/feat'], { cwd: worktree })).stdout;
}

async function refExists(worktree: string, ref: string): Promise<boolean> {
  try {
    await execFile('git', ['rev-parse', '-q', '--verify', ref], { cwd: worktree });
    return true;
  } catch {
    return false;
  }
}

async function liveReadyJournal(worktree: string): Promise<string> {
  const processStat = await readFile(`/proc/${process.pid}/stat`, 'utf8');
  const processStartTime = processStat
    .slice(processStat.lastIndexOf(') ') + 2)
    .trim()
    .split(/\s+/)[19];
  if (!processStartTime) throw new Error('current process start time unavailable');
  const leafTip = await head(worktree);
  const journal: RestackJournal = {
    opId: 'stacked-halt-record' as RestackJournal['opId'],
    cause: 'base-refresh',
    committer: { name: 'Halt record', email: 'halt-record@example.test', date: '2030-01-01T00:00:00Z' },
    dirtyPaths: [],
    refs: [{ ref: 'refs/heads/feat/daemon-demo' as never, oldSha: leafTip as never }],
    ranges: [], children: [], state: 'ready',
    owner: { host: hostname(), pid: process.pid, processStartTime },
  };
  const blob = await writeRestackJournalBlob(worktree, journal);
  await execFile('git', ['update-ref', journalRefFor('demo'), blob, ''], { cwd: worktree });
  return blob;
}
