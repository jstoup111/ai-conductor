import { describe, expect, it, vi } from 'vitest';
import type { ComplexityTier } from '../../src/types/index.js';
import { resolvePlanPatternSource } from '../../src/engine/plan-pattern-source.js';
import { isGatingStep } from '../../src/engine/gates.js';
import { ALL_STEPS, getSkippableSteps, shouldSkipForTier } from '../../src/engine/steps.js';

const planPath = '.docs/plans/feature.md';
const sourcePath = 'src/conductor/src/engine/pattern-source.ts';
const replicationDeclaration = [
  `**Pattern-source:** ${sourcePath}`,
  '**Rename-map:** pattern-source -> target-pattern',
].join('\n');

function stepPolicy(tier: ComplexityTier) {
  return {
    skipped: getSkippableSteps(tier),
    enabledGates: ALL_STEPS
      .filter((step) => isGatingStep(step.name) && !shouldSkipForTier(step.name, tier))
      .map((step) => step.name),
  };
}

describe('declared replication step invariance', () => {
  it.each<ComplexityTier>(['S', 'M', 'L'])(
    'keeps skip and enabled-gate sets unchanged at tier %s',
    async (tier) => {
      const fileExists = vi.fn(async (path: string) => path === sourcePath);
      const noDeclaration = await resolvePlanPatternSource(
        planPath,
        '# Implementation Plan',
        fileExists,
      );
      const declaration = await resolvePlanPatternSource(
        planPath,
        replicationDeclaration,
        fileExists,
      );

      expect(noDeclaration).toEqual({ kind: 'absent' });
      expect(declaration.kind).toBe('resolved');
      expect(fileExists).toHaveBeenCalledTimes(1);
      expect(fileExists).toHaveBeenCalledWith(sourcePath);

      const baseline = stepPolicy(tier);
      const withReplicationDeclaration = stepPolicy(tier);

      expect(withReplicationDeclaration).toEqual(baseline);
    },
  );
});
