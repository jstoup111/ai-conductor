import { describe, expect, it, vi } from 'vitest';
import type { ComplexityTier } from '../../src/types/index.js';
import { resolvePlanContentScheduling } from '../../src/engine/plan-content-scheduling.js';

const planPath = '.docs/plans/feature.md';
const sourcePath = 'src/conductor/src/engine/pattern-source.ts';
const replicationDeclaration = [
  `**Pattern-source:** ${sourcePath}`,
  '**Rename-map:** pattern-source -> target-pattern',
].join('\n');

const expectedPolicies: Record<ComplexityTier, {
  skippedSteps: string[];
  enabledGateSteps: string[];
}> = {
  S: {
    skippedSteps: [
      'architecture_diagram',
      'architecture_review',
      'conflict_check',
      'coherence_check',
      'acceptance_specs',
      'manual_test',
      'architecture_review_as_built',
      'retro',
    ],
    enabledGateSteps: ['prd', 'stories', 'plan', 'wiring_check', 'test_suite', 'build_review', 'prd_audit', 'finish'],
  },
  M: {
    skippedSteps: [],
    enabledGateSteps: [
      'prd', 'stories', 'conflict_check', 'plan', 'coherence_check', 'acceptance_specs',
      'wiring_check', 'test_suite', 'build_review', 'manual_test', 'prd_audit',
      'architecture_review_as_built', 'finish',
    ],
  },
  L: {
    skippedSteps: [],
    enabledGateSteps: [
      'prd', 'stories', 'conflict_check', 'plan', 'coherence_check', 'acceptance_specs',
      'wiring_check', 'test_suite', 'build_review', 'manual_test', 'prd_audit',
      'architecture_review_as_built', 'finish',
    ],
  },
};

describe('declared replication step invariance', () => {
  it.each<ComplexityTier>(['S', 'M', 'L'])(
    'keeps skip and enabled-gate sets unchanged at tier %s',
    async (tier) => {
      const fileExists = vi.fn(async (path: string) => path === sourcePath);
      const absent = await resolvePlanContentScheduling({
        planPath,
        planContent: '# Implementation Plan',
        tier,
        fileExists,
      });
      const resolved = await resolvePlanContentScheduling({
        planPath,
        planContent: replicationDeclaration,
        tier,
        fileExists,
      });

      expect(absent.declaration).toEqual({ kind: 'absent' });
      expect(resolved.declaration.kind).toBe('resolved');
      expect(fileExists).toHaveBeenCalledTimes(1);
      expect(fileExists).toHaveBeenCalledWith(sourcePath);

      expect(absent).toMatchObject(expectedPolicies[tier]);
      expect(resolved).toMatchObject(expectedPolicies[tier]);
      expect({
        skippedSteps: resolved.skippedSteps,
        enabledGateSteps: resolved.enabledGateSteps,
      }).toEqual({
        skippedSteps: absent.skippedSteps,
        enabledGateSteps: absent.enabledGateSteps,
      });
    },
  );
});
