// Covers: task:4
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { renderHaltRecord, supersedeHaltRecordText } from '../../../src/engine/halt-record.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { checkPathOwnership } from '../../../src/engine/restack/restack-ownership.js';
import { replayChildRange, type CommitterStamp } from '../../../src/engine/restack/restack-replay.js';
import { parseCommitSha, type ChildRange, type CommitSha } from '../../../src/engine/restack/restack-types.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const stamp: CommitterStamp = { name: 'Restack Journal', email: 'journal@example.test', date: '2030-02-03T04:05:06Z' };

function sha(raw: string): CommitSha {
  const value = parseCommitSha(raw.trim());
  if (!value) throw new Error(`expected SHA, got ${raw}`);
  return value;
}

function haltedRecord(haltedAt: string): string {
  return renderHaltRecord({
    slug: 'demo', haltClass: 'needs-human', step: 'build', phase: 'BUILD', branch: 'feat/demo',
    headSha: 'a'.repeat(40), haltedAt, haltBody: 'halted for review\n',
  });
}

function resolvedRecord(haltedAt: string, resolvedAt: string): string {
  return supersedeHaltRecordText(haltedRecord(haltedAt), { cause: 'operator resume', resolvedAt });
}

interface FixtureOptions {
  readonly parentRecord?: string;
  readonly childRecord?: string;
  readonly childOwnsRecord?: boolean;
  readonly mixed?: boolean;
}

async function fixture(options: FixtureOptions) {
  const repo = await mkdtemp(join(tmpdir(), 'restack-halt-record-newest-'));
  repositories.push(repo);
  const git = (args: string[], env?: NodeJS.ProcessEnv) => execFile('git', args, { cwd: repo, env });
  const commit = async (subject: string, changes: Record<string, string>) => {
    for (const [path, text] of Object.entries(changes)) {
      await mkdir(join(repo, path, '..'), { recursive: true });
      await writeFile(join(repo, path), text);
    }
    await git(['add', '.']);
    await git(['commit', '-qm', subject]);
    return sha((await git(['rev-parse', 'HEAD'])).stdout);
  };

  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.name', 'Fixture']);
  await git(['config', 'user.email', 'fixture@example.test']);
  const base = await commit('base', { 'base.txt': 'base\n', ...(options.parentRecord === undefined ? {} : { '.docs/halted/demo.md': options.parentRecord }) });
  await git(['checkout', '-qb', 'child']);
  const oldParent = base;
  if (options.childOwnsRecord !== false) {
    await commit(options.mixed ? 'mixed record and source' : 'child halt record', {
      ...(options.childRecord === undefined ? {} : { '.docs/halted/demo.md': options.childRecord }),
      ...(options.mixed ? { 'src/m.ts': 'child mixed\n' } : {}),
    });
  } else {
    await commit('child source only', { 'src/child.ts': 'child\n' });
  }
  const oldTip = sha((await git(['rev-parse', 'HEAD'])).stdout);
  await git(['checkout', '-qb', 'parent', base]);
  const newParent = sha((await git(['rev-parse', 'HEAD'])).stdout);
  const child = parseChildId(2);
  if (!child) throw new Error('child id must parse');
  return { repo, git, newParent, range: { child, oldParent, oldTip, kind: 'active' } as ChildRange };
}

async function recordAt(subject: Awaited<ReturnType<typeof fixture>>, revision: CommitSha): Promise<string | undefined> {
  const result = await subject.git(['show', `${revision}:.docs/halted/demo.md`]).catch(() => undefined);
  return result?.stdout;
}

async function replay(subject: Awaited<ReturnType<typeof fixture>>) {
  return replayChildRange(subject.range, subject.newParent, stamp, makeGitRunner(subject.repo), { haltRecordSlug: 'demo' });
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

describe('replayChildRange carries the newest halt record (real local Git)', () => {
  it('keeps the newer resolved parent record, but appends exactly one record commit for a newer child record', async () => {
    const parentWins = await fixture({
      parentRecord: resolvedRecord('2026-10-26T09:00:00.000Z', '2026-10-26T12:30:00.000Z'),
      childRecord: haltedRecord('2026-10-26T11:00:00.000Z'),
    });
    const parentResult = await replay(parentWins);
    expect(await recordAt(parentWins, parentResult.tip)).toBe(await recordAt(parentWins, parentWins.newParent));
    expect((await parentWins.git(['log', '--format=%s', `${parentWins.newParent}..${parentResult.tip}`])).stdout).not.toContain('halt record: demo');

    const childWins = await fixture({
      parentRecord: resolvedRecord('2026-10-26T09:00:00.000Z', '2026-10-26T10:00:00.000Z'),
      childRecord: haltedRecord('2026-10-26T12:05:00.000Z'),
    });
    const childResult = await replay(childWins);
    expect(await recordAt(childWins, childResult.tip)).toBe(await recordAt(childWins, childWins.range.oldTip));
    expect((await childWins.git(['log', '--format=%s', `${childWins.newParent}..${childResult.tip}`])).stdout.split('\n').filter((subject) => subject === 'halt record: demo')).toHaveLength(1);
    expect((await childWins.git(['show', '-s', '--format=%s', childResult.tip])).stdout.trim()).toBe('halt record: demo');
  });

  it('keeps the parent for tied or unreadable child times, and uses the child when only its time parses', async () => {
    const parent = haltedRecord('2026-10-26T12:00:00.000Z');
    for (const child of [
      haltedRecord('2026-10-26T12:00:00.000Z').replace('halted for review', 'child tied time'),
      haltedRecord('not-an-iso-time'),
      'not a halt record\n',
    ]) {
      const subject = await fixture({ parentRecord: parent, childRecord: child });
      const result = await replay(subject);
      expect(await recordAt(subject, result.tip)).toBe(parent);
      expect((await subject.git(['log', '--format=%s', `${subject.newParent}..${result.tip}`])).stdout).not.toContain('halt record: demo');
    }
    const child = haltedRecord('2026-10-26T12:00:00.000Z');
    const subject = await fixture({ parentRecord: 'Halted at: unreadable\n', childRecord: child });
    const result = await replay(subject);
    expect(await recordAt(subject, result.tip)).toBe(child);
    expect((await subject.git(['show', '-s', '--format=%s', result.tip])).stdout.trim()).toBe('halt record: demo');
  });

  it('does not treat an inherited old-tip record as range-owned', async () => {
    const inherited = haltedRecord('2026-10-26T12:05:00.000Z');
    const olderParent = haltedRecord('2026-10-26T10:00:00.000Z');
    const subject = await fixture({ parentRecord: inherited, childOwnsRecord: false });
    await subject.git(['checkout', '-q', 'parent']);
    await mkdir(join(subject.repo, '.docs', 'halted'), { recursive: true });
    await writeFile(join(subject.repo, '.docs', 'halted', 'demo.md'), olderParent);
    await subject.git(['add', '.docs/halted/demo.md']);
    await subject.git(['commit', '-qm', 'older parent record']);
    const newParent = sha((await subject.git(['rev-parse', 'HEAD'])).stdout);
    const result = await replayChildRange(subject.range, newParent, stamp, makeGitRunner(subject.repo), { haltRecordSlug: 'demo' });
    expect(await recordAt(subject, result.tip)).toBe(olderParent);
    expect((await subject.git(['log', '--format=%s', `${newParent}..${result.tip}`])).stdout).not.toContain('halt record: demo');
    await expect(checkPathOwnership(subject.range, newParent, result.tip, makeGitRunner(subject.repo))).resolves.toEqual({ kind: 'accepted' });
  });

  it('carries a record created by the child when the parent has none', async () => {
    const child = haltedRecord('2026-10-26T12:05:00.000Z');
    const subject = await fixture({ childRecord: child });
    const result = await replay(subject);
    expect(await recordAt(subject, result.tip)).toBe(child);
  });

  it('restores the newer parent record after a kept mixed commit replaces it', async () => {
    const parent = resolvedRecord('2026-10-26T09:00:00.000Z', '2026-10-26T12:30:00.000Z');
    const subject = await fixture({ parentRecord: parent, childRecord: haltedRecord('2026-10-26T11:00:00.000Z'), mixed: true });
    const result = await replay(subject);
    expect((await subject.git(['show', `${result.tip}:src/m.ts`])).stdout).toBe('child mixed\n');
    expect(await recordAt(subject, result.tip)).toBe(parent);
    expect((await subject.git(['show', '-s', '--format=%s', result.tip])).stdout.trim()).toBe('halt record: demo');
  });
});
