// Covers: task:2
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import {
  carryNewestHaltRecord,
  isHaltRecordOnlyCommit,
  mapOmittedHaltRecordCommits,
} from '../../../src/engine/restack/halt-record-bookkeeping.js';
import { checkPathOwnership } from '../../../src/engine/restack/restack-ownership.js';
import { parseCommitSha, type ChildRange, type CommitSha } from '../../../src/engine/restack/restack-types.js';
import type { CommitterStamp } from '../../../src/engine/restack/restack-replay.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const stamp: CommitterStamp = {
  name: 'Restack Journal', email: 'journal@example.test', date: '2030-02-03T04:05:06Z',
};

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

function sha(raw: string): CommitSha {
  const parsed = parseCommitSha(raw.trim());
  if (!parsed) throw new Error(`expected full SHA: ${raw}`);
  return parsed;
}

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'halt-record-bookkeeping-'));
  repositories.push(repo);
  const git = (args: string[], env?: NodeJS.ProcessEnv) => execFile('git', args, { cwd: repo, env });
  const write = async (path: string, contents: string) => {
    await mkdir(join(repo, path, '..'), { recursive: true });
    await writeFile(join(repo, path), contents);
  };
  const commit = async (message: string, paths: Record<string, string>) => {
    for (const [path, contents] of Object.entries(paths)) await write(path, contents);
    await git(['add', '.']);
    await git(['commit', '-qm', message]);
    return sha((await git(['rev-parse', 'HEAD'])).stdout);
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.name', 'Fixture']);
  await git(['config', 'user.email', 'fixture@example.test']);
  const base = await commit('base', { 'base.txt': 'base\n' });
  return { repo, git, write, commit, base, runner: makeGitRunner(repo) };
}

function range(oldParent: CommitSha, oldTip: CommitSha): ChildRange {
  const child = parseChildId(2);
  if (!child) throw new Error('invalid child');
  return { child, oldParent, oldTip, kind: 'active' };
}

async function recordAt(subject: Awaited<ReturnType<typeof fixture>>, revision: CommitSha): Promise<string | undefined> {
  const result = await subject.git(['show', `${revision}:.docs/halted/demo.md`]).catch(() => undefined);
  return result?.stdout;
}

describe('halt-record bookkeeping (real local Git)', () => {
  it('classifies exactly a non-merge demo halt-record commit', async () => {
    const subject = await fixture();
    const onlyDemo = await subject.commit('halt demo', { '.docs/halted/demo.md': 'demo\n' });
    await subject.git(['checkout', '-qb', 'variants', onlyDemo]);
    const mixed = await subject.commit('mixed', { '.docs/halted/demo.md': 'mixed\n', '.docs/plans/stem.md': 'plan\n' });
    const other = await subject.commit('halt other', { '.docs/halted/other.md': 'other\n' });
    await subject.git(['commit', '--allow-empty', '-qm', 'empty']);
    const empty = sha((await subject.git(['rev-parse', 'HEAD'])).stdout);
    await subject.git(['checkout', '-qb', 'side', onlyDemo]);
    const side = await subject.commit('side halt', { '.docs/halted/demo.md': 'side\n' });
    await subject.git(['checkout', '-qb', 'merge-parent', onlyDemo]);
    await subject.commit('parent halt', { '.docs/halted/demo.md': 'parent\n' });
    await subject.git(['merge', '--no-ff', '--no-commit', side]).catch(() => undefined);
    await subject.write('.docs/halted/demo.md', 'merged\n');
    await subject.git(['add', '.docs/halted/demo.md']);
    await subject.git(['commit', '-qm', 'merge halt']);
    const merge = sha((await subject.git(['rev-parse', 'HEAD'])).stdout);

    await expect(isHaltRecordOnlyCommit(onlyDemo, 'demo', subject.runner)).resolves.toBe(true);
    await expect(isHaltRecordOnlyCommit(mixed, 'demo', subject.runner)).resolves.toBe(false);
    await expect(isHaltRecordOnlyCommit(other, 'demo', subject.runner)).resolves.toBe(false);
    await expect(isHaltRecordOnlyCommit(empty, 'demo', subject.runner)).resolves.toBe(false);
    await expect(isHaltRecordOnlyCommit(merge, 'demo', subject.runner)).resolves.toBe(false);
  });

  it('adds one stamped, trailer-free commit carrying the newer range record', async () => {
    const subject = await fixture();
    await subject.git(['checkout', '-qb', 'range']);
    const oldParent = sha((await subject.git(['rev-parse', 'HEAD'])).stdout);
    const oldTip = await subject.commit('newer halt', { '.docs/halted/demo.md': 'Halted at: 2031-01-01T00:00:00.000Z\n' });
    await subject.git(['checkout', '-qb', 'parent', subject.base]);
    const newParent = await subject.commit('older halt', { '.docs/halted/demo.md': 'Halted at: 2030-01-01T00:00:00.000Z\n' });
    const carried = await carryNewestHaltRecord(range(oldParent, oldTip), newParent, 'demo', newParent, stamp, subject.runner);

    expect(carried.added).toBe(true);
    expect((await subject.git(['rev-parse', `${carried.tip}^`])).stdout.trim()).toBe(newParent);
    expect((await subject.git(['log', '-1', '--format=%B', carried.tip])).stdout).toBe('halt record: demo\n\n');
    expect((await subject.git(['show', '-s', '--format=%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI', carried.tip])).stdout.trim())
      .toBe(`${stamp.name}\x00${stamp.email}\x00${stamp.date}\x00${stamp.name}\x00${stamp.email}\x00${stamp.date}`);
    expect((await subject.git(['diff-tree', '--no-commit-id', '--name-only', '-r', carried.tip])).stdout.trim()).toBe('.docs/halted/demo.md');
    await expect(recordAt(subject, carried.tip)).resolves.toBe(await recordAt(subject, oldTip));
  });

  it('does not add a commit when the range did not own the record or the parent already wins at the tip', async () => {
    const subject = await fixture();
    await subject.git(['checkout', '-qb', 'range']);
    const oldParent = sha((await subject.git(['rev-parse', 'HEAD'])).stdout);
    const oldTip = await subject.commit('source only', { 'src/a.ts': 'a\n' });
    await subject.git(['checkout', '-qb', 'parent', subject.base]);
    const newParent = await subject.commit('parent halt', { '.docs/halted/demo.md': 'Halted at: 2030-01-01T00:00:00.000Z\n' });
    const untouched = await carryNewestHaltRecord(range(oldParent, oldTip), newParent, 'demo', newParent, stamp, subject.runner);
    expect(untouched).toEqual({ added: false, tip: newParent });

    await subject.git(['checkout', '-q', 'range']);
    const ownedOlder = await subject.commit('older range halt', { '.docs/halted/demo.md': 'Halted at: 2029-01-01T00:00:00.000Z' });
    const parentWins = await carryNewestHaltRecord(range(oldParent, ownedOlder), newParent, 'demo', newParent, stamp, subject.runner);
    expect(parentWins).toEqual({ added: false, tip: newParent });

    const restoreParent = await carryNewestHaltRecord(range(oldParent, ownedOlder), newParent, 'demo', ownedOlder, stamp, subject.runner);
    expect(restoreParent.added).toBe(true);
    await expect(recordAt(subject, restoreParent.tip)).resolves.toBe(await recordAt(subject, newParent));
  });

  it('maps leading and between omitted commits to the prior rewrite and trailing commits to the final tip', async () => {
    const subject = await fixture();
    await subject.git(['checkout', '-qb', 'range']);
    const oldParent = sha((await subject.git(['rev-parse', 'HEAD'])).stdout);
    const leading = await subject.commit('leading halt', { '.docs/halted/demo.md': 'one\n' });
    const keptOne = await subject.commit('K1', { 'src/one.ts': 'one\n' });
    const between = await subject.commit('between halt', { '.docs/halted/demo.md': 'two\n' });
    const keptTwo = await subject.commit('K2', { 'src/two.ts': 'two\n' });
    const trailing = await subject.commit('trailing halt', { '.docs/halted/demo.md': 'three\n' });
    const newParent = subject.base;
    const rewriteOne = sha((await subject.git(['commit-tree', `${keptOne}^{tree}`, '-p', newParent, '-m', 'rewritten K1'])).stdout);
    const rewriteTwo = sha((await subject.git(['commit-tree', `${keptTwo}^{tree}`, '-p', rewriteOne, '-m', 'rewritten K2'])).stdout);
    const finalTip = sha((await subject.git(['commit-tree', `${trailing}^{tree}`, '-p', rewriteTwo, '-m', 'tip'])).stdout);
    const rewrites = new Map<CommitSha, CommitSha>([[keptOne, rewriteOne], [keptTwo, rewriteTwo]]);

    await mapOmittedHaltRecordCommits(range(oldParent, trailing), 'demo', newParent, finalTip, rewrites, subject.runner);
    expect(rewrites.get(leading)).toBe(newParent);
    expect(rewrites.get(between)).toBe(rewriteOne);
    expect(rewrites.get(trailing)).toBe(finalTip);
  });

  it('uses range ownership so a q-carried merge record path does not require a bookkeeping commit', async () => {
    const subject = await fixture();
    await subject.git(['checkout', '-qb', 'range']);
    const oldParent = sha((await subject.git(['rev-parse', 'HEAD'])).stdout);
    await subject.commit('range work', { 'src/a.ts': 'a\n' });
    await subject.git(['checkout', '-qb', 'side', subject.base]);
    const side = await subject.commit('older parent record', { '.docs/halted/demo.md': 'Halted at: 2030-01-01T00:00:00.000Z\n' });
    await subject.git(['checkout', '-q', 'range']);
    await subject.git(['merge', '--no-ff', '-qm', 'automatic carried merge', side]);
    const oldTip = sha((await subject.git(['rev-parse', 'HEAD'])).stdout);
    await subject.git(['checkout', '-qb', 'parent', side]);
    const newParent = await subject.commit('parent advance', { 'parent.txt': 'parent\n' });
    const carried = await carryNewestHaltRecord(range(oldParent, oldTip), newParent, 'demo', newParent, stamp, subject.runner);

    expect(carried).toEqual({ added: false, tip: newParent });
    await expect(checkPathOwnership(range(oldParent, oldTip), newParent, carried.tip, subject.runner)).resolves.toEqual({ kind: 'accepted' });
  });

  it('maps an omitted halt record after a patch-equivalent commit with no rewrite to the new parent', async () => {
    const subject = await fixture();
    await subject.git(['checkout', '-qb', 'range']);
    const oldParent = sha((await subject.git(['rev-parse', 'HEAD'])).stdout);
    await subject.commit('patch equivalent', { 'src/already.ts': 'same\n' });
    const omitted = await subject.commit('halt', { '.docs/halted/demo.md': 'record\n' });
    const kept = await subject.commit('K1', { 'src/kept.ts': 'kept\n' });
    const rewritten = sha((await subject.git(['commit-tree', `${kept}^{tree}`, '-p', subject.base, '-m', 'rewritten K1'])).stdout);
    const rewrites = new Map<CommitSha, CommitSha>([[kept, rewritten]]);

    await mapOmittedHaltRecordCommits(range(oldParent, kept), 'demo', subject.base, rewritten, rewrites, subject.runner);
    expect(rewrites.get(omitted)).toBe(subject.base);
  });
});
