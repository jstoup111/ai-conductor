import type {
  ConductState,
  StepDefinition,
  StepName,
} from '../types/index.js';
import type { GateVerdict } from './gate-verdicts.js';
import { getStepStatus } from './state.js';
import { shouldSkipForBootstrapMode } from './steps.js';

/**
 * The gate-driven loop's next-step selector. Given the resolved step list,
 * current state, and gate verdicts, it returns the earliest unsatisfied gate
 * to run (or `done`). This replaces the linear `i++` walk for the looped
 * region: ordering and kickback routing fall out of "pick the earliest
 * unsatisfied gate".
 *
 * It is PURE and config-agnostic — it operates on whatever ordered `steps`
 * list it is given (e.g. `buildStepRegistry(config)`), so YAML custom steps
 * and skips flow through without the selector hardcoding anything.
 */
export interface SelectorInput {
  /** Resolved, ordered step list (config-derived; e.g. buildStepRegistry(config)). */
  steps: StepDefinition[];
  state: ConductState;
  verdicts: Partial<Record<StepName, GateVerdict>>;
  /**
   * The front edge of the looped region — the earliest step the loop may
   * select. Steps before it are owned by the linear front half. Set to the
   * earliest kickback target (`stories`) so an invalidated plan/stories routes
   * the loop backward; in normal operation those upstream gates are already
   * satisfied and the selector lands on `build`.
   */
  regionStart: StepName;
}

export type SelectorDecision =
  | { kind: 'run'; step: StepName; reason: string }
  | { kind: 'done'; reason: string };

/**
 * A gate is satisfied when its verdict says so (authoritative — covers a
 * recheck `true` and a kickback `false`). Absent a verdict, fall back to step
 * state: `done`/`skipped` count, but `stale` does NOT — a staled step needs to
 * re-run.
 */
export function gateSatisfied(
  step: StepName,
  state: ConductState,
  verdicts: Partial<Record<StepName, GateVerdict>>,
): boolean {
  // A staled step must re-run regardless of an old verdict — kickback's
  // markDownstreamStale relies on this to force downstream steps to re-run
  // even though their last verdict said satisfied.
  if (getStepStatus(state, step) === 'stale') return false;
  const v = verdicts[step];
  if (v) return v.satisfied;
  const status = getStepStatus(state, step);
  return status === 'done' || status === 'skipped';
}

/** True when a step is skipped by explicit state, complexity tier, or bootstrap mode. */
function isSkipped(step: StepDefinition, state: ConductState): boolean {
  if (getStepStatus(state, step.name) === 'skipped') return true;
  if (state.complexity_tier && step.skippableForTiers.includes(state.complexity_tier)) {
    return true;
  }
  if (shouldSkipForBootstrapMode(step.name, state.bootstrap_mode)) return true;
  return false;
}

/**
 * Pick the earliest unsatisfied, non-skipped gate at or after `regionStart`.
 * Returns `done` when every gate in the region is satisfied.
 */
export function selectNextGate(input: SelectorInput): SelectorDecision {
  const { steps, state, verdicts, regionStart } = input;
  const startIdx = steps.findIndex((s) => s.name === regionStart);
  if (startIdx === -1) {
    throw new Error(
      `selectNextGate: regionStart "${regionStart}" is not in the resolved step list`,
    );
  }

  for (let i = startIdx; i < steps.length; i++) {
    const step = steps[i];
    if (isSkipped(step, state)) continue;
    if (gateSatisfied(step.name, state, verdicts)) continue;

    const v = verdicts[step.name];
    const reason = v?.kickback
      ? `kickback from ${v.kickback.from}: ${v.kickback.evidence}`
      : (v?.reason ?? `${step.name} not yet satisfied`);
    return { kind: 'run', step: step.name, reason };
  }

  return { kind: 'done', reason: 'all gates in the looped region are satisfied' };
}
