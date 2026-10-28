// Covers: task:2
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  PRD_AUDIT_PROJECTION_CORPUS_MAXIMA_BYTES,
  PRD_AUDIT_PROJECTION_ENVELOPE_OVERHEAD_BYTES,
  PRD_AUDIT_PROJECTION_LIMITS,
  PRD_AUDIT_PROJECTION_MIN_HISTORY_BYTES,
} from '../../src/engine/prd-audit-projection.js';
import {
  corpusAdmissionFailures,
  largestMarkdownBytes,
  largestPlanIntentBytes,
} from './corpus-admission.js';

function roundUpPowerOfTwo(bytes: number): number {
  let rounded = 1;
  while (rounded < bytes) rounded *= 2;
  return rounded;
}

describe('PRD-audit live-corpus projection limits', () => {
  it('ships finite corpus-based limits that admit every normal input and its total envelope', async () => {
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
    const limits = PRD_AUDIT_PROJECTION_LIMITS;
    const maxima = PRD_AUDIT_PROJECTION_CORPUS_MAXIMA_BYTES;
    const historyFloor = PRD_AUDIT_PROJECTION_MIN_HISTORY_BYTES;
    const overhead = PRD_AUDIT_PROJECTION_ENVELOPE_OVERHEAD_BYTES;
    const [planIntent, planTasks, criteria, prdIntent, coherence] = await Promise.all([
      largestPlanIntentBytes(join(repositoryRoot, '.docs', 'plans')),
      largestMarkdownBytes(join(repositoryRoot, '.docs', 'plans')),
      largestMarkdownBytes(join(repositoryRoot, '.docs', 'stories')),
      largestMarkdownBytes(join(repositoryRoot, '.docs', 'specs')),
      largestMarkdownBytes(join(repositoryRoot, '.docs', 'coherence')),
    ]);

    expect(corpusAdmissionFailures([
      { dimension: 'plan-intent', measure: planIntent, limit: limits.planIntentBytes },
      { dimension: 'plan-tasks', measure: planTasks, limit: limits.planTasksBytes },
      { dimension: 'criteria', measure: criteria, limit: limits.criteriaBytes },
      { dimension: 'prd-intent', measure: prdIntent, limit: limits.prdIntentBytes },
      { dimension: 'coherence', measure: coherence, limit: limits.coherenceBytes },
    ])).toEqual([]);
    expect(limits).toEqual({
      planIntentBytes: expect.any(Number),
      planTasksBytes: expect.any(Number),
      criteriaBytes: expect.any(Number),
      prdIntentBytes: expect.any(Number),
      coherenceBytes: expect.any(Number),
      historyBytes: expect.any(Number),
      totalBytes: expect.any(Number),
    });
    expect(Object.values({ ...limits, overhead, historyFloor }).every((limit) => Number.isFinite(limit) && limit > 0)).toBe(true);
    expect(limits.planIntentBytes).toBe(roundUpPowerOfTwo(Math.max(256 * 1024, maxima.planIntentBytes)));
    expect(limits.planTasksBytes).toBe(roundUpPowerOfTwo(Math.max(256 * 1024, maxima.planTasksBytes)));
    expect(limits.criteriaBytes).toBe(roundUpPowerOfTwo(Math.max(256 * 1024, maxima.criteriaBytes)));
    expect(limits.prdIntentBytes).toBe(roundUpPowerOfTwo(maxima.prdIntentBytes));
    expect(limits.coherenceBytes).toBe(roundUpPowerOfTwo(maxima.coherenceBytes));
    expect(limits.historyBytes).toBe(roundUpPowerOfTwo(Math.max(historyFloor, maxima.historyBytes)));
    expect(limits.totalBytes).toBe(roundUpPowerOfTwo(
      limits.planIntentBytes + limits.planTasksBytes + limits.criteriaBytes + limits.prdIntentBytes +
      limits.coherenceBytes + limits.historyBytes + (512 * 1024) + overhead,
    ));
  });
});
