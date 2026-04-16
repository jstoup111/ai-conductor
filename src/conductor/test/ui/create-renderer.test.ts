import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRenderer } from '../../src/ui/create-renderer.js';
import type { ConductorEvent, ConductState } from '../../src/types/index.js';
import { ALL_STEPS } from '../../src/engine/steps.js';

describe('createRenderer', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let readStateMock: (path: string) => Promise<{ ok: true; value: ConductState }>;
  let renderer: (event: ConductorEvent) => Promise<void>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const state: ConductState = {
      feature_desc: 'Add login',
      complexity_tier: 'M',
      worktree: 'done',
      memory: 'done',
      brainstorm: 'in_progress',
    };

    readStateMock = vi.fn(async () => ({ ok: true as const, value: state }));

    renderer = createRenderer({
      stateFilePath: '/tmp/test-state.json',
      featureDesc: 'Add login',
      steps: ALL_STEPS,
      readStateFn: readStateMock,
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('renders dashboard on step_completed', async () => {
    await renderer({ type: 'step_completed', step: 'worktree', status: 'done' });
    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Conductor: Add login');
    expect(output).toContain('✓ Worktree');
  });

  it('renders dashboard on tier_skip', async () => {
    await renderer({ type: 'tier_skip', step: 'conflict_check', tier: 'S' });
    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Conductor: Add login');
  });

  it('renders dashboard on config_skip', async () => {
    await renderer({ type: 'config_skip', step: 'retro' });
    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Conductor: Add login');
  });

  it('renders dashboard on gate_blocked', async () => {
    await renderer({ type: 'gate_blocked', step: 'build', reason: 'missing plan' });
    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Conductor: Add login');
  });

  it('renders dashboard on feature_complete', async () => {
    await renderer({ type: 'feature_complete' });
    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Conductor: Add login');
    expect(output).toContain('Feature complete');
  });

  it('does NOT render dashboard on step_started — only prints step status line', async () => {
    await renderer({ type: 'step_started', step: 'brainstorm', index: 2 });
    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    // Should NOT contain the full dashboard header
    expect(output).not.toContain('Conductor: Add login');
    // Should contain the step line
    expect(output).toContain('▶ brainstorm');
  });

  it('suppresses dashboard_refresh while a step is actively running', async () => {
    // step_started marks a step as active
    await renderer({ type: 'step_started', step: 'brainstorm', index: 2 });
    consoleSpy.mockClear();

    // dashboard_refresh should be suppressed during active step
    await renderer({ type: 'dashboard_refresh' });
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('allows dashboard_refresh after step completes', async () => {
    await renderer({ type: 'step_started', step: 'brainstorm', index: 2 });
    await renderer({ type: 'step_completed', step: 'brainstorm', status: 'done' });
    consoleSpy.mockClear();

    await renderer({ type: 'dashboard_refresh' });
    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Conductor: Add login');
  });

  it('renders dashboard_refresh when no step is active', async () => {
    // No step_started has fired
    await renderer({ type: 'dashboard_refresh' });
    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Conductor: Add login');
  });

  it('renders step_failed with error output', async () => {
    await renderer({ type: 'step_failed', step: 'build', error: 'compile error', retryCount: 1 });
    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('✗ build');
    expect(output).toContain('FAILED');
  });

  it('reads state from file on each dashboard render', async () => {
    await renderer({ type: 'step_completed', step: 'worktree', status: 'done' });
    expect(readStateMock).toHaveBeenCalledWith('/tmp/test-state.json');
  });
});
