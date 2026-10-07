// Covers: task:11, task:12
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PiProvider, type PiEnvironment } from '../../src/execution/pi-provider.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import { type RateCard } from '../../src/execution/rate-card.js';
import { computeCostRollup } from '../../src/engine/cost-rollup.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { classifyMetering } from '../../src/engine/metering.js';
import { executeProviderCandidates } from '../../src/engine/provider-execution.js';
import { resolveProviderModelPolicy } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet, type ProviderRuntime } from '../../src/engine/provider-runtime.js';
import { ProviderSessionScope } from '../../src/engine/provider-session.js';
import { renderShippedRecordWithCost } from '../../src/engine/shipped-record.js';
import type { ProviderAttemptEvent } from '../../src/types/events.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';

const RATE_CARD: RateCard = {
  as_of: '2026-10-02T00:00:00.000Z',
  source: 'test',
  models: {
    'gpt-5.6-luna': {
      input_cost_per_token: 2e-7,
      output_cost_per_token: 1.2e-6,
      cache_read_input_token_cost: 2e-8,
      cache_creation_input_token_cost: 2.5e-7,
    },
  },
};

const piEnvironment: PiEnvironment = {
  stat: async () => ({ isFile: () => true, isDirectory: () => false }),
  env: {},
  homeDir: () => '/home/test-agent',
  cwd: () => '/workspace',
};

function runtime(key: string, provider: LLMProvider): ProviderRuntime {
  const policy = resolveProviderModelPolicy(key);
  return {
    key,
    provider,
    policy,
    builtIn: true,
    availability: new ModelAvailability(policy.modelFallbackLadder),
  };
}

describe('Pi cost rollup integration', () => {
  let worktreeDir: string;
  let events: ConductorEventEmitter;
  let persister: EventPersister;

  beforeEach(async () => {
    worktreeDir = await mkdtemp(join(tmpdir(), 'pi-cost-rollup-'));
    events = new ConductorEventEmitter();
    persister = new EventPersister(join(worktreeDir, '.pipeline', 'events.jsonl'), events);
    persister.start();
  });

  afterEach(async () => {
    persister.stop();
    await rm(worktreeDir, { recursive: true, force: true });
  });

  async function executePi(stdout: string, options: {
    exitCode?: number;
    model?: string;
    rateCard?: RateCard;
  } = {}): Promise<ProviderAttemptEvent> {
    const pi = new PiProvider(
      'pi',
      async () => ({ stdout, stderr: '', exitCode: options.exitCode ?? 0 }),
      piEnvironment,
      undefined,
      () => options.rateCard ?? RATE_CARD,
    );
    const attempts: ProviderAttemptEvent[] = [];

    await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['pi'],
      preferredProvider: 'pi',
      ...(options.model === undefined ? {} : { modelOverride: options.model }),
      runtimes: new ProviderRuntimeSet([runtime('pi', pi)]),
      sessions: new ProviderSessionScope(() => 'pi-cost-rollup-session'),
      options: {
        prompt: 'Build the feature.',
        cwd: worktreeDir,
      },
      onAttempt: async (step, attempt) => {
        const event: ProviderAttemptEvent = { type: 'provider_attempt', step, ...attempt };
        attempts.push(event);
        await events.emit(event);
      },
    });

    expect(attempts).toHaveLength(1);
    return attempts[0]!;
  }

  async function workedStream(): Promise<string> {
    return readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');
  }

  it('persists an executed Pi attempt into provider and configured-model cost buckets', async () => {
    const piAttempt = await executePi(await workedStream(), { model: 'openai/gpt-5.6-sol' });
    await events.emit({
      type: 'provider_attempt', step: 'build_review', provider: 'claude', model: 'claude-sonnet',
      outcome: 'success', invoked: true,
      tokenUsage: { input: 10, output: 2, costUsd: 0.10, costSource: 'provider' },
    });

    expect(piAttempt.tokenUsage).toMatchObject({ input: 200, output: 65 });
    expect(piAttempt.tokenUsage?.costUsd).toBeCloseTo(0.0035, 12);
    const rollup = await computeCostRollup(worktreeDir);

    expect(rollup.costUsd).toBeCloseTo(0.1035, 12);
    expect(rollup.providers?.pi).toMatchObject({
      tokens: expect.objectContaining({ input: 200, output: 65 }),
    });
    expect(rollup.providers?.pi?.costUsd).toBeCloseTo(0.0035, 12);
    expect(rollup.byDimension).toContainEqual(expect.objectContaining({
      step: 'build', model: 'openai/gpt-5.6-sol', provider: 'pi', source: 'provider',
    }));
    expect(rollup.byDimension?.find((bucket) => bucket.provider === 'pi')?.costUsd).toBeCloseTo(0.0035, 12);
  });

  it('counts an invoked failed Pi attempt\'s billed usage in the feature cost rollup', async () => {
    const piAttempt = await executePi(await workedStream(), { exitCode: 1 });
    const rollup = await computeCostRollup(worktreeDir);

    expect(piAttempt).toMatchObject({ outcome: 'failure', tokenUsage: { input: 200, output: 65 } });
    expect(rollup).toMatchObject({
      dispatches: 1,
      tokens: { input: 200, output: 65, cacheRead: 700, cacheCreation: 50 },
      unmetered: { count: 0 },
    });
    expect(rollup.costUsd).toBeCloseTo(0.0035, 12);
  });

  it('keeps an invoked failed Pi attempt with no completed message visible as unmetered', async () => {
    const killedEarly = (await workedStream()).split('\n').slice(0, 7).join('\n');
    const piAttempt = await executePi(killedEarly, { exitCode: 1 });
    const rollup = await computeCostRollup(worktreeDir);

    expect(piAttempt).not.toHaveProperty('tokenUsage');
    expect(rollup).toMatchObject({
      dispatches: 1,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      costUsd: 0,
      unmetered: { count: 1 },
    });
  });

  it('records card-priced Pi cost under rate-card rather than provider', async () => {
    const zeroCostStream = (await workedStream()).replaceAll('"total":0.0021', '"total":0').replaceAll('"total":0.0014', '"total":0');
    await executePi(zeroCostStream, { model: 'openai/gpt-5.6-sol' });

    const rollup = await computeCostRollup(worktreeDir);

    expect(rollup.byDimension).toContainEqual(expect.objectContaining({
      step: 'build', model: 'openai/gpt-5.6-sol', provider: 'pi', source: 'rate-card',
    }));
    expect(rollup.byDimension).not.toContainEqual(expect.objectContaining({
      step: 'build', model: 'openai/gpt-5.6-sol', provider: 'pi', source: 'provider',
    }));
  });

  it('renders cost-unmetered Pi usage without losing its tokens', async () => {
    const zeroCostStream = (await workedStream())
      .replaceAll('"total":0.0021', '"total":0')
      .replaceAll('"total":0.0014', '"total":0')
      .replaceAll('"provider":"openai"', '"provider":"cline"')
      .replaceAll('"model":"gpt-5.6-luna"', '"model":"google/gemma-4-31b-it:free"');
    await executePi(zeroCostStream);

    const rendered = renderShippedRecordWithCost({
      slug: 'pi-cost', specHash: 'abc', pr: 'https://example.test/pr/1', shipped: '2026-10-03',
    }, await computeCostRollup(worktreeDir));

    expect(rendered).toContain('input: 200\noutput: 65\n');
    expect(rendered).toContain('cost_usd: 0\n');
    expect(rendered).toContain('cost_unmetered: count: 1\n');
    expect(rendered).toContain('  pi: input: 200, output: 65, cache_read: 700, cache_creation: 50, cost_usd: 0, dispatches: 1, cost_unmetered: 1\n');
  });

  it('renders legacy Claude and Codex Cost bytes unchanged', async () => {
    const claudeUsage = { input: 100, output: 10, cacheRead: 5, cacheCreation: 1, costUsd: 0.01, costSource: 'provider' as const };
    const codexUsage = { input: 20, output: 2, cacheRead: 3, cacheCreation: 0, costUsd: 0.02, costSource: 'rate-card' as const };
    await events.emit({ type: 'provider_attempt', step: 'build', provider: 'claude', model: 'claude', outcome: 'success', invoked: true, tokenUsage: claudeUsage });
    await events.emit({ type: 'provider_attempt', step: 'build_review', provider: 'codex', model: 'codex', outcome: 'success', invoked: true, tokenUsage: codexUsage });

    expect(classifyMetering(claudeUsage)).toBe('fully-metered');
    expect(classifyMetering(codexUsage)).toBe('fully-metered');
    const rendered = renderShippedRecordWithCost({
      slug: 'legacy', specHash: 'def', pr: 'https://example.test/pr/2', shipped: '2026-10-03',
    }, await computeCostRollup(worktreeDir));

    expect(rendered.slice(rendered.indexOf('## Cost'))).toBe(
      '## Cost\n' +
      'input: 120\noutput: 12\ncache_read: 8\ncache_creation: 1\ncost_usd: 0.03\n' +
      'dispatches: 2\nretries: 0\nhalts: 0\nunmetered: count: 0, duration_ms: 0\ncost_unmetered: count: 0\n' +
      'providers:\n' +
      '  claude: input: 100, output: 10, cache_read: 5, cache_creation: 1, cost_usd: 0.01, dispatches: 1, cost_unmetered: 0\n' +
      '  codex: input: 20, output: 2, cache_read: 3, cache_creation: 0, cost_usd: 0.02, dispatches: 1, cost_unmetered: 0\n',
    );
  });

});
