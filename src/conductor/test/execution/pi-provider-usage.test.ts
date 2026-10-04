import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { PiProvider, type PiEnvironment, type PiSubprocessFactory } from '../../src/execution/pi-provider.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';

const invokeOptions: InvokeOptions = {
  prompt: 'Implement the requested change.',
  sessionId: 'caller-session',
  resume: false,
  cwd: '/workspace/project',
  model: 'openai/gpt-5.6-luna',
  effort: 'xhigh',
};

const environment: PiEnvironment = {
  stat: vi.fn(async () => ({ isFile: () => true, isDirectory: () => false })),
  env: {},
  homeDir: () => '/home/agent',
  cwd: () => '/workspace/project',
};

describe('PiProvider usage', () => {
  it('sums only terminal assistant message usage without counting partial or repeated events', async () => {
    const stdout = await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout, stderr: '', exitCode: 0, kill: vi.fn() });
    const provider = new PiProvider('/resolved/pi', spawn, environment);

    await expect(provider.invoke(invokeOptions)).resolves.toMatchObject({
      success: true,
      output: 'Second turn.',
      tokenUsage: {
        input: 200,
        output: 65,
        cacheRead: 700,
        cacheCreation: 50,
        numTurns: 2,
      },
    });
  });

  it('includes terminal tool-result usage without counting it as an assistant turn', async () => {
    const workedStream = await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');
    const toolResult = JSON.stringify({
      type: 'message_end',
      message: {
        role: 'toolResult',
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
      },
    });
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({
      stdout: `${workedStream}\n${toolResult}`,
      stderr: '',
      exitCode: 0,
      kill: vi.fn(),
    });
    const provider = new PiProvider('/resolved/pi', spawn, environment);

    await expect(provider.invoke(invokeOptions)).resolves.toMatchObject({
      success: true,
      tokenUsage: { input: 210, output: 70, numTurns: 2 },
    });
  });

  it('records finite Pi reasoning usage separately from output', async () => {
    const stdout = JSON.stringify({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: 'Reasoned response.',
        usage: { input: 20, output: 40, cacheRead: 0, cacheWrite: 0, reasoning: 30 },
        stopReason: 'stop',
      },
    });
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout, stderr: '', exitCode: 0, kill: vi.fn() });
    const provider = new PiProvider('/resolved/pi', spawn, environment);

    await expect(provider.invoke(invokeOptions)).resolves.toMatchObject({
      success: true,
      tokenUsage: { input: 20, output: 40, reasoningOutput: 30, numTurns: 1 },
    });
  });
});
