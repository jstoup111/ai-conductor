// Covers: task:17
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { makeGitRunner } from '../../../src/engine/rebase.js';
import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from '../slice-topology-fixture.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { readRestackJournal } from '../../../src/engine/restack/restack-journal.js';
import { parseCommitSha, type CommitSha } from '../../../src/engine/restack/restack-types.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const envelopeFilesystem: SliceTopologyFixtureFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

function sha(value: string): CommitSha {
  const parsed = parseCommitSha(value.trim());
  if (!parsed) throw new Error(`expected full Git SHA: ${value}`);
  return parsed;
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => rm(repository, { recursive: true, force: true })));
});

async function fixture(q: 'carried' | 'not-carried') {
  const repo = await mkdtemp(join(tmpdir(), 'restack-flatten-refused-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, path: string, content: string) => {
    await writeFile(join(repo, path), content);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return sha((await git(['rev-parse', 'HEAD'])).stdout);
  };

  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.test']);
  await git(['config', 'user.name', 'Restack flatten refusal']);
  await writeFile(join(repo, '.git', 'info', 'exclude'), '.pipeline/\n');
  await commit('base', 'shared.txt', 'base\n');

  await git(['checkout', '-qb', 'feat/c1/demo']);
  const childOne = await commit('child one', 'child-one.txt', 'child one\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', childOne]);

  await git(['checkout', '-qb', 'feat/c2/demo']);
  await commit('child conflict', 'shared.txt', 'child\n');

  if (q === 'carried') {
    await git(['checkout', '-q', 'main']);
    await commit('Q', 'shared.txt', 'Q\n');
    await git(['checkout', '-q', 'feat/c2/demo']);
    await git(['merge', '--no-ff', '--no-commit', 'main']).catch(() => undefined);
    await writeFile(join(repo, 'shared.txt'), 'child merge resolution\n');
    await git(['add', 'shared.txt']);
    await git(['commit', '-qm', 'merge carried Q']);
    await git(['checkout', '-q', 'main']);
  } else {
    await git(['checkout', '-qb', 'uncarried-side', childOne]);
    await commit('uncarried side', 'side.txt', 'side\n');
    await git(['checkout', '-q', 'feat/c2/demo']);
    await git(['merge', '--no-ff', '-m', 'merge uncarried Q', 'uncarried-side']);
    await git(['checkout', '-q', 'main']);
  }

  const merge = sha((await git(['rev-parse', 'feat/c2/demo'])).stdout);
  const newDefault = await commit('new default', 'shared.txt', 'default\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c2', merge]);
  await git(['checkout', '-qb', 'feat/daemon-demo', merge]);
  await commit('leaf', 'leaf.txt', 'leaf\n');
  await writeSliceTopologyFixture(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2, '3': 3 }, titles: ['Child 1', 'Child 2', 'Leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  }, envelopeFilesystem);

  return { repo, git, merge, newDefault };
}

async function stackRefs(subject: Awaited<ReturnType<typeof fixture>>): Promise<string> {
  return (await subject.git([
    'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/', 'refs/conductor/demo/closed/',
  ])).stdout;
}

describe('runRestack flatten refusal (real local Git)', () => {
  it.each([
    ['when Q is carried', 'carried'],
    ['when Q is not carried', 'not-carried'],
  ] as const)('%s halts rather than handing a merge-bearing child to the resolver', async (_name, q) => {
    const subject = await fixture(q);
    const before = await stackRefs(subject);
    const events = new ConductorEventEmitter();
    const refusals: unknown[] = [];
    let resolverCalls = 0;
    events.on('restack_refused', (event) => { refusals.push(event); });

    const result = await runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'base-refresh',
      newDefault: subject.newDefault,
      events,
      git: makeGitRunner(subject.repo),
      resolver: async () => {
        resolverCalls += 1;
        return { resolved: false, reason: 'must not be called' };
      },
    });

    expect(result).toMatchObject({ kind: 'halted' });
    expect(resolverCalls).toBe(0);
    expect(await stackRefs(subject)).toBe(before);
    expect(refusals).toContainEqual(expect.objectContaining({
      reason: 'flatten_refused', child: 2, detail: expect.stringContaining(subject.merge),
    }));
    await expect(readRestackJournal(subject.repo, 'demo')).resolves.toMatchObject({
      kind: 'journal', journal: { state: 'aborted' },
    });
    const stagingRefs = await subject.git([
      'for-each-ref', '--format=%(refname) %(objectname)', 'refs/conductor/demo/restack/staging/',
    ]);
    expect(stagingRefs.stdout).toContain('refs/conductor/demo/restack/staging/c1 ');
    expect(stagingRefs.stdout).toContain(`refs/conductor/demo/restack/staging/c2 ${subject.merge}`);
    const halt = await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toMatch(/resolve.*feat\/c2\/demo.*resume/is);
    expect(halt).not.toMatch(/git\s+rebase/i);
  });
});
