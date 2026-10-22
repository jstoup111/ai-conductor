import { expect, it } from 'vitest';
import { docsPruneEvent, renderDocsPruneReport } from '../../src/engine/docs-prune.js';

it('renders every removed and deferred path and emits an empty outcome without a PR URL', () => {
  const outcome = { removable: ['.docs/plans/alpha.md', '.docs/coherence/alpha.md'], deferred: [{ stem: 'beta', paths: ['.docs/coherence/beta.md', '.docs/plans/beta.md'], reason: 'open-pr-modifies' as const, pullRequests: ['https://example.test/pr/2', 'https://example.test/pr/3'] }], skipped: [], excluded: [] };
  const report = renderDocsPruneReport(outcome);
  for (const path of [...outcome.removable, ...outcome.deferred[0]!.paths]) expect(report).toContain(path);
  expect(report).toContain('open-pr-modifies');
  for (const url of outcome.deferred[0]!.pullRequests) expect(report).toContain(url);
  expect(docsPruneEvent({ ...outcome, removable: [] })).toEqual(expect.objectContaining({ type: 'decide_artifacts_pruned', removed: [] }));
  expect(docsPruneEvent({ ...outcome, removable: [] })).not.toHaveProperty('pullRequestUrl');
});
