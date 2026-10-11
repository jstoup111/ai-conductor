import { describe, expect, it } from 'vitest';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REMEDIATION_PROJECTION_CORPUS_MAXIMA_BYTES,
  REMEDIATION_PROJECTION_ENVELOPE_OVERHEAD_BYTES,
  REMEDIATION_PROJECTION_LIMITS,
  REMEDIATION_PROJECTION_NAMED_BOUND_FLOOR_BYTES,
  REMEDIATION_PROJECTION_OPTIONAL_CONTEXT_FLOOR_BYTES,
  type RemediationProjectionLimits,
} from '../../src/engine/remediation-projection.js';
import { corpusAdmissionFailures, largestPlanTasksBytes } from './corpus-admission.js';

function roundUpPowerOfTwo(bytes: number): number {
  let rounded = 1;
  while (rounded < bytes) rounded *= 2;
  return rounded;
}

describe('remediation projection corpus limits', () => {
  // Covers: task:10
  it('ships finite corpus-sized structured limits and a total envelope', async () => {
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
    const limits: RemediationProjectionLimits = REMEDIATION_PROJECTION_LIMITS;
    expect(limits).toEqual({
      requiredReferencesBytes: expect.any(Number),
      tasksBytes: expect.any(Number),
      pendingAsBuiltFindingsBytes: expect.any(Number),
      priorLapsBytes: expect.any(Number),
      refusalsBytes: expect.any(Number),
      totalBytes: expect.any(Number),
      perFileHunksBytes: expect.any(Number),
      totalDiffBytes: expect.any(Number),
    });
    expect(Object.values(limits).every((limit) => Number.isFinite(limit) && limit > 0)).toBe(true);
    expect(corpusAdmissionFailures([{
      dimension: 'tasks',
      measure: await largestPlanTasksBytes(join(repositoryRoot, '.docs', 'plans')),
      limit: limits.tasksBytes,
    }])).toEqual([]);
    expect(limits.requiredReferencesBytes).toBe(roundUpPowerOfTwo(Math.max(
      REMEDIATION_PROJECTION_NAMED_BOUND_FLOOR_BYTES,
      REMEDIATION_PROJECTION_CORPUS_MAXIMA_BYTES.requiredReferencesBytes,
    )));
    expect(limits.tasksBytes).toBe(roundUpPowerOfTwo(Math.max(
      REMEDIATION_PROJECTION_NAMED_BOUND_FLOOR_BYTES,
      REMEDIATION_PROJECTION_CORPUS_MAXIMA_BYTES.tasksBytes,
    )));
    expect(limits.pendingAsBuiltFindingsBytes).toBe(roundUpPowerOfTwo(Math.max(
      REMEDIATION_PROJECTION_NAMED_BOUND_FLOOR_BYTES,
      REMEDIATION_PROJECTION_CORPUS_MAXIMA_BYTES.pendingAsBuiltFindingsBytes,
    )));
    for (const [limit, measured] of [
      [limits.priorLapsBytes, REMEDIATION_PROJECTION_CORPUS_MAXIMA_BYTES.priorLapsBytes],
      [limits.refusalsBytes, REMEDIATION_PROJECTION_CORPUS_MAXIMA_BYTES.refusalsBytes],
    ] as const) {
      expect(limit).toBe(roundUpPowerOfTwo(Math.max(REMEDIATION_PROJECTION_OPTIONAL_CONTEXT_FLOOR_BYTES, measured)));
    }
    expect(limits.totalBytes).toBe(roundUpPowerOfTwo(
      limits.requiredReferencesBytes + limits.tasksBytes + limits.pendingAsBuiltFindingsBytes +
      limits.priorLapsBytes + limits.refusalsBytes + REMEDIATION_PROJECTION_ENVELOPE_OVERHEAD_BYTES,
    ));
  });
});
