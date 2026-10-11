import { describe, expect, it } from 'vitest';

import { AS_BUILT_PROJECTION_LIMITS } from '../../src/engine/as-built-projection.js';
import { corpusAdmissionFailures, largestMarkdownBytes } from './corpus-admission.js';

const REPOSITORY_ROOT = new URL('../../../../', import.meta.url);

describe('as-built projection live-corpus limits', () => {
  it('keeps the largest plan, stories, and governing-ADR decision corpus inputs within shipped byte limits', async () => {
    const limits = AS_BUILT_PROJECTION_LIMITS;
    const [plans, stories, decisions] = await Promise.all([
      largestMarkdownBytes(new URL('.docs/plans', REPOSITORY_ROOT).pathname),
      largestMarkdownBytes(new URL('.docs/stories', REPOSITORY_ROOT).pathname),
      largestMarkdownBytes(new URL('.docs/decisions', REPOSITORY_ROOT).pathname),
    ]);

    expect({
      perFileHunks: limits.perFileHunksBytes,
      totalDiff: limits.totalDiffBytes,
      planTasks: limits.planTasksBytes,
      storyCriteria: limits.storyCriteriaBytes,
      governingAdrDecisions: limits.governingAdrDecisionsBytes,
    }).toEqual({
      perFileHunks: expect.any(Number),
      totalDiff: expect.any(Number),
      planTasks: expect.any(Number),
      storyCriteria: expect.any(Number),
      governingAdrDecisions: expect.any(Number),
    });
    expect(corpusAdmissionFailures([
      { dimension: 'plans', measure: plans, limit: limits.planTasksBytes },
      { dimension: 'stories', measure: stories, limit: limits.storyCriteriaBytes },
      { dimension: 'decisions', measure: decisions, limit: limits.governingAdrDecisionsBytes },
    ])).toEqual([]);
  });
});
