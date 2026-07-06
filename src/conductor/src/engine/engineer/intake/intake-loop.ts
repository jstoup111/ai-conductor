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

import type { Envelope } from './port.js';

/** Effects injected into the intake loop's tick/scheduler. */
export interface IntakeLoopDeps {
  /** Polls all registered repos for newly captured envelopes this tick. */
  poll: () => Promise<Envelope[]>;
  /** Enqueues a single captured envelope (ledger-deduped upstream). */
  enqueue: (envelope: Envelope) => Promise<void>;
  /** Notifies the operator (status surface + best-effort push) of newly captured ideas. */
  notify: (ideas: Envelope[]) => Promise<void>;
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
 * enrichOrigin — attaches origin-routing hints to a captured envelope
 * (Task 7).
 *
 * When an envelope carries a `hintRepo` (set by the GitHub adapter, per the
 * ADR), this maps it to an explicit `target` (the proposed routing
 * destination — the origin repo) and a `sourceRef` (the full source
 * reference, e.g. `owner/X#7`) so the `claim` phase can auto-route later
 * (ADR-008) without recomputing this from the raw source. Envelopes without
 * a `hintRepo` pass through unchanged — this enrichment is additive only.
 *
 * When an envelope has no resolvable `hintRepo` (Task 8), origin routing
 * cannot map it to an explicit `target`. Rather than drop it — losing a
 * captured idea because routing metadata is missing would be worse than
 * surfacing it for manual triage — this preserves the envelope's raw
 * `sourceRef` unchanged and logs an origin-unresolved warning via the
 * injected `log` so the tick still enqueues it for later manual routing.
 */
function enrichOrigin(envelope: Envelope, log: (msg: string) => void): Envelope {
  if (typeof envelope.hintRepo === 'string') {
    const hintRepo = envelope.hintRepo;
    const { id, sourceRef: existingSourceRef } = envelope;
    const sourceRef =
      typeof existingSourceRef === 'string' && existingSourceRef.includes('#')
        ? existingSourceRef
        : id.includes('#')
          ? id
          : `${hintRepo}#${id}`;
    return { ...envelope, target: hintRepo, sourceRef };
  }

  log(
    `intake tick: origin-unresolved (no hintRepo) for envelope with sourceRef=${envelope.sourceRef}; enqueuing as-is for manual routing`,
  );
  return envelope;
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
  let envelopes: Envelope[];
  try {
    envelopes = await deps.poll();
  } catch (err) {
    // The adapter already isolates per-repo failures (FR-27/ADR-012); this
    // catch is a defensive backstop so an unexpected poll() rejection never
    // crashes the tick or the loop. Log and treat this tick as zero-capture.
    deps.log(`intake tick: poll() failed: ${err instanceof Error ? err.message : String(err)}`);
    return { captured: 0 };
  }
  const captured: Envelope[] = [];
  for (const rawEnvelope of envelopes) {
    const envelope = enrichOrigin(rawEnvelope, deps.log);
    try {
      await deps.enqueue(envelope);
      captured.push(envelope);
    } catch (err) {
      // Per-repo isolation backstop (FR-7/FR-27, ADR-012): a single envelope's
      // enqueue failure must not abort the tick or drop the other repos'
      // captures — log it and keep going.
      deps.log(`intake tick: enqueue() failed for an envelope: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (captured.length > 0) {
    try {
      await deps.notify(captured);
    } catch (err) {
      // Non-fatal notification backstop (FR-5/FR-12): a notify() failure must
      // not prevent captures from being persisted or crash the tick — log it
      // and proceed.
      deps.log(`notify failed (non-fatal, tick continues): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { captured: captured.length };
}

/**
 * runIntakeLoop — the intake loop's main entry point (Task 4).
 *
 * Poll-sleep loop: calls `intakeTick(deps)` on each iteration, then sleeps
 * for `opts.intervalMs` via the injected `deps.sleep()` before the next
 * iteration. When `opts.once` is true, runs exactly one tick and returns
 * without sleeping. Otherwise loops continuously (until `deps.sleep()`
 * rejects/throws, which is how tests — and, in production, shutdown
 * signals — terminate the loop).
 */
export async function runIntakeLoop(deps: IntakeLoopDeps, opts: IntakeLoopOptions): Promise<void> {
  for (;;) {
    try {
      await intakeTick(deps);
    } catch (err) {
      // Whole-tick failure backstop (Task 6): intakeTick() already isolates
      // per-repo poll/enqueue failures internally, but an unexpected failure
      // elsewhere in the tick (e.g. notify()) must not crash the loop. Log it
      // and proceed to the next sleep/tick cycle.
      deps.log(`intake loop: tick failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (opts.once === true) {
      return;
    }
    await deps.sleep(opts.intervalMs);
  }
}
