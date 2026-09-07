import { join } from 'node:path';

import { resolveFeaturePlanPath } from './artifacts.js';
import { repairPlanIdentity } from './repair-obligations.js';
import { readState } from './state.js';

/**
 * The plan a repair obligation is scoped to, resolved the way the obligation
 * WRITER resolves it.
 *
 * Obligations are persisted with `planIdentity = repairPlanIdentity(root,
 * resolveFeaturePlanPath(root, feature_desc))` because `activePlanPath` is
 * written only by the interactive plan step: a daemon-dispatched,
 * spec-landed feature enters the pipeline at `build` with DECIDE pre-done and
 * therefore never records one. Readers that consulted `activePlanPath` alone
 * saw `null`, treated a worktree full of open obligations as "no repair
 * state", and let the legacy `Task:` trailer union re-close exactly the task
 * the repair had re-staged (#1831, #2261).
 *
 * `resolveFeaturePlanPath` already IS the full ladder — engine-recorded path
 * first, then the slug-scoped convention — so this helper is the single place
 * that turns it into the identity obligations are keyed by. Do not re-derive
 * either half at a call site.
 */
export type RepairPlanBinding =
  | { readonly kind: 'bound'; readonly identity: string }
  | { readonly kind: 'unbound'; readonly reason: string };

export async function resolveRepairPlanBinding(projectRoot: string): Promise<RepairPlanBinding> {
  const state = await readState(join(projectRoot, '.pipeline', 'conduct-state.json'));
  const featureDesc = state.ok ? state.value.feature_desc : undefined;
  const planPath = await resolveFeaturePlanPath(projectRoot, featureDesc);
  if (!planPath) {
    return {
      kind: 'unbound',
      reason:
        'no active plan could be resolved (engine-state.json records no activePlanPath and ' +
        'the plan corpus is empty or ambiguous for this feature)',
    };
  }
  return { kind: 'bound', identity: repairPlanIdentity(projectRoot, planPath) };
}
