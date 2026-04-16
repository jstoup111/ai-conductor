import { describe, it, expect, vi } from 'vitest';
import type { LLMProvider, InvokeOptions, InvokeResult } from '../../src/execution/llm-provider.js';
import type { ConductState } from '../../src/types/index.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';

function createMockProvider(result?: Partial<InvokeResult>): LLMProvider {
  return {
    invoke: vi.fn().mockResolvedValue({
      success: true,
      output: 'done',
      exitCode: 0,
      ...result,
    }),
    invokeInteractive: vi.fn().mockResolvedValue(undefined),
  };
}

const emptyState: ConductState = {};

describe('DefaultStepRunner', () => {
  // Interactive steps use invokeInteractive
  it('invokes interactive session for brainstorm', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('brainstorm', emptyState);

    expect(provider.invokeInteractive).toHaveBeenCalledOnce();
    expect(provider.invoke).not.toHaveBeenCalled();
    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.prompt).toContain('/brainstorm');
  });

  it('invokes interactive session for stories', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('stories', emptyState);

    expect(provider.invokeInteractive).toHaveBeenCalledOnce();
    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.prompt).toContain('/stories');
  });

  it('invokes interactive session for plan', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('plan', emptyState);

    expect(provider.invokeInteractive).toHaveBeenCalledOnce();
    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.prompt).toContain('/plan');
  });

  // Non-interactive steps use invoke with --print
  it('invokes LLM provider with --print for build', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('build', emptyState);

    expect(provider.invoke).toHaveBeenCalledOnce();
    expect(provider.invokeInteractive).not.toHaveBeenCalled();
    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.prompt).toMatch(/\/pipeline|\/tdd/);
  });

  it('returns success for interactive step', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    const result = await runner.run('brainstorm', emptyState);

    expect(result.success).toBe(true);
  });

  it('returns success when non-interactive LLM returns success', async () => {
    const provider = createMockProvider({ success: true, output: 'all good', exitCode: 0 });
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    const result = await runner.run('build', emptyState);

    expect(result.success).toBe(true);
    expect(result.output).toBe('all good');
  });

  it('returns failure when non-interactive LLM returns failure', async () => {
    const provider = createMockProvider({ success: false, output: 'error occurred', exitCode: 1 });
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    const result = await runner.run('build', emptyState);

    expect(result.success).toBe(false);
    expect(result.output).toBe('error occurred');
  });

  it('does not use --dangerouslySkipPermissions for interactive steps', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('brainstorm', emptyState);

    const opts = (provider.invokeInteractive as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.dangerouslySkipPermissions).toBe(false);
  });

  it('uses --dangerouslySkipPermissions for non-interactive steps', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('build', emptyState);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.dangerouslySkipPermissions).toBe(true);
  });
});
