import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Writable } from 'node:stream';
import { TerminalRenderer } from '../../src/ui/terminal-renderer.js';
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

describe('TerminalRenderer', () => {
  let readStateMock: (path: string) => Promise<{ ok: true; value: ConductState }>;
  let renderer: TerminalRenderer;
  let stream: CaptureStream;

  beforeEach(() => {
    const state: ConductState = {
      feature_desc: 'Add login',
      complexity_tier: 'M',
      worktree: 'done',
      memory: 'done',
      explore: 'in_progress',
      plan: 'done',
    };

    readStateMock = vi.fn(async () => ({ ok: true as const, value: state }));
    stream = new CaptureStream();

    renderer = new TerminalRenderer({
      stateFilePath: '/tmp/test-state.json',
      featureDesc: 'Add login',
      steps: ALL_STEPS,
      readStateFn: readStateMock,
      liveRegion: createLiveRegion({ stream, forceTTY: false }),
    });
  });

  it('renders dashboard on step_completed', async () => {
    await renderer.handle({ type: 'step_completed', step: 'worktree', status: 'done' });
    const output = stream.output();
    expect(output).toContain('Conductor: Add login');
    expect(output).toContain('✓ Worktree');
  });

  it('renders dashboard on tier_skip', async () => {
    await renderer.handle({ type: 'tier_skip', step: 'conflict_check', tier: 'S' });
    expect(stream.output()).toContain('Conductor: Add login');
  });

  it('renders dashboard on config_skip', async () => {
    await renderer.handle({ type: 'config_skip', step: 'retro' });
    expect(stream.output()).toContain('Conductor: Add login');
  });

  it('renders dashboard on gate_blocked', async () => {
    await renderer.handle({ type: 'gate_blocked', step: 'build', reason: 'missing plan' });
    expect(stream.output()).toContain('Conductor: Add login');
  });

  it('renders dashboard on feature_complete', async () => {
    await renderer.handle({ type: 'feature_complete' });
    const output = stream.output();
    expect(output).toContain('Conductor: Add login');
    expect(output).toContain('FEATURE COMPLETE');
  });

  it('feature_complete banner includes feature description and PR url when provided', async () => {
    await renderer.handle({
      type: 'feature_complete',
      featureDesc: 'Add login',
      prUrl: 'https://github.com/foo/bar/pull/42',
    });
    const output = stream.output();
    expect(output).toContain('FEATURE COMPLETE: Add login');
    expect(output).toContain('PR: https://github.com/foo/bar/pull/42');
  });

  it('prints a transient step-started line but no full dashboard', async () => {
    await renderer.handle({ type: 'step_started', step: 'explore', index: 2 });
    const output = stream.output();
    expect(output).not.toContain('Conductor: Add login');
    expect(output).toContain('▶ Explore');
  });

  it('renders dashboard_refresh even when no step event has fired', async () => {
    await renderer.handle({ type: 'dashboard_refresh' });
    expect(stream.output()).toContain('Conductor: Add login');
  });

  it('renders step_failed with error output', async () => {
    await renderer.handle({
      type: 'step_failed',
      step: 'build',
      error: 'compile error',
      retryCount: 1,
    });
    const output = stream.output();
    expect(output).toContain('STEP FAILED: build');
    expect(output).toContain('compile error');
  });

  it('renders provider fallback as a loud warning with complete diagnostics', async () => {
    await renderer.handle({
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

  it('renders typed credential-park progress without a lifecycle restart', async () => {
    await renderer.handle({
      type: 'credentials_park_progress',
      provider: 'codex',
      source: 'cached-login',
      readiness: 'unusable',
      elapsedSeconds: 3,
      nextProbeDelaySeconds: 4,
      degradation: 'credential-failure',
    });

    expect(stream.output()).toContain(
      'Codex cached-login credentials: unusable (credential-failure); waiting 3s, next check in 4s',
    );
  });

  it('renders closed probe-failure recovery progress without a lifecycle restart', async () => {
    await renderer.handle({
      type: 'credentials_park_progress',
      provider: 'codex',
      source: 'cached-login',
      readiness: 'probe-failed',
      elapsedSeconds: 3,
      degradation: 'probe-failure',
      failureKind: 'timeout',
      nextDisposition: 'trial-required',
    });

    expect(stream.output()).toContain(
      'Codex cached-login credentials: probe-failed (probe-failure: timeout); waiting 3s, next disposition: trial-required',
    );
  });

  it('renders only closed credential-park progress fields', async () => {
    const rawFragment = 'sk-live-super-secret-token /private/codex/credentials.json';
    await renderer.handle({
      type: 'credentials_park_progress', provider: 'codex', source: 'cached-login',
      readiness: 'unusable', elapsedSeconds: 60, nextProbeDelaySeconds: 30,
      degradation: 'credential-failure',
    });

    expect(stream.output()).not.toContain(rawFragment);
  });

  it('reads state from file on each dashboard render', async () => {
    await renderer.handle({ type: 'step_completed', step: 'worktree', status: 'done' });
    expect(readStateMock).toHaveBeenCalledWith('/tmp/test-state.json');
  });

  it('successive dashboard updates in non-TTY mode deduplicate identical frames', async () => {
    await renderer.handle({ type: 'step_completed', step: 'worktree', status: 'done' });
    const firstLength = stream.output().length;
    await renderer.handle({ type: 'dashboard_refresh' });
    expect(stream.output().length).toBe(firstLength);
  });

  // T10 — spinner stop: stop() clears live region
  it('stop() clears the live region without throwing', () => {
    expect(() => renderer.stop()).not.toThrow();
  });

  // T10 — renderer_error events are handled gracefully
  it('logs renderer_error events as warnings', async () => {
    await renderer.handle({ type: 'renderer_error', rendererName: 'bad-renderer', error: 'boom' });
    expect(stream.output()).toContain('Renderer error [bad-renderer]: boom');
  });

  it('implements UIRenderer interface (handle + stop)', () => {
    expect(typeof renderer.handle).toBe('function');
    expect(typeof renderer.stop).toBe('function');
  });

  describe('artifact dashboard lines', () => {
    it('omits artifact lines when projectRoot is not provided', async () => {
      await renderer.handle({ type: 'step_completed', step: 'plan', status: 'done' });
      expect(stream.output()).not.toContain('.docs/plans/');
    });

    it('shows ✗ for missing artifacts when projectRoot is set', async () => {
      const { mkdtemp, rm } = await import('fs/promises');
      const { tmpdir } = await import('os');
      const { join } = await import('path');
      const root = await mkdtemp(join(tmpdir(), 'renderer-artifact-'));
      const s = new CaptureStream();
      try {
        const r2 = new TerminalRenderer({
          stateFilePath: '/tmp/test-state.json',
          featureDesc: 'Add login',
          steps: ALL_STEPS,
          readStateFn: readStateMock,
          projectRoot: root,
          liveRegion: createLiveRegion({ stream: s, forceTTY: false }),
        });
        await r2.handle({ type: 'step_completed', step: 'plan', status: 'done' });
        expect(s.output()).toContain('.docs/plans/*.md — missing');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('shows only the active feature plan when neighbouring plans make the glob ambiguous', async () => {
      const { mkdtemp, mkdir, rm, writeFile } = await import('fs/promises');
      const { tmpdir } = await import('os');
      const { join } = await import('path');
      const root = await mkdtemp(join(tmpdir(), 'renderer-artifact-scope-'));
      const s = new CaptureStream();
      try {
        await mkdir(join(root, '.docs/plans'), { recursive: true });
        await writeFile(join(root, '.docs/plans/feature-a.md'), '# Plan A\n');
        await writeFile(join(root, '.docs/plans/feature-b.md'), '# Plan B\n');
        const r2 = new TerminalRenderer({
          stateFilePath: '/tmp/test-state.json',
          featureDesc: 'feature-b',
          steps: ALL_STEPS,
          readStateFn: readStateMock,
          projectRoot: root,
          liveRegion: createLiveRegion({ stream: s, forceTTY: false }),
        });

        await r2.handle({ type: 'step_completed', step: 'plan', status: 'done' });

        const planArtifactLines = s.output().split('\n')
          .map((line) => line.trim())
          .filter((line) => line.includes('.docs/plans/'));
        expect(planArtifactLines).toEqual(['✓ .docs/plans/feature-b.md']);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });
});
