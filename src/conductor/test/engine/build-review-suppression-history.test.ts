// Covers: task:12
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { joinBuildReviewRubricOutcomes, projectBuildReviewAggregateSources } from '../../src/engine/build-review-aggregate.js';
import {
  persistBuildReviewSuppressions,
  projectBuildReviewSuppressionEntries,
} from '../../src/engine/build-review-suppression-history.js';
import { RemediationCaseStore } from '../../src/engine/remediation-case-store.js';

const temporaryDirectories: string[] = [];

async function projectRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'build-review-suppression-history-'));
  temporaryDirectories.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const feature = { version: 'v1' as const, repository: '/repo', feature: 'feature' };

function lapAggregate(lapId: string) {
  return joinBuildReviewRubricOutcomes({
    lapId: lapId as never,
    snapshotDigest: `snapshot-${lapId}`,
    results: {
      testQuality: {
        kind: 'judged', rubric: 'testQuality', lapId: lapId as never, snapshotDigest: `snapshot-${lapId}`,
        contractVersion: 'v3', verdict: 'FAIL',
        findings: [
          {
            concernKind: 'test-insensitive', summary: 'The sub-floor finding.', evidenceLocations: ['test/low.test.ts:1'],
            anchor: { rubric: 'testQuality', locus: { path: 'test/low.test.ts', contentHash: 'sha256:low', display: 'low test' } },
            confidence: 40,
          },
          {
            concernKind: 'test-insensitive', summary: 'The finding with no reported confidence.', evidenceLocations: ['test/absent.test.ts:1'],
            anchor: { rubric: 'testQuality', locus: { path: 'test/absent.test.ts', contentHash: 'sha256:absent', display: 'absent test' } },
          },
        ],
      },
    },
  });
}

describe('projectBuildReviewSuppressionEntries', () => {
  it('projects one entry per suppressed finding carrying rubric, summary, confidence, floor, and the lap', () => {
    const aggregate = lapAggregate('lap-1');
    const sources = projectBuildReviewAggregateSources(aggregate)!;

    expect(projectBuildReviewSuppressionEntries({
      aggregate,
      suppressedFindingIds: [sources[0]!.findingId],
      floors: { testQuality: 70 },
    })).toEqual([{
      findingId: sources[0]!.findingId,
      rubric: 'testQuality',
      summary: 'The sub-floor finding.',
      confidence: 40,
      floor: 70,
      lastSeenLap: 'lap-1',
    }]);
  });

  it('projects nothing for a finding that reported no confidence, because such a finding is never suppressible', () => {
    const aggregate = lapAggregate('lap-1');
    const sources = projectBuildReviewAggregateSources(aggregate)!;

    expect(projectBuildReviewSuppressionEntries({
      aggregate,
      suppressedFindingIds: [sources[1]!.findingId],
      floors: { testQuality: 70 },
    })).toEqual([]);
  });
});

describe('persistBuildReviewSuppressions', () => {
  it('refreshes a recurring entry in place on a later lap without creating a second row or pruning history', async () => {
    const root = await projectRoot();
    const firstLap = {
      findingId: 'testQuality:finding-recurring', rubric: 'testQuality', summary: 'The sub-floor finding.',
      confidence: 40, floor: 70, lastSeenLap: 'lap-1',
    } as const;
    const absentAfterwards = {
      findingId: 'testQuality:finding-gone', rubric: 'testQuality', summary: 'A suppression that stopped recurring.',
      confidence: 35, floor: 70, lastSeenLap: 'lap-1',
    } as const;

    await expect(persistBuildReviewSuppressions({
      projectRoot: root, feature, suppressions: [firstLap, absentAfterwards],
    })).resolves.toEqual({ ok: true });

    const secondLap = { ...firstLap, confidence: 55, lastSeenLap: 'lap-2' } as const;
    await expect(persistBuildReviewSuppressions({
      projectRoot: root, feature, suppressions: [secondLap],
    })).resolves.toEqual({ ok: true });

    const persisted = await new RemediationCaseStore(root, feature).read();
    if (!persisted.ok) throw new Error(`unexpected case-store failure: ${persisted.reason}`);
    expect(persisted.state.suppressions).toEqual([secondLap, absentAfterwards]);
  });

  it('writes nothing at all when the lap suppressed nothing', async () => {
    const root = await projectRoot();

    await expect(persistBuildReviewSuppressions({ projectRoot: root, feature, suppressions: [] })).resolves.toEqual({ ok: true });

    const persisted = await new RemediationCaseStore(root, feature).read();
    if (!persisted.ok) throw new Error(`unexpected case-store failure: ${persisted.reason}`);
    expect(persisted.state.suppressions).toEqual([]);
  });
});
