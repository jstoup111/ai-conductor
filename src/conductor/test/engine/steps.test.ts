import { describe, it, expect } from 'vitest';
import type { StepName, ComplexityTier } from '../../src/types/index.js';
import type { HarnessConfig } from '../../src/types/config.js';
import {
  ALL_STEPS,
  getStepDefinition,
  getStepIndex,
  getStepByIndex,
  shouldSkipForTier,
  shouldSkipForTrack,
  shouldSkipForBootstrapMode,
  getSkippableSteps,
  isCheckpointStep,
  getPrerequisites,
  buildStepRegistry,
} from '../../src/engine/steps.js';

describe('engine/steps', () => {
  // --- ALL_STEPS exact order ---

  describe('ALL_STEPS', () => {
    const expectedOrder: StepName[] = [
      'worktree', 'memory', 'explore', 'complexity', 'prd',
      'architecture_diagram', 'architecture_review', 'stories', 'conflict_check', 'plan',
      'coherence_check',
      'acceptance_specs', 'build', 'build_review', 'wiring_check', 'manual_test', 'prd_audit',
      'architecture_review_as_built', 'retro', 'rebase', 'finish',
    ];

    it('has exactly 21 steps', () => {
      expect(ALL_STEPS).toHaveLength(21);
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

    it('explore is DECIDE/advisory, always runs, no prereqs', () => {
      const s = ALL_STEPS[2];
      expect(s.name).toBe('explore');
      expect(s.phase).toBe('DECIDE');
      expect(s.enforcement).toBe('advisory');
      expect(s.prerequisites).toEqual([]);
      expect(s.skippableForTiers).toEqual([]);
    });

    it('complexity has prereq explore', () => {
      const s = ALL_STEPS[3];
      expect(s.name).toBe('complexity');
      expect(s.phase).toBe('DECIDE');
      expect(s.enforcement).toBe('advisory');
      expect(s.prerequisites).toEqual(['explore']);
    });

    it('prd is DECIDE/gating, prereq explore, technical-track-skipped, kickback target', () => {
      const s = ALL_STEPS[4];
      expect(s.name).toBe('prd');
      expect(s.phase).toBe('DECIDE');
      expect(s.enforcement).toBe('gating');
      expect(s.prerequisites).toEqual(['explore']);
      expect(s.skippableForTracks).toEqual(['technical']);
      expect(s.kickbackTarget).toBe(true);
    });

    it('architecture_diagram is DECIDE/advisory, prereq complexity, skippable for S', () => {
      const s = ALL_STEPS[5];
      expect(s.name).toBe('architecture_diagram');
      expect(s.enforcement).toBe('advisory');
      expect(s.prerequisites).toEqual(['complexity']);
      expect(s.skippableForTiers).toEqual(['S']);
    });

    it('architecture_review is DECIDE/advisory, skippable for S, kickback target (precedes stories)', () => {
      const s = ALL_STEPS[6];
      expect(s.name).toBe('architecture_review');
      expect(s.enforcement).toBe('advisory');
      expect(s.prerequisites).toEqual(['architecture_diagram']);
      expect(s.skippableForTiers).toEqual(['S']);
      expect(s.kickbackTarget).toBe(true);
    });

    it('stories is DECIDE/gating with prereq architecture_review', () => {
      const s = ALL_STEPS[7];
      expect(s.name).toBe('stories');
      expect(s.phase).toBe('DECIDE');
      expect(s.enforcement).toBe('gating');
      expect(s.prerequisites).toEqual(['architecture_review']);
      expect(s.kickbackTarget).toBe(true);
    });

    it('conflict_check is DECIDE/gating, prereq stories, skippable for S', () => {
      const s = ALL_STEPS[8];
      expect(s.name).toBe('conflict_check');
      expect(s.enforcement).toBe('gating');
      expect(s.prerequisites).toEqual(['stories']);
      expect(s.skippableForTiers).toEqual(['S']);
    });

    it('plan is DECIDE/gating with prereq conflict_check', () => {
      const s = ALL_STEPS[9];
      expect(s.name).toBe('plan');
      expect(s.enforcement).toBe('gating');
      expect(s.prerequisites).toEqual(['conflict_check']);
    });

    it('coherence_check is DECIDE/gating, prereq plan, skippable for S', () => {
      const s = ALL_STEPS[10];
      expect(s.name).toBe('coherence_check');
      expect(s.prerequisites).toEqual(['plan']);
      expect(s.skippableForTiers).toEqual(['S']);
    });

    it('acceptance_specs is BUILD/gating, skippable for S', () => {
      const s = ALL_STEPS[11];
      expect(s.name).toBe('acceptance_specs');
      expect(s.enforcement).toBe('gating');
      expect(s.prerequisites).toEqual(['plan']);
      expect(s.skippableForTiers).toEqual(['S']);
    });

    it('build is BUILD/structural, checkpoint, prereq plan', () => {
      const s = ALL_STEPS[12];
      expect(s.name).toBe('build');
      expect(s.phase).toBe('BUILD');
      expect(s.enforcement).toBe('structural');
      expect(s.prerequisites).toEqual(['plan']);
      expect(s.isCheckpoint).toBe(true);
    });

    it('build_review is a BUILD/gating loop gate sitting between build and manual_test', () => {
      const s = ALL_STEPS[13];
      expect(s.name).toBe('build_review');
      expect(s.phase).toBe('BUILD');
      expect(s.enforcement).toBe('gating');
      expect(s.prerequisites).toEqual(['build']);
      expect(s.loopGate).toBe(true);
      expect(s.isCheckpoint).toBe(false);
    });

    it('wiring_check is a BUILD/gating loop gate sitting between build_review and manual_test', () => {
      const s = ALL_STEPS[14];
      expect(s.name).toBe('wiring_check');
      expect(s.phase).toBe('BUILD');
      expect(s.enforcement).toBe('gating');
      expect(s.prerequisites).toEqual(['build_review']);
      expect(s.loopGate).toBe(true);
      expect(s.skippableForTiers).toEqual([]);
      expect(s.isCheckpoint).toBe(false);
    });

    it('manual_test is SHIP/gating, checkpoint, prereq wiring_check (#367 — a failing manual test must be able to block)', () => {
      const s = ALL_STEPS[15];
      expect(s.name).toBe('manual_test');
      expect(s.phase).toBe('SHIP');
      expect(s.enforcement).toBe('gating');
      expect(s.prerequisites).toEqual(['wiring_check']);
      expect(s.isCheckpoint).toBe(true);
      // ADR D5: Small-tier features skip manual testing (mirrors
      // conflict_check/acceptance_specs S-tier skip).
      expect(s.skippableForTiers).toEqual(['S']);
    });

    it('prd_audit is SHIP/gating loopGate, after manual_test, not skippable', () => {
      const s = ALL_STEPS[16];
      expect(s.name).toBe('prd_audit');
      expect(s.phase).toBe('SHIP');
      expect(s.enforcement).toBe('gating');
      expect(s.prerequisites).toEqual(['manual_test']);
      expect(s.skippableForTiers).toEqual([]);
      expect(s.isCheckpoint).toBe(false);
      expect(s.loopGate).toBe(true);
      expect(s.skillName).toBe('prd-audit');
    });

    it('architecture_review_as_built is SHIP/gating loopGate, after prd_audit', () => {
      const s = ALL_STEPS[17];
      expect(s.name).toBe('architecture_review_as_built');
      expect(s.phase).toBe('SHIP');
      expect(s.enforcement).toBe('gating');
      expect(s.prerequisites).toEqual(['prd_audit']);
      // Skipped for Small (no ADRs) and tied to the DECIDE-phase review: if
      // architecture_review was skipped for any reason, there is nothing to
      // audit, so the as-built sweep skips too.
      expect(s.skippableForTiers).toEqual(['S']);
      expect(s.skipWhenSkipped).toBe('architecture_review');
      expect(s.isCheckpoint).toBe(false);
      expect(s.loopGate).toBe(true);
      // Runs the existing architecture-review skill in --as-built mode.
      expect(s.skillName).toBe('architecture-review');
    });

    it('retro is SHIP/advisory, skippable for S', () => {
      const s = ALL_STEPS[18];
      expect(s.name).toBe('retro');
      expect(s.enforcement).toBe('advisory');
      expect(s.prerequisites).toEqual(['architecture_review_as_built']);
      expect(s.skippableForTiers).toEqual(['S']);
    });

    it('rebase is SHIP/structural loopGate, engine-native, before finish', () => {
      const s = ALL_STEPS[19];
      expect(s.name).toBe('rebase');
      expect(s.phase).toBe('SHIP');
      expect(s.enforcement).toBe('structural');
      expect(s.prerequisites).toEqual(['manual_test']);
      expect(s.skippableForTiers).toEqual([]);
      expect(s.isCheckpoint).toBe(false);
      expect(s.loopGate).toBe(true);
      // Engine-native: no skill is dispatched for rebase (like complexity).
      expect(s.skillName).toBeUndefined();
    });

    it('finish is SHIP/gating with prereq rebase', () => {
      const s = ALL_STEPS[20];
      expect(s.name).toBe('finish');
      expect(s.enforcement).toBe('gating');
      expect(s.prerequisites).toEqual(['rebase']);
      expect(s.isCheckpoint).toBe(false);
    });

    it('build → build_review → wiring_check → manual_test → prd_audit → architecture_review_as_built → retro → rebase → finish loop-tail topology', () => {
      const names = ALL_STEPS.map((s) => s.name);
      const tail = names.slice(names.indexOf('build'));
      expect(tail).toEqual([
        'build', 'build_review', 'wiring_check', 'manual_test', 'prd_audit', 'architecture_review_as_built',
        'retro', 'rebase', 'finish',
      ]);
    });

    it('the two SHIP compliance gates are gating loop members between manual_test and retro', () => {
      const names = ALL_STEPS.map((s) => s.name);
      expect(names.indexOf('manual_test')).toBeLessThan(names.indexOf('prd_audit'));
      expect(names.indexOf('prd_audit')).toBeLessThan(
        names.indexOf('architecture_review_as_built'),
      );
      expect(names.indexOf('architecture_review_as_built')).toBeLessThan(
        names.indexOf('retro'),
      );
      expect(names.indexOf('architecture_review_as_built')).toBeLessThan(
        names.indexOf('finish'),
      );
      for (const n of ['prd_audit', 'architecture_review_as_built'] as StepName[]) {
        const def = ALL_STEPS.find((s) => s.name === n)!;
        expect(def.enforcement).toBe('gating');
        expect(def.loopGate).toBe(true);
      }
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

    it('returns 20 for finish', () => {
      expect(getStepIndex('finish')).toBe(20);
    });
  });

  describe('getStepByIndex', () => {
    it('returns worktree for index 0', () => {
      expect(getStepByIndex(0).name).toBe('worktree');
    });

    it('returns finish for index 20', () => {
      expect(getStepByIndex(20).name).toBe('finish');
    });

    it('throws for out-of-range index', () => {
      expect(() => getStepByIndex(21)).toThrow();
      expect(() => getStepByIndex(-1)).toThrow();
    });
  });

  // --- shouldSkipForTier ---

  describe('shouldSkipForTier', () => {
    const sSkippable: StepName[] = [
      'conflict_check', 'architecture_diagram', 'architecture_review',
      'coherence_check', 'acceptance_specs', 'manual_test', 'retro',
    ];

    it('Small tier skips the right 7 steps', () => {
      for (const step of sSkippable) {
        expect(shouldSkipForTier(step, 'S')).toBe(true);
      }
    });

    it('Small tier does not skip non-skippable steps', () => {
      const nonSkippable: StepName[] = [
        'worktree', 'memory', 'explore', 'complexity', 'prd', 'stories',
        'plan', 'build', 'wiring_check', 'finish',
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

    it('wiring_check is present (never skipped) for S/M/L tiers', () => {
      for (const tier of ['S', 'M', 'L'] as ComplexityTier[]) {
        expect(shouldSkipForTier('wiring_check', tier)).toBe(false);
      }
    });

    // Invariant-locking test (Task: T6): the BUILD/SHIP evidence-gate core
    // must never be skippable for S tier, regardless of future edits to
    // sSkippable above. No production change expected — this pins the set.
    // manual_test is intentionally excluded (ADR D5, #775): S-tier features
    // legitimately skip manual testing.
    it('locks the S-tier evidence-gate core as never-skippable (Task: T6)', () => {
      const evidenceGateCore: StepName[] = [
        'build', 'build_review', 'wiring_check', 'rebase', 'finish',
      ];
      for (const step of evidenceGateCore) {
        expect(shouldSkipForTier(step, 'S')).toBe(false);
      }
    });
  });

  // --- shouldSkipForTrack ---

  describe('shouldSkipForTrack', () => {
    it('skips prd + prd_audit on the technical track', () => {
      expect(shouldSkipForTrack('prd', 'technical')).toBe(true);
      expect(shouldSkipForTrack('prd_audit', 'technical')).toBe(true);
    });
    it('does NOT skip prd / prd_audit on the product track', () => {
      expect(shouldSkipForTrack('prd', 'product')).toBe(false);
      expect(shouldSkipForTrack('prd_audit', 'product')).toBe(false);
    });
    it('missing track defaults to product (nothing track-skipped)', () => {
      expect(shouldSkipForTrack('prd', undefined)).toBe(false);
      expect(shouldSkipForTrack('prd_audit', undefined)).toBe(false);
    });
    it('non-track-gated steps are never track-skipped', () => {
      for (const s of ['stories', 'plan', 'build', 'explore'] as StepName[]) {
        expect(shouldSkipForTrack(s, 'technical')).toBe(false);
      }
    });
  });

  // --- getSkippableSteps ---

  describe('getSkippableSteps', () => {
    it('returns 8 steps for S tier', () => {
      const result = getSkippableSteps('S');
      // Returned in ALL_STEPS order (architecture now precedes conflict_check).
      expect(result).toEqual([
        'architecture_diagram', 'architecture_review', 'conflict_check',
        'coherence_check', 'acceptance_specs', 'manual_test',
        'architecture_review_as_built', 'retro',
      ]);
    });

    it('returns empty for M tier', () => {
      expect(getSkippableSteps('M')).toEqual([]);
    });

    it('returns empty for L tier', () => {
      expect(getSkippableSteps('L')).toEqual([]);
    });

    it('locks the exact S-tier skippable-steps invariant (Task: T4)', () => {
      expect(getSkippableSteps('S')).toEqual([
        'architecture_diagram',
        'architecture_review',
        'conflict_check',
        'coherence_check',
        'acceptance_specs',
        'manual_test',
        'architecture_review_as_built',
        'retro',
      ]);
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
        'worktree', 'memory', 'explore', 'complexity', 'prd', 'stories',
        'conflict_check', 'plan', 'architecture_diagram', 'architecture_review',
        'acceptance_specs', 'wiring_check', 'retro', 'finish',
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

    it('complexity requires explore', () => {
      expect(getPrerequisites('complexity')).toEqual(['explore']);
    });

    it('build requires plan', () => {
      expect(getPrerequisites('build')).toEqual(['plan']);
    });

    it('rebase requires manual_test', () => {
      expect(getPrerequisites('rebase')).toEqual(['manual_test']);
    });

    it('finish requires rebase', () => {
      expect(getPrerequisites('finish')).toEqual(['rebase']);
    });
  });

  // --- buildStepRegistry ---

  describe('buildStepRegistry', () => {
    it('inserts custom step after specified step', () => {
      const config: HarnessConfig = {
        steps: {
          lint: {
            after: 'build',
            skill: 'custom-lint',
            enforcement: 'gating',
          },
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
      expect(lintStep.loopGate).toBe(true); // inherits build's loop membership
    });

    it('custom step joins the loop iff its `after` target is a loop step', () => {
      const registry = buildStepRegistry({
        steps: {
          'in-loop': { after: 'manual_test', skill: 's1' }, // SHIP loop step
          'front-half': { after: 'memory', skill: 's2' }, // not a loop step
        },
      });
      const inLoop = registry.find((s) => s.name === ('in-loop' as StepName));
      const frontHalf = registry.find((s) => s.name === ('front-half' as StepName));
      expect(inLoop?.loopGate).toBe(true);
      expect(frontHalf?.loopGate).toBeFalsy();
    });

    it('explicit gate / kickback_target override inheritance', () => {
      const registry = buildStepRegistry({
        steps: {
          'opt-out': { after: 'build', skill: 's1', gate: false }, // in loop region but opted out
          'opt-in': { after: 'memory', skill: 's2', gate: true }, // front half but forced into loop
          're-openable': { after: 'plan', skill: 's3', kickback_target: true },
        },
      });
      const r = (n: string) => registry.find((s) => s.name === (n as StepName));
      expect(r('opt-out')?.loopGate).toBe(false);
      expect(r('opt-in')?.loopGate).toBe(true);
      expect(r('re-openable')?.kickbackTarget).toBe(true);
    });

    it('preserves config file order for multiple custom steps at same position', () => {
      const config: HarnessConfig = {
        steps: {
          lint: {
            after: 'build',
            skill: 'custom-lint',
            enforcement: 'gating',
          },
          security_scan: {
            after: 'build',
            skill: 'security-scan',
            enforcement: 'advisory',
          },
        },
      };

      const registry = buildStepRegistry(config);

      const names = registry.map((s) => s.name);
      const buildIdx = names.indexOf('build');
      const lintIdx = names.indexOf('lint' as StepName);
      const scanIdx = names.indexOf('security_scan' as StepName);

      // Both come after build, in config file order (Option B: file-order tiebreak)
      expect(lintIdx).toBe(buildIdx + 1);
      expect(scanIdx).toBe(buildIdx + 2);
    });

    it('chains custom steps via after: <sibling-custom>', () => {
      const config: HarnessConfig = {
        steps: {
          lint: {
            after: 'build',
            skill: 'custom-lint',
            enforcement: 'advisory',
          },
          format: {
            after: 'lint',
            skill: 'custom-format',
            enforcement: 'advisory',
          },
        },
      };

      const registry = buildStepRegistry(config);
      const names = registry.map((s) => s.name);
      const buildIdx = names.indexOf('build');
      const lintIdx = names.indexOf('lint' as StepName);
      const formatIdx = names.indexOf('format' as StepName);

      // Chain: build → lint → format, contiguous.
      expect(lintIdx).toBe(buildIdx + 1);
      expect(formatIdx).toBe(lintIdx + 1);
      expect(registry[formatIdx].prerequisites).toEqual(['lint']);
    });
  });
});

describe('shouldSkipForBootstrapMode', () => {
  it("returns true for 'assess' when mode is 'new'", () => {
    expect(shouldSkipForBootstrapMode('assess', 'new')).toBe(true);
  });

  it("returns false for 'assess' when mode is 'fresh'", () => {
    expect(shouldSkipForBootstrapMode('assess', 'fresh')).toBe(false);
  });

  it("returns false for 'assess' when mode is 'partial'", () => {
    expect(shouldSkipForBootstrapMode('assess', 'partial')).toBe(false);
  });

  it("returns false for 'assess' when mode is 're-bootstrap'", () => {
    expect(shouldSkipForBootstrapMode('assess', 're-bootstrap')).toBe(false);
  });

  it('returns false for assess when mode is undefined (missing state field)', () => {
    expect(shouldSkipForBootstrapMode('assess', undefined)).toBe(false);
  });

  it("never skips non-assess steps even when mode is 'new'", () => {
    const nonAssessSteps: StepName[] = [
      'memory',
      'explore',
      'prd',
      'stories',
      'plan',
      'build',
      'finish',
    ];
    for (const step of nonAssessSteps) {
      expect(shouldSkipForBootstrapMode(step, 'new')).toBe(false);
    }
  });
});
