import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { ComplexityTier } from '../types/index.js';
import { adrApprovalStatus, findArtifactFiles } from './artifacts.js';

export const AS_BUILT_CHECKS = [
  'reachability',
  'planGap',
  'adrCompliance',
  'diagramDrift',
] as const;

export type AsBuiltCheck = typeof AS_BUILT_CHECKS[number];

export interface AsBuiltCheckPolicy {
  enabled: boolean;
  reason: string;
}

export type AsBuiltPolicy = Record<AsBuiltCheck, AsBuiltCheckPolicy>;

/** The validated configuration shape consumed by the as-built policy. */
export interface AsBuiltPolicyConfig {
  architecture_review_as_built?: {
    checks?: Partial<Record<AsBuiltCheck, { tiers?: readonly ComplexityTier[] }>>;
  };
}

export interface ResolveAsBuiltPolicyInput {
  projectRoot: string;
  tier: ComplexityTier | undefined;
  config?: AsBuiltPolicyConfig;
}

function configuredTierReason(
  config: AsBuiltPolicyConfig | undefined,
  check: AsBuiltCheck,
  tier: ComplexityTier,
): string | undefined {
  const tiers = config?.architecture_review_as_built?.checks?.[check]?.tiers;
  if (tiers === undefined || tiers.includes(tier)) return undefined;
  return `architecture_review_as_built.checks.${check}.tiers excludes ${tier}`;
}

async function hasApprovedAdrs(projectRoot: string): Promise<boolean> {
  const paths = await findArtifactFiles(projectRoot, 'architecture_review');
  for (const path of paths) {
    if (!basename(path).startsWith('adr-')) continue;
    try {
      if (adrApprovalStatus(await readFile(path, 'utf-8')).approved) return true;
    } catch {
      // An unreadable ADR is not approved input for this judgement.
    }
  }
  return false;
}

/**
 * Resolve the independently applicable checks for the as-built review.
 *
 * Reachability and plan-gap cover every tier. ADR and diagram checks are only
 * meaningful when their corresponding approved artifact corpus is present.
 * An explicit tier policy always takes precedence over artifact applicability.
 */
export async function resolveAsBuiltPolicy({
  projectRoot,
  tier = 'M',
  config,
}: ResolveAsBuiltPolicyInput): Promise<AsBuiltPolicy> {
  const [approvedAdrs, diagrams] = await Promise.all([
    hasApprovedAdrs(projectRoot),
    findArtifactFiles(projectRoot, 'architecture_diagram'),
  ]);
  const policy = {} as AsBuiltPolicy;

  for (const check of AS_BUILT_CHECKS) {
    const configReason = configuredTierReason(config, check, tier);
    if (configReason) {
      policy[check] = { enabled: false, reason: configReason };
      continue;
    }

    if (check === 'adrCompliance' && !approvedAdrs) {
      policy[check] = { enabled: false, reason: 'no approved ADRs' };
      continue;
    }
    if (check === 'diagramDrift' && diagrams.length === 0) {
      policy[check] = { enabled: false, reason: 'no diagrams' };
      continue;
    }

    policy[check] = {
      enabled: true,
      reason:
        check === 'adrCompliance'
          ? 'approved ADRs present'
          : check === 'diagramDrift'
            ? 'diagrams present'
            : 'all tiers',
    };
  }

  return policy;
}

/** Render the policy in the exact operational form the as-built reviewer receives. */
export function renderAsBuiltPolicyPrompt(policy: AsBuiltPolicy): string {
  return [
    'AS-BUILT CHECK POLICY:',
    'Apply each enabled check and do not infer obligations from checks marked off.',
    ...AS_BUILT_CHECKS.map((check) =>
      `- ${check}: ${policy[check].enabled ? 'on' : 'off'} — ${policy[check].reason}`,
    ),
  ].join('\n');
}
