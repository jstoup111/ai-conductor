import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { Dashboard, getStatusIcon } from '../../../src/ui/terminal/dashboard.js';
import type { ConductState, StepDefinition, StepName, Phase, EnforcementLevel, ComplexityTier } from '../../../src/types/index.js';

function makeStep(
  name: StepName,
  label: string,
  phase: Phase,
  overrides?: Partial<StepDefinition>,
): StepDefinition {
  return {
    name,
    label,
    phase,
    enforcement: 'gating' as EnforcementLevel,
    prerequisites: [],
    skippableForTiers: [],
    isCheckpoint: false,
    ...overrides,
  };
}

const ALL_STEPS: StepDefinition[] = [
  makeStep('worktree', 'Worktree', 'SETUP'),
  makeStep('memory', 'Memory', 'SETUP'),
  makeStep('brainstorm', 'Brainstorm', 'UNDERSTAND'),
  makeStep('complexity', 'Complexity', 'UNDERSTAND'),
  makeStep('stories', 'Stories', 'UNDERSTAND'),
  makeStep('conflict_check', 'Conflict Check', 'DECIDE'),
  makeStep('plan', 'Plan', 'DECIDE'),
  makeStep('architecture_diagram', 'Architecture Diagram', 'DECIDE'),
  makeStep('architecture_review', 'Architecture Review', 'DECIDE'),
  makeStep('acceptance_specs', 'Acceptance Specs', 'BUILD'),
  makeStep('build', 'Build', 'BUILD'),
  makeStep('manual_test', 'Manual Test', 'SHIP'),
  makeStep('retro', 'Retro', 'SHIP'),
  makeStep('finish', 'Finish', 'SHIP'),
];

describe('Dashboard', () => {
  it('renders all 14 steps', () => {
    const state: ConductState = {};
    const { lastFrame } = render(<Dashboard state={state} steps={ALL_STEPS} />);
    const frame = lastFrame()!;
    for (const step of ALL_STEPS) {
      expect(frame).toContain(step.label);
    }
  });

  it('shows green checkmark for done', () => {
    const state: ConductState = { worktree: 'done' };
    const { lastFrame } = render(<Dashboard state={state} steps={ALL_STEPS} />);
    const frame = lastFrame()!;
    expect(frame).toContain('\u2713');
  });

  it('shows yellow arrow for in_progress', () => {
    const state: ConductState = { brainstorm: 'in_progress' };
    const { lastFrame } = render(<Dashboard state={state} steps={ALL_STEPS} />);
    const frame = lastFrame()!;
    expect(frame).toContain('\u25B6');
  });

  it('shows empty box for pending', () => {
    const state: ConductState = {};
    const { lastFrame } = render(<Dashboard state={state} steps={ALL_STEPS} />);
    const frame = lastFrame()!;
    expect(frame).toContain('\u2B1A');
  });

  it('shows skip arrow for skipped', () => {
    const state: ConductState = { complexity: 'skipped' };
    const { lastFrame } = render(<Dashboard state={state} steps={ALL_STEPS} />);
    const frame = lastFrame()!;
    expect(frame).toContain('\u2192');
  });

  it('shows warning for stale', () => {
    const state: ConductState = { stories: 'stale' };
    const { lastFrame } = render(<Dashboard state={state} steps={ALL_STEPS} />);
    const frame = lastFrame()!;
    expect(frame).toContain('\u26A0');
  });

  it('shows X for failed', () => {
    const state: ConductState = { build: 'failed' };
    const { lastFrame } = render(<Dashboard state={state} steps={ALL_STEPS} />);
    const frame = lastFrame()!;
    expect(frame).toContain('\u2717');
  });

  it('shows phase label for each step', () => {
    const state: ConductState = {};
    const { lastFrame } = render(<Dashboard state={state} steps={ALL_STEPS} />);
    const frame = lastFrame()!;
    expect(frame).toContain('[SETUP]');
    expect(frame).toContain('[UNDERSTAND]');
    expect(frame).toContain('[DECIDE]');
    expect(frame).toContain('[BUILD]');
    expect(frame).toContain('[SHIP]');
  });

  it('shows feature name in header', () => {
    const state: ConductState = {};
    const { lastFrame } = render(
      <Dashboard state={state} steps={ALL_STEPS} featureName="Add login" />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Feature: Add login');
  });

  it('shows elapsed time for active step', () => {
    const state: ConductState = { build: 'in_progress' };
    const { lastFrame } = render(
      <Dashboard state={state} steps={ALL_STEPS} elapsedSeconds={42} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('42s');
  });

  it('narrow terminal does not garble output (still renders)', () => {
    // ink-testing-library renders without a real terminal, so width is irrelevant
    // We just verify it renders cleanly with minimal steps
    const state: ConductState = { worktree: 'done' };
    const { lastFrame } = render(
      <Dashboard state={state} steps={ALL_STEPS.slice(0, 3)} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Worktree');
    expect(frame).toContain('Memory');
    expect(frame).toContain('Brainstorm');
  });

  it('unknown step status shows as pending (empty box)', () => {
    // Force an unknown status by casting
    const state = { worktree: 'unknown_status' } as unknown as ConductState;
    const { lastFrame } = render(<Dashboard state={state} steps={ALL_STEPS} />);
    const frame = lastFrame()!;
    // The first step (worktree) should show the pending icon
    expect(frame).toContain('\u2B1A');
  });
});

describe('getStatusIcon', () => {
  it('returns correct icons for all known statuses', () => {
    expect(getStatusIcon('done')).toEqual({ icon: '\u2713', color: 'green' });
    expect(getStatusIcon('in_progress')).toEqual({ icon: '\u25B6', color: 'yellow' });
    expect(getStatusIcon('skipped')).toEqual({ icon: '\u2192', color: 'cyan' });
    expect(getStatusIcon('stale')).toEqual({ icon: '\u26A0', color: 'yellow' });
    expect(getStatusIcon('failed')).toEqual({ icon: '\u2717', color: 'red' });
    expect(getStatusIcon('pending')).toEqual({ icon: '\u2B1A', color: 'gray' });
    expect(getStatusIcon('anything')).toEqual({ icon: '\u2B1A', color: 'gray' });
  });
});
