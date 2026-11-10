// Covers: task:3
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { restackResolverForStepRunner } from '../../../src/engine/daemon-feature-lifecycle.js';
import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import {
  resolveRestackConflict,
  type RestackResolutionContext,
  type RestackResolver,
} from '../../../src/engine/restack/restack-resolver.js';
import { parseCommitSha, type CommitSha } from '../../../src/engine/restack/restack-types.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { sealStack } from './restack-sweepG2-fixture.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];

interface Fixture {
  readonly repo: string;
  readonly git: (
    args: string[],
    env?: NodeJS.ProcessEnv,
  ) => Promise<{ readonly stdout: string; readonly stderr: string }>;
  readonly newDefault: CommitSha;
  readonly oldParent: CommitSha;
  readonly oldTip: CommitSha;
  readonly leafCommits: readonly CommitSha[];
}

function sha(value: string): CommitSha {
  const parsed = parseCommitSha(value.trim());
  if (!parsed) throw new Error(`expected SHA, got ${value}`);
  return parsed;
}

async function createFixture({
  duplicateSubjects = false,
  carryLeafPatches = false,
}: {
  duplicateSubjects?: boolean;
  carryLeafPatches?: boolean;
} = {}): Promise<Fixture> {
  const repo = await mkdtemp(join(tmpdir(), 'restack-tip-authority-'));
  repositories.push(repo);
  const git = (args: string[], env?: NodeJS.ProcessEnv) =>
    execFile('git', args, {
      cwd: repo,
      ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
    });
  const commit = async (subject: string, path: string, content: string) => {
    await writeFile(join(repo, path), content);
    await git(['add', path]);
    await git(['commit', '-qm', subject]);
    return sha((await git(['rev-parse', 'HEAD'])).stdout);
  };

  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.name', 'Fixture Committer']);
  await git(['config', 'user.email', 'fixture@example.test']);
  await commit('base', 'base.txt', 'base\n');
  await commit('shared base', 'conflict.txt', 'base\n');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const c1 = await commit('child one', 'one.txt', 'one\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
  await git(['checkout', '-qb', 'feat/c2/demo']);
  const c2 = await commit('child two', 'two.txt', 'two\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c2', c2]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  const oldParent = sha((await git(['rev-parse', 'HEAD'])).stdout);
  const leafCommits: CommitSha[] = [];
  for (let index = 1; index <= 8; index += 1) {
    leafCommits.push(
      await commit(
        duplicateSubjects && index >= 7 ? 'child three duplicate' : `child three ${index}`,
        index === 1 ? 'conflict.txt' : `three-${index}.txt`,
        index === 1 ? 'child\n' : `${index}\n`,
      ),
    );
  }
  const oldTip = sha((await git(['rev-parse', 'HEAD'])).stdout);
  await git(['checkout', '-q', 'main']);
  if (carryLeafPatches) await git(['cherry-pick', ...leafCommits]);
  else await commit('default conflicts', 'conflict.txt', 'default\n');
  const newDefault = sha((await git(['rev-parse', 'HEAD'])).stdout);
  await git(['checkout', '-q', 'feat/daemon-demo']);
  await sealStack(repo);
  return { repo, git, newDefault, oldParent, oldTip, leafCommits };
}

async function subjects(subject: Fixture, range: string): Promise<string[]> {
  return (await subject.git(['log', '--reverse', '--format=%s', range])).stdout.trim().split('\n').filter(Boolean);
}

async function runWithResolver(
  subject: Fixture,
  resolveRebaseConflict: RestackResolver,
): Promise<{ readonly child: number; readonly newTip: string }[]> {
  const resolver = restackResolverForStepRunner({
    resolveRebaseConflict: (context) => resolveRebaseConflict(context as RestackResolutionContext),
  });
  if (!resolver) throw new Error('expected production resolver');
  const events = new ConductorEventEmitter();
  const applied: Array<{ readonly child: number; readonly newTip: string }> = [];
  events.on('restack_applied', (event) => {
    if (event.type === 'restack_applied') applied.push({ child: event.child, newTip: event.newTip });
  });
  const result = await runRestack({
    worktree: subject.repo,
    slug: 'demo',
    cause: 'base-refresh',
    newDefault: subject.newDefault,
    resolver,
    resolverCap: 1,
    events,
    git: makeGitRunner(subject.repo),
  });
  expect(result.kind).toBe('applied');
  return applied;
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

describe('restack resolver tip authority (real local Git)', () => {
  it('moves child three to the settled temporary HEAD when its provider continued without the resolver environment', async () => {
    const subject = await createFixture();
    let settledHead: string | undefined;
    const applied = await runWithResolver(subject, async (context) => {
      await writeFile(join(context.projectRoot, 'conflict.txt'), 'resolved\n');
      const git = makeGitRunner(context.projectRoot);
      await git(['add', 'conflict.txt']);
      const continued = await git(['rebase', '--continue'], { env: { GIT_EDITOR: 'true' } });
      if (continued.exitCode !== 0) throw new Error(`continue failed: ${continued.stderr}`);
      const head = await git(['rev-parse', 'HEAD']);
      if (head.exitCode !== 0) throw new Error(`resolver head failed: ${head.stderr}`);
      settledHead = head.stdout.trim();
      return { resolved: true };
    });

    const newTip = (await subject.git(['rev-parse', 'feat/daemon-demo'])).stdout.trim();
    expect(newTip).toBe(settledHead);
    expect(await subjects(subject, `${subject.oldParent}..${subject.oldTip}`)).toHaveLength(8);
    expect(await subjects(subject, `${subject.oldParent}..${subject.oldTip}`)).toEqual(
      await subjects(subject, `${(await subject.git(['rev-parse', 'feat/c2/demo'])).stdout.trim()}..${newTip}`),
    );
    expect(applied).toContainEqual(expect.objectContaining({ child: 3, newTip }));
  });

  it('keeps the hook-enabled settled HEAD, all child commits, and the journal committer stamp', async () => {
    const subject = await createFixture();
    const applied = await runWithResolver(subject, async (context) => {
      await writeFile(join(context.projectRoot, 'conflict.txt'), 'resolved\n');
      const git = makeGitRunner(context.projectRoot);
      await git(['add', 'conflict.txt'], { env: context.environment });
      await git(['rebase', '--continue'], { env: context.environment });
      return { resolved: true };
    });

    const parent = (await subject.git(['rev-parse', 'feat/c2/demo'])).stdout.trim();
    const tip = (await subject.git(['rev-parse', 'feat/daemon-demo'])).stdout.trim();
    expect(tip).not.toBe(parent);
    expect(await subjects(subject, `${parent}..${tip}`)).toEqual(
      await subjects(subject, `${subject.oldParent}..${subject.oldTip}`),
    );
    expect((await subject.git(['log', '--format=%cn%x00%ce', `${parent}..${tip}`])).stdout.trim().split('\n')).toEqual(
      Array.from({ length: 8 }, () => 'Fixture Committer\0fixture@example.test'),
    );
    expect(applied).toContainEqual(expect.objectContaining({ child: 3, newTip: tip }));
  });

  it('rebuilds only uniquely-subjected candidates when a provider continued without the rewrite-list hook', async () => {
    const subject = await createFixture({ duplicateSubjects: true });
    await runWithResolver(subject, async (context) => {
      await writeFile(join(context.projectRoot, 'conflict.txt'), 'resolved\n');
      const git = makeGitRunner(context.projectRoot);
      await git(['add', 'conflict.txt']);
      await git(['rebase', '--continue'], { env: { GIT_EDITOR: 'true' } });
      return { resolved: true };
    });

    const parent = (await subject.git(['rev-parse', 'feat/c2/demo'])).stdout.trim();
    const tip = (await subject.git(['rev-parse', 'feat/daemon-demo'])).stdout.trim();
    const { rewritesByUniqueSubject } = await import('../../../src/engine/restack/restack-conflict-record.js');
    const rewrites = await rewritesByUniqueSubject(
      makeGitRunner(subject.repo),
      `${subject.oldParent}..${subject.oldTip}`,
      `${parent}..${tip}`,
      await subjects(subject, `${subject.oldParent}..${subject.oldTip}`),
    );
    for (const commit of subject.leafCommits.slice(0, 6)) expect(rewrites.get(commit)).toMatch(/^[0-9a-f]{40}$/);
    for (const commit of subject.leafCommits.slice(6)) expect(rewrites.get(commit)).toBeUndefined();
  });

  it('uses the new parent for an empty todo and leaves a no-candidate restack without a HALT', async () => {
    const subject = await createFixture({ carryLeafPatches: true });
    const child = parseChildId(3);
    if (!child) throw new Error('expected child three');
    const resolver = restackResolverForStepRunner({
      resolveRebaseConflict: async () => ({ resolved: false, reason: 'empty todo must not invoke resolver' }),
    });
    if (!resolver) throw new Error('expected production resolver');
    const direct = await resolveRestackConflict({
      worktree: subject.repo,
      range: { child, oldParent: subject.oldParent, oldTip: subject.oldTip, kind: 'leaf-active' },
      newParent: subject.newDefault,
      stamp: { name: 'Fixture Committer', email: 'fixture@example.test', date: '2030-02-03T04:05:06Z' },
      comparisonCommits: subject.leafCommits,
      resolver,
      cap: 1,
    });
    expect(direct).toMatchObject({ tip: subject.newDefault, candidates: [] });
    let resolverCalls = 0;
    await runWithResolver(subject, async () => {
      resolverCalls += 1;
      return { resolved: false, reason: 'empty todo must not invoke resolver' };
    });
    expect(resolverCalls).toBe(0);
    await expect(readFile(join(subject.repo, '.pipeline/HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
