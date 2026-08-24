// `conduct rate-card {refresh,show}` — maintain the committed per-model token
// price card at `.ai-conductor/rate-card.json`.
//
// Refresh fetches LiteLLM's public `model_prices_and_context_window.json`
// (~1.8MB, 3000+ models), PRUNES it to just the models this project's provider
// model policies actually route to, and rewrites the card with a new `as_of`.
//
// Deliberately an operator command, not a daemon poller: a network fetch has no
// business on the dispatch path, where it would add latency and a failure mode
// to every provider invocation. Cron this if you want it periodic.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  RATE_CARD_RELATIVE_PATH,
  RATE_CARD_SOURCE_URL,
  parseModelRate,
  parseRateCard,
  type ModelRate,
  type RateCard,
} from '../execution/rate-card.js';
import { rateCardModelIds } from './provider-model-policy.js';

export type RateCardDispatch =
  | { kind: 'refresh'; models: string[] }
  | { kind: 'show' }
  | { kind: 'guide' };

/**
 * Parse argv for the `rate-card` subcommand.
 *   conduct rate-card refresh                → refresh the policy-derived model set
 *   conduct rate-card refresh --model <id>   → refresh, plus these extra models
 *   conduct rate-card show                   → print the committed card
 *   conduct rate-card                        → usage
 */
export function detectRateCardCommand(argv: string[]): RateCardDispatch | null {
  if (argv[2] !== 'rate-card') return null;
  const rest = argv.slice(3);
  const sub = rest[0];
  if (sub === 'show') return { kind: 'show' };
  if (sub !== 'refresh') return { kind: 'guide' };

  const models: string[] = [];
  for (let i = 1; i < rest.length; i += 1) {
    if (rest[i] === '--model' && typeof rest[i + 1] === 'string') {
      models.push(rest[i + 1]);
      i += 1;
    }
  }
  return { kind: 'refresh', models };
}

/** Injectable fetch seam — no ordinary test may reach the real network. */
export type RateCardFetch = (url: string) => Promise<string>;

const defaultFetch: RateCardFetch = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.text();
};

/**
 * Prune an upstream LiteLLM catalog to `models`, keeping only the three fields
 * the pricing formula reads. A model with no usable upstream record is reported
 * as missing rather than guessed at — the card must never carry a rate that was
 * not published.
 */
export function pruneRateCard(
  upstreamJson: string,
  models: readonly string[],
): { models: Record<string, ModelRate>; missing: string[] } {
  let upstream: unknown;
  try {
    upstream = JSON.parse(upstreamJson);
  } catch {
    throw new Error('upstream rate source is not valid JSON');
  }
  if (typeof upstream !== 'object' || upstream === null || Array.isArray(upstream)) {
    throw new Error('upstream rate source is not a JSON object');
  }
  const catalog = upstream as Record<string, unknown>;

  const pruned: Record<string, ModelRate> = {};
  const missing: string[] = [];
  for (const model of [...new Set(models)].sort()) {
    const rate = Object.hasOwn(catalog, model) ? parseModelRate(catalog[model]) : undefined;
    if (rate) pruned[model] = rate;
    else missing.push(model);
  }
  return { models: pruned, missing };
}

/** Serialize a card deterministically so a refresh with no rate change is a no-op diff. */
export function renderRateCard(card: RateCard): string {
  return `${JSON.stringify(card, null, 2)}\n`;
}

export async function dispatchRateCard(
  cmd: RateCardDispatch,
  projectRoot: string,
  deps: { fetch?: RateCardFetch; now?: () => Date } = {},
): Promise<number> {
  const path = join(projectRoot, RATE_CARD_RELATIVE_PATH);

  if (cmd.kind === 'guide') {
    console.error(
      'conduct rate-card refresh [--model <id>]...\n' +
        `  Fetch ${RATE_CARD_SOURCE_URL},\n` +
        '  prune it to the models this project routes to (plus any --model given),\n' +
        `  and rewrite ${RATE_CARD_RELATIVE_PATH} with a fresh as_of timestamp.\n` +
        '  Commit the result: the card is durable state the build reads by name.\n' +
        'conduct rate-card show\n' +
        '  Print the committed card (as_of, source, and each model rate).',
    );
    return 1;
  }

  if (cmd.kind === 'show') {
    let card: RateCard | undefined;
    try {
      card = parseRateCard(await readFile(path, 'utf-8'));
    } catch {
      console.error(`  no rate card at ${path} — run \`conduct rate-card refresh\``);
      return 1;
    }
    if (!card) {
      console.error(`  ${path} is not a readable rate card — run \`conduct rate-card refresh\``);
      return 1;
    }
    console.log(`as_of: ${card.as_of}`);
    console.log(`source: ${card.source}`);
    for (const [model, rate] of Object.entries(card.models)) {
      console.log(
        `  ${model}: input=${rate.input_cost_per_token} output=${rate.output_cost_per_token} ` +
          `cache_read=${rate.cache_read_input_token_cost ?? rate.input_cost_per_token}`,
      );
    }
    return 0;
  }

  const wanted = [...rateCardModelIds(), ...cmd.models];
  const doFetch = deps.fetch ?? defaultFetch;

  let upstreamJson: string;
  try {
    upstreamJson = await doFetch(RATE_CARD_SOURCE_URL);
  } catch (e) {
    console.error(
      `  rate-card refresh failed: could not fetch ${RATE_CARD_SOURCE_URL} ` +
        `(${e instanceof Error ? e.message : String(e)}). The committed card is unchanged.`,
    );
    return 1;
  }

  let pruned: { models: Record<string, ModelRate>; missing: string[] };
  try {
    pruned = pruneRateCard(upstreamJson, wanted);
  } catch (e) {
    console.error(
      `  rate-card refresh failed: ${e instanceof Error ? e.message : String(e)}. ` +
        'The committed card is unchanged.',
    );
    return 1;
  }

  if (Object.keys(pruned.models).length === 0) {
    console.error(
      '  rate-card refresh failed: upstream carried no usable rate for any routed model. ' +
        'The committed card is unchanged.',
    );
    return 1;
  }

  const card: RateCard = {
    as_of: (deps.now?.() ?? new Date()).toISOString(),
    source: RATE_CARD_SOURCE_URL,
    models: pruned.models,
  };

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, renderRateCard(card), 'utf-8');

  console.error(`  wrote ${path} — ${Object.keys(card.models).length} model(s), as_of ${card.as_of}`);
  for (const model of pruned.missing) {
    // Named, not silently dropped: a routed model with no published rate is
    // exactly the case that leaves its dispatches cost-unmetered.
    console.error(`  ⚠ no upstream rate for "${model}" — its dispatches stay cost-unmetered`);
  }
  return 0;
}
