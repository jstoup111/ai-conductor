import { describe, expect, it } from 'vitest';

import type {
  ConductorOptions,
  OperatorParkedTermination,
  SchedulingUnitRef,
} from '../../src/engine/conductor.js';

describe('operator park boundary contract', () => {
  it('represents every scheduling-unit boundary and optional daemon boundary options', () => {
    const boundaries = [
      { kind: 'step', name: 'memory' },
      { kind: 'group', name: 'ship-validation' },
      { kind: 'pre-first-unit' },
    ] satisfies SchedulingUnitRef[];
    const parked = boundaries.map((boundary) => ({
      kind: 'operator-parked' as const,
      boundary,
    })) satisfies OperatorParkedTermination[];
    const options = [
      {},
      {
        featureSlug: 'boundary-aware-operator-parking',
        operatorParkBoundary: async () => false,
      },
    ] satisfies Pick<
      ConductorOptions,
      'featureSlug' | 'operatorParkBoundary'
    >[];

    expect({
      boundaries: parked.map(({ boundary }) => boundary.kind),
      configured: options.map((option) => 'featureSlug' in option),
    }).toEqual({
      boundaries: ['step', 'group', 'pre-first-unit'],
      configured: [false, true],
    });
  });
});
