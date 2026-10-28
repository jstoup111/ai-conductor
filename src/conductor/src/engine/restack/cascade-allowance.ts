import { join } from 'node:path';
import type { ComplexityTier, HarnessConfig } from '../../types/index.js';
import { loadConfig } from '../config.js';
import { resolveMainRepoRoot } from '../park-marker.js';
import { readState } from '../state.js';
import type { CascadeCounts } from './cascade-cap.js';

/** Default restack cascades per feature complexity when configuration omits a cap. */
export const RESTACK_CASCADE_TIER_DEFAULTS: Readonly<Record<ComplexityTier, number>> = {
  S: 3,
  M: 3,
  L: 8,
};

export interface RestackCascadeAllowance {
  limit: number;
  /** Undefined stays visible to renderers as an unrecorded tier treated as M. */
  tier: ComplexityTier | undefined;
  source: 'configured' | 'default';
}

type RestackCascadeConfig = number | Partial<Record<ComplexityTier, number>>;

function configuredRestackCascadeCap(config: HarnessConfig): RestackCascadeConfig | undefined {
  return config.stacked_prs?.max_restack_cascades;
}

/** Resolve the configured or tier-default restack cascade allowance for one feature. */
export function resolveRestackCascadeAllowance(
  config: HarnessConfig,
  tier: ComplexityTier | undefined,
): RestackCascadeAllowance {
  const configured = configuredRestackCascadeCap(config);
  if (typeof configured === 'number') return { limit: configured, tier, source: 'configured' };
  const effectiveTier = tier ?? 'M';
  const configuredLimit = configured?.[effectiveTier];
  if (configuredLimit !== undefined) return { limit: configuredLimit, tier, source: 'configured' };
  return { limit: RESTACK_CASCADE_TIER_DEFAULTS[effectiveTier], tier, source: 'default' };
}

/**
 * Resolve the allowance for a feature worktree. The tier belongs to that
 * feature's state, while configuration belongs to the shared main checkout.
 */
export async function resolveCascadeAllowanceForWorktree(
  worktree: string,
): Promise<RestackCascadeAllowance> {
  const mainRoot = await resolveMainRepoRoot(worktree);
  const [configResult, stateResult] = await Promise.all([
    loadConfig(mainRoot),
    readState(join(worktree, '.pipeline', 'conduct-state.json')),
  ]);
  if (!configResult.ok) throw new Error(configResult.error.message);
  if (!stateResult.ok) throw new Error(stateResult.error.message);
  return resolveRestackCascadeAllowance(configResult.config, stateResult.value.complexity_tier);
}

/** Render the shared allowance phrase used by cascade cap surfaces. */
export function formatCascadeAllowance(allowance: RestackCascadeAllowance): string {
  const tier = allowance.tier === undefined
    ? 'tier unrecorded, treated as M;'
    : `tier ${allowance.tier}`;
  return `${tier} allowance ${allowance.limit} (${allowance.source})`;
}

export interface CascadeSummaryChild {
  child: number;
  consumed: number;
  limit: number;
  remaining: number;
  raised: boolean;
}

export interface CascadeSummary {
  inspectLines: readonly string[];
  statusFragment: string;
  json: {
    tier: ComplexityTier | null;
    allowance: number;
    source: RestackCascadeAllowance['source'];
    children: readonly CascadeSummaryChild[];
  };
}

/**
 * Render the one cascade accounting view consumed by both inspect and status.
 * Limits have a child-scoped raise precedence over the feature allowance.
 */
export function renderCascadeSummary(
  counts: CascadeCounts,
  allowance: RestackCascadeAllowance,
): CascadeSummary {
  const children = [...new Set([
    ...Object.keys(counts.counts),
    ...Object.keys(counts.limits ?? {}),
  ])]
    .map(Number)
    .sort((left, right) => left - right)
    .map((child): CascadeSummaryChild => {
      const key = String(child);
      const raised = counts.limits?.[key] !== undefined;
      const limit = counts.limits?.[key] ?? allowance.limit;
      const consumed = counts.counts[key] ?? 0;
      return { child, consumed, limit, remaining: Math.max(0, limit - consumed), raised };
    });
  const allowanceText = formatCascadeAllowance(allowance);
  const childInspectLines = children.map((child) =>
    `child ${child.child}: ${child.consumed}/${child.limit} consumed; ${child.remaining} remaining${child.raised ? ' (raised)' : ''}`,
  );
  const childStatus = children.length === 0
    ? 'none charged'
    : children.map((child) => `child ${child.child} ${child.consumed}/${child.limit}${child.raised ? ' (raised)' : ''}`).join(', ');
  return {
    inspectLines: [
      `Restack cascades — ${allowanceText}`,
      ...(childInspectLines.length === 0 ? ['none charged'] : childInspectLines),
    ],
    statusFragment: `${allowanceText}; ${childStatus}`,
    json: {
      tier: allowance.tier ?? null,
      allowance: allowance.limit,
      source: allowance.source,
      children,
    },
  };
}
