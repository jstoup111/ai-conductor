import { describe, it, expect } from 'vitest';
import { renderDashboardLines } from '../../src/ui/dashboard-text.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState } from '../../src/types/index.js';

describe('renderDashboardLines', () => {
  it('renders all steps grouped by phase with pending icons when state is empty', () => {
    const state: ConductState = {};
    const lines = renderDashboardLines(state, ALL_STEPS, 'Add login');

    // Header
    expect(lines[0]).toContain('━');
    expect(lines[1]).toContain('Conductor: Add login');
    expect(lines[2]).toContain('━');

    // Should contain all phase headers
    const text = lines.join('\n');
    expect(text).toContain('SETUP');
    expect(text).toContain('UNDERSTAND');
    expect(text).toContain('DECIDE');
    expect(text).toContain('BUILD');
    expect(text).toContain('SHIP');

    // All steps should appear as pending
    expect(text).toContain('⬚ Worktree');
    expect(text).toContain('⬚ Memory');
    expect(text).toContain('⬚ Finish');
  });

  it('shows complexity tier in header when present in state', () => {
    const state: ConductState = { complexity_tier: 'M' };
    const lines = renderDashboardLines(state, ALL_STEPS, 'Add login');
    const header = lines[1];
    expect(header).toContain('Tier: M');
  });

  it('shows done icon for completed steps', () => {
    const state: ConductState = { worktree: 'done', memory: 'done' };
    const lines = renderDashboardLines(state, ALL_STEPS, 'Test feature');
    const text = lines.join('\n');
    expect(text).toContain('✓ Worktree');
    expect(text).toContain('✓ Memory');
  });

  it('shows in_progress icon for active step', () => {
    const state: ConductState = { worktree: 'done', memory: 'in_progress' };
    const lines = renderDashboardLines(state, ALL_STEPS, 'Test feature');
    const text = lines.join('\n');
    expect(text).toContain('▶ Memory');
  });

  it('shows skipped icon for skipped steps', () => {
    const state: ConductState = { conflict_check: 'skipped' };
    const lines = renderDashboardLines(state, ALL_STEPS, 'Test feature');
    const text = lines.join('\n');
    expect(text).toContain('→ Conflict Check');
  });

  it('shows failed icon for failed steps', () => {
    const state: ConductState = { build: 'failed' };
    const lines = renderDashboardLines(state, ALL_STEPS, 'Test feature');
    const text = lines.join('\n');
    expect(text).toContain('✗ Build');
  });

  it('shows stale icon for stale steps', () => {
    const state: ConductState = { plan: 'stale' };
    const lines = renderDashboardLines(state, ALL_STEPS, 'Test feature');
    const text = lines.join('\n');
    expect(text).toContain('⚠ Plan');
  });

  it('omits tier from header when not set', () => {
    const state: ConductState = {};
    const lines = renderDashboardLines(state, ALL_STEPS, 'Test feature');
    const header = lines[1];
    expect(header).not.toContain('Tier');
  });

  it('uses "(resuming)" when no feature name provided', () => {
    const state: ConductState = {};
    const lines = renderDashboardLines(state, ALL_STEPS);
    const header = lines[1];
    expect(header).toContain('(resuming)');
  });

  it('renders running suffix for in_progress step', () => {
    const state: ConductState = { brainstorm: 'in_progress' };
    const lines = renderDashboardLines(state, ALL_STEPS, 'Test');
    const text = lines.join('\n');
    expect(text).toContain('▶ Brainstorm — running...');
  });
});
