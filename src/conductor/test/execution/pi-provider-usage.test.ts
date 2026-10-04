// Covers: task:1, task:2, task:3, task:4
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { PiProvider, type PiEnvironment, type PiSubprocessFactory } from '../../src/execution/pi-provider.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { resolveProviderModelPolicy } from '../../src/engine/provider-model-policy.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { ProviderAttemptEvent } from '../../src/types/index.js';
import { classifyMetering } from '../../src/engine/metering.js';

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

function terminalAssistantMessage(usage?: unknown): string {
  return JSON.stringify({
    type: 'message_end',
    message: {
      role: 'assistant',
      content: 'Completed.',
      ...(usage === undefined ? {} : { usage }),
      stopReason: 'stop',
    },
  });
}

async function providerAttemptFor(stdout: string, exitCode = 0): Promise<{
  readonly result: Awaited<ReturnType<DefaultStepRunner['run']>>;
  readonly event: ProviderAttemptEvent;
}> {
  const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout, stderr: '', exitCode });
  const pi = new PiProvider('/resolved/pi', spawn, environment);
  const emitted: ProviderAttemptEvent[] = [];
  const config: HarnessConfig = {
    llm_provider: 'pi',
    steps: { explore: { llm_provider: 'pi' } },
  };
  const policy = resolveProviderModelPolicy('pi', { config });
  const runner = new DefaultStepRunner(pi, 'pi-no-usage', '/workspace/project', {
    mode: 'auto',
    config,
    configuredProviders: ['pi'],
    providerRuntimes: new ProviderRuntimeSet([{
      key: 'pi',
      provider: pi,
      lifecycleCapability: pi.lifecycleCapability,
      nativeSchemaCapability: pi.nativeSchemaCapability,
      policy,
      builtIn: true,
      availability: new ModelAvailability(policy.modelFallbackLadder),
    }]),
    sessionStore: new ProviderSessionStore(),
    providerAttempt: (step, attempt) => { emitted.push({ type: 'provider_attempt', step, ...attempt }); },
  });

  const result = await runner.run('explore', {});
  const event = emitted.find((candidate) => candidate.provider === 'pi');
  expect(event).toBeDefined();
  return { result, event: event! };
}

describe('PiProvider usage', () => {
  it('uses Pi-reported cost when every token-bearing message is priced', async () => {
    const stdout = await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout, stderr: '', exitCode: 0 });
    const provider = new PiProvider('/resolved/pi', spawn, environment);

    const result = await provider.invoke(invokeOptions);

    expect(result.tokenUsage).toMatchObject({ costSource: 'provider' });
    expect(result.tokenUsage?.costUsd).toBeCloseTo(0.0035, 12);
    expect(classifyMetering(result.tokenUsage)).toBe('fully-metered');
  });

  it.each([
    ['a negative cost', -1],
    ['a non-numeric cost', 'NaN'],
  ])('leaves cost absent when a token-bearing message has %s', async (_name, invalidCost) => {
    const workedStream = await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');
    const stdout = workedStream.replaceAll('"total":0.0021', `"total":${JSON.stringify(invalidCost)}`);
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout, stderr: '', exitCode: 0 });
    const provider = new PiProvider('/resolved/pi', spawn, environment);

    const result = await provider.invoke(invokeOptions);

    expect(result.tokenUsage).not.toHaveProperty('costUsd');
    expect(result.tokenUsage).not.toHaveProperty('costSource');
  });

  it('skips a zero-token message when summing Pi-reported cost', async () => {
    const workedStream = await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');
    const zeroTokenTurn = terminalAssistantMessage({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: { total: 0 },
    });
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({
      stdout: `${workedStream}\n${zeroTokenTurn}`,
      stderr: '',
      exitCode: 0,
    });
    const provider = new PiProvider('/resolved/pi', spawn, environment);

    const result = await provider.invoke(invokeOptions);

    expect(result.tokenUsage).toMatchObject({ costSource: 'provider' });
    expect(result.tokenUsage?.costUsd).toBeCloseTo(0.0035, 12);
  });

  it('sums only terminal assistant message usage without counting partial or repeated events', async () => {
    const stdout = await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout, stderr: '', exitCode: 0 });
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
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout, stderr: '', exitCode: 0 });
    const provider = new PiProvider('/resolved/pi', spawn, environment);

    await expect(provider.invoke(invokeOptions)).resolves.toMatchObject({
      success: true,
      tokenUsage: { input: 20, output: 40, reasoningOutput: 30, numTurns: 1 },
    });
  });

  it.each([
    {
      name: 'terminal assistant message without message usage',
      stdout: terminalAssistantMessage(),
    },
    {
      name: 'message usage with a string input',
      stdout: terminalAssistantMessage({ input: '20', output: 4, cacheRead: 0, cacheWrite: 0 }),
    },
    {
      name: 'message usage with a missing input',
      stdout: terminalAssistantMessage({ output: 4, cacheRead: 0, cacheWrite: 0 }),
    },
    {
      name: 'top-level usage rather than message usage',
      stdout: JSON.stringify({
        type: 'message_end',
        usage: { input: 20, output: 4, cacheRead: 0, cacheWrite: 0 },
        message: { role: 'assistant', content: 'Completed.', stopReason: 'stop' },
      }),
    },
    {
      name: 'an all-zero message usage',
      stdout: terminalAssistantMessage({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
    },
  ])('returns no token usage for $name', async ({ stdout }) => {
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout, stderr: '', exitCode: 0 });
    const provider = new PiProvider('/resolved/pi', spawn, environment);

    const result = await provider.invoke(invokeOptions);

    expect(result).toMatchObject({ success: true });
    expect(result).not.toHaveProperty('tokenUsage');
  });

  it.each([
    ['terminal assistant message without message usage', terminalAssistantMessage()],
    ['message usage with a string input', terminalAssistantMessage({ input: '20', output: 4, cacheRead: 0, cacheWrite: 0 })],
    ['message usage with a missing input', terminalAssistantMessage({ output: 4, cacheRead: 0, cacheWrite: 0 })],
    ['top-level usage rather than message usage', JSON.stringify({
      type: 'message_end',
      usage: { input: 20, output: 4, cacheRead: 0, cacheWrite: 0 },
      message: { role: 'assistant', content: 'Completed.', stopReason: 'stop' },
    })],
    ['all-zero message usage', terminalAssistantMessage({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })],
  ])('emits no token usage in the conductor provider attempt for $0', async (_name, stdout) => {
    const { result, event } = await providerAttemptFor(stdout);

    expect(result).toMatchObject({ success: true });
    expect(event).not.toHaveProperty('tokenUsage');
  });

  it.each([
    {
      name: 'a non-zero exit after a usage-bearing stream',
      stdout: () => readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8'),
      exitCode: 1,
      output: undefined,
    },
    {
      name: 'an error stop with an otherwise successful process exit',
      stdout: () => readFile(new URL('../fixtures/pi/error-stop-live-capture.jsonl', import.meta.url), 'utf8'),
      exitCode: 0,
      output: 'Free tier request failed.',
    },
  ])('fails $name without recording token usage in the conductor provider attempt', async ({ stdout, exitCode, output }) => {
    const { result, event } = await providerAttemptFor(await stdout(), exitCode);

    expect(result).toMatchObject({ success: false, ...(output === undefined ? {} : { output }) });
    expect(event).not.toHaveProperty('tokenUsage');
  });

  it('skips malformed JSONL records while retaining usage from terminal assistant messages', async () => {
    const workedStream = await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');
    const lines = workedStream.split('\n');
    lines.splice(10, 0, '{ malformed JSONL');
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout: lines.join('\n'), stderr: '', exitCode: 0 });
    const provider = new PiProvider('/resolved/pi', spawn, environment);

    await expect(provider.invoke(invokeOptions)).resolves.toMatchObject({
      success: true,
      tokenUsage: { input: 200, output: 65 },
    });
  });
});
