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
    invokeInteractive: vi.fn(),
  };
}

const emptyState: ConductState = {};

describe('DefaultStepRunner', () => {
  it('invokes LLM provider with correct skill prompt for brainstorm', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('brainstorm', emptyState);

    expect(provider.invoke).toHaveBeenCalledOnce();
    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.prompt).toContain('/brainstorm');
  });

  it('invokes LLM provider with correct skill prompt for stories', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('stories', emptyState);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.prompt).toContain('/stories');
  });

  it('invokes LLM provider with correct skill prompt for plan', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('plan', emptyState);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.prompt).toContain('/plan');
  });

  it('invokes LLM provider with correct skill prompt for build', async () => {
    const provider = createMockProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    await runner.run('build', emptyState);

    const opts = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0] as InvokeOptions;
    expect(opts.prompt).toMatch(/\/pipeline|\/tdd/);
  });

  it('returns success when LLM returns success', async () => {
    const provider = createMockProvider({ success: true, output: 'all good', exitCode: 0 });
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    const result = await runner.run('brainstorm', emptyState);

    expect(result.success).toBe(true);
    expect(result.output).toBe('all good');
  });

  it('returns failure when LLM returns failure', async () => {
    const provider = createMockProvider({ success: false, output: 'error occurred', exitCode: 1 });
    const runner = new DefaultStepRunner(provider, 'session-1', '/tmp/project');

    const result = await runner.run('brainstorm', emptyState);

    expect(result.success).toBe(false);
    expect(result.output).toBe('error occurred');
  });
});
