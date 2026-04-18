import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Writable } from 'node:stream';
import { createRenderer } from '../../src/ui/create-renderer.js';
import { createLiveRegion } from '../../src/ui/live-region.js';
import type { ConductorEvent, ConductState } from '../../src/types/index.js';
import { ALL_STEPS } from '../../src/engine/steps.js';

class CaptureStream extends Writable {
  chunks: string[] = [];
  _write(chunk: Buffer | string, _e: string, cb: (err?: Error | null) => void): void {
    this.chunks.push(chunk.toString());
    cb();
  }
  output(): string {
    return this.chunks.join('');
  }
  reset(): void {
    this.chunks = [];
  }
}

describe('createRenderer', () => {
  let readStateMock: (path: string) => Promise<{ ok: true; value: ConductState }>;
  let renderer: (event: ConductorEvent) => Promise<void>;
  let stream: CaptureStream;

  beforeEach(() => {
    const state: ConductState = {
      feature_desc: 'Add login',
      complexity_tier: 'M',
      worktree: 'done',
      memory: 'done',
      brainstorm: 'in_progress',
      // Mark plan 'done' so artifact-status tests exercise the non-pending path.
      plan: 'done',
    };

    readStateMock = vi.fn(async () => ({ ok: true as const, value: state }));
    stream = new CaptureStream();

    renderer = createRenderer({
      stateFilePath: '/tmp/test-state.json',
      featureDesc: 'Add login',
      steps: ALL_STEPS,
      readStateFn: readStateMock,
      liveRegion: createLiveRegion({ stream, forceTTY: false }),
    });
  });

  it('renders dashboard on step_completed', async () => {
    await renderer({ type: 'step_completed', step: 'worktree', status: 'done' });
    const output = stream.output();
    expect(output).toContain('Conductor: Add login');
    expect(output).toContain('✓ Worktree');
  });

  it('renders dashboard on tier_skip', async () => {
    await renderer({ type: 'tier_skip', step: 'conflict_check', tier: 'S' });
    expect(stream.output()).toContain('Conductor: Add login');
  });

  it('renders dashboard on config_skip', async () => {
    await renderer({ type: 'config_skip', step: 'retro' });
    expect(stream.output()).toContain('Conductor: Add login');
  });

  it('renders dashboard on gate_blocked', async () => {
    await renderer({ type: 'gate_blocked', step: 'build', reason: 'missing plan' });
    expect(stream.output()).toContain('Conductor: Add login');
  });

  it('renders dashboard on feature_complete', async () => {
    await renderer({ type: 'feature_complete' });
    const output = stream.output();
    expect(output).toContain('Conductor: Add login');
    expect(output).toContain('Feature complete');
  });

  it('prints a transient step-started line but no full dashboard', async () => {
    await renderer({ type: 'step_started', step: 'brainstorm', index: 2 });
    const output = stream.output();
    expect(output).not.toContain('Conductor: Add login');
    // Renderer now resolves the step's display label (e.g. "Brainstorm")
    // for the transient line, not the raw step name.
    expect(output).toContain('▶ Brainstorm');
  });

  it('renders dashboard_refresh even when no step event has fired', async () => {
    await renderer({ type: 'dashboard_refresh' });
    expect(stream.output()).toContain('Conductor: Add login');
  });

  it('renders step_failed with error output', async () => {
    await renderer({
      type: 'step_failed',
      step: 'build',
      error: 'compile error',
      retryCount: 1,
    });
    const output = stream.output();
    expect(output).toContain('STEP FAILED: build');
    expect(output).toContain('compile error');
  });

  it('reads state from file on each dashboard render', async () => {
    await renderer({ type: 'step_completed', step: 'worktree', status: 'done' });
    expect(readStateMock).toHaveBeenCalledWith('/tmp/test-state.json');
  });

  it('successive dashboard updates in non-TTY mode deduplicate identical frames', async () => {
    await renderer({ type: 'step_completed', step: 'worktree', status: 'done' });
    const firstLength = stream.output().length;
    // Same state → dashboard is identical → no new write.
    await renderer({ type: 'dashboard_refresh' });
    expect(stream.output().length).toBe(firstLength);
  });

  describe('artifact dashboard lines', () => {
    it('omits artifact lines when projectRoot is not provided', async () => {
      await renderer({ type: 'step_completed', step: 'plan', status: 'done' });
      expect(stream.output()).not.toContain('.docs/plans/');
    });

    it('shows ✗ for missing artifacts when projectRoot is set', async () => {
      const { mkdtemp, rm } = await import('fs/promises');
      const { tmpdir } = await import('os');
      const { join } = await import('path');
      const root = await mkdtemp(join(tmpdir(), 'renderer-artifact-'));
      const s = new CaptureStream();
      try {
        const r2 = createRenderer({
          stateFilePath: '/tmp/test-state.json',
          featureDesc: 'Add login',
          steps: ALL_STEPS,
          readStateFn: readStateMock,
          projectRoot: root,
          liveRegion: createLiveRegion({ stream: s, forceTTY: false }),
        });
        await r2({ type: 'step_completed', step: 'plan', status: 'done' });
        expect(s.output()).toContain('.docs/plans/*.md — missing');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('shows ✓ with matched files when artifacts exist on disk', async () => {
      const { mkdtemp, rm, mkdir, writeFile } = await import('fs/promises');
      const { tmpdir } = await import('os');
      const { join } = await import('path');
      const root = await mkdtemp(join(tmpdir(), 'renderer-artifact-'));
      const s = new CaptureStream();
      try {
        await mkdir(join(root, '.docs/plans'), { recursive: true });
        await writeFile(join(root, '.docs/plans/2026-04-16-thing.md'), 'plan');
        const r2 = createRenderer({
          stateFilePath: '/tmp/test-state.json',
          featureDesc: 'Add login',
          steps: ALL_STEPS,
          readStateFn: readStateMock,
          projectRoot: root,
          liveRegion: createLiveRegion({ stream: s, forceTTY: false }),
        });
        await r2({ type: 'step_completed', step: 'plan', status: 'done' });
        expect(s.output()).toContain('✓ .docs/plans/2026-04-16-thing.md');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });
});
