// Covers: task:8
import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { detectStackRestackResolveCommand } from '../../src/cli.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { resolutionRefFor, type RestackConflictRecord, writeConflictRecord } from '../../src/engine/restack/restack-conflict-record.js';
import { parseCommitSha, type CommitSha, type RestackOpId } from '../../src/engine/restack/restack-types.js';
import { dispatchStackRestackResolve } from '../../src/engine/stack-restack-resolve-cli.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];

function sha(value: string): CommitSha {
  const parsed = parseCommitSha(value.trim());
  if (!parsed) throw new Error(`expected SHA, got ${value}`);
  return parsed;
}

function child(value: number) {
  const parsed = parseChildId(value);
  if (!parsed) throw new Error(`expected child, got ${value}`);
  return parsed;
}

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'stack-restack-resolve-adapted-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const write = async (path: string, contents: string) => {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), contents);
  };
  const commit = async (subject: string) => {
    await git(['add', '-A']);
    await git(['commit', '-qm', subject]);
    return sha((await git(['rev-parse', 'HEAD'])).stdout);
  };

  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.test']);
  await git(['config', 'user.name', 'Restack resolve fixture']);
  await write('.gitignore', '.pipeline/\n');
  await write('base.txt', 'base\n');
  await commit('base');

  await git(['checkout', '-qb', 'feat/c1/demo']);
  const oldParent = sha((await git(['rev-parse', 'HEAD'])).stdout);
  await git(['checkout', '-qb', 'feat/c2/demo']);
  await write('src/owned.ts', 'old child change\n');
  const oldTip = await commit('child change');

  await git(['checkout', '-q', 'feat/c1/demo']);
  await write('tests/a.test.ts', 'parent added test\n');
  const newParent = await commit('parent adds test');

  const record: RestackConflictRecord = {
    opId: 'adapted-tip-conflict' as RestackOpId,
    child: child(2), oldParent, oldTip, newParent,
    newParentTree: sha((await git(['rev-parse', `${newParent}^{tree}`])).stdout),
    candidateSubjects: ['child change'], commit: oldTip, paths: ['src/owned.ts'],
  };
  await expect(writeConflictRecord(repo, 'demo', record)).resolves.toEqual({ kind: 'updated' });
  await mkdir(join(repo, '.pipeline'), { recursive: true });
  await writeFile(join(repo, '.pipeline', 'HALT'), 'Restack-Conflict: 2 adapted-tip-conflict\n');
  await writeFile(join(repo, '.pipeline', 'HALT.class'), 'needs-human\n');

  const tip = async (name: string, change: () => Promise<void>) => {
    await git(['checkout', '-qB', `tip-${name}`, newParent]);
    await write('src/owned.ts', 'old child change\n');
    await change();
    return commit('child change');
  };

  return { repo, git, tip };
}

function command(tip: string) {
  const parsed = detectStackRestackResolveCommand(['node', 'ai-conductor', 'stack', 'restack-resolve', '--slug', 'demo', '--child', '2', '--tip', tip]);
  if (!parsed) throw new Error('command did not parse');
  return parsed;
}

function deps(repo: string, output: string[]) {
  return {
    resolveMainRoot: async () => repo,
    resolveWorktree: async () => repo,
    acquireLease: async () => ({ kind: 'acquired' as const, lease: { release: async () => ({ ok: true as const }) } }),
    resolveOperator: async () => 'operator@example.test',
    print: (line: string) => { output.push(line); },
  };
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

describe('stack restack-resolve --tip adapted paths (real local Git)', () => {
  it('records a tip that adapts a test added by the new parent', async () => {
    const subject = await fixture();
    const tip = await subject.tip('adapt', () => writeFile(join(subject.repo, 'tests', 'a.test.ts'), 'adapted parent test\n'));
    const output: string[] = [];

    await expect(dispatchStackRestackResolve(command(tip), deps(subject.repo, output))).resolves.toBe(0);

    expect(output).toEqual(['stack restack-resolve: recorded resolution for child 2']);
    await expect(subject.git(['rev-parse', resolutionRefFor('demo', child(2))])).resolves.toMatchObject({ stdout: `${tip}\n` });
  });

  it.each([
    ['deletes a test added by the new parent', async (repo: string) => rm(join(repo, 'tests', 'a.test.ts')), 'tests/a.test.ts (parent-revert)'],
    ['changes a path outside the child range and parent delta', async (repo: string) => writeFile(join(repo, 'src', 'other.ts'), 'unowned\n'), 'src/other.ts (unowned)'],
  ])('refuses a tip that %s without recording it or changing the halt', async (_label, change, detail) => {
    const subject = await fixture();
    const tip = await subject.tip('refused', () => change(subject.repo));
    const before = await readFile(join(subject.repo, '.pipeline', 'HALT'));
    const output: string[] = [];

    await expect(dispatchStackRestackResolve(command(tip), deps(subject.repo, output))).resolves.toBe(1);

    expect(output).toEqual([`stack restack-resolve: refused — resolution touches unowned paths: ${detail}`]);
    await expect(subject.git(['rev-parse', '-q', '--verify', resolutionRefFor('demo', child(2))])).rejects.toMatchObject({ code: 1 });
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'))).resolves.toEqual(before);
    await expect(access(join(subject.repo, '.pipeline', 'HALT.class'))).resolves.toBeUndefined();
  });
});
