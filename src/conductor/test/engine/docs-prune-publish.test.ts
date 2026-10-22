// Covers: task:6, task:7, task:rem-prd-audit-6-r2
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { DocsPruneRefusal, publishDocsPrune } from '../../src/engine/docs-prune.js';
import { dispatchDocsPrune, makeProductionDocsPrunePublisher } from '../../src/engine/docs-prune-cli.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const outcome = { removable: ['.docs/plans/alpha.md'], deferred: [], skipped: [], excluded: [] };
const operations = { run: vi.fn(async () => ({})) };
const roots: string[] = [];

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function git(cwd: string, args: readonly string[]): Promise<string> {
  return (await execa('git', [...args], { cwd })).stdout.trim();
}

async function writeDocs(repo: string, stem: string): Promise<void> {
  await mkdir(join(repo, '.docs', 'plans'), { recursive: true });
  await mkdir(join(repo, '.docs', 'coherence'), { recursive: true });
  await mkdir(join(repo, '.docs', 'shipped'), { recursive: true });
  await Promise.all([
    writeFile(join(repo, '.docs', 'plans', `${stem}.md`), `${stem} plan\n`),
    writeFile(join(repo, '.docs', 'coherence', `${stem}.md`), `${stem} coherence\n`),
    writeFile(join(repo, '.docs', 'shipped', `${stem}.md`), `${stem} shipped\n`),
  ]);
}

it('publishes only a docs-prune ref and creates its review PR', async () => {
  const push = vi.fn(async () => ({ kind: 'executed' as const }));
  await publishDocsPrune({ repoDir: '/repo', repository: 'o/r', operatorLogin: 'me', branch: 'docs-prune/2026-10-22', commit: 'abc', outcome, openPullRequests: [], push, operations, approve: async () => true });
  expect(push).toHaveBeenCalledWith('docs-prune/2026-10-22', 'abc');
  expect(operations.run).toHaveBeenCalledWith(expect.objectContaining({ operation: 'pull-request.create', payload: expect.objectContaining({ base: 'main', head: 'docs-prune/2026-10-22' }) }));
  expect(push).not.toHaveBeenCalledWith('main', expect.anything());
});

it('refreshes the operator owned prune PR instead of creating a second PR', async () => {
  const push = vi.fn(async () => ({ kind: 'executed' as const }));
  operations.run.mockClear();
  const existing = { number: 2, url: 'https://example.test/pr/2', body: '', headSha: 'old', headRef: 'docs-prune/previous', author: 'me', changedPaths: [] };
  await publishDocsPrune({ repoDir: '/repo', repository: 'o/r', operatorLogin: 'me', branch: 'docs-prune/2026-10-22', commit: 'next', expectedHead: 'fetched-head', outcome: { ...outcome, removable: ['.docs/plans/alpha.md', '.docs/plans/beta.md'] }, openPullRequests: [existing], push, operations, approve: async () => true });
  expect(push).toHaveBeenCalledWith('docs-prune/previous', 'next', 'fetched-head');
  expect(operations.run).toHaveBeenCalledWith(expect.objectContaining({ operation: 'pull-request.edit', target: { kind: 'pull-request', number: 2, repository: 'o/r' } }));
  expect(operations.run).not.toHaveBeenCalledWith(expect.objectContaining({ operation: 'pull-request.create' }));
});

it('refreshes an owned prune PR from current main with every newly removable path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'docs-prune-refresh-'));
  roots.push(root);
  const remote = join(root, 'origin.git');
  const repo = join(root, 'repo');
  await mkdir(repo);
  await initTestRepo(repo);
  await git(root, ['init', '--bare', '--initial-branch=main', remote]);
  await git(repo, ['remote', 'add', 'origin', remote]);

  await writeDocs(repo, 'alpha');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'ship alpha']);
  await git(repo, ['push', 'origin', 'main']);

  await git(repo, ['checkout', '-b', 'docs-prune/previous']);
  await git(repo, ['rm', '-r', '--', '.docs/plans/alpha.md', '.docs/coherence/alpha.md']);
  await git(repo, ['commit', '-m', 'docs: prune alpha']);
  await git(repo, ['push', 'origin', 'docs-prune/previous']);
  await git(repo, ['checkout', 'main']);

  await writeDocs(repo, 'beta');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'ship beta']);
  await git(repo, ['push', 'origin', 'main']);

  const calls: string[][] = [];
  const runner = async (args: string[], options: { cwd?: string }) => {
    calls.push([...args]);
    return { stdout: await git(options.cwd ?? repo, args) };
  };
  const gh = vi.fn(async (args: string[]) => {
    if (args[0] === 'repo') return { stdout: JSON.stringify({ nameWithOwner: 'acme/conductor' }) };
    if (args.includes('graphql')) return { stdout: JSON.stringify({ data: { repository: { pullRequests: { nodes: [{ number: 2, url: 'https://example.test/pr/2', body: '', headRefOid: await git(remote, ['rev-parse', 'refs/heads/docs-prune/previous']), headRefName: 'docs-prune/previous', author: { login: 'me' }, files: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }], pageInfo: { hasNextPage: false, endCursor: null } } } } }) };
    if (args[0] === 'api') return { stdout: 'me\n' };
    throw new Error(`unexpected gh command: ${args.join(' ')}`);
  });
  const pushes = vi.fn(async () => ({ kind: 'executed' as const }));
  const requests: unknown[] = [];
  const publish = async (input: Parameters<typeof publishDocsPrune>[0]) => publishDocsPrune({
    ...input,
    push: pushes,
    operations: { run: async (request) => { requests.push(request); return {}; } },
    approve: async () => true,
  });

  await expect(dispatchDocsPrune({ kind: 'run' }, repo, { git: runner as never, gh: gh as never, publish })).resolves.toBe(0);

  const commit = String(pushes.mock.calls[0]?.[1]);
  expect((await git(repo, ['show', '--format=', '--name-status', commit])).split('\n').filter(Boolean).sort()).toEqual([
    'D\t.docs/coherence/alpha.md', 'D\t.docs/coherence/beta.md',
    'D\t.docs/plans/alpha.md', 'D\t.docs/plans/beta.md',
  ]);
  expect(pushes).toHaveBeenCalledWith('docs-prune/previous', commit, expect.any(String));
  expect(pushes).not.toHaveBeenCalledWith('main', expect.anything(), expect.anything());
  expect(requests).toContainEqual(expect.objectContaining({ operation: 'pull-request.edit' }));
  expect(requests).not.toContainEqual(expect.objectContaining({ operation: 'pull-request.create' }));
  expect(calls.filter(([command]) => command === 'push')).toEqual([]);
});

it('refuses a foreign open docs-prune PR before pushing', async () => {
  const push = vi.fn();
  await expect(publishDocsPrune({ repoDir: '/repo', repository: 'o/r', operatorLogin: 'me', branch: 'docs-prune/2026-10-22', commit: 'abc', outcome, openPullRequests: [{ number: 1, url: 'https://example.test/pr/1', body: '', headSha: '', headRef: 'docs-prune/old', author: 'other', changedPaths: [] }], push, operations, approve: async () => true })).rejects.toBeInstanceOf(DocsPruneRefusal);
  expect(push).not.toHaveBeenCalled();
});

it('refuses a declined approval before pushing or creating a PR', async () => {
  operations.run.mockClear();
  const push = vi.fn(async () => ({ kind: 'executed' as const }));
  await expect(publishDocsPrune({ repoDir: '/repo', repository: 'o/r', operatorLogin: 'me', branch: 'docs-prune/2026-10-22', commit: 'abc', outcome, openPullRequests: [], push, operations, approve: async () => false })).rejects.toThrow('remote-ref.push');
  expect(push).not.toHaveBeenCalled();
  expect(operations.run).not.toHaveBeenCalled();
});

it('refuses a failed push before writing a pull request', async () => {
  operations.run.mockClear();
  const push = vi.fn(async () => ({ kind: 'refused' as const, detail: 'explicit approval required' }));
  await expect(publishDocsPrune({ repoDir: '/repo', repository: 'o/r', operatorLogin: 'me', branch: 'docs-prune/2026-10-22', commit: 'abc', outcome, openPullRequests: [], push, operations, approve: async () => true })).rejects.toThrow('push explicit approval required');
  expect(operations.run).not.toHaveBeenCalled();
});

it('production publisher refuses a declined interactive approval before any remote write', async () => {
  const git = vi.fn(async () => ({ stdout: '' }));
  const gh = vi.fn(async () => ({ stdout: '' }));
  const publish = makeProductionDocsPrunePublisher(git as never, gh as never, '/repo', {
    mode: 'interactive', confirm: async () => false,
  });
  await expect(publish({ repoDir: '/repo', repository: 'o/r', operatorLogin: 'me', branch: 'docs-prune/2026-10-22', commit: 'abc', outcome, openPullRequests: [] }))
    .rejects.toBeInstanceOf(DocsPruneRefusal);
  expect(git).not.toHaveBeenCalled();
  expect(gh).not.toHaveBeenCalled();
});

it('production publisher refuses a non-interactive confirmation before any remote write', async () => {
  const git = vi.fn(async () => ({ stdout: '' }));
  const gh = vi.fn(async () => ({ stdout: '' }));
  const publish = makeProductionDocsPrunePublisher(git as never, gh as never, '/repo', {
    mode: 'automatic', confirm: async () => true,
  });
  await expect(publish({ repoDir: '/repo', repository: 'o/r', operatorLogin: 'me', branch: 'docs-prune/2026-10-22', commit: 'abc', outcome, openPullRequests: [] }))
    .rejects.toThrow('remote-ref.push');
  expect(git).not.toHaveBeenCalled();
  expect(gh).not.toHaveBeenCalled();
});
