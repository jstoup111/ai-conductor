import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  RATE_CARD_RELATIVE_PATH,
  applyRateCard,
  clearRateCardCache,
  loadRateCard,
  parseModelRate,
  parseRateCard,
  priceUsage,
  type ModelRate,
  type RateCard,
} from '../../src/execution/rate-card.js';
import { classifyMetering } from '../../src/engine/metering.js';
import type { TokenUsage } from '../../src/execution/llm-provider.js';

// Published LiteLLM rates for the models this harness routes codex dispatches
// to, per token.
const TERRA: ModelRate = {
  input_cost_per_token: 2e-6,
  output_cost_per_token: 1.2e-5,
  cache_read_input_token_cost: 2e-7,
  cache_creation_input_token_cost: 2.5e-6,
};
const SOL: ModelRate = {
  input_cost_per_token: 4e-6,
  output_cost_per_token: 2e-5,
  cache_read_input_token_cost: 4e-7,
};

const card = (models: Record<string, ModelRate>): RateCard => ({
  as_of: '2026-08-24T00:00:00.000Z',
  source: 'https://example.invalid/rates.json',
  models,
});

describe('priceUsage', () => {
  // Cache WRITES cost more than ordinary input — upstream publishes 1.25x
  // across the codex family (terra 2.5e-6 vs input 2e-6). Pricing them at the
  // input rate understated every cache-creating dispatch by 20%. It stayed
  // invisible because codex reported `cacheCreation: 0` on all 17 observed
  // dispatches, so the term was inert rather than correct.
  it('prices cache creation at its own published rate, not the input rate', () => {
    const usage: TokenUsage = { input: 0, output: 0, cacheCreation: 1_000_000 };
    expect(priceUsage(usage, TERRA)).toBeCloseTo(2.5, 12);
    expect(priceUsage(usage, TERRA)).not.toBeCloseTo(2.0, 12);
  });

  it('falls back to the input rate only when a model publishes no cache-write tier', () => {
    const noCacheWrite: ModelRate = {
      input_cost_per_token: 2e-6,
      output_cost_per_token: 1.2e-5,
      cache_read_input_token_cost: 2e-7,
    };
    const usage: TokenUsage = { input: 0, output: 0, cacheCreation: 1_000_000 };
    expect(priceUsage(usage, noCacheWrite)).toBeCloseTo(2.0, 12);
  });

  it('prices fresh input, cache reads, cache creation, and output', () => {
    const usage: TokenUsage = {
      input: 1000,
      output: 100,
      cacheRead: 10_000,
      cacheCreation: 500,
    };
    // 1000*2e-6 + 10000*2e-7 + 500*2.5e-6 + 100*1.2e-5
    // The cache-creation term uses the published cache-WRITE rate (2.5e-6),
    // not the input rate.
    expect(priceUsage(usage, TERRA)).toBeCloseTo(0.002 + 0.002 + 0.00125 + 0.0012, 12);
  });

  it('does NOT price reasoningOutput separately — it is already inside output', () => {
    const withReasoning: TokenUsage = { input: 0, output: 1000, reasoningOutput: 900 };
    const without: TokenUsage = { input: 0, output: 1000 };
    expect(priceUsage(withReasoning, TERRA)).toBe(priceUsage(without, TERRA));
    expect(priceUsage(withReasoning, TERRA)).toBeCloseTo(0.012, 12);
  });

  it('falls back to the input rate when a model publishes no cache-read tier', () => {
    const noCacheTier: ModelRate = { input_cost_per_token: 2e-6, output_cost_per_token: 1.2e-5 };
    expect(priceUsage({ input: 0, output: 0, cacheRead: 1_000_000 }, noCacheTier)).toBeCloseTo(2, 12);
  });

  it('reproduces the measured cost of a real mixed-provider feature build', () => {
    // Aggregated from the 17 codex dispatches of the feature
    // `a-halt-leaves-no-committed-pushed-record-for-the-o`: 16 on terra, 1 on
    // sol. Before this change those dispatches reported $0.00, so the feature
    // line paired all-provider token volume with Claude-only dollars ($5.63)
    // and understated the true ~$24.60 spend by 4.4x.
    const terraUsage: TokenUsage = { input: 2_236_559, output: 143_012, cacheRead: 55_698_496 };
    const solUsage: TokenUsage = { input: 15_850, output: 5_241, cacheRead: 2_341_312 };
    const total = priceUsage(terraUsage, TERRA) + priceUsage(solUsage, SOL);
    expect(total).toBeGreaterThan(18);
    expect(total).toBeLessThan(20);
  });
});

describe('applyRateCard', () => {
  it('attaches a rate-card cost and marks its provenance', () => {
    const priced = applyRateCard({ input: 1000, output: 100 }, 'gpt-5.6-terra', card({ 'gpt-5.6-terra': TERRA }));
    expect(priced?.costUsd).toBeCloseTo(0.002 + 0.0012, 12);
    expect(priced?.costSource).toBe('rate-card');
    expect(classifyMetering(priced)).toBe('fully-metered');
  });

  it('leaves a provider-reported cost untouched', () => {
    const provided: TokenUsage = { input: 1000, output: 100, costUsd: 9.99, costSource: 'provider' };
    const result = applyRateCard(provided, 'gpt-5.6-terra', card({ 'gpt-5.6-terra': TERRA }));
    expect(result).toBe(provided);
    expect(result?.costUsd).toBe(9.99);
    expect(result?.costSource).toBe('provider');
  });

  it.each([
    ['no card', undefined, 'gpt-5.6-terra'],
    ['no model', card({ 'gpt-5.6-terra': TERRA }), undefined],
    ['unknown model', card({ 'gpt-5.6-terra': TERRA }), 'gpt-9-unheard-of'],
    ['empty card', card({}), 'gpt-5.6-terra'],
  ] as const)('fails closed with %s — never invents a cost', (_label, rateCard, model) => {
    const usage: TokenUsage = { input: 1000, output: 100 };
    const result = applyRateCard(usage, model, rateCard);
    expect(result?.costUsd).toBeUndefined();
    expect(result?.costSource).toBeUndefined();
    expect(classifyMetering(result)).toBe('cost-unmetered');
  });

  it('never resolves a model through Object.prototype', () => {
    const result = applyRateCard({ input: 1, output: 1 }, 'toString', card({ 'gpt-5.6-terra': TERRA }));
    expect(result?.costUsd).toBeUndefined();
  });

  it('keeps "no usage at all" distinct from "usage with no rate"', () => {
    // Two different gaps that must never collapse into one another, and
    // neither of which may produce a number. A dispatch that reported NO
    // token usage (today: every dispatch on the streaming path, which
    // discards telemetry wholesale) stays `unmetered`. A dispatch that
    // reported tokens the card cannot price stays `cost-unmetered` — its
    // tokens are real and counted, only its dollars are unknown.
    const rateCard = card({ 'gpt-5.6-terra': TERRA });

    const noUsage = applyRateCard(undefined, 'gpt-5.6-terra', rateCard);
    expect(noUsage).toBeUndefined();
    expect(classifyMetering(noUsage)).toBe('unmetered');

    const unpriceable = applyRateCard({ input: 1000, output: 100 }, 'gpt-9-unheard-of', rateCard);
    expect(unpriceable).toMatchObject({ input: 1000, output: 100 });
    expect(unpriceable?.costUsd).toBeUndefined();
    expect(classifyMetering(unpriceable)).toBe('cost-unmetered');
  });
});

describe('parseModelRate', () => {
  it('keeps only the four fields the formula reads', () => {
    expect(
      parseModelRate({
        input_cost_per_token: 2e-6,
        output_cost_per_token: 1.2e-5,
        cache_read_input_token_cost: 2e-7,
        cache_creation_input_token_cost: 2.5e-6,
        litellm_provider: 'openai',
        max_tokens: 128000,
      }),
    ).toEqual(TERRA);
  });

  it.each([
    ['missing input cost', { output_cost_per_token: 1 }],
    ['missing output cost', { input_cost_per_token: 1 }],
    ['non-numeric cost', { input_cost_per_token: '2e-6', output_cost_per_token: 1 }],
    ['negative cost', { input_cost_per_token: -1, output_cost_per_token: 1 }],
    ['not an object', 'nope'],
    ['null', null],
  ] as const)('rejects %s', (_label, value) => {
    expect(parseModelRate(value)).toBeUndefined();
  });

  it('drops an unusable cache-read tier rather than the whole rate', () => {
    const rate = parseModelRate({
      input_cost_per_token: 2e-6,
      output_cost_per_token: 1.2e-5,
      cache_read_input_token_cost: 'free',
    });
    expect(rate).toEqual({ input_cost_per_token: 2e-6, output_cost_per_token: 1.2e-5 });
  });
});

describe('parseRateCard', () => {
  it('reads a well-formed card', () => {
    const parsed = parseRateCard(
      JSON.stringify({ as_of: '2026-08-24T00:00:00.000Z', source: 'u', models: { 'gpt-5.6-terra': TERRA } }),
    );
    expect(parsed?.as_of).toBe('2026-08-24T00:00:00.000Z');
    expect(parsed?.models['gpt-5.6-terra']).toEqual(TERRA);
  });

  it.each([
    ['unparseable JSON', '{ not json'],
    ['a JSON array', '[]'],
    ['a card with no as_of', JSON.stringify({ models: {} })],
    ['a card with no models map', JSON.stringify({ as_of: 'x' })],
  ] as const)('rejects %s', (_label, raw) => {
    expect(parseRateCard(raw)).toBeUndefined();
  });

  it('drops individual unusable entries without failing the card', () => {
    const parsed = parseRateCard(
      JSON.stringify({
        as_of: 'x',
        models: { 'gpt-5.6-terra': TERRA, broken: { input_cost_per_token: 1 } },
      }),
    );
    expect(Object.keys(parsed!.models)).toEqual(['gpt-5.6-terra']);
  });
});

describe('loadRateCard', () => {
  let dir: string;

  beforeEach(async () => {
    clearRateCardCache();
    dir = await mkdtemp(join(tmpdir(), 'rate-card-'));
  });

  afterEach(async () => {
    clearRateCardCache();
    await rm(dir, { recursive: true, force: true });
  });

  const write = async (contents: string) => {
    const path = join(dir, RATE_CARD_RELATIVE_PATH);
    await mkdir(join(dir, '.ai-conductor'), { recursive: true });
    await writeFile(path, contents, 'utf-8');
    return path;
  };

  it('reads the committed card at .ai-conductor/rate-card.json', async () => {
    await write(JSON.stringify({ as_of: 'x', models: { 'gpt-5.6-terra': TERRA } }));
    expect(loadRateCard(dir)?.models['gpt-5.6-terra']).toEqual(TERRA);
  });

  it('returns undefined for a missing card, an unreadable one, and no root', async () => {
    expect(loadRateCard(dir)).toBeUndefined();
    expect(loadRateCard(undefined)).toBeUndefined();
    await write('{ not json');
    expect(loadRateCard(dir)).toBeUndefined();
  });

  it('picks up a refreshed card without a restart', async () => {
    const path = await write(JSON.stringify({ as_of: 'x', models: { 'gpt-5.6-terra': TERRA } }));
    expect(loadRateCard(dir)?.models['gpt-5.6-terra']?.input_cost_per_token).toBe(2e-6);
    await writeFile(
      path,
      JSON.stringify({ as_of: 'y', models: { 'gpt-5.6-terra': { ...TERRA, input_cost_per_token: 5e-6 } } }),
      'utf-8',
    );
    // mtime granularity: force a distinct stamp rather than sleeping.
    const { utimesSync } = await import('node:fs');
    utimesSync(path, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    expect(loadRateCard(dir)?.models['gpt-5.6-terra']?.input_cost_per_token).toBe(5e-6);
  });
});
