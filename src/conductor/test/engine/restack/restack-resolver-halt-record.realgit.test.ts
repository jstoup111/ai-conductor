// Covers: task:5
import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { checkPathOwnership } from '../../../src/engine/restack/restack-ownership.js';
import { resolveRestackConflict } from '../../../src/engine/restack/restack-resolver.js';
import { parseCommitSha, type ChildRange, type CommitSha } from '../../../src/engine/restack/restack-types.js';
import type { CommitterStamp } from '../../../src/engine/restack/restack-replay.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const stamp: CommitterStamp = { name: 'Journal Committer', email: 'journal@example.test', date: '2030-02-03T04:05:06Z' };

function sha(raw: string): CommitSha {
  const value = parseCommitSha(raw.trim());
  if (!value) throw new Error(`expected SHA, got ${raw}`);
  return value;
}

async function fixture(
  childTime = '2026-10-26T12:05:00.000Z',
  parentTime = '2026-10-26T10:00:00.000Z',
  parentRecordIsBase = false,
  mixedPath = 'src/b.ts',
) {
  const repo = await mkdtemp(join(tmpdir(), 'restack-resolver-halt-record-'));
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
  const parentRecordText = `# Halt record\nStatus: resolved\nResolved at: ${parentTime}\n`;
  const base = await commit('base', {
    'src/a.ts': 'base\n', 'src/b.ts': 'base\n', 'src/m.ts': 'base\n',
    ...(parentRecordIsBase ? { '.docs/halted/demo.md': parentRecordText } : {}),
  });
  await git(['checkout', '-qb', 'child']);
  const oldParent = base;
  const code = await commit('code conflict', { 'src/a.ts': 'child\n' });
  const mixed = await commit('mixed record and source', {
    [mixedPath]: 'child mixed\n',
    '.docs/halted/demo.md': `# Halt record\nStatus: halted\nHalted at: ${childTime}\n`,
  });
  const haltSubjects: string[] = [];
  for (let index = 1; index <= 4; index += 1) {
    haltSubjects.push(`halt ${index}`);
    await commit(`halt ${index}`, { '.docs/halted/demo.md': `# Halt record\nStatus: halted\nHalted at: ${childTime}\n# ${index}\n` });
  }
  const oldTip = sha((await git(['rev-parse', 'HEAD'])).stdout);
  const childRecord = (await git(['show', `${oldTip}:.docs/halted/demo.md`])).stdout;
  await git(['checkout', '-q', 'main']);
  const newParent = await commit('parent advance', {
    'src/a.ts': 'parent\n',
    ...(parentRecordIsBase ? {} : { '.docs/halted/demo.md': parentRecordText }),
  });
  const parentRecord = (await git(['show', `${newParent}:.docs/halted/demo.md`])).stdout;
  return {
    repo, git, range: { child: parseChildId(2)!, oldParent, oldTip, kind: 'active' } as ChildRange,
    newParent, code, mixed, haltSubjects, childRecord, parentRecord,
  };
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

describe('resolveRestackConflict halt-record bookkeeping (real local Git)', () => {
  it('keeps halt-only commits out of the todo and resolver conflicts, without changing repository configuration', async () => {
    const subject = await fixture();
    const config = await readFile(join(subject.repo, '.git', 'config'));
    const infoAttributes = join(subject.repo, '.git', 'info', 'attributes');
    const trackedAttributes = join(subject.repo, '.gitattributes');
    const beforeInfo = await readFile(infoAttributes, 'utf8').catch(() => undefined);
    const beforeTracked = await readFile(trackedAttributes, 'utf8').catch(() => undefined);
    const conflicts: string[][] = [];

    const result = await resolveRestackConflict({
      worktree: subject.repo, range: subject.range, newParent: subject.newParent, stamp, cap: 1, haltRecordSlug: 'demo',
      resolver: async (context) => {
        conflicts.push([...context.conflicts]);
        const git = makeGitRunner(context.projectRoot);
        await git(['checkout', '--theirs', 'src/a.ts'], { env: context.environment });
        await git(['add', 'src/a.ts'], { env: context.environment });
        await git(['rebase', '--continue'], { env: context.environment });
        return { resolved: true };
      },
    });

    expect(result.outcome.kind).toBe('changed');
    expect(conflicts).toEqual([['src/a.ts']]);
    const subjects = await Promise.all(result.candidates.map(async (candidate) => (await subject.git(['show', '-s', '--format=%s', candidate])).stdout.trim()));
    expect(subjects).toEqual(['code conflict', 'mixed record and source']);
    expect(subjects).not.toEqual(expect.arrayContaining(subject.haltSubjects));
    expect((await subject.git(['show', `${result.tip}:.docs/halted/demo.md`])).stdout).toBe(subject.childRecord);
    expect((await subject.git(['log', '-1', '--format=%s', result.tip!])).stdout.trim()).toBe('halt record: demo');
    await expect(checkPathOwnership(subject.range, subject.newParent, result.tip!, makeGitRunner(subject.repo))).resolves.toEqual({ kind: 'accepted' });
    expect(await readFile(join(subject.repo, '.git', 'config'))).toStrictEqual(config);
    if (beforeInfo === undefined) await expect(access(infoAttributes)).rejects.toThrow();
    else await expect(readFile(infoAttributes, 'utf8')).resolves.toBe(beforeInfo);
    if (beforeTracked === undefined) await expect(access(trackedAttributes)).rejects.toThrow();
    else await expect(readFile(trackedAttributes, 'utf8')).resolves.toBe(beforeTracked);
  });

  it('restores the newer parent record after a kept mixed commit replaces it with an older child record', async () => {
    const subject = await fixture('2026-10-26T11:00:00.000Z', '2026-10-26T12:30:00.000Z', true, 'src/m.ts');
    const result = await resolveRestackConflict({
      worktree: subject.repo, range: subject.range, newParent: subject.newParent, stamp, cap: 1, haltRecordSlug: 'demo',
      resolver: async (context) => {
        const git = makeGitRunner(context.projectRoot);
        await git(['checkout', '--theirs', 'src/a.ts'], { env: context.environment });
        await git(['add', 'src/a.ts'], { env: context.environment });
        await git(['rebase', '--continue'], { env: context.environment });
        return { resolved: true };
      },
    });

    expect((await subject.git(['show', `${result.tip}:src/m.ts`])).stdout).toBe('child mixed\n');
    expect((await subject.git(['show', `${result.tip}:.docs/halted/demo.md`])).stdout).toBe(subject.parentRecord);
    expect((await subject.git(['log', '-1', '--format=%s', result.tip!])).stdout.trim()).toBe('halt record: demo');
    expect((await subject.git(['show', '-s', '--format=%B', result.candidates[1]!])).stdout).toContain('mixed record and source');
  });
});
