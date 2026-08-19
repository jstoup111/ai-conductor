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
import type { BuildReviewMetrics } from './build-tail-rollup.js';

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

function parseBuildReviewBlock(content: string): BuildReviewMetrics | undefined {
  const match = /^## Build Review\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(content);
  if (!match) return undefined;
  const body = match[1];
  const number = (name: string): number | undefined => {
    const value = new RegExp(`^${name}:\\s*(\\d+)\\s*$`, 'm').exec(body)?.[1];
    return value === undefined ? undefined : Number(value);
  };
  const laps = /^laps_to_pass:\s*(\d+|not reached)\s*$/m.exec(body)?.[1];
  const rubricFailureRates: Record<string, { failures: number; judged: number }> = {};
  const skipReasons: Record<string, number> = {};
  let section: 'rubrics' | 'skip_reasons' | undefined;
  for (const line of body.split('\n')) {
    if (line === 'rubrics:') { section = 'rubrics'; continue; }
    if (line === 'skip_reasons:') { section = 'skip_reasons'; continue; }
    const entry = /^  ([^:]+): failures: (\d+), judged: (\d+)$/.exec(line);
    if (section === 'rubrics' && entry) rubricFailureRates[entry[1]] = { failures: Number(entry[2]), judged: Number(entry[3]) };
    const skipReason = /^  ([^:]+): (\d+)$/.exec(line);
    if (section === 'skip_reasons' && skipReason) skipReasons[skipReason[1]] = Number(skipReason[2]);
  }
  const skipped = number('skipped');
  const cacheHits = number('cache_hits');
  const infrastructureFailures = number('infrastructure_failures');
  if (skipped === undefined || cacheHits === undefined || infrastructureFailures === undefined) return undefined;
  return {
    lapsToPass: laps && laps !== 'not reached' ? Number(laps) : undefined,
    rubricFailureRates,
    skipped,
    cacheHits,
    infrastructureFailures,
    skipReasons,
  };
}

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
  const reason = /^reason:\s*(.+?)\s*$/m.exec(body)?.[1];

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

  return {
    state: 'partial',
    ...(activeMs === undefined ? {} : { activeMs }),
    ...(reason === undefined ? {} : { reason: reason as Extract<TimingRollup, { state: 'partial' }>['reason'] }),
  };
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
  buildReview?: BuildReviewMetrics;
}

interface TimingAggregate {
  measured: number;
  partial: number;
  unavailable: number;
  activeMs: number;
  providerActiveMs: number;
  noProviderActiveMs: number;
}

interface CostAggregate {
  input: number;
  output: number;
  costUsd: number;
  tokenCounted: number;
  costCounted: number;
}

interface ReportAggregate {
  cost: CostAggregate;
  timing: TimingAggregate;
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

function createReportAggregate(): ReportAggregate {
  return {
    cost: { input: 0, output: 0, costUsd: 0, tokenCounted: 0, costCounted: 0 },
    timing: {
      measured: 0,
      partial: 0,
      unavailable: 0,
      activeMs: 0,
      providerActiveMs: 0,
      noProviderActiveMs: 0,
    },
  };
}

function addCost(aggregate: CostAggregate, cost: KpiCostFields | null): void {
  if (!cost || cost.unmeteredCount > 0) return;
  aggregate.input += cost.input;
  aggregate.output += cost.output;
  aggregate.tokenCounted += 1;
  if (cost.costUnmetered > 0) return;
  aggregate.costUsd += cost.costUsd;
  aggregate.costCounted += 1;
}

function renderProviderLines(providers: Record<string, KpiProviderCostFields>): string[] {
  return Object.entries(providers).map(([provider, cost]) => {
    const tokens = cost.input + cost.output;
    const costUsd = cost.costUnmetered > 0 ? 'unavailable' : cost.costUsd;
    return (
      `  - ${provider}: input=${cost.input} output=${cost.output} ` +
      `tokens=${tokens} cost_usd=${costUsd} ` +
      `cost_unmetered=${cost.costUnmetered} dispatches=${cost.dispatches}`
    );
  });
}

function renderFeatureLines(feature: FeatureKpi): string[] {
  const timing = formatFeatureTiming(feature.time);
  const buildReview = feature.buildReview
    ? ` build_review=laps_to_pass=${feature.buildReview.lapsToPass ?? 'not reached'} skipped=${feature.buildReview.skipped} cache_hits=${feature.buildReview.cacheHits} infrastructure_failures=${feature.buildReview.infrastructureFailures}`
    : '';
  const rubricLines = feature.buildReview
    ? Object.entries(feature.buildReview.rubricFailureRates).sort(([a], [b]) => a.localeCompare(b)).map(
      ([rubric, rate]) => `  - ${rubric}: raw_failures=${rate.failures}/${rate.judged}`,
    )
    : [];
  if (!feature.cost) {
    return [
      `- ${feature.slug}: engine=${feature.engineVersion} no Cost data available (skipped)${timing}${buildReview}`,
      ...rubricLines,
    ];
  }
  const cost = feature.cost;
  const unmetered = cost.unmeteredCount > 0;
  const costUnmetered = cost.costUnmetered > 0;
  const marker = unmetered
    ? ' [PARTIAL — unmetered dispatches present]'
    : costUnmetered ? ' [COST-PARTIAL — cost-unmetered dispatches present]' : '';
  const costUsd = costUnmetered ? 'unavailable' : cost.costUsd;
  const featureLine =
    `- ${feature.slug}: engine=${feature.engineVersion} ` +
    `input=${cost.input} output=${cost.output} tokens=${cost.input + cost.output} ` +
    `cache_read=${cost.cacheRead} cache_creation=${cost.cacheCreation} ` +
    `dispatches=${cost.dispatches} retries=${cost.retries} halts=${cost.halts} ` +
    `duration_ms=${cost.unmeteredDurationMs} cost_usd=${costUsd}${marker}${timing}`;
  return [`${featureLine}${buildReview}`, ...renderProviderLines(cost.providers), ...rubricLines];
}

function renderAggregateLine(aggregate: ReportAggregate): string {
  const { cost } = aggregate;
  const costUsd = cost.costCounted > 0
    ? Math.round(cost.costUsd * 10000) / 10000
    : 'unavailable';
  return (
    `Aggregate / trend across ${cost.tokenCounted} feature(s): ` +
    `total tokens=${cost.input + cost.output} ` +
    `(input=${cost.input}, output=${cost.output}), total cost_usd=${costUsd}` +
    formatTimingAggregate(aggregate.timing)
  );
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
      buildReview: parseBuildReviewBlock(content),
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

  const lines = ['KPI report — tokens per shipped feature\n'];
  const aggregate = createReportAggregate();
  for (const feature of features) {
    lines.push(...renderFeatureLines(feature));
    addCost(aggregate.cost, feature.cost);
    addTiming(aggregate.timing, feature.time);
  }
  lines.push('', renderAggregateLine(aggregate));

  return lines.join('\n') + '\n';
}
