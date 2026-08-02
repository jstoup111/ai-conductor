import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Writable } from 'node:stream';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
      explore: 'in_progress',
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
    await renderer({ type: 'step_started', step: 'explore', index: 2 });
    const output = stream.output();
    expect(output).not.toContain('Conductor: Add login');
    // Renderer now resolves the step's display label (e.g. "Explore")
    // for the transient line, not the raw step name.
    expect(output).toContain('▶ Explore');
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

  it('renders a loud provider fallback warning', async () => {
    await renderer({
      type: 'provider_fallback',
      step: 'plan',
      failedProvider: 'codex',
      reason: 'executable not found',
      nextProvider: 'claude',
    });
    expect(stream.output()).toContain(
      '⚠ PROVIDER FALLBACK: plan — codex unavailable (executable not found); trying claude',
    );
  });

  it('renders closed probe-failure recovery progress in CLI mode', async () => {
    await renderer({
      type: 'credentials_park_progress',
      provider: 'codex',
      source: 'cached-login',
      readiness: 'probe-failed',
      elapsedSeconds: 3,
      degradation: 'probe-failure',
      probeFailureKind: 'timeout',
      nextDisposition: 'trial-required',
    });

    expect(stream.output()).toContain(
      'Codex cached-login credentials: probe-failed (probe-failure: timeout); waiting 3s, next disposition: trial-required',
    );
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
          featureDesc: '2026-04-16-thing',
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

    it.each([
      ['feature-a', '.docs/conflicts/feature-a.md', '.docs/conflicts/feature-b.md'],
      ['feature-b', '.docs/conflicts/feature-b.md', '.docs/conflicts/feature-a.md'],
    ])(
      'shows only %s artifacts when neighbouring feature artifacts share the dashboard corpus',
      async (featureDesc, expectedArtifact, foreignArtifact) => {
        const root = await mkdtemp(join(tmpdir(), 'renderer-artifact-scope-'));
        const s = new CaptureStream();
        try {
          await mkdir(join(root, '.docs/conflicts'), { recursive: true });
          await writeFile(join(root, '.docs/conflicts/feature-a.md'), 'feature A');
          await writeFile(join(root, '.docs/conflicts/feature-b.md'), 'feature B');
          const scopedState: ConductState = {
            feature_desc: featureDesc,
            conflict_check: 'done',
          };
          const r2 = createRenderer({
            stateFilePath: join(root, 'conduct-state.json'),
            featureDesc,
            steps: ALL_STEPS,
            readStateFn: async () => ({ ok: true, value: scopedState }),
            projectRoot: root,
            liveRegion: createLiveRegion({ stream: s, forceTTY: false }),
          });

          await r2({ type: 'step_completed', step: 'conflict_check', status: 'done' });

          expect({
            expected: s.output().includes(expectedArtifact),
            foreign: s.output().includes(foreignArtifact),
          }).toEqual({ expected: true, foreign: false });
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      },
    );

    it('renders an ambiguous foreign artifact corpus as unsatisfied', async () => {
      const root = await mkdtemp(join(tmpdir(), 'renderer-artifact-ambiguous-'));
      const s = new CaptureStream();
      try {
        await mkdir(join(root, '.docs/conflicts'), { recursive: true });
        await writeFile(join(root, '.docs/conflicts/feature-a.md'), 'feature A');
        await writeFile(join(root, '.docs/conflicts/feature-c.md'), 'feature C');
        const scopedState: ConductState = {
          feature_desc: 'feature-b',
          conflict_check: 'done',
        };
        const r2 = createRenderer({
          stateFilePath: join(root, 'conduct-state.json'),
          featureDesc: 'feature-b',
          steps: ALL_STEPS,
          readStateFn: async () => ({ ok: true, value: scopedState }),
          projectRoot: root,
          liveRegion: createLiveRegion({ stream: s, forceTTY: false }),
        });

        await r2({ type: 'step_completed', step: 'conflict_check', status: 'done' });

        expect({
          missing: s.output().includes('.docs/conflicts/*.md — missing'),
          featureA: s.output().includes('.docs/conflicts/feature-a.md'),
          featureC: s.output().includes('.docs/conflicts/feature-c.md'),
        }).toEqual({ missing: true, featureA: false, featureC: false });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });
});
