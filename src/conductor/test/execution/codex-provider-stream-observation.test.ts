import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { CodexProvider } from '../../src/execution/codex-provider.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';

const readyDoctor = async () => ({
  stdout: JSON.stringify({
    schemaVersion: 1,
    auth: { selectedMode: 'cached-login', configured: true },
    transport: { authenticated: true },
  }),
  exitCode: 0,
});

describe('CodexProvider provider stream observations', () => {
  it('reports JSONL usage as child-unsupported without an active-child count', async () => {
    const stdout = new PassThrough();
    let resolveProcess: (result: { stdout: string; stderr: string; exitCode: number }) => void;
    let resolveStarted: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const process = Object.assign(new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
      resolveProcess = resolve;
    }), { stdout, kill: vi.fn() });
    const provider = new CodexProvider(readyDoctor, 'codex', undefined, () => {
      resolveStarted!();
      return process as any;
    });
    const observations: unknown[] = [];
    const options: InvokeOptions = {
      prompt: 'Do the thing',
      sessionId: 'thread-123',
      resume: false,
      onProviderStream: (observation) => observations.push(observation),
    };

    const invocation = provider.invoke(options);
    await started;
    const record = JSON.stringify({
      type: 'turn.completed',
      usage: {
        input_tokens: 17,
        cached_input_tokens: 5,
        cache_write_input_tokens: 3,
        output_tokens: 7,
      },
    });
    stdout.write(`${record}\n`);
    resolveProcess!({ stdout: record, stderr: '', exitCode: 0 });
    await invocation;

    expect(observations).toEqual([{
      childObservability: 'unsupported',
      uncachedInputTokens: 12,
      cachedInputTokens: 8,
      outputTokens: 7,
    }]);
  });
});
