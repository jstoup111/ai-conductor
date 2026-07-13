/**
 * Pure progress/escalation helpers for the kickback-to-build no-op loop.
 *
 * These functions have no I/O and no hidden state — identical inputs always
 * produce identical outputs. Callers (the daemon loop) are responsible for
 * gathering the head/resolved-count/verdict inputs from disk and persisting
 * the result; this module only classifies and decides.
 */

/** Whether a build step actually moved anything. */
export type BuildProgress = 'did-work' | 'no-work';

export interface ClassifyBuildProgressInput {
  /** HEAD sha before the build step ran, or null if unknown. */
  headBefore: string | null;
  /** HEAD sha after the build step ran, or null if unknown. */
  headAfter: string | null;
  /** Count of resolved items (e.g. resolved review comments/blockers) before. */
  resolvedBefore: number;
  /** Count of resolved items after. */
  resolvedAfter: number;
}

/**
 * Classifies whether a build step did real work.
 *
 * `'no-work'` is returned when both `headBefore` and `headAfter` are `null`.
 * A null head means we couldn't observe the repo state at all (not that it
 * didn't move) — but treating unknown as "did work" would let a kickback
 * loop spin forever without ever escalating, so unknown is deliberately
 * folded into the conservative ('no-work') branch: it only suppresses a
 * halt-worthy escalation, never hides real progress (a truthful head change
 * always wins via the strict inequality check below).
 */
export function classifyBuildProgress(input: ClassifyBuildProgressInput): BuildProgress {
  const { headBefore, headAfter, resolvedBefore, resolvedAfter } = input;

  if (headAfter !== headBefore) return 'did-work';
  if (resolvedAfter > resolvedBefore) return 'did-work';
  return 'no-work';
}

export interface ShouldEscalateKickbackInput {
  progress: BuildProgress;
  /** The gate verdict prior to this build/kickback cycle. */
  priorVerdict: boolean;
  /** The gate verdict after this build/kickback cycle. */
  nextVerdict: boolean;
  /** Whether kickback-escalation is enabled at all. */
  enabled: boolean;
}

export interface ShouldEscalateKickbackResult {
  halt: boolean;
  /** Present only when halt is true — names the unchanged input(s). */
  reason?: string;
}

/**
 * Decides whether a no-op kickback-to-build cycle should escalate to a halt.
 *
 * Halts only when the build produced no observable progress (no head or
 * resolved-count movement) AND the gate verdict is unchanged AND escalation
 * is enabled — i.e. the loop is provably spinning without making progress.
 */
export function shouldEscalateKickback(
  input: ShouldEscalateKickbackInput,
): ShouldEscalateKickbackResult {
  const { progress, priorVerdict, nextVerdict, enabled } = input;

  if (!enabled) return { halt: false };
  if (progress === 'did-work') return { halt: false };
  if (priorVerdict !== nextVerdict) return { halt: false };

  return {
    halt: true,
    reason:
      'build produced no head or resolved-count movement and the gate verdict is unchanged',
  };
}
