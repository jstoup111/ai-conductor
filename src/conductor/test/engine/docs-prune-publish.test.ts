import { expect, it, vi } from 'vitest';
import { DocsPruneRefusal, publishDocsPrune } from '../../src/engine/docs-prune.js';

const outcome = { removable: ['.docs/plans/alpha.md'], deferred: [], skipped: [], excluded: [] };
const operations = { run: vi.fn(async () => ({})) };

it('publishes only a docs-prune ref and creates its review PR', async () => {
  const push = vi.fn(async () => ({ kind: 'executed' as const }));
  await publishDocsPrune({ repoDir: '/repo', repository: 'o/r', operatorLogin: 'me', branch: 'docs-prune/2026-10-22', commit: 'abc', outcome, openPullRequests: [], push, operations, approve: async () => true });
  expect(push).toHaveBeenCalledWith('docs-prune/2026-10-22', 'abc');
  expect(operations.run).toHaveBeenCalledWith(expect.objectContaining({ operation: 'pull-request.create', payload: expect.objectContaining({ base: 'main', head: 'docs-prune/2026-10-22' }) }));
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
