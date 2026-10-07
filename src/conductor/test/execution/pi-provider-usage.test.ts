// Covers: task:1, task:2, task:3, task:4, task:5, task:6, task:8
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PiProvider, type PiEnvironment, type PiSubprocessFactory } from '../../src/execution/pi-provider.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';
import { clearRateCardCache, loadRateCard, type RateCard } from '../../src/execution/rate-card.js';
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

const RATE_CARD: RateCard = {
  as_of: '2026-09-12T11:36:56.747Z',
  source: 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
  models: {
    'gpt-5.6-luna': {
      input_cost_per_token: 2e-7,
      output_cost_per_token: 1.2e-6,
      cache_read_input_token_cost: 2e-8,
      cache_creation_input_token_cost: 2.5e-7,
    },
    'gpt-5.6-sol': {
      input_cost_per_token: 4e-6,
      output_cost_per_token: 2e-5,
      cache_read_input_token_cost: 4e-7,
      cache_creation_input_token_cost: 5e-6,
    },
    'gpt-5.6-terra': {
      input_cost_per_token: 2e-6,
      output_cost_per_token: 1.2e-5,
      cache_read_input_token_cost: 2e-7,
      cache_creation_input_token_cost: 2.5e-6,
    },
  },
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

function replaceTerminalCost(stdout: string, current: string, replacement: string): string {
  return stdout.split('\n').map((line) => (
    line.includes('"type":"message_end"')
      ? line.replaceAll(`"total":${current}`, `"total":${replacement}`)
      : line
  )).join('\n');
}

function rewriteAssistantMessages(
  stdout: string,
  rewrite: (message: Record<string, unknown>, turn: number) => void,
): string {
  let turn = 0;
  return stdout.split('\n').map((line) => {
    if (!line.trim()) return line;
    const event = JSON.parse(line) as { type?: unknown; message?: Record<string, unknown> };
    if (event.type === 'message_end' && event.message?.role === 'assistant') {
      rewrite(event.message, turn);
      turn += 1;
    }
    return JSON.stringify(event);
  }).join('\n');
}

async function providerAttemptFor(
  stdout: string,
  exitCode = 0,
  loadRates: () => RateCard | undefined = () => undefined,
): Promise<{
  readonly result: Awaited<ReturnType<DefaultStepRunner['run']>>;
  readonly event: ProviderAttemptEvent;
}> {
  const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout, stderr: '', exitCode });
  const pi = new PiProvider('/resolved/pi', spawn, environment, undefined, loadRates);
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
  it('leaves cost absent for a zero-cost unlisted model while retaining its attribution', async () => {
    const workedStream = await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');
    const stdout = rewriteAssistantMessages(workedStream, (message) => {
      message.provider = 'cline';
      message.model = 'google/gemma-4-31b-it:free';
      (message.usage as { cost?: { total?: unknown } }).cost = { total: 0 };
    });
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout, stderr: '', exitCode: 0 });
    const provider = new PiProvider('/resolved/pi', spawn, environment, undefined, () => RATE_CARD);

    const result = await provider.invoke(invokeOptions);

    expect(result.tokenUsage).toMatchObject({
      input: 200,
      output: 65,
      attributedModel: 'cline/google/gemma-4-31b-it:free',
    });
    expect(result.tokenUsage).not.toHaveProperty('costUsd');
    expect(result.tokenUsage).not.toHaveProperty('costSource');
    expect(classifyMetering(result.tokenUsage)).toBe('cost-unmetered');
  });

  it('rate-card-prices a Pi model whose bare model id contains a slash', async () => {
    const workedStream = await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');
    const stdout = rewriteAssistantMessages(workedStream, (message) => {
      message.provider = 'cline';
      message.model = 'google/gemma-4-31b-it:free';
      (message.usage as { cost?: { total?: unknown } }).cost = { total: 0 };
    });
    const rateCard: RateCard = {
      ...RATE_CARD,
      models: {
        'google/gemma-4-31b-it:free': {
          input_cost_per_token: 1e-6,
          output_cost_per_token: 2e-6,
        },
      },
    };
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout, stderr: '', exitCode: 0 });
    const provider = new PiProvider('/resolved/pi', spawn, environment, undefined, () => rateCard);

    const result = await provider.invoke(invokeOptions);

    expect(result.tokenUsage).toMatchObject({ costSource: 'rate-card' });
    expect(result.tokenUsage?.costUsd).toBeCloseTo(0.00108, 12);
  });

  it('leaves cost absent when an unlisted assistant turn has no Pi cost', async () => {
    const workedStream = await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');
    const stdout = rewriteAssistantMessages(workedStream, (message, turn) => {
      if (turn === 1) {
        delete (message.usage as { cost?: unknown }).cost;
        message.model = 'unlisted-model';
      }
    });
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout, stderr: '', exitCode: 0 });
    const provider = new PiProvider('/resolved/pi', spawn, environment, undefined, () => RATE_CARD);

    const result = await provider.invoke(invokeOptions);

    expect(result.tokenUsage).not.toHaveProperty('costUsd');
    expect(result.tokenUsage).not.toHaveProperty('costSource');
  });

  it('never rate-card-prices a token-bearing tool result', async () => {
    const workedStream = await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');
    const toolResult = JSON.stringify({
      type: 'message_end',
      message: {
        role: 'toolResult',
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
      },
    });
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({
      stdout: `${workedStream}\n${toolResult}`,
      stderr: '',
      exitCode: 0,
    });
    const provider = new PiProvider('/resolved/pi', spawn, environment, undefined, () => RATE_CARD);

    const result = await provider.invoke(invokeOptions);

    expect(result.tokenUsage).not.toHaveProperty('costUsd');
    expect(result.tokenUsage).not.toHaveProperty('costSource');
    expect(classifyMetering(result.tokenUsage)).toBe('cost-unmetered');
  });

  it('emits attributed but cost-unmetered usage for an unlisted Pi model', async () => {
    const workedStream = await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');
    const stdout = rewriteAssistantMessages(workedStream, (message) => {
      message.provider = 'cline';
      message.model = 'google/gemma-4-31b-it:free';
      (message.usage as { cost?: { total?: unknown } }).cost = { total: 0 };
    });

    const { result, event } = await providerAttemptFor(stdout, 0, () => RATE_CARD);

    expect(result).toMatchObject({ success: true });
    expect(event.tokenUsage).toMatchObject({
      input: 200,
      output: 65,
      attributedModel: 'cline/google/gemma-4-31b-it:free',
    });
    expect(event.tokenUsage).not.toHaveProperty('costUsd');
    expect(event.tokenUsage).not.toHaveProperty('costSource');
  });

  it('uses Pi-reported cost when every token-bearing message is priced', async () => {
    const stdout = await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout, stderr: '', exitCode: 0 });
    const provider = new PiProvider('/resolved/pi', spawn, environment);

    const result = await provider.invoke(invokeOptions);

    expect(result.tokenUsage).toMatchObject({ costSource: 'provider' });
    expect(result.tokenUsage?.costUsd).toBeCloseTo(0.0035, 12);
    expect(classifyMetering(result.tokenUsage)).toBe('fully-metered');
  });

  it('attributes worked-stream usage to its last valid assistant model', async () => {
    const stdout = await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout, stderr: '', exitCode: 0 });
    const provider = new PiProvider('/resolved/pi', spawn, environment);

    const result = await provider.invoke(invokeOptions);

    expect(result.tokenUsage?.attributedModel).toBe('openai/gpt-5.6-luna');
  });

  it('attributes a trailing zero-token assistant turn without pricing it', async () => {
    const workedStream = await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');
    const zeroTokenTurn = JSON.stringify({
      type: 'message_end',
      message: {
        role: 'assistant',
        provider: 'openai',
        model: 'gpt-5.6-terra',
        content: 'No additional tokens.',
        usage: { input: 0, output: 0 },
        stopReason: 'stop',
      },
    });
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({
      stdout: `${workedStream}\n${zeroTokenTurn}`,
      stderr: '',
      exitCode: 0,
    });
    const provider = new PiProvider('/resolved/pi', spawn, environment);

    const result = await provider.invoke(invokeOptions);

    expect(result.tokenUsage).toMatchObject({
      attributedModel: 'openai/gpt-5.6-terra',
      costSource: 'provider',
    });
    expect(result.tokenUsage?.costUsd).toBeCloseTo(0.0035, 12);
  });

  it('prices zero-cost usage by the model Pi ran rather than the requested model', async () => {
    const workedStream = await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');
    const stdout = rewriteAssistantMessages(workedStream, (message) => {
      (message.usage as { cost?: { total?: unknown } }).cost = { total: 0 };
    });
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout, stderr: '', exitCode: 0 });
    const provider = new PiProvider('/resolved/pi', spawn, environment, undefined, () => RATE_CARD);

    const result = await provider.invoke({ ...invokeOptions, model: 'openai/gpt-5.6-sol' });

    expect(result.tokenUsage).toMatchObject({
      attributedModel: 'openai/gpt-5.6-luna',
      costSource: 'rate-card',
    });
    expect(result.tokenUsage?.costUsd).toBeCloseTo(0.0001445, 12);
  });

  it('records the complete usage of a settled worked stream whose process exited non-zero', async () => {
    const stdout = await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout, stderr: '', exitCode: 1 });
    const provider = new PiProvider('/resolved/pi', spawn, environment);

    const result = await provider.invoke(invokeOptions);

    expect(result).toMatchObject({ success: false });
    expect(result.tokenUsage).toMatchObject({
      input: 200, output: 65, cacheRead: 700, cacheCreation: 50, numTurns: 2,
      attributedModel: 'openai/gpt-5.6-luna', costSource: 'provider',
    });
    expect(result.tokenUsage?.costUsd).toBeCloseTo(0.0035, 12);
    expect(classifyMetering(result.tokenUsage)).toBe('fully-metered');
  });

  it('records completed-message tokens, unpriced, when the run is killed mid-message', async () => {
    const worked = (await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8')).split('\n');
    // Through the second assistant message's start and partial update; no message_end, no agent_end.
    const stdout = worked.slice(0, 12).join('\n');
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout, stderr: '', exitCode: null, signal: 'SIGKILL' });
    const provider = new PiProvider('/resolved/pi', spawn, environment);

    const result = await provider.invoke(invokeOptions);

    expect(result).toMatchObject({ success: false });
    // Only the completed first message counts; the in-flight message's partial usage never does.
    expect(result.tokenUsage).toMatchObject({ input: 120, output: 40, cacheRead: 300, cacheCreation: 50 });
    // The in-flight message's spend is unseen, so the price is withheld: cost-unmetered, not a partial $.
    expect(result.tokenUsage).not.toHaveProperty('costUsd');
    expect(classifyMetering(result.tokenUsage)).toBe('cost-unmetered');
  });

  it('records no usage, so the cost stays unknown, when killed before any message completed', async () => {
    const worked = (await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8')).split('\n');
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout: worked.slice(0, 7).join('\n'), stderr: '', exitCode: 1 });
    const provider = new PiProvider('/resolved/pi', spawn, environment);

    const result = await provider.invoke(invokeOptions);

    expect(result).toMatchObject({ success: false });
    expect(result).not.toHaveProperty('tokenUsage');
    expect(classifyMetering(result.tokenUsage)).toBe('unmetered');
  });

  it('records the completed-message tokens of an aborted run, unpriced', async () => {
    const worked = (await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8')).split('\n');
    const controller = new AbortController();
    const spawn = vi.fn<PiSubprocessFactory>().mockImplementation(async () => {
      controller.abort();
      return { stdout: worked.slice(0, 10).join('\n'), stderr: '', exitCode: null, signal: 'SIGTERM' };
    });
    const provider = new PiProvider('/resolved/pi', spawn, environment);

    const result = await provider.invoke({ ...invokeOptions, abortSignal: controller.signal });

    expect(result).toMatchObject({ success: false, output: 'Pi invocation aborted.' });
    expect(result.tokenUsage).toMatchObject({ input: 120, output: 40 });
    expect(classifyMetering(result.tokenUsage)).toBe('cost-unmetered');
  });

  it('attributes and prices zero-cost usage with each message response model', async () => {
    const workedStream = await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');
    const stdout = rewriteAssistantMessages(workedStream, (message) => {
      message.responseModel = 'gpt-5.6-terra';
      (message.usage as { cost?: { total?: unknown } }).cost = { total: 0 };
    });
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout, stderr: '', exitCode: 0 });
    const provider = new PiProvider('/resolved/pi', spawn, environment, undefined, () => RATE_CARD);

    const result = await provider.invoke(invokeOptions);

    expect(result.tokenUsage).toMatchObject({ attributedModel: 'openai/gpt-5.6-terra', costSource: 'rate-card' });
    expect(result.tokenUsage?.costUsd).toBeCloseTo(0.001445, 12);
  });

  it('attributes mixed-model usage to the last assistant model while pricing each turn by its own model', async () => {
    const workedStream = await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');
    const stdout = rewriteAssistantMessages(workedStream, (message, turn) => {
      if (turn === 1) message.responseModel = 'gpt-5.6-terra';
      (message.usage as { cost?: { total?: unknown } }).cost = { total: 0 };
    });
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout, stderr: '', exitCode: 0 });
    const provider = new PiProvider('/resolved/pi', spawn, environment, undefined, () => RATE_CARD);

    const result = await provider.invoke(invokeOptions);

    expect(result.tokenUsage).toMatchObject({ attributedModel: 'openai/gpt-5.6-terra', costSource: 'rate-card' });
    expect(result.tokenUsage?.costUsd).toBeCloseTo(0.0006305, 12);
  });

  it.each([
    ['a missing provider', (message: Record<string, unknown>) => { delete message.provider; }],
    ['a missing model', (message: Record<string, unknown>) => { delete message.model; }],
    ['a numeric provider', (message: Record<string, unknown>) => { message.provider = 42; }],
    ['a numeric model', (message: Record<string, unknown>) => { message.model = 42; }],
  ])('does not attribute or price a second turn with %s', async (_name, invalidate) => {
    const workedStream = await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');
    const stdout = rewriteAssistantMessages(workedStream, (message, turn) => {
      (message.usage as { cost?: { total?: unknown } }).cost = { total: 0 };
      if (turn === 1) invalidate(message);
    });
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout, stderr: '', exitCode: 0 });
    const provider = new PiProvider('/resolved/pi', spawn, environment, undefined, () => RATE_CARD);

    const result = await provider.invoke(invokeOptions);

    expect(result.tokenUsage).not.toHaveProperty('costUsd');
    expect(classifyMetering(result.tokenUsage)).toBe('cost-unmetered');
    expect(result.tokenUsage?.attributedModel).toBe('openai/gpt-5.6-luna');
  });

  it.each([
    ['a negative cost', -1],
    ['a non-numeric cost', 'NaN'],
  ])('leaves cost absent when a token-bearing message has %s', async (_name, invalidCost) => {
    const workedStream = await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');
    const stdout = replaceTerminalCost(workedStream, '0.0021', JSON.stringify(invalidCost));
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout, stderr: '', exitCode: 0 });
    const provider = new PiProvider('/resolved/pi', spawn, environment, undefined, () => undefined);

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

  it.each([
    ['every Pi cost is zero', (stdout: string) => replaceTerminalCost(replaceTerminalCost(stdout, '0.0021', '0'), '0.0014', '0')],
    ['only turn two Pi cost is zero', (stdout: string) => replaceTerminalCost(stdout, '0.0014', '0')],
  ])('falls back to the message model rate card when %s', async (_name, rewrite) => {
    const workedStream = await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout: rewrite(workedStream), stderr: '', exitCode: 0 });
    const provider = new PiProvider('/resolved/pi', spawn, environment, undefined, () => RATE_CARD);

    const result = await provider.invoke(invokeOptions);

    // 120*2e-7 + 300*2e-8 + 50*2.5e-7 + 40*1.2e-6
    // + 80*2e-7 + 400*2e-8 + 25*1.2e-6
    expect(result.tokenUsage?.costUsd).toBeCloseTo(0.0001445, 12);
    expect(result.tokenUsage?.costSource).toBe('rate-card');
    expect(classifyMetering(result.tokenUsage)).toBe('fully-metered');
  });

  it.each([
    ['negative', '-1'],
    ['infinite', '1e400'],
    ['non-numeric', '"NaN"'],
  ])('falls back to the rate card when turn one Pi cost is %s', async (_name, replacement) => {
    const workedStream = await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');
    const stdout = replaceTerminalCost(
      replaceTerminalCost(workedStream, '0.0021', replacement),
      '0.0014',
      '0',
    );
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout, stderr: '', exitCode: 0 });
    const provider = new PiProvider('/resolved/pi', spawn, environment, undefined, () => RATE_CARD);

    const result = await provider.invoke(invokeOptions);

    expect(result.tokenUsage?.costUsd).toBeCloseTo(0.0001445, 12);
    expect(result.tokenUsage?.costSource).toBe('rate-card');
  });

  it.each([
    ['no project card', undefined],
    ['an unparseable project card', '{not json'],
  ])('stays cost-unmetered with %s', async (_name, cardContents) => {
    const project = await mkdtemp(join(tmpdir(), 'pi-rate-card-project-'));
    const home = await mkdtemp(join(tmpdir(), 'pi-rate-card-home-'));
    const previousHome = process.env.HOME;
    try {
      if (cardContents !== undefined) {
        await mkdir(join(project, '.ai-conductor'), { recursive: true });
        await writeFile(join(project, '.ai-conductor', 'rate-card.json'), cardContents, 'utf8');
      }
      process.env.HOME = home;
      clearRateCardCache();
      const workedStream = await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');
      const stdout = replaceTerminalCost(replaceTerminalCost(workedStream, '0.0021', '0'), '0.0014', '0');
      const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout, stderr: '', exitCode: 0 });
      const provider = new PiProvider('/resolved/pi', spawn, environment, undefined, loadRateCard);

      const result = await provider.invoke({ ...invokeOptions, cwd: project });

      expect(result).toMatchObject({ success: true });
      expect(result.tokenUsage?.input).toBe(200);
      expect(result.tokenUsage).not.toHaveProperty('costUsd');
      expect(classifyMetering(result.tokenUsage)).toBe('cost-unmetered');
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      clearRateCardCache();
      await rm(project, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
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

  it('ignores non-assistant, non-tool-result message usage', async () => {
    const workedStream = await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');
    const ignoredMessages = ['user', 'system', undefined].map((role) => JSON.stringify({
      type: 'message_end',
      message: {
        ...(role === undefined ? {} : { role }),
        usage: { input: 100, output: 100, cacheRead: 100, cacheWrite: 100, cost: { total: 1 } },
      },
    }));
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({
      stdout: `${workedStream}\n${ignoredMessages.join('\n')}`,
      stderr: '',
      exitCode: 0,
    });
    const provider = new PiProvider('/resolved/pi', spawn, environment);

    const result = await provider.invoke(invokeOptions);

    expect(result.tokenUsage).toMatchObject({ input: 200, output: 65, costSource: 'provider' });
    expect(result.tokenUsage?.costUsd).toBeCloseTo(0.0035, 12);
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

  it('returns no token usage for zero input and output with omitted cache fields', async () => {
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({
      stdout: terminalAssistantMessage({ input: 0, output: 0 }),
      stderr: '',
      exitCode: 0,
    });
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

  it('records the spend of a non-zero exit after a usage-bearing stream in the failed conductor provider attempt', async () => {
    const stdout = await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');

    const { result, event } = await providerAttemptFor(stdout, 1);

    expect(result).toMatchObject({ success: false });
    expect(event).toMatchObject({ outcome: 'failure', tokenUsage: { input: 200, output: 65, costSource: 'provider' } });
    expect(event.tokenUsage?.costUsd).toBeCloseTo(0.0035, 12);
  });

  it('records the turns billed before a terminal error stop (a credit failure after real work)', async () => {
    const worked = (await readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8')).split('\n');
    const errorStop = (await readFile(new URL('../fixtures/pi/error-stop-live-capture.jsonl', import.meta.url), 'utf8'))
      .split('\n')
      .filter((line) => line.includes('"role":"assistant"') && (line.includes('"message_start"') || line.includes('"message_end"')));
    // First worked turn, then a turn whose request the provider refused, then the agent loop ends.
    const stdout = [...worked.slice(0, 10), ...errorStop, '{"type":"agent_end","messages":[]}'].join('\n');

    const { result, event } = await providerAttemptFor(stdout, 0);

    expect(result).toMatchObject({ success: false, output: 'Free tier request failed.' });
    expect(event).toMatchObject({ outcome: 'failure', tokenUsage: { input: 120, output: 40, numTurns: 2, costSource: 'provider' } });
    expect(event.tokenUsage?.costUsd).toBeCloseTo(0.0021, 12);
    expect(classifyMetering(event.tokenUsage)).toBe('fully-metered');
  });

  it('leaves an error stop that billed nothing unmetered rather than recording a $0 cost', async () => {
    const stdout = await readFile(new URL('../fixtures/pi/error-stop-live-capture.jsonl', import.meta.url), 'utf8');

    const { result, event } = await providerAttemptFor(stdout, 0);

    expect(result).toMatchObject({ success: false, output: 'Free tier request failed.' });
    expect(event).toMatchObject({ outcome: 'failure', invoked: true });
    expect(event).not.toHaveProperty('tokenUsage');
    expect(classifyMetering(event.tokenUsage)).toBe('unmetered');
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

describe('PiProvider pi-subagents usage', () => {
  const subagentStream = () => readFile(new URL('../fixtures/pi/subagent-stream.jsonl', import.meta.url), 'utf8');

  type ToolResultRecord = { toolName?: unknown; details: Record<string, unknown>; usage?: unknown };

  /** Rewrite every subagent tool-result record: the tool_execution_end result and the toolResult message. */
  function rewriteSubagentResults(stdout: string, rewrite: (result: ToolResultRecord) => void): string {
    return stdout.split('\n').map((line) => {
      if (!line.trim()) return line;
      const event = JSON.parse(line) as {
        type?: unknown;
        result?: ToolResultRecord;
        message?: ToolResultRecord & { role?: unknown };
      };
      if (event.type === 'tool_execution_end' && event.result) rewrite(event.result);
      if ((event.type === 'message_start' || event.type === 'message_end') && event.message?.role === 'toolResult') {
        rewrite(event.message);
      }
      return JSON.stringify(event);
    }).join('\n');
  }

  function toolResultLine(toolName: string, details: Record<string, unknown>, usage?: unknown): string {
    return JSON.stringify({
      type: 'message_end',
      message: {
        role: 'toolResult',
        toolCallId: `call-${toolName}`,
        toolName,
        content: [],
        details,
        ...(usage === undefined ? {} : { usage }),
        isError: false,
      },
    });
  }

  const asyncLaunch = toolResultLine('subagent', {
    mode: 'single',
    runId: 'run-bg-1',
    results: [],
    asyncId: 'run-bg-1',
    asyncDir: '/tmp/async/run-bg-1',
  });

  /** Insert lines before the final assistant turn of the subagent fixture. */
  function beforeFinalTurn(stdout: string, ...extra: string[]): string {
    const lines = stdout.split('\n');
    lines.splice(lines.lastIndexOf('{"type":"turn_start"}'), 0, ...extra);
    return lines.join('\n');
  }

  async function invoke(stdout: string) {
    const spawn = vi.fn<PiSubprocessFactory>().mockResolvedValue({ stdout, stderr: '', exitCode: 0 });
    return new PiProvider('/resolved/pi', spawn, environment).invoke(invokeOptions);
  }

  it('adds the nested subagent rollup once on top of the direct child usage already on the tool result', async () => {
    const result = await invoke(await subagentStream());

    expect(result.tokenUsage).toMatchObject({
      input: 100 + 5000 + 1000 + 200,
      output: 20 + 800 + 200 + 30,
      cacheRead: 20000,
      numTurns: 2,
      costSource: 'provider',
    });
    expect(result.tokenUsage?.costUsd).toBeCloseTo(0.001 + 0.4 + 0.1 + 0.002, 12);
    expect(classifyMetering(result.tokenUsage)).toBe('fully-metered');
  });

  it('takes the whole subagent rollup when the tool result carries no usage of its own', async () => {
    const stdout = rewriteSubagentResults(await subagentStream(), (result) => { delete result.usage; });

    const result = await invoke(stdout);

    expect(result.tokenUsage).toMatchObject({ input: 6300, output: 1050, costSource: 'provider' });
    expect(result.tokenUsage?.costUsd).toBeCloseTo(0.503, 12);
  });

  it('counts unpriced nested subagent tokens without claiming a provider cost', async () => {
    const stdout = rewriteSubagentResults(await subagentStream(), (result) => {
      result.details.totalCost = { inputTokens: 6000, outputTokens: 1000, costUsd: 0.4 };
    });

    const result = await invoke(stdout);

    expect(result.tokenUsage).toMatchObject({ input: 6300, output: 1050 });
    expect(result.tokenUsage).not.toHaveProperty('costUsd');
    expect(result.tokenUsage).not.toHaveProperty('costSource');
  });

  it('never claims a complete cost while a background subagent run has not reported its usage', async () => {
    const result = await invoke(beforeFinalTurn(await subagentStream(), asyncLaunch));

    expect(result.tokenUsage).toMatchObject({ input: 6300, output: 1050 });
    expect(result.tokenUsage).not.toHaveProperty('costUsd');
    expect(result.tokenUsage).not.toHaveProperty('costSource');
    expect(classifyMetering(result.tokenUsage)).not.toBe('fully-metered');
  });

  it('keeps provider cost once a wait result delivers the background run usage', async () => {
    const stdout = beforeFinalTurn(
      await subagentStream(),
      asyncLaunch,
      toolResultLine(
        'bg_wait',
        {
          mode: 'management',
          results: [],
          completions: [{
            runId: 'run-bg-1',
            results: [{ agent: 'delegate', usage: { input: 300, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0.03, turns: 2 } }],
          }],
        },
        { input: 300, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 350, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.03 } },
      ),
    );

    const result = await invoke(stdout);

    expect(result.tokenUsage).toMatchObject({ input: 6600, output: 1100, costSource: 'provider' });
    expect(result.tokenUsage?.costUsd).toBeCloseTo(0.533, 12);
  });

  it('ignores a cost rollup on a tool result from any tool other than subagent', async () => {
    const stdout = rewriteSubagentResults(await subagentStream(), (result) => { result.toolName = 'bash'; });

    const result = await invoke(stdout);

    expect(result.tokenUsage).toMatchObject({ input: 5300, output: 850, costSource: 'provider' });
    expect(result.tokenUsage?.costUsd).toBeCloseTo(0.403, 12);
  });
});
