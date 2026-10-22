import { expect, it } from 'vitest';
import { docsPruneEvent, renderDocsPruneReport } from '../../src/engine/docs-prune.js';

it('renders and emits the exact prune outcome', () => {
  const outcome = { removable: ['.docs/plans/alpha.md'], deferred: [{ stem: 'beta', paths: ['.docs/coherence/beta.md'], reason: 'open-pr-modifies' as const, pullRequests: ['https://example.test/pr/2'] }], skipped: [], excluded: [] };
  expect(renderDocsPruneReport(outcome)).toContain('https://example.test/pr/2');
  expect(docsPruneEvent(outcome).type).toBe('decide_artifacts_pruned');
});
