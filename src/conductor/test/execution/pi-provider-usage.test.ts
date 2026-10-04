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
});
