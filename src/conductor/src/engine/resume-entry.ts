import type { ConductState, StepDefinition, StepGroup, StepName, StepStatus, Track } from '../types/index.js';
import type { HarnessConfig } from '../types/config.js';
import { checkGate } from './gates.js';
import {
  makeNoVerdictOutcome,
  makeSkippedOutcome,
  makeVerdictOutcome,
  type GroupMember,
} from './group-core.js';
import { type NavigableStep } from './conductor-options.js';
import { resolveStepConfig } from './resolved-config.js';
import type { ProviderModelPolicy } from './provider-model-policy.js';
import {
  ALL_STEPS,
  getStepDefinition,
  shouldSkipForBootstrapMode,
  shouldSkipForUpstreamSkip,
} from './steps.js';
import { getStepStatus, markDownstreamStale, stepSatisfied } from './state.js';

// Gate topology — DERIVED from the resolved step registry, not hardcoded, so
// custom config steps (and reordering) participate in the gate loop:
//   - loopGate steps     → the selector-driven tail (build…finish by default)
//   - kickbackTarget steps → upstream gates a downstream step may re-open
//   - verdictSteps        → either of the above (verdict recomputed after run)
//   - firstLoopIndex      → the front/loop boundary (first loopGate step)
//   - regionStart         → where the selector starts scanning (first kickback target)
export interface GateTopology {
  verdictSteps: Set<StepName>;
  kickbackTargets: StepName[];
  firstLoopIndex: number;
  regionStart: StepName;
}

export function deriveGateTopology(steps: StepDefinition[]): GateTopology {
  const verdictSteps = new Set<StepName>();
  const kickbackTargets: StepName[] = [];
  let firstLoopIndex = steps.length;
  steps.forEach((s, i) => {
    if (s.loopGate) {
      verdictSteps.add(s.name);
      if (i < firstLoopIndex) firstLoopIndex = i;
    }
    if (s.kickbackTarget) {
      verdictSteps.add(s.name);
      kickbackTargets.push(s.name);
    }
  });
  const regionStart =
    kickbackTargets[0] ??
    steps.find((s) => s.phase === 'DECIDE')?.name ??
    steps[0]?.name;
  return { verdictSteps, kickbackTargets, firstLoopIndex, regionStart };
}

export function navigateBack(
  state: ConductState,
  target: StepName,
  steps: StepDefinition[] = ALL_STEPS,
  preserve: readonly StepName[] = [],
): { state: ConductState; index: number } {
  const allStepNames = steps.map((s) => s.name);
  const updated = markDownstreamStale(state, target, allStepNames, preserve);
  (updated as Record<string, unknown>)[target] = 'pending';
  const index = steps.findIndex((s) => s.name === target);
  return { state: updated, index };
}

export function getNavigableSteps(
  state: ConductState,
  steps: StepDefinition[] = ALL_STEPS,
): NavigableStep[] {
  return steps
    .filter((step) => {
      const status = state[step.name];
      return status === 'done' || status === 'stale';
    })
    .map((step) => ({
      name: step.name,
      label: step.label,
      status: state[step.name] as StepStatus,
      phase: step.phase,
    }));
}

/**
 * Pure helper (no side effects): resolves the "last step" that a run reached,
 * for use by the finally backstop's diagnostic HALT message so it never
 * surfaces the literal 'unknown' to operators. Preference order:
 *   1. state.last_step, if recorded
 *   2. breadcrumb.lastAdvancedStep, if the run tracked one
 *   3. the furthest-progressed 'done' step per canonical ALL_STEPS order
 *   4. the literal 'no step recorded' as a last resort
 */
export function resolveLastStep(
  state: Record<string, unknown> & { last_step?: string },
  breadcrumb: { lastAdvancedStep?: string },
): string {
  if (state?.last_step) return state.last_step;
  if (breadcrumb?.lastAdvancedStep) return breadcrumb.lastAdvancedStep;

  let furthestIndex = -1;
  let furthestStep: string | undefined;
  for (let i = 0; i < ALL_STEPS.length; i++) {
    const name = ALL_STEPS[i].name;
    if (state?.[name] === 'done' && i > furthestIndex) {
      furthestIndex = i;
      furthestStep = name;
    }
  }
  if (furthestStep) return furthestStep;

  return 'no step recorded';
}

/**
 * Calculate the index in steps where resume should start, based on the current state.
 * Used for parity testing and direct resume-index calculation without gate verdict clamping.
 * Returns the index of the first pending step after the last done step, or 0 if feature is complete.
 */
export function findResumeIndex(
  state: ConductState,
  steps: StepDefinition[] = ALL_STEPS,
): number {
  // If feature is already complete, treat as new feature (start from 0)
  if (state.feature_status === 'complete') {
    return 0;
  }

  // First, look for an in_progress step
  for (let i = 0; i < steps.length; i++) {
    if (getStepStatus(state, steps[i].name) === 'in_progress') {
      return i;
    }
  }

  // Otherwise, find the first pending step after the last done step
  let lastDoneIndex = -1;
  for (let i = 0; i < steps.length; i++) {
    if (getStepStatus(state, steps[i].name) === 'done') {
      lastDoneIndex = i;
    }
  }

  return lastDoneIndex + 1;
}

/**
 * Walk a candidate resume index BACKWARD to the earliest step the gate loop
 * will actually admit.
 *
 * The verdict-aware resume clamp picks the earliest gate whose VERDICT is
 * unsatisfied, but the loop admits a step only when `checkGate` — which reads
 * STATE, not verdicts — passes. Those two predicates can disagree: a step whose
 * verdict says satisfied but whose state is `failed` is skipped by the clamp
 * and then rejected as an unsatisfied prerequisite by `checkGate`, so the loop
 * exits immediately through the markerless `gate_blocked` return (#1052).
 *
 * Given a candidate index, repeatedly replace it with the index of its earliest
 * unsatisfied prerequisite until `checkGate` passes. Movement is strictly
 * backward and bounded by `steps.length`, so this always terminates — even for
 * a malformed registry with a prerequisite cycle. Returns the candidate
 * unchanged when its gate already passes (the overwhelmingly common case) or
 * when no earlier prerequisite can be resolved.
 */
export function clampToRunnablePrerequisite(
  steps: StepDefinition[],
  state: ConductState,
  candidate: number,
): number {
  let idx = candidate;
  for (let guard = 0; guard < steps.length; guard++) {
    const step = steps[idx];
    if (!step) return idx;
    const gate = checkGate(step, state);
    if (gate.passed) return idx;

    const earliest = earliestResolvablePrerequisiteIndex(steps, state, step, idx);
    if (earliest === -1) return idx;
    idx = earliest;
  }
  return idx;
}

/**
 * Find the earliest unsatisfied prerequisite that can be reached by moving
 * backward from `beforeIndex`. Prerequisites absent from the resolved registry
 * or at/after the bound cannot be resolved by that movement.
 */
export function earliestResolvablePrerequisiteIndex(
  steps: StepDefinition[],
  state: ConductState,
  step: StepDefinition,
  beforeIndex: number,
  include: (prerequisite: StepName) => boolean = () => true,
): number {
  let earliest = -1;
  for (const prereq of step.prerequisites) {
    if (stepSatisfied(state, prereq)) continue;
    if (!include(prereq)) continue;
    const prereqIdx = steps.findIndex((candidate) => candidate.name === prereq);
    if (prereqIdx < 0 || prereqIdx >= beforeIndex) continue;
    if (earliest === -1 || prereqIdx < earliest) earliest = prereqIdx;
  }
  return earliest;
}

/**
 * Reconcile a resume candidate with the same state-only entry gate the main
 * loop will check before dispatching it. The backward walk is bounded and
 * does not mutate state. If a malformed resolved step list leaves the gate
 * refused, the loop's existing gate-refusal path owns that terminal outcome.
 */
export function resolveRunnableResumeEntry(
  steps: StepDefinition[],
  state: ConductState,
  candidate: number,
): number {
  return clampToRunnablePrerequisite(steps, state, candidate);
}

/**
 * Resolve which members of a built-in concurrent group (e.g.
 * `VALIDATION_GROUP`) are actually dispatchable, reusing the SAME per-step
 * skip predicates the pre-existing serial walk already applies
 * (tier/track/upstream-skip/config-disable) rather than reinventing skip
 * logic for the group. A member that would skip under the serial walk gets
 * a `SkippedOutcome` here too — never silently omitted, and never a
 * `VerdictOutcome`/`NoVerdictOutcome` that could fail the group.
 *
 * When every member skips, `allSkipped` is true and `dispatchable` is
 * empty — the caller marks the group itself skipped and dispatches nothing,
 * rather than dispatching a group of zero branches.
 */
export function resolveGroupMembership(
  group: StepGroup,
  state: ConductState,
  track: Track,
  modelPolicy: ProviderModelPolicy,
  config?: HarnessConfig,
  reverifyDoneMembers = false,
): { members: GroupMember[]; dispatchable: GroupMember[]; allSkipped: boolean } {
  const tier = state.complexity_tier ?? 'L';
  const members: GroupMember[] = group.members.map((name) => {
    const stepDef = getStepDefinition(name);
    const resolved = resolveStepConfig(
      stepDef.name,
      stepDef.phase,
      modelPolicy,
      config,
      { tier: state.complexity_tier },
    );
    const skip =
      getStepStatus(state, name) === 'skipped' ||
      stepDef.skippableForTiers.includes(tier) ||
      (stepDef.skippableForTracks ?? []).includes(track) ||
      shouldSkipForUpstreamSkip(stepDef, state) ||
      shouldSkipForBootstrapMode(stepDef.name, state.bootstrap_mode) ||
      resolved.disabled;
    // Task 27: resume-awareness — a member already marked 'done' in state
    // (e.g. persisted mid-group, when a SIGINT landed after this member
    // settled but before its siblings/the join did) is already satisfied.
    // A BUILD repair invalidates the prior verification round. Its next
    // group join is the only satisfaction authority, so every non-skipped
    // member must dispatch rather than reuse a prior state/verdict.
    const alreadyDone =
      !skip &&
      !reverifyDoneMembers &&
      getStepStatus(state, name) === 'done';
    return {
      name,
      skill: stepDef.skillName ?? '',
      outcome: skip
        ? makeSkippedOutcome()
        : alreadyDone
          ? makeVerdictOutcome('pass')
          : makeNoVerdictOutcome('not-run'),
    };
  });
  const dispatchable = members.filter(
    (m) => m.outcome.kind === 'no-verdict' && m.outcome.reason === 'not-run',
  );
  return { members, dispatchable, allSkipped: dispatchable.length === 0 };
}
