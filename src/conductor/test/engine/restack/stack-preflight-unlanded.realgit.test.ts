// Covers: task:17
import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from '../slice-topology-fixture.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { runStackPreflight } from '../../../src/engine/restack/stack-preflight.js';
import { writePublicationRecord } from '../../../src/engine/stack-publication-record.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const envelopeFilesystem: SliceTopologyFixtureFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => { await Promise.all(repositories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function fixture(routing = true) {
  const repo = await mkdtemp(join(tmpdir(), 'stack-preflight-unlanded-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, path: string, value: string) => {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), value);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };
  const onBranch = async <T>(branch: string, run: () => Promise<T>): Promise<T> => {
    await git(['checkout', '-q', branch]);
    try { return await run(); } finally { await git(['checkout', '-q', 'feat/daemon-demo']); }
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'unlanded@example.test']);
  await git(['config', 'user.name', 'Stack preflight unlanded']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await git(['add', '.gitignore']);
  await git(['commit', '-qm', 'ignore pipeline']);
  await commit('base', 'base.txt', 'base\n');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const closedOne = await commit('closed one', 'one.txt', 'one\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', closedOne]);
  await git(['checkout', '-qb', 'feat/c2/demo']);
  const closedTwo = await commit('closed two', 'two.txt', 'two\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c2', closedTwo]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await commit('leaf', 'leaf.txt', 'leaf\n');
  await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await writeFile(join(repo, '.ai-conductor', 'config.yml'), [
    'stacked_prs:', '  enabled: true', '  max_slices: 3', `  route_whole_feature_fixes: ${routing}`, '',
  ].join('\n'));
  await writeSliceTopologyFixture(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { a: 1, b: 2, c: 3 }, titles: ['one', 'two', 'leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  }, envelopeFilesystem);
  const refs = async () => (await git(['for-each-ref', '--format=%(refname) %(objectname)'])).stdout;
  return { repo, git, commit, onBranch, refs, closedOne };
}

async function preflight(subject: Awaited<ReturnType<typeof fixture>>) {
  const events = new ConductorEventEmitter();
  const planned: unknown[] = [];
  events.on('restack_planned', (event) => { planned.push(event); });
  const result = await runStackPreflight({
    worktree: subject.repo, slug: 'demo', events, git: makeGitRunner(subject.repo),
  });
  return { result, planned };
}

const exists = (path: string) => access(path).then(() => true, () => false);

describe('runStackPreflight unlanded closed-child commits (real local Git)', () => {
  it('halts a raw child 1 commit with its exact landing command, without moving refs or restacking', async () => {
    const subject = await fixture();
    await subject.onBranch('feat/c1/demo', () => subject.commit('raw review edit', 'review.txt', 'X\n'));
    const before = await subject.refs();

    const { result, planned } = await preflight(subject);

    expect(result).toEqual({ kind: 'halted' });
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toBe([
      'unlanded-closed-child-commits: child 1',
      'ai-conductor stack land --slug demo --child 1 --reason "<why>"',
      '',
    ].join('\n'));
    expect(planned).toEqual([]);
    expect(await subject.refs()).toBe(before);
  });

  it('offers child 2 as an exact carry when raw commits exist on children 1 and 2', async () => {
    const subject = await fixture();
    await subject.onBranch('feat/c1/demo', () => subject.commit('raw child one edit', 'one-review.txt', 'X\n'));
    await subject.onBranch('feat/c2/demo', () => subject.commit('raw child two edit', 'two-review.txt', 'X\n'));

    await expect(preflight(subject)).resolves.toMatchObject({ result: { kind: 'halted' } });

    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toBe([
      'unlanded-closed-child-commits: children 1, 2',
      'ai-conductor stack land --slug demo --child 1 --carry 2 --reason "<why>"',
      '',
    ].join('\n'));
  });

  it('keeps the published-stack halt ahead of the unlanded landing instruction', async () => {
    const subject = await fixture();
    await subject.onBranch('feat/c1/demo', () => subject.commit('raw review edit', 'review.txt', 'X\n'));
    await expect(writePublicationRecord(subject.repo, 'demo', undefined, {
      version: 1,
      members: [{ position: parseChildId(1)!, branch: 'feat/c1/demo', pr: 101 }],
    })).resolves.toEqual({ kind: 'updated' });

    await expect(preflight(subject)).resolves.toMatchObject({ result: { kind: 'halted' } });

    await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('restack refused (published-stack) child 1');
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.not.toContain('unlanded-closed-child-commits');
  });

  it('ignores a halt-record-only commit, while routing-off preserves feature repair', async () => {
    const haltOnly = await fixture();
    await haltOnly.onBranch('feat/c1/demo', () => haltOnly.commit('halt record', '.docs/halted/demo.md', 'Status: halted\n'));

    await expect(preflight(haltOnly)).resolves.toMatchObject({ result: { kind: 'clear' }, planned: [] });
    expect(await exists(join(haltOnly.repo, '.pipeline', 'HALT'))).toBe(false);

    const routingOff = await fixture(false);
    const newTip = await routingOff.onBranch('feat/c1/demo', () => routingOff.commit('raw review edit', 'review.txt', 'X\n'));

    await expect(preflight(routingOff)).resolves.toMatchObject({ result: { kind: 'repaired' }, planned: [expect.anything()] });
    expect((await routingOff.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).stdout.trim()).toBe(newTip);
    expect(await exists(join(routingOff.repo, '.pipeline', 'HALT'))).toBe(false);
  });
});
