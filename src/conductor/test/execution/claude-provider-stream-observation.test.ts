import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';

describe('ClaudeProvider provider stream observations', () => {
  it('reports the live-probed Agent lifecycle with observed children and running token totals', async () => {
    const stdout = new PassThrough();
    let resolveProcess: (result: { stdout: string; stderr: string; exitCode: number }) => void;
    let resolveStarted: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const process = Object.assign(new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
      resolveProcess = resolve;
    }), { stdout, kill: vi.fn() });
    const provider = new ClaudeProvider(undefined, () => {
      resolveStarted!();
      return process as any;
    });
    const observations: unknown[] = [];
    const options: InvokeOptions = {
      prompt: 'Do the thing',
      sessionId: 'session-123',
      resume: false,
      onProviderStream: (observation) => observations.push(observation),
    };

    const invocation = provider.invoke(options);
    await started;
    const agentToolUse = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'child-1', name: 'Agent' }] },
      usage: {
        input_tokens: 17,
        cache_read_input_tokens: 5,
        cache_creation_input_tokens: 3,
        output_tokens: 7,
      },
    });
    const agentToolResult = JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'child-1' }] },
    });
    stdout.write(agentToolUse.slice(0, 30));
    stdout.write(`${agentToolUse.slice(30)}\n`);
    stdout.write(`${agentToolResult}\n`);
    resolveProcess!({ stdout: `${agentToolUse}\n${agentToolResult}\n`, stderr: '', exitCode: 0 });
    await invocation;

    expect(observations).toHaveLength(2);
    expect(observations[0]).toMatchObject({
      childObservability: 'observed',
      activeChildren: 1,
      uncachedInputTokens: 17,
      cachedInputTokens: 8,
      outputTokens: 7,
    });
    expect(observations[1]).toMatchObject({
      childObservability: 'observed',
      activeChildren: 0,
    });
  });
});
