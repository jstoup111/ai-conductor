// Covers: task:1
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { makeGitRunner } from '../../../src/engine/rebase.js';
import { parseChildId } from '../../../src/engine/child-context.js';
import { buildFlattenedHandoff } from '../../../src/engine/restack/restack-resolver.js';
import { parseCommitSha, type ChildRange, type CommitSha } from '../../../src/engine/restack/restack-types.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];

function sha(value: string): CommitSha {
  const parsed = parseCommitSha(value.trim());
  if (!parsed) throw new Error(`expected full SHA: ${value}`);
  return parsed;
}

async function repository(): Promise<{ repo: string; git: (args: string[]) => ReturnType<typeof execFile> }> {
  const repo = await mkdtemp(join(tmpdir(), 'restack-flattened-handoff-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.test']);
  await git(['config', 'user.name', 'Restack fixture']);
  return { repo, git };
}

async function commit(git: (args: string[]) => ReturnType<typeof execFile>, subject: string): Promise<CommitSha> {
  await git(['add', '.']);
  await git(['commit', '-qm', subject]);
  return sha((await git(['rev-parse', 'HEAD'])).stdout);
}

function range(oldParent: CommitSha, oldTip: CommitSha): ChildRange {
  const child = parseChildId(2);
  if (!child) throw new Error('invalid child id');
  return { child, oldParent, oldTip, kind: 'active' };
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

describe('buildFlattenedHandoff (real local Git)', () => {
  it('makes ordinary commits and a non-carried merge pickable in first-parent order', async () => {
    const { repo, git } = await repository();
    await writeFile(join(repo, 'base.txt'), 'base\n');
    const base = await commit(git, 'base');
    await git(['checkout', '-qb', 'child']);
    await writeFile(join(repo, 'c.txt'), 'C\n');
    const c = await commit(git, 'C');
    await git(['checkout', '-qb', 'side', base]);
    await writeFile(join(repo, 'side.txt'), 'side\n');
    await commit(git, 'side');
    await git(['checkout', '-q', 'child']);
    await git(['merge', '--no-ff', '-m', 'M', 'side']);
    const merge = sha((await git(['rev-parse', 'HEAD'])).stdout);
    await writeFile(join(repo, 't.txt'), 'T\n');
    const t = await commit(git, 'T');
    await git(['checkout', '-q', 'main']);
    await writeFile(join(repo, 'upstream.txt'), 'upstream\n');
    const newParent = await commit(git, 'upstream');

    const handoff = await buildFlattenedHandoff(range(base, t), newParent, makeGitRunner(repo));

    expect(handoff.todo).toHaveLength(3);
    expect(handoff.todo[0]).toBe(c);
    expect(handoff.todo[2]).toBe(t);
    const flattened = handoff.todo[1]!;
    expect((await git(['rev-list', '--parents', '-n', '1', flattened])).stdout.trim().split(/\s+/)).toHaveLength(2);
    expect((await git(['show', '-s', '--format=%s', flattened])).stdout.trim()).toBe('M');
    expect((await git(['show', '-s', '--format=%an <%ae>', flattened])).stdout.trim()).toBe('Restack fixture <restack@example.test>');
    expect((await git(['show', '-s', '--format=%B', flattened])).stdout).toContain(`Flattened-merge: ${merge}`);
    expect(handoff.candidates).toEqual(handoff.todo);
  });

  it('preserves the old tip tree in a linear chain across carried, hand-resolved, and non-carried merges', async () => {
    for (const kind of ['automatic', 'hand', 'side'] as const) {
      const { repo, git } = await repository();
      await writeFile(join(repo, 'shared.txt'), 'base\n');
      const base = await commit(git, 'base');
      await git(['checkout', '-qb', 'child']);
      await writeFile(join(repo, 'child.txt'), `${kind}\n`);
      await commit(git, 'C');
      await git(['checkout', '-q', 'main']);
      await writeFile(join(repo, 'shared.txt'), 'upstream\n');
      const upstream = await commit(git, 'upstream');
      if (kind === 'side') {
        await git(['checkout', '-qb', 'side', base]);
        await writeFile(join(repo, 'side.txt'), 'side\n');
        await commit(git, 'side');
      }
      await git(['checkout', '-q', 'child']);
      if (kind === 'hand') {
        await git(['merge', '--no-ff', '--no-commit', 'main']);
        await writeFile(join(repo, 'shared.txt'), 'hand\n');
        await git(['add', 'shared.txt']);
        await git(['commit', '-qm', 'M']);
      } else {
        await git(['merge', '--no-ff', '-m', 'M', kind === 'side' ? 'side' : 'main']);
      }
      const tip = sha((await git(['rev-parse', 'HEAD'])).stdout);
      const handoff = await buildFlattenedHandoff(range(base, tip), upstream, makeGitRunner(repo));
      expect((await git(['rev-parse', `${handoff.tip}^{tree}`])).stdout.trim()).toBe((await git(['rev-parse', `${tip}^{tree}`])).stdout.trim());
      expect((await git(['rev-list', '--min-parents=2', `${base}..${handoff.tip}`])).stdout.trim()).toBe('');
    }
  });

  it('omits an automatic carried merge and records it as ancestry-only', async () => {
    const { repo, git } = await repository();
    await writeFile(join(repo, 'base.txt'), 'base\n');
    const base = await commit(git, 'base');
    await git(['checkout', '-qb', 'child']);
    await writeFile(join(repo, 'child.txt'), 'child\n');
    const child = await commit(git, 'C');
    await git(['checkout', '-q', 'main']);
    await writeFile(join(repo, 'upstream.txt'), 'upstream\n');
    const newParent = await commit(git, 'upstream');
    await git(['checkout', '-q', 'child']);
    await git(['merge', '--no-ff', '-m', 'M', 'main']);
    const merge = sha((await git(['rev-parse', 'HEAD'])).stdout);

    const handoff = await buildFlattenedHandoff(range(base, merge), newParent, makeGitRunner(repo));

    expect(handoff.todo).toEqual([child]);
    expect(handoff.candidates).toEqual([child]);
    expect(handoff.audit.ancestryOnlyMerges).toEqual([merge]);
  });

  it('omits a flattened merge pick when its change is already in the new parent', async () => {
    const { repo, git } = await repository();
    await writeFile(join(repo, 'base.txt'), 'base\n');
    const base = await commit(git, 'base');
    await git(['checkout', '-qb', 'child']);
    await git(['checkout', '-qb', 'side', base]);
    await writeFile(join(repo, 'side.txt'), 'side\n');
    await commit(git, 'side');
    await git(['checkout', '-q', 'child']);
    await git(['merge', '--no-ff', '-m', 'M', 'side']);
    const merge = sha((await git(['rev-parse', 'HEAD'])).stdout);
    await git(['checkout', '-q', 'main']);
    await git(['merge', '--no-ff', '-m', 'carry side', 'side']);
    const newParent = sha((await git(['rev-parse', 'HEAD'])).stdout);

    const handoff = await buildFlattenedHandoff(range(base, merge), newParent, makeGitRunner(repo));

    expect(handoff.todo).toEqual([]);
    expect(handoff.candidates).toEqual([]);
  });

  it('keeps halt-record-only history in the chain without making it pickable', async () => {
    const { repo, git } = await repository();
    await writeFile(join(repo, 'base.txt'), 'base\n');
    const base = await commit(git, 'base');
    await git(['checkout', '-qb', 'child']);
    await mkdir(join(repo, '.docs', 'halted'), { recursive: true });
    await writeFile(join(repo, '.docs', 'halted', 'demo.md'), 'halt\n');
    const halt = await commit(git, 'halt record');
    await git(['checkout', '-q', 'main']);
    await writeFile(join(repo, 'upstream.txt'), 'upstream\n');
    const newParent = await commit(git, 'upstream');

    const handoff = await buildFlattenedHandoff(range(base, halt), newParent, makeGitRunner(repo), { haltRecordSlug: 'demo' });

    expect(handoff.todo).toEqual([]);
    expect(handoff.candidates).toEqual([]);
    expect((await git(['rev-parse', `${handoff.tip}^{tree}`])).stdout.trim()).toBe((await git(['rev-parse', `${halt}^{tree}`])).stdout.trim());
  });
});
