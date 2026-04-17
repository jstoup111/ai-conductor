import { describe, it, expect } from 'vitest';
import { buildDashboardSnapshot } from '../../src/ui/dashboard-snapshot.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState } from '../../src/types/index.js';

describe('buildDashboardSnapshot', () => {
  it('returns a step per definition with pending status when state is empty', () => {
    const snap = buildDashboardSnapshot({}, ALL_STEPS, 'Add login');
    expect(snap.featureName).toBe('Add login');
    expect(snap.complexityTier).toBeUndefined();
    expect(snap.steps).toHaveLength(ALL_STEPS.length);
    expect(snap.steps.every((s) => s.status === 'pending')).toBe(true);
    expect(snap.steps.every((s) => s.artifacts === undefined)).toBe(true);
  });

  it('propagates complexity_tier from state', () => {
    const state: ConductState = { complexity_tier: 'M' };
    const snap = buildDashboardSnapshot(state, ALL_STEPS, 'Add login');
    expect(snap.complexityTier).toBe('M');
  });

  it('copies per-step status from state', () => {
    const state: ConductState = {
      worktree: 'done',
      memory: 'in_progress',
      build: 'failed',
    };
    const snap = buildDashboardSnapshot(state, ALL_STEPS, 'Test');
    const byName = Object.fromEntries(snap.steps.map((s) => [s.name, s.status]));
    expect(byName.worktree).toBe('done');
    expect(byName.memory).toBe('in_progress');
    expect(byName.build).toBe('failed');
  });

  it('preserves label and phase from step definition', () => {
    const snap = buildDashboardSnapshot({}, ALL_STEPS);
    for (const step of snap.steps) {
      const def = ALL_STEPS.find((s) => s.name === step.name)!;
      expect(step.label).toBe(def.label);
      expect(step.phase).toBe(def.phase);
    }
  });

  it('attaches artifacts only to steps that have attempted to run', () => {
    const state: ConductState = { plan: 'done', stories: 'pending' };
    const snap = buildDashboardSnapshot(state, ALL_STEPS, 'Test', {
      plan: [{ pattern: '.docs/plans/*.md', files: ['.docs/plans/x.md'], satisfied: true }],
      stories: [{ pattern: '.docs/stories/*.md', files: [], satisfied: false }],
    });
    const plan = snap.steps.find((s) => s.name === 'plan')!;
    const stories = snap.steps.find((s) => s.name === 'stories')!;
    expect(plan.artifacts).toHaveLength(1);
    expect(stories.artifacts).toBeUndefined();
  });

  it('defaults featureName to undefined when omitted', () => {
    const snap = buildDashboardSnapshot({}, ALL_STEPS);
    expect(snap.featureName).toBeUndefined();
  });
});
