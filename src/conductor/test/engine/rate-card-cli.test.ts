import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  detectRateCardCommand,
  dispatchRateCard,
  pruneRateCard,
} from '../../src/engine/rate-card-cli.js';
import { rateCardModelIds } from '../../src/engine/provider-model-policy.js';
import { RATE_CARD_RELATIVE_PATH, parseRateCard } from '../../src/execution/rate-card.js';

const UPSTREAM = JSON.stringify({
  'gpt-5.6-terra': {
    input_cost_per_token: 2e-6,
    output_cost_per_token: 1.2e-5,
    cache_read_input_token_cost: 2e-7,
    litellm_provider: 'openai',
    max_tokens: 128000,
  },
  'gpt-5.6-sol': {
    input_cost_per_token: 4e-6,
    output_cost_per_token: 2e-5,
    cache_read_input_token_cost: 4e-7,
  },
  'gpt-5.6-luna': {
    input_cost_per_token: 2e-7,
    output_cost_per_token: 1.2e-6,
    cache_read_input_token_cost: 2e-8,
  },
  'claude-opus-4': { input_cost_per_token: 1.5e-5, output_cost_per_token: 7.5e-5 },
});

describe('detectRateCardCommand', () => {
  it('parses the subcommands it owns and ignores everything else', () => {
    expect(detectRateCardCommand(['n', 'c', 'rate-card', 'refresh'])).toEqual({ kind: 'refresh', models: [] });
    expect(detectRateCardCommand(['n', 'c', 'rate-card', 'show'])).toEqual({ kind: 'show' });
    expect(detectRateCardCommand(['n', 'c', 'rate-card'])).toEqual({ kind: 'guide' });
    expect(detectRateCardCommand(['n', 'c', 'daemon', 'status'])).toBeNull();
  });

  it('collects repeated --model additions', () => {
    expect(
      detectRateCardCommand(['n', 'c', 'rate-card', 'refresh', '--model', 'a', '--model', 'b']),
    ).toEqual({ kind: 'refresh', models: ['a', 'b'] });
  });
});

describe('rateCardModelIds', () => {
  it('covers every codex model the policy can route to, and no claude alias', () => {
    const ids = rateCardModelIds();
    expect(ids).toContain('gpt-5.6-terra');
    expect(ids).toContain('gpt-5.6-sol');
    // Reachable only via the escalation ladder — the case a step-model-only
    // derivation would miss, leaving those dispatches cost-unmetered.
    expect(ids).toContain('gpt-5.6-luna');
    // Claude reports its own cost; pricing it from a card would be second-guessing.
    expect(ids).not.toContain('opus');
    expect(ids).not.toContain('sonnet');
  });
});

describe('pruneRateCard', () => {
  it('keeps only the requested models and only the priced fields', () => {
    const { models, missing } = pruneRateCard(UPSTREAM, ['gpt-5.6-terra']);
    expect(models).toEqual({
      'gpt-5.6-terra': {
        input_cost_per_token: 2e-6,
        output_cost_per_token: 1.2e-5,
        cache_read_input_token_cost: 2e-7,
      },
    });
    expect(missing).toEqual([]);
  });

  it('reports an unpublished model as missing instead of guessing a rate', () => {
    const { models, missing } = pruneRateCard(UPSTREAM, ['gpt-5.6-terra', 'gpt-9-unheard-of']);
    expect(Object.keys(models)).toEqual(['gpt-5.6-terra']);
    expect(missing).toEqual(['gpt-9-unheard-of']);
  });

  it('rejects an upstream payload that is not a JSON object', () => {
    expect(() => pruneRateCard('<html>404</html>', ['x'])).toThrow(/not valid JSON/);
    expect(() => pruneRateCard('[]', ['x'])).toThrow(/not a JSON object/);
  });
});

describe('dispatchRateCard refresh', () => {
  let dir: string;
  const errors: string[] = [];
  const logs: string[] = [];
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rate-card-cli-'));
    errors.length = 0;
    logs.length = 0;
    errorSpy = vi.spyOn(console, 'error').mockImplementation((m) => { errors.push(String(m)); });
    logSpy = vi.spyOn(console, 'log').mockImplementation((m) => { logs.push(String(m)); });
  });

  afterEach(async () => {
    errorSpy.mockRestore();
    logSpy.mockRestore();
    await rm(dir, { recursive: true, force: true });
  });

  const cardPath = () => join(dir, RATE_CARD_RELATIVE_PATH);

  it('writes a pruned card with a fresh as_of and the upstream source', async () => {
    const code = await dispatchRateCard({ kind: 'refresh', models: [] }, dir, {
      fetch: async () => UPSTREAM,
      now: () => new Date('2026-08-24T12:00:00.000Z'),
    });
    expect(code).toBe(0);

    const card = parseRateCard(await readFile(cardPath(), 'utf-8'));
    expect(card?.as_of).toBe('2026-08-24T12:00:00.000Z');
    expect(card?.source).toMatch(/litellm/);
    expect(Object.keys(card!.models).sort()).toEqual(['gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra']);
    // Pruned: the 3000-model upstream catalog does not land in the repo.
    expect(card?.models['claude-opus-4']).toBeUndefined();
  });

  it('adds explicitly requested models on top of the policy set', async () => {
    await dispatchRateCard({ kind: 'refresh', models: ['claude-opus-4'] }, dir, {
      fetch: async () => UPSTREAM,
    });
    const card = parseRateCard(await readFile(cardPath(), 'utf-8'));
    expect(card?.models['claude-opus-4']).toBeDefined();
  });

  it('leaves the committed card untouched when the fetch fails', async () => {
    await mkdir(join(dir, '.ai-conductor'), { recursive: true });
    await writeFile(cardPath(), 'SENTINEL', 'utf-8');
    const code = await dispatchRateCard({ kind: 'refresh', models: [] }, dir, {
      fetch: async () => { throw new Error('ENOTFOUND'); },
    });
    expect(code).toBe(1);
    expect(await readFile(cardPath(), 'utf-8')).toBe('SENTINEL');
    expect(errors.join('\n')).toMatch(/ENOTFOUND/);
  });

  it('leaves the committed card untouched when upstream prices nothing we route to', async () => {
    await mkdir(join(dir, '.ai-conductor'), { recursive: true });
    await writeFile(cardPath(), 'SENTINEL', 'utf-8');
    const code = await dispatchRateCard({ kind: 'refresh', models: [] }, dir, {
      fetch: async () => JSON.stringify({ 'some-other-model': { input_cost_per_token: 1, output_cost_per_token: 1 } }),
    });
    expect(code).toBe(1);
    expect(await readFile(cardPath(), 'utf-8')).toBe('SENTINEL');
  });

  it('names a routed model upstream does not price', async () => {
    await dispatchRateCard({ kind: 'refresh', models: ['gpt-9-unheard-of'] }, dir, {
      fetch: async () => UPSTREAM,
    });
    expect(errors.join('\n')).toMatch(/no upstream rate for "gpt-9-unheard-of"/);
  });

  it('show prints the committed card, and reports its absence', async () => {
    expect(await dispatchRateCard({ kind: 'show' }, dir)).toBe(1);
    await dispatchRateCard({ kind: 'refresh', models: [] }, dir, { fetch: async () => UPSTREAM });
    expect(await dispatchRateCard({ kind: 'show' }, dir)).toBe(0);
    expect(logs.join('\n')).toMatch(/gpt-5\.6-terra: input=0\.000002 output=0\.000012 cache_read=2e-7/);
  });
});
