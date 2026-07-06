// ─────────────────────────────────────────────────────────────────────────────
// Background Auto-Intake on the Conduct Loop — types only (Task 1).
//
// Plan: .docs/plans/2026-06-30-background-intake-conduct-loop.md (Task 1)
// Stories: .docs/stories/background-intake-conduct-loop.md (FR-1, FR-10)
//
// `IntakeLoopDeps` are the effects injected into the (not-yet-implemented)
// pure-core `runIntakeLoop(deps, opts)` / `intakeTick(deps)` — poll, enqueue,
// notify, sleep, clock, and log — so the loop can be unit-tested with zero
// real I/O. `IntakeLoopOptions` configures the interval scheduler.
//
// This module intentionally contains no implementation logic yet: no network
// calls, no persistence, no scheduling. Types only.
// ─────────────────────────────────────────────────────────────────────────────

/** Effects injected into the intake loop's tick/scheduler. */
export interface IntakeLoopDeps {
  /** Polls all registered repos for newly captured envelopes this tick. */
  poll: () => Promise<unknown[]>;
  /** Enqueues a single captured envelope (ledger-deduped upstream). */
  enqueue: (envelope: unknown) => Promise<void>;
  /** Notifies the operator (status surface + best-effort push) of newly captured ideas. */
  notify: (ideas: unknown[]) => Promise<void>;
  /** Delays the loop between ticks by the given number of milliseconds. */
  sleep: (ms: number) => Promise<void>;
  /** Returns the current time (injected clock, for deterministic tests). */
  now: () => Date;
  /** Emits a diagnostic log line. */
  log: (msg: string) => void;
}

/** Configuration for the intake loop's interval scheduler. */
export interface IntakeLoopOptions {
  /** Delay between ticks, in milliseconds. */
  intervalMs: number;
  /** When true, run exactly one tick and return instead of looping forever. */
  once?: boolean;
  /** Maximum number of consecutive idle (zero-capture) polls before... (reserved for later tasks). */
  maxIdlePolls?: number;
}

/** Summary of a single intake tick's outcome (Task 2). */
export interface IntakeTickSummary {
  /** Number of envelopes captured (polled and enqueued) this tick. */
  captured: number;
}

/**
 * intakeTick — a single tick of the intake loop (Task 2).
 *
 * Polls all registered repos via the injected `poll()`, enqueues every
 * returned envelope via the injected `enqueue()`, and returns a tick
 * summary `{ captured: <count> }`. Pure orchestration over injected effects:
 * no real I/O, no claude/provider capability.
 */
export async function intakeTick(deps: IntakeLoopDeps): Promise<IntakeTickSummary> {
  const envelopes = await deps.poll();
  for (const envelope of envelopes) {
    await deps.enqueue(envelope);
  }
  return { captured: envelopes.length };
}
