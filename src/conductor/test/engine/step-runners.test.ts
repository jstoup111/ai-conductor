import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMProvider, InvokeOptions, InvokeResult } from '../../src/execution/llm-provider.js';
import type { ConductState } from '../../src/types/index.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';

function createMockProvider(): LLMProvider {
  return {
    invoke: vi.fn().mockResolvedValue({
      success: true,
      output: 'done',
      exitCode: 0,
    }),
    invokeInteractive: vi.fn().mockResolvedValue(undefined),
  };
}

const emptyState: ConductState = {};

describe('DefaultStepRunner', () => {
  it('all steps use invokeInteractive (stdio: inherit)', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('brainstorm', emptyState);

    expect(provider.invokeInteractive).toHaveBeenCalledOnce();
    expect(provider.invoke).not.toHaveBeenCalled();
  });

  it('passes correct prompt for brainstorm', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('brainstorm', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.prompt).toContain('/brainstorm');
  });

  it('passes correct prompt for build (pipeline)', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('build', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.prompt).toMatch(/\/pipeline|\/tdd/);
  });

  it('autonomous steps use --dangerouslySkipPermissions', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('build', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.dangerouslySkipPermissions).toBe(true);
  });

  it('collaborative steps do NOT use --dangerouslySkipPermissions', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('brainstorm', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.dangerouslySkipPermissions).toBe(false);
  });

  it('worktree is autonomous', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('worktree', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.dangerouslySkipPermissions).toBe(true);
  });

  it('stories is collaborative', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('stories', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.dangerouslySkipPermissions).toBe(false);
  });

  it('returns success on normal completion', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    const result = await runner.run('brainstorm', emptyState);

    expect(result.success).toBe(true);
  });

  it('returns failure when session throws', async () => {
    const provider = createMockProvider();
    (provider.invokeInteractive as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('crash'));
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    const result = await runner.run('brainstorm', emptyState);

    expect(result.success).toBe(false);
  });

  it('first step does not resume, subsequent steps do', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('worktree', emptyState);
    await runner.run('memory', emptyState);

    const call1 = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    const call2 = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[1][0] as InvokeOptions;
    expect(call1.resume).toBe(false);
    expect(call2.resume).toBe(true);
  });

  // --- Feature 1: Step-scoped system prompts ---

  it('step runner passes system prompt with step context', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
      featureDesc: 'Add user auth',
      totalSteps: 14,
    });

    await runner.run('brainstorm', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).toContain('[Conduct step 3/14]');
    expect(opts.systemPrompt).toContain('Feature: Add user auth');
  });

  it('collaborative step system prompt includes "Complete ONLY this step"', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
      featureDesc: 'Add user auth',
      totalSteps: 14,
    });

    // brainstorm is collaborative (not autonomous)
    await runner.run('brainstorm', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).toContain('Complete ONLY this step');
    expect(opts.systemPrompt).toContain('Brainstorm');
  });

  it('autonomous step system prompt does NOT include "Complete ONLY this step"', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
      featureDesc: 'Add user auth',
      totalSteps: 14,
    });

    // build is autonomous
    await runner.run('build', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.systemPrompt).toContain('[Conduct step 11/14]');
    expect(opts.systemPrompt).not.toContain('Complete ONLY this step');
  });

  // --- Feature 2: Session creation marker ---

  describe('session marker persistence', () => {
    let pipeDir: string;

    beforeEach(async () => {
      pipeDir = await mkdtemp(join(tmpdir(), 'step-runner-'));
    });

    afterEach(async () => {
      await rm(pipeDir, { recursive: true, force: true });
    });

    it('persists session-created marker after first success', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      await runner.run('worktree', emptyState);

      // Marker file should exist
      const markerPath = join(pipeDir, 'session-created');
      await expect(access(markerPath).then(() => true, () => false)).resolves.toBe(true);
    });

    it('reads existing session-created marker on init', async () => {
      // Pre-create the marker file
      await writeFile(join(pipeDir, 'session-created'), '1', 'utf-8');

      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      // First run should use resume=true because marker exists
      await runner.run('brainstorm', emptyState);

      const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
      expect(opts.resume).toBe(true);
    });

    it('persists session ID to conduct-session-id file', async () => {
      const provider = createMockProvider();
      const runner = new DefaultStepRunner(provider, 'my-session-id', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      await runner.run('worktree', emptyState);

      const sessionIdPath = join(pipeDir, 'conduct-session-id');
      const content = await readFile(sessionIdPath, 'utf-8');
      expect(content.trim()).toBe('my-session-id');
    });

    it('does not write marker when step fails', async () => {
      const provider = createMockProvider();
      (provider.invokeInteractive as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('crash'));
      const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project', {
        pipelineDir: pipeDir,
      });

      await runner.run('worktree', emptyState);

      const markerPath = join(pipeDir, 'session-created');
      await expect(access(markerPath).then(() => true, () => false)).resolves.toBe(false);
    });
  });
});
