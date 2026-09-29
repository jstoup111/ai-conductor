import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { joinBuildReviewRubricOutcomes, projectBuildReviewAggregateSources } from '../../src/engine/build-review-aggregate.js';
import { parseBuildReviewLapId, type BuildReviewJudgedResult } from '../../src/engine/build-review-domain.js';
import { stampBuildReviewCustomJudgedResult } from '../../src/engine/build-review-finding-identity.js';
import { loadConfig } from '../../src/engine/config.js';
import { resolveBuildReviewConfig } from '../../src/engine/resolved-config.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '../../../..');
const lapId = parseBuildReviewLapId('lap-event-spine')!;
const snapshotDigest = 'sha256:event-spine-snapshot';
const HASH = `sha256:${'a'.repeat(64)}`;
const POLICY_DIGEST = `sha256-v1:${'b'.repeat(64)}`;

function cleanResult(rubric: 'testQuality' | 'security'): BuildReviewJudgedResult {
  return {
    kind: 'judged', rubric, lapId, snapshotDigest, contractVersion: 'v3', findings: [], verdict: 'PASS',
  };
}

describe('repository-local event-spine build-review rubric', () => {
  it('declares the project event-spine custom rubric and attributes its judged finding', async () => {
    const loaded = await loadConfig(repoRoot);

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const resolved = resolveBuildReviewConfig(loaded.config);
    const eventSpine = resolved.catalog.filter((entry) => entry.id === 'eventSpine');

    expect({
      catalog: resolved.catalog.map((entry) => entry.id),
      adjudication: resolved.adjudication.enabled,
      rawMinimumConfidence: loaded.config.build_review?.custom_rubrics?.eventSpine?.min_confidence,
      eventSpine,
    }).toEqual({
      catalog: ['testQuality', 'security', 'eventSpine'],
      adjudication: true,
      rawMinimumConfidence: undefined,
      eventSpine: [expect.objectContaining({
        id: 'eventSpine', kind: 'custom', skill: 'event-spine', source: 'project',
        policy: expect.objectContaining({ enabled: true, llm_provider: 'claude', model: 'sonnet', effort: 'low' }),
      })],
    });

    const entry = eventSpine[0];
    if (!entry || entry.kind !== 'custom') throw new Error('expected eventSpine custom catalog entry');
    const sourceRegion = {
      path: 'src/conductor/src/engine/reviewer.ts', startLine: 12, endLine: 18,
      contentHash: HASH, display: 'parallel reviewer ledger',
    };
    const declaration = {
      version: 'v1' as const, rubricId: entry.id, semanticSkill: entry.skill,
      question: entry.question, source: 'project' as const, resources: entry.resources,
    };
    const stamp = {
      rubric: entry.id, lapId, declaration,
      policy: { version: 'v1' as const, bundleDigest: POLICY_DIGEST },
      candidate: { provider: 'claude', model: 'sonnet', effort: 'low' },
      reviewedInput: { version: 'v1' as const, contentDigest: HASH },
    };
    const result = stampBuildReviewCustomJudgedResult({
      kind: 'custom-findings', version: 'v1', findings: [{
        concernId: 'parallel-event-channel', summary: 'The diff adds a separate reviewer ledger.',
        evidenceLocations: ['src/conductor/src/engine/reviewer.ts:12'], sourceRegions: [sourceRegion],
      }],
    }, stamp, { sourceRegions: [sourceRegion] });
    if (!result) throw new Error('expected stamped eventSpine finding');

    const aggregate = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest, results: { testQuality: cleanResult('testQuality'), security: cleanResult('security') },
      customResults: {
        eventSpine: {
          descriptor: {
            version: 'v1', semanticSkill: entry.skill, declaration,
            installation: { source: 'project' }, effectivePolicy: stamp.policy,
            reviewedInput: stamp.reviewedInput, producer: stamp.candidate,
          },
          result,
        },
      },
      currentCustomRubrics: ['eventSpine'],
    });

    expect(aggregate.verdict).toBe('FAIL');
    expect(projectBuildReviewAggregateSources(aggregate)).toEqual([
      expect.objectContaining({ rubric: 'eventSpine', concernKind: 'parallel-event-channel' }),
    ]);
  });
});
