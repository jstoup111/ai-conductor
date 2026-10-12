import { BUILT_IN_PROVIDERS } from '../execution/provider-catalog.js';
import type { HarnessConfig } from '../types/config.js';
import type { PlanReviewIndependence } from './plan-review-artifact.js';

export type AuthoringHost = string | 'unknown';

/** Resolve the host that authored the DECIDE artifacts without guessing. */
export function resolveAuthoringHost(env: NodeJS.ProcessEnv = process.env): AuthoringHost {
  if (env.AI_CONDUCTOR_AUTHORING_PROVIDER) return env.AI_CONDUCTOR_AUTHORING_PROVIDER;
  const marker = BUILT_IN_PROVIDERS.find((provider) =>
    'interactiveLaunch' in provider && provider.interactiveLaunch.sessionMarkers.some((key) => Boolean(env[key])),
  );
  return marker?.id ?? 'unknown';
}

export function orderReviewerCandidates(input: { config: HarnessConfig; host: AuthoringHost; configuredProviders?: readonly string[] }): string[] {
  const configured = [...(input.configuredProviders ?? input.config.llm_provider ?? [])];
  const preferred = input.config.steps?.plan_review?.llm_provider;
  const preference = Array.isArray(preferred) ? preferred[0] : preferred;
  const ordered = preference && configured.includes(preference)
    ? [preference, ...configured.filter((provider) => provider !== preference)]
    : configured;
  return input.host === 'unknown' ? ordered : [...ordered.filter((provider) => provider !== input.host), ...ordered.filter((provider) => provider === input.host)];
}

export function classifyIndependence(host: AuthoringHost, reviewer: string): PlanReviewIndependence {
  return host === 'unknown' ? 'unknown-host' : host === reviewer ? 'same-provider' : 'cross-provider';
}
