import { describe, it, expect } from 'vitest';
import type { StepName, ComplexityTier } from '../../src/types/index.js';
import type { HarnessConfig } from '../../src/types/config.js';
import {
  ALL_STEPS,
  getStepDefinition,
  getStepIndex,
  getStepByIndex,
  shouldSkipForTier,
  getSkippableSteps,
  isCheckpointStep,
  getPrerequisites,
  buildStepRegistry,
} from '../../src/engine/steps.js';

describe('engine/steps', () => {
  // --- ALL_STEPS exact order ---

  describe('ALL_STEPS', () => {
    const expectedOrder: StepName[] = [
      'worktree', 'memory', 'brainstorm', 'complexity', 'stories',
      'conflict_check', 'plan', 'architecture_diagram', 'architecture_review',
      'acceptance_specs', 'build', 'manual_test', 'retro', 'finish',
    ];

    it('has exactly 14 steps', () => {
      expect(ALL_STEPS).toHaveLength(14);
    });

    it('steps are in exact order', () => {
      expect(ALL_STEPS.map(s => s.name)).toEqual(expectedOrder);
    });

    it('worktree is SETUP/structural with no prereqs, no skip, not checkpoint', () => {
      const s = ALL_STEPS[0];
      expect(s.name).toBe('worktree');
      expect(s.phase).toBe('SETUP');
      expect(s.enforcement).toBe('structural');
      expect(s.prerequisites).toEqual([]);
      expect(s.skippableForTiers).toEqual([]);
      expect(s.isCheckpoint).toBe(false);
    });

    it('memory is UNDERSTAND/advisory', () => {
      const s = ALL_STEPS[1];
      expect(s.name).toBe('memory');
      expect(s.phase).toBe('UNDERSTAND');
      expect(s.enforcement).toBe('advisory');
      expect(s.prerequisites).toEqual([]);
    });

    it('brainstorm is DECIDE/advisory', () => {
      const s = ALL_STEPS[2];
      expect(s.name).toBe('brainstorm');
      expect(s.phase).toBe('DECIDE');
      expect(s.enforcement).toBe('advisory');
      expect(s.prerequisites).toEqual([]);
    });

    it('complexity has prereq brainstorm', () => {
      const s = ALL_STEPS[3];
      expect(s.name).toBe('complexity');
      expect(s.phase).toBe('DECIDE');
      expect(s.enforcement).toBe('advisory');
      expect(s.prerequisites).toEqual(['brainstorm']);
    });

    it('stories is DECIDE/gating with prereq brainstorm', () => {
      const s = ALL_STEPS[4];
      expect(s.name).toBe('stories');
      expect(s.phase).toBe('DECIDE');
      expect(s.enforcement).toBe('gating');
      expect(s.prerequisites).toEqual(['brainstorm']);
    });

    it('conflict_check is DECIDE/gating, skippable for S', () => {
      const s = ALL_STEPS[5];
      expect(s.name).toBe('conflict_check');
      expect(s.enforcement).toBe('gating');
      expect(s.prerequisites).toEqual(['stories']);
      expect(s.skippableForTiers).toEqual(['S']);
    });

    it('plan is DECIDE/gating with prereq conflict_check', () => {
      const s = ALL_STEPS[6];
      expect(s.name).toBe('plan');
      expect(s.enforcement).toBe('gating');
      expect(s.prerequisites).toEqual(['conflict_check']);
    });

    it('architecture_diagram is DECIDE/advisory, skippable for S', () => {
      const s = ALL_STEPS[7];
      expect(s.name).toBe('architecture_diagram');
      expect(s.enforcement).toBe('advisory');
      expect(s.prerequisites).toEqual(['plan']);
      expect(s.skippableForTiers).toEqual(['S']);
    });

    it('architecture_review is DECIDE/advisory, skippable for S', () => {
      const s = ALL_STEPS[8];
      expect(s.name).toBe('architecture_review');
      expect(s.enforcement).toBe('advisory');
      expect(s.prerequisites).toEqual(['plan']);
      expect(s.skippableForTiers).toEqual(['S']);
    });

    it('acceptance_specs is BUILD/gating, skippable for S', () => {
      const s = ALL_STEPS[9];
      expect(s.name).toBe('acceptance_specs');
      expect(s.enforcement).toBe('gating');
      expect(s.prerequisites).toEqual(['plan']);
      expect(s.skippableForTiers).toEqual(['S']);
    });

    it('build is BUILD/structural, checkpoint, prereq plan', () => {
      const s = ALL_STEPS[10];
      expect(s.name).toBe('build');
      expect(s.phase).toBe('BUILD');
      expect(s.enforcement).toBe('structural');
      expect(s.prerequisites).toEqual(['plan']);
      expect(s.isCheckpoint).toBe(true);
    });

    it('manual_test is SHIP/advisory, checkpoint, prereq build', () => {
      const s = ALL_STEPS[11];
      expect(s.name).toBe('manual_test');
      expect(s.phase).toBe('SHIP');
      expect(s.enforcement).toBe('advisory');
      expect(s.prerequisites).toEqual(['build']);
      expect(s.isCheckpoint).toBe(true);
    });

    it('retro is SHIP/advisory, skippable for S', () => {
      const s = ALL_STEPS[12];
      expect(s.name).toBe('retro');
      expect(s.enforcement).toBe('advisory');
      expect(s.prerequisites).toEqual(['manual_test']);
      expect(s.skippableForTiers).toEqual(['S']);
    });

    it('finish is SHIP/gating with prereq retro', () => {
      const s = ALL_STEPS[13];
      expect(s.name).toBe('finish');
      expect(s.enforcement).toBe('gating');
      expect(s.prerequisites).toEqual(['retro']);
      expect(s.isCheckpoint).toBe(false);
    });
  });

  // --- getStepDefinition ---

  describe('getStepDefinition', () => {
    it('returns correct definition for known step', () => {
      expect(getStepDefinition('build').name).toBe('build');
      expect(getStepDefinition('build').isCheckpoint).toBe(true);
    });

    it('throws for unknown step name', () => {
      expect(() => getStepDefinition('nonexistent' as any)).toThrow();
    });
  });

  // --- getStepIndex / getStepByIndex ---

  describe('getStepIndex', () => {
    it('returns 0 for worktree', () => {
      expect(getStepIndex('worktree')).toBe(0);
    });

    it('returns 13 for finish', () => {
      expect(getStepIndex('finish')).toBe(13);
    });
  });

  describe('getStepByIndex', () => {
    it('returns worktree for index 0', () => {
      expect(getStepByIndex(0).name).toBe('worktree');
    });

    it('returns finish for index 13', () => {
      expect(getStepByIndex(13).name).toBe('finish');
    });

    it('throws for out-of-range index', () => {
      expect(() => getStepByIndex(14)).toThrow();
      expect(() => getStepByIndex(-1)).toThrow();
    });
  });

  // --- shouldSkipForTier ---

  describe('shouldSkipForTier', () => {
    const sSkippable: StepName[] = [
      'conflict_check', 'architecture_diagram', 'architecture_review',
      'acceptance_specs', 'retro',
    ];

    it('Small tier skips the right 5 steps', () => {
      for (const step of sSkippable) {
        expect(shouldSkipForTier(step, 'S')).toBe(true);
      }
    });

    it('Small tier does not skip non-skippable steps', () => {
      const nonSkippable: StepName[] = [
        'worktree', 'memory', 'brainstorm', 'complexity', 'stories',
        'plan', 'build', 'manual_test', 'finish',
      ];
      for (const step of nonSkippable) {
        expect(shouldSkipForTier(step, 'S')).toBe(false);
      }
    });

    it('Medium tier skips nothing', () => {
      for (const step of ALL_STEPS) {
        expect(shouldSkipForTier(step.name, 'M')).toBe(false);
      }
    });

    it('Large tier skips nothing', () => {
      for (const step of ALL_STEPS) {
        expect(shouldSkipForTier(step.name, 'L')).toBe(false);
      }
    });
  });

  // --- getSkippableSteps ---

  describe('getSkippableSteps', () => {
    it('returns 5 steps for S tier', () => {
      const result = getSkippableSteps('S');
      expect(result).toEqual([
        'conflict_check', 'architecture_diagram', 'architecture_review',
        'acceptance_specs', 'retro',
      ]);
    });

    it('returns empty for M tier', () => {
      expect(getSkippableSteps('M')).toEqual([]);
    });

    it('returns empty for L tier', () => {
      expect(getSkippableSteps('L')).toEqual([]);
    });
  });

  // --- isCheckpointStep ---

  describe('isCheckpointStep', () => {
    it('build is a checkpoint', () => {
      expect(isCheckpointStep('build')).toBe(true);
    });

    it('manual_test is a checkpoint', () => {
      expect(isCheckpointStep('manual_test')).toBe(true);
    });

    it('other steps are not checkpoints', () => {
      const nonCheckpoint: StepName[] = [
        'worktree', 'memory', 'brainstorm', 'complexity', 'stories',
        'conflict_check', 'plan', 'architecture_diagram', 'architecture_review',
        'acceptance_specs', 'retro', 'finish',
      ];
      for (const step of nonCheckpoint) {
        expect(isCheckpointStep(step)).toBe(false);
      }
    });
  });

  // --- getPrerequisites ---

  describe('getPrerequisites', () => {
    it('worktree has no prerequisites', () => {
      expect(getPrerequisites('worktree')).toEqual([]);
    });

    it('complexity requires brainstorm', () => {
      expect(getPrerequisites('complexity')).toEqual(['brainstorm']);
    });

    it('build requires plan', () => {
      expect(getPrerequisites('build')).toEqual(['plan']);
    });

    it('finish requires retro', () => {
      expect(getPrerequisites('finish')).toEqual(['retro']);
    });
  });

  // --- buildStepRegistry ---

  describe('buildStepRegistry', () => {
    it('inserts custom step after specified step', () => {
      const config: HarnessConfig = {
        steps: {
          add: [
            {
              name: 'lint',
              after: 'build',
              skill: 'custom-lint',
              enforcement: 'gating',
            },
          ],
        },
      };

      const registry = buildStepRegistry(config);

      const names = registry.map((s) => s.name);
      const buildIdx = names.indexOf('build');
      const lintIdx = names.indexOf('lint' as StepName);

      expect(lintIdx).toBe(buildIdx + 1);

      const lintStep = registry[lintIdx];
      expect(lintStep.label).toBe('lint');
      expect(lintStep.phase).toBe('BUILD'); // inherits from 'build'
      expect(lintStep.enforcement).toBe('gating');
      expect(lintStep.prerequisites).toEqual(['build']);
      expect(lintStep.skippableForTiers).toEqual([]);
      expect(lintStep.isCheckpoint).toBe(false);
      expect(lintStep.skillName).toBe('custom-lint');
    });

    it('preserves config file order for multiple custom steps at same position', () => {
      const config: HarnessConfig = {
        steps: {
          add: [
            {
              name: 'lint',
              after: 'build',
              skill: 'custom-lint',
              enforcement: 'gating',
            },
            {
              name: 'security_scan',
              after: 'build',
              skill: 'security-scan',
              enforcement: 'advisory',
            },
          ],
        },
      };

      const registry = buildStepRegistry(config);

      const names = registry.map((s) => s.name);
      const buildIdx = names.indexOf('build');
      const lintIdx = names.indexOf('lint' as StepName);
      const scanIdx = names.indexOf('security_scan' as StepName);

      // Both come after build, in config order
      expect(lintIdx).toBe(buildIdx + 1);
      expect(scanIdx).toBe(buildIdx + 2);
    });
  });
});
