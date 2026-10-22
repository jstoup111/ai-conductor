// Covers: task:6, task:7
import { expect, it, vi } from 'vitest';
import { DocsPruneRefusal, publishDocsPrune } from '../../src/engine/docs-prune.js';
import { makeProductionDocsPrunePublisher } from '../../src/engine/docs-prune-cli.js';

const outcome = { removable: ['.docs/plans/alpha.md'], deferred: [], skipped: [], excluded: [] };
const operations = { run: vi.fn(async () => ({})) };

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
  await publishDocsPrune({ repoDir: '/repo', repository: 'o/r', operatorLogin: 'me', branch: 'docs-prune/2026-10-22', commit: 'next', outcome: { ...outcome, removable: ['.docs/plans/alpha.md', '.docs/plans/beta.md'] }, openPullRequests: [existing], push, operations, approve: async () => true });
  expect(push).toHaveBeenCalledWith('docs-prune/previous', 'next');
  expect(operations.run).toHaveBeenCalledWith(expect.objectContaining({ operation: 'pull-request.edit', target: { kind: 'pull-request', number: 2, repository: 'o/r' } }));
  expect(operations.run).not.toHaveBeenCalledWith(expect.objectContaining({ operation: 'pull-request.create' }));
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
