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
