import { describe, expect, it, vi } from 'vitest';

import { CodexProvider } from '../../src/execution/codex-provider.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';
import type { RateCard } from '../../src/execution/rate-card.js';
import { classifyMetering } from '../../src/engine/metering.js';

const readyDoctor = async () => ({
  stdout: JSON.stringify({
    schemaVersion: 1,
    auth: { selectedMode: 'cached-login', configured: true },
    transport: { authenticated: true },
  }),
  exitCode: 0,
});

const CARD: RateCard = {
  as_of: '2026-08-24T00:00:00.000Z',
  source: 'https://example.invalid/rates.json',
  models: {
    'gpt-5.6-terra': {
      input_cost_per_token: 2e-6,
      output_cost_per_token: 1.2e-5,
      cache_read_input_token_cost: 2e-7,
    },
  },
};

/** One `turn.completed` record shaped exactly as Codex emits it. */
const STDOUT = JSON.stringify({
  type: 'turn.completed',
  usage: {
    input_tokens: 11_000,
    cached_input_tokens: 10_000,
    output_tokens: 500,
  },
});

function providerWith(card: RateCard | undefined, seen: Array<string | undefined>) {
  const subprocess = Object.assign(
    Promise.resolve({ stdout: STDOUT, stderr: '', exitCode: 0 }),
    { kill: vi.fn() },
  );
  return new CodexProvider(
    readyDoctor,
    'codex',
    undefined,
    () => subprocess as never,
    undefined,
    (root) => {
      seen.push(root);
      return card;
    },
  );
}

const options: InvokeOptions = {
  prompt: 'Do the thing',
  sessionId: 'thread-cost',
  resume: false,
  model: 'gpt-5.6-terra',
  cwd: '/repo/.worktrees/feature',
};

describe('CodexProvider dispatch-time cost accounting', () => {
  it('prices the dispatch from the rate card so it stops being cost-unmetered', async () => {
    const seen: Array<string | undefined> = [];
    const result = await providerWith(CARD, seen).invoke(options);

    // input_tokens INCLUDES the cached share, so fresh input is 1_000.
    expect(result.tokenUsage).toMatchObject({ input: 1_000, cacheRead: 10_000, output: 500 });
    // 1000*2e-6 + 10000*2e-7 + 500*1.2e-5
    expect(result.tokenUsage?.costUsd).toBeCloseTo(0.002 + 0.002 + 0.006, 12);
    expect(result.tokenUsage?.costSource).toBe('rate-card');
    expect(classifyMetering(result.tokenUsage)).toBe('fully-metered');
    // The card is looked up under the dispatch's own worktree.
    expect(seen).toContain('/repo/.worktrees/feature');
  });

  it('stays cost-unmetered when no card is available', async () => {
    const result = await providerWith(undefined, []).invoke(options);
    expect(result.tokenUsage?.input).toBe(1_000);
    expect(result.tokenUsage?.costUsd).toBeUndefined();
    expect(classifyMetering(result.tokenUsage)).toBe('cost-unmetered');
  });

  it('stays cost-unmetered when the dispatch pinned no model', async () => {
    const result = await providerWith(CARD, []).invoke({ ...options, model: undefined });
    expect(result.tokenUsage?.costUsd).toBeUndefined();
    expect(classifyMetering(result.tokenUsage)).toBe('cost-unmetered');
  });

  it('stays cost-unmetered when the routed model has no card entry', async () => {
    const result = await providerWith(CARD, []).invoke({ ...options, model: 'gpt-5.6-sol' });
    expect(result.tokenUsage?.costUsd).toBeUndefined();
    expect(classifyMetering(result.tokenUsage)).toBe('cost-unmetered');
  });
});
