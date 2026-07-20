/**
 * Retry-as-escalation ladder (issue #188, adr-2026-07-05-retry-as-escalation-ladder).
 *
 * A pure, attempt-indexed transform on a step's base (model, effort). The base
 * config from `resolveStepConfig` is never mutated — escalation is recomputed
 * each attempt from the 1-based `attempt` number, so non-budget-consuming retry
 * paths (`attempt--; continue`) neither advance nor stall the ladder.
 *
 * Two orthogonal ladders:
 *   - EFFORT_ORDER  — ascending reasoning effort; bumped first (attempt 2).
 *   - MODEL_TIER_ORDER — ascending capability; bumped after (attempt 3+).
 *
 * The model bump expresses *intent* only. Liveness is guaranteed elsewhere: the
 * StepRunner routes the chosen model through `ModelAvailability.effectiveModel`
 * (issue #186), which substitutes a live model if the target tier is dead. This
 * module never calls the availability API itself.
 */

import type { EffortLevel } from '../types/config.js';

/** Ascending reasoning-effort ladder. Escalation bumps up, capped at `max`. */
export const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/**
 * Ascending model-capability ladder used for *upgrade-on-retry*. Deliberately
 * distinct from `model-availability.ts`'s DEFAULT_MODEL_FALLBACK_LADDER, which
 * descends for *substitute-on-dead*. Opposite direction, different purpose.
 */
export const MODEL_TIER_ORDER = ['haiku', 'sonnet', 'opus', 'fable'] as const;

/** The (model, effort) an attempt will dispatch at. */
export interface EscalatedAttempt {
  model: string;
  effort: EffortLevel;
}

/**
 * Bump an effort level `steps` rungs up EFFORT_ORDER, clamped to the top
 * (`max`). An effort already at the top is a no-op (S6). An effort not present
 * in EFFORT_ORDER is returned unchanged (defensive). `steps <= 0` is a no-op.
 */
export function bumpEffort(effort: EffortLevel, steps: number): EffortLevel {
  const idx = EFFORT_ORDER.indexOf(effort);
  if (idx === -1) return effort;
  const advance = steps > 0 ? steps : 0;
  const next = Math.min(idx + advance, EFFORT_ORDER.length - 1);
  return EFFORT_ORDER[next];
}

/**
 * Bump a model `steps` tiers up MODEL_TIER_ORDER, clamped to the top (`fable`).
 * A model already at the top tier is a no-op (S7). A base model not present in
 * MODEL_TIER_ORDER (e.g. a full model id) is returned unchanged (defensive).
 * `steps <= 0` is a no-op.
 */
export function bumpModel(model: string, steps: number): string {
  const idx = (MODEL_TIER_ORDER as readonly string[]).indexOf(model);
  if (idx === -1) return model;
  const advance = steps > 0 ? steps : 0;
  const next = Math.min(idx + advance, MODEL_TIER_ORDER.length - 1);
  return MODEL_TIER_ORDER[next];
}

/**
 * Escalation ladder as a pure function of the 1-based `attempt`.
 *
 *   escalate === false → base, unchanged (S5 opt-out).
 *   attempt <= 1       → base (first attempt is never escalated, S1 given).
 *   attempt === 2      → base model, effort bumped one level (S1).
 *   attempt >= 3       → model bumped (attempt − 2) tiers, effort held at the
 *                        attempt-2 level (one bump) (S2).
 *
 * Bumps are cumulative, monotonic, and capped at each ladder's top rung —
 * `escalateAttempt` never de-escalates and never throws (S6, S7).
 */
export function escalateAttempt(
  baseModel: string,
  baseEffort: EffortLevel,
  attempt: number,
  escalate: boolean,
): EscalatedAttempt {
  if (escalate === false || attempt <= 1) {
    return { model: baseModel, effort: baseEffort };
  }
  if (attempt === 2) {
    return { model: baseModel, effort: bumpEffort(baseEffort, 1) };
  }
  // attempt >= 3: effort stays at the attempt-2 rung; model climbs.
  return {
    model: bumpModel(baseModel, attempt - 2),
    effort: bumpEffort(baseEffort, 1),
  };
}
