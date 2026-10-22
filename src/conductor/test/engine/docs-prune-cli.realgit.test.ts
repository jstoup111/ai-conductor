import { expect, it, vi } from 'vitest';
import { dispatchDocsPrune } from '../../src/engine/docs-prune-cli.js';

it('fails closed when its guarded commit cannot establish the exact deletion set', async () => {
  const errors: string[] = [];
  const git = vi.fn(async (args: string[]) => ({ stdout: args[0] === 'ls-tree' ? '.docs/shipped/alpha.md\n.docs/plans/alpha.md\n' : '' }));
  const gh = vi.fn(async (args: string[]) => args[0] === 'repo' ? ({ stdout: JSON.stringify({ nameWithOwner: 'o/r' }) }) : ({ stdout: JSON.stringify({ data: { repository: { pullRequests: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }) }));
  await expect(dispatchDocsPrune({ kind: 'run' }, process.cwd(), { git: git as never, gh: gh as never, reportError: (m) => errors.push(m) })).resolves.toBe(1);
  expect(errors.join('\n')).toContain('unexpected staged path');
});
