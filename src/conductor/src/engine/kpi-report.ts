/**
 * conduct kpi — read-only report over committed `.docs/shipped/*.md` records.
 *
 * Parses each shipped record's frontmatter (via parseShippedRecord) plus the
 * `## Cost` block appended by renderShippedRecordWithCost (Task 6), and
 * prints a per-feature token/cost summary plus an aggregate across all
 * shipped features. Never throws: a missing shipped dir, zero records, a
 * record with no Cost block, or a malformed Cost block are all tolerated
 * and reported gracefully rather than crashing the report (docs-track-
 * features / never-block convention).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseShippedRecord } from './shipped-record.js';
import type { TimingRollup } from './timing-rollup.js';

export interface KpiCostFields {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  costUsd: number;
  dispatches: number;
  retries: number;
  halts: number;
  unmeteredCount: number;
  unmeteredDurationMs: number;
  costUnmetered: number;
  providers: Record<string, KpiProviderCostFields>;
}

export interface KpiProviderCostFields {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  costUsd: number;
  dispatches: number;
  costUnmetered: number;
}

export type KpiTimeFields = TimingRollup;

/**
 * Parse the independently rendered `## Time` section. Cost fields are never
 * consulted, so timing remains reportable when cost evidence is absent.
 */
export function parseTimeBlock(content: string): KpiTimeFields {
  const match = /^## Time\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(content);
  if (!match) return { state: 'unavailable' };

  const body = match[1];
  const num = (name: string): number | undefined => {
    const field = new RegExp(`^${name}:\\s*([\\-0-9.]+)\\s*$`, 'm').exec(body);
    const value = field ? Number(field[1]) : undefined;
    return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
  };
  const activeMs = num('active_ms');
  const providerActiveMs = num('provider_active_ms');
  const noProviderActiveMs = num('no_provider_active_ms');

  if (/^state:\s*unavailable\s*$/m.test(body)) {
    return { state: 'unavailable' };
  }
  if (
    /^state:\s*measured\s*$/m.test(body) &&
    activeMs !== undefined &&
    providerActiveMs !== undefined &&
    noProviderActiveMs !== undefined &&
    providerActiveMs + noProviderActiveMs === activeMs
  ) {
    return { state: 'measured', activeMs, providerActiveMs, noProviderActiveMs };
  }

  return activeMs === undefined ? { state: 'partial' } : { state: 'partial', activeMs };
}

/**
 * Tolerant parser for the `## Cost` block emitted by
 * renderShippedRecordWithCost. Accepts reasonable formatting variance (extra
 * whitespace, the braced `{ count: N, duration_ms: M }` shape or the bare
 * `count: N, duration_ms: M` shape actually emitted) rather than requiring a
 * byte-exact match. Returns null if no Cost block / no recognizable fields
 * are present.
 */
export function parseCostBlock(content: string): KpiCostFields | null {
  const idx = content.indexOf('## Cost');
  if (idx === -1) return null;
  const body = content.slice(idx);

  const num = (name: string): number | undefined => {
    const m = new RegExp(`^${name}:\\s*([\\-0-9.]+)`, 'm').exec(body);
    return m ? Number(m[1]) : undefined;
  };

  const input = num('input');
  const output = num('output');
  if (input === undefined || output === undefined) return null;

  const unmeteredMatch = /^unmetered:\s*\{?\s*count:\s*([\-0-9.]+)\s*,\s*duration_ms:\s*([\-0-9.]+)\s*\}?/m.exec(
    body,
  );
  const costUnmeteredMatch = /^cost_unmetered:\s*(?:\{?\s*count:\s*)?([\-0-9.]+)/m.exec(body);
  const providers = parseProviderCostFields(body);

  return {
    input,
    output,
    cacheRead: num('cache_read') ?? 0,
    cacheCreation: num('cache_creation') ?? 0,
    costUsd: num('cost_usd') ?? 0,
    dispatches: num('dispatches') ?? 0,
    retries: num('retries') ?? 0,
    halts: num('halts') ?? 0,
    unmeteredCount: unmeteredMatch ? Number(unmeteredMatch[1]) : 0,
    unmeteredDurationMs: unmeteredMatch ? Number(unmeteredMatch[2]) : 0,
    costUnmetered: costUnmeteredMatch ? Number(costUnmeteredMatch[1]) : 0,
    providers,
  };
}

function parseProviderCostFields(body: string): Record<string, KpiProviderCostFields> {
  const providers: Record<string, KpiProviderCostFields> = Object.create(null);
  let inProviders = false;

  for (const line of body.split('\n')) {
    if (/^providers:\s*$/.test(line)) {
      inProviders = true;
      continue;
    }
    if (!inProviders) continue;

    const providerMatch = /^  ([^:]+):\s*(.*)$/.exec(line);
    if (!providerMatch) {
      if (line.trim()) inProviders = false;
      continue;
    }

    const fields = providerMatch[2];
    const num = (name: string): number => {
      const match = new RegExp(`(?:^|,\\s*)${name}:\\s*([\\-0-9.]+)(?:,|$)`).exec(fields);
      return match ? Number(match[1]) : 0;
    };
    const costUnmeteredMatch = /(?:^|,\s*)cost_unmetered:\s*(?:count:\s*)?([\-0-9.]+)(?:,|$)/.exec(fields);

    providers[providerMatch[1].trim()] = {
      input: num('input'),
      output: num('output'),
      cacheRead: num('cache_read'),
      cacheCreation: num('cache_creation'),
      costUsd: num('cost_usd'),
      dispatches: num('dispatches'),
      costUnmetered: costUnmeteredMatch ? Number(costUnmeteredMatch[1]) : 0,
    };
  }

  return providers;
}

interface FeatureKpi {
  slug: string;
  cost: KpiCostFields | null;
  time: KpiTimeFields;
  /**
   * Engine build that shipped this feature. `unknown` for records written
   * before engine-version stamping — reported explicitly rather than omitted
   * so an unattributed ship stays visible in the report instead of silently
   * blending into the stamped ones.
   */
  engineVersion: string;
}

interface TimingAggregate {
  measured: number;
  partial: number;
  unavailable: number;
  activeMs: number;
  providerActiveMs: number;
  noProviderActiveMs: number;
}

function formatFeatureTiming(time: TimingRollup): string {
  if (time.state === 'measured') {
    return (
      ` time=measured active_ms=${time.activeMs}` +
      ` provider_active_ms=${time.providerActiveMs}` +
      ` no_provider_active_ms=${time.noProviderActiveMs}`
    );
  }
  if (time.state === 'partial') {
    return ` time=partial${time.activeMs === undefined ? '' : ` active_ms=${time.activeMs}`}`;
  }
  return ' time=unavailable';
}

function addTiming(aggregate: TimingAggregate, time: TimingRollup): void {
  aggregate[time.state] += 1;
  if (time.state !== 'measured') return;
  aggregate.activeMs += time.activeMs;
  aggregate.providerActiveMs += time.providerActiveMs;
  aggregate.noProviderActiveMs += time.noProviderActiveMs;
}

function formatTimingAggregate(aggregate: TimingAggregate): string {
  let output =
    `; timing measured=${aggregate.measured}` +
    ` partial=${aggregate.partial} unavailable=${aggregate.unavailable}`;
  if (aggregate.measured === 0) return output;
  output +=
    ` avg_active_ms=${aggregate.activeMs / aggregate.measured}` +
    ` avg_provider_active_ms=${aggregate.providerActiveMs / aggregate.measured}` +
    ` avg_no_provider_active_ms=${aggregate.noProviderActiveMs / aggregate.measured}`;
  return output;
}

async function loadFeatures(shippedDir: string): Promise<FeatureKpi[]> {
  let files: string[];
  try {
    files = (await readdir(shippedDir)).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }

  const features: FeatureKpi[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = await readFile(join(shippedDir, file), 'utf8');
    } catch {
      continue;
    }
    const parsed = parseShippedRecord(content);
    const slug = 'slug' in parsed ? parsed.slug : file.replace(/\.md$/, '');
    const engineVersion = ('engineVersion' in parsed ? parsed.engineVersion : undefined) ?? 'unknown';
    features.push({
      slug,
      cost: parseCostBlock(content),
      time: parseTimeBlock(content),
      engineVersion,
    });
  }

  return features;
}

/**
 * renderKpi renders the full `conduct kpi` report for the given repo root.
 * Resolves `.docs/shipped` under root. Always resolves successfully (never
 * throws) — a missing/empty shipped dir prints a friendly message.
 */
export async function renderKpi(root: string): Promise<string> {
  const shippedDir = join(root, '.docs', 'shipped');
  const features = await loadFeatures(shippedDir);

  if (features.length === 0) {
    return 'No shipped features yet — .docs/shipped/ is empty or does not exist.\n';
  }

  const lines: string[] = [];
  lines.push('KPI report — tokens per shipped feature\n');

  let totalInput = 0;
  let totalOutput = 0;
  let totalCostUsd = 0;
  let counted = 0;
  let costCounted = 0;
  const timingAggregate: TimingAggregate = {
    measured: 0,
    partial: 0,
    unavailable: 0,
    activeMs: 0,
    providerActiveMs: 0,
    noProviderActiveMs: 0,
  };

  for (const feature of features) {
    const timing = formatFeatureTiming(feature.time);
    addTiming(timingAggregate, feature.time);
    if (!feature.cost) {
      lines.push(
        `- ${feature.slug}: engine=${feature.engineVersion} no Cost data available (skipped)${timing}`,
      );
      continue;
    }
    const tokens = feature.cost.input + feature.cost.output;
    const unmetered = feature.cost.unmeteredCount > 0;
    const costUnmetered = feature.cost.costUnmetered > 0;
    const marker = unmetered
      ? ' [PARTIAL — unmetered dispatches present]'
      : costUnmetered
        ? ' [COST-PARTIAL — cost-unmetered dispatches present]'
        : '';
    const cost = costUnmetered ? 'unavailable' : feature.cost.costUsd;
    lines.push(
      `- ${feature.slug}: engine=${feature.engineVersion} ` +
        `input=${feature.cost.input} output=${feature.cost.output} ` +
        `tokens=${tokens} cache_read=${feature.cost.cacheRead} ` +
        `cache_creation=${feature.cost.cacheCreation} dispatches=${feature.cost.dispatches} ` +
        `retries=${feature.cost.retries} halts=${feature.cost.halts} ` +
        `duration_ms=${feature.cost.unmeteredDurationMs} cost_usd=${cost}${marker}${timing}`,
    );
    for (const [provider, providerCost] of Object.entries(feature.cost.providers)) {
      const providerTokens = providerCost.input + providerCost.output;
      const providerUsd = providerCost.costUnmetered > 0 ? 'unavailable' : providerCost.costUsd;
      lines.push(
        `  - ${provider}: input=${providerCost.input} output=${providerCost.output} ` +
          `tokens=${providerTokens} cost_usd=${providerUsd} ` +
          `cost_unmetered=${providerCost.costUnmetered} dispatches=${providerCost.dispatches}`,
      );
    }
    if (unmetered) {
      continue;
    }
    totalInput += feature.cost.input;
    totalOutput += feature.cost.output;
    counted += 1;
    if (!costUnmetered) {
      totalCostUsd += feature.cost.costUsd;
      costCounted += 1;
    }
  }

  const totalTokens = totalInput + totalOutput;
  lines.push('');
  const aggregateCost = costCounted > 0
    ? Math.round(totalCostUsd * 10000) / 10000
    : 'unavailable';
  let aggregate =
    `Aggregate / trend across ${counted} feature(s): total tokens=${totalTokens} ` +
      `(input=${totalInput}, output=${totalOutput}), total cost_usd=${aggregateCost}`;
  aggregate += formatTimingAggregate(timingAggregate);
  lines.push(aggregate);

  return lines.join('\n') + '\n';
}
