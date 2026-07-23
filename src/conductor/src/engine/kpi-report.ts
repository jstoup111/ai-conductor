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

  const unmeteredMatch = /unmetered:\s*\{?\s*count:\s*([\-0-9.]+)\s*,\s*duration_ms:\s*([\-0-9.]+)\s*\}?/.exec(
    body,
  );

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
  };
}

interface FeatureKpi {
  slug: string;
  cost: KpiCostFields | null;
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
    features.push({ slug, cost: parseCostBlock(content) });
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

  for (const feature of features) {
    if (!feature.cost) {
      lines.push(`- ${feature.slug}: no Cost data available (skipped)`);
      continue;
    }
    const tokens = feature.cost.input + feature.cost.output;
    const partial = feature.cost.unmeteredCount > 0;
    const marker = partial ? ' [PARTIAL — unmetered dispatches present]' : '';
    lines.push(
      `- ${feature.slug}: input=${feature.cost.input} output=${feature.cost.output} ` +
        `tokens=${tokens} cost_usd=${feature.cost.costUsd}${marker}`,
    );
    totalInput += feature.cost.input;
    totalOutput += feature.cost.output;
    totalCostUsd += feature.cost.costUsd;
    counted += 1;
  }

  const totalTokens = totalInput + totalOutput;
  lines.push('');
  lines.push(
    `Aggregate / trend across ${counted} feature(s): total tokens=${totalTokens} ` +
      `(input=${totalInput}, output=${totalOutput}), total cost_usd=${Math.round(totalCostUsd * 10000) / 10000}`,
  );

  return lines.join('\n') + '\n';
}
