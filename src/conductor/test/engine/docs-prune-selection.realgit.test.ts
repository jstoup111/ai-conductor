// Covers: task:2, task:4
import { describe, expect, it } from 'vitest';
import { applyOpenPullRequestDeferral, resolveDocsPruneSelection } from '../../src/engine/docs-prune.js';

const paths = [
  '.docs/shipped/alpha.md', '.docs/plans/alpha.md', '.docs/coherence/alpha.md',
  '.docs/plans/beta.md', '.docs/coherence/beta.md',
];
describe('docs prune selection', () => {
  it('selects only shipped stems from origin/main and defers a complete stem', async () => {
    const git = async (args: string[]) => ({ stdout: args[0] === 'ls-tree' ? `${paths.join('\n')}\n` : '' });
    const selected = await resolveDocsPruneSelection('/repo', git as never);
    expect(selected.removable).toEqual(['.docs/plans/alpha.md', '.docs/coherence/alpha.md']);
    expect(selected.skipped).toContainEqual({ stem: 'beta', reason: 'no-shipped-record' });
    const deferred = applyOpenPullRequestDeferral(selected, [{ number: 1, url: 'https://example.test/pr/1', body: '', headSha: 'a', headRef: 'feature', author: 'other', changedPaths: ['.docs/coherence/alpha.md'] }], 'me');
    expect(deferred.removable).toEqual([]);
    expect(deferred.deferred[0]?.paths).toEqual(selected.removable);
  });
});

it('defers only touched stems, including a 150th changed path, and ignores the operator prune PR', async () => {
  const git = async (args: string[]) => ({ stdout: args[0] === 'ls-tree' ? [
    '.docs/shipped/alpha.md', '.docs/plans/alpha.md', '.docs/coherence/alpha.md',
    '.docs/shipped/gamma.md', '.docs/plans/gamma.md', '.docs/coherence/gamma.md',
  ].join('\n') : '' });
  const selected = await resolveDocsPruneSelection('/repo', git as never);
  const changedPaths = Array.from({ length: 149 }, (_, index) => `.docs/other/${index}.md`).concat('.docs/plans/alpha.md');
  const deferred = applyOpenPullRequestDeferral(selected, [{ number: 2, url: 'https://example.test/pr/2', body: '', headSha: 'b', headRef: 'feature/alpha', author: 'other', changedPaths }], 'me');
  expect(deferred.deferred).toContainEqual({ stem: 'alpha', paths: selected.stems.get('alpha'), reason: 'open-pr-modifies', pullRequests: ['https://example.test/pr/2'] });
  expect(deferred.removable).toEqual(selected.stems.get('gamma'));

  const ownPr = applyOpenPullRequestDeferral(selected, [{ number: 3, url: 'https://example.test/pr/3', body: '', headSha: 'c', headRef: 'docs-prune/2026-10-22', author: 'me', changedPaths: ['.docs/coherence/alpha.md'] }], 'me');
  expect(ownPr.deferred).toEqual([]);
  expect(ownPr.removable).toEqual(selected.removable);
});

it('keeps an exact dated artifact while excluding an ambiguous undated match', async () => {
  const collisionPaths = [
    '.docs/shipped/2026-10-01-alpha.md', '.docs/plans/2026-10-01-alpha.md',
    '.docs/plans/2026-10-20-alpha.md', '.docs/coherence/2026-10-01-alpha.md',
    '.docs/conflicts/alpha.md',
  ];
  const git = async (args: string[]) => ({ stdout: args[0] === 'ls-tree' ? `${collisionPaths.join('\n')}\n` : '' });
  const selected = await resolveDocsPruneSelection('/repo', git as never);
  expect(selected.removable).toContain('.docs/coherence/2026-10-01-alpha.md');
  expect(selected.removable).not.toContain('.docs/conflicts/alpha.md');
  expect(selected.excluded).toContain('.docs/conflicts/alpha.md');
});
