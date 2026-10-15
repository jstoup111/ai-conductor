// Covers: task:24
import { describe, expect, it, vi } from 'vitest';

import type { InvokeOptions, LLMProvider } from '../../src/execution/llm-provider.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';

describe('DefaultStepRunner.dispatchResidueRoutingJudgement', () => {
  it('uses the remediate configuration and returns the provider result unchanged', async () => {
    const invoke = vi.fn(async (_options: InvokeOptions) => ({ success: true, output: '{"items":[]}' }));
    const subject = new DefaultStepRunner({ name: 'claude', invoke } as unknown as LLMProvider, 'routing-attempt', '/project', {
      config: {
        llm_provider: 'claude',
        steps: { remediate: { model: 'routing-model', effort: 'high' } },
      },
    });

    const expected = subject.resolvedConfigFor('remediate');

    await expect(subject.dispatchResidueRoutingJudgement('route every residue item')).resolves.toEqual({
      success: true,
      output: '{"items":[]}',
    });
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('route every residue item'),
      model: expected.model,
      effort: expected.effort,
    }));
  });
});
