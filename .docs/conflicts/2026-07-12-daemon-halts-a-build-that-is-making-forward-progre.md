# Conflict Check: Progress-aware build halt (#280)

**Date:** 2026-07-12 · **Tier:** M

Checked the spec against adjacent work touching the build retry loop, the daemon re-kick/wake
machinery, and the task-progress primitive.

## Findings

### C1 — `retry-as-escalation` (ADR APPROVED, plan on main, NOT yet implemented) — OVERLAP, reconcilable
`adr-2026-07-05-retry-as-escalation-ladder.md` + `.docs/plans/retry-as-escalation.md` define an
attempt-indexed capability ladder (`escalateAttempt`, `EFFORT_ORDER`, `MODEL_TIER_ORDER`) and
explicitly **"shrink the now-wasteful deep budgets"** (`DEFAULT_STEP_RETRIES`, including `build`).
Verified these symbols do **not** exist in the current code — that spec is landed but unbuilt.

Both specs edit the **same** region: the build retry loop's attempt counter and per-attempt config
(`conductor.ts` ~1638–2436). They agree on the premise — a fixed count of *identical* retries is the
wrong lever — and are **synergistic**, not contradictory:
- retry-as-escalation: identical retries are coin-flips → cut the budget, raise capability per attempt.
- this spec: a **progress** retry is not a coin-flip (it resolves real tasks) → don't count it against
  the halt budget.

**Reconciliation (merge-order):** these are orthogonal transforms on one loop.
- If retry-as-escalation builds first: this spec layers "progress retries bypass the (now smaller)
  budget, bounded by `attempt_ceiling`" on top of the escalation ladder; `attempt_ceiling` must be
  validated against the escalation-reduced `max_retries`, not the old default.
- If this spec builds first: retry-as-escalation must preserve the progress-bypass branch when it
  shrinks the budget (a cut budget is fine precisely because progress retries no longer terminate on it).
- **Plan carries this as an explicit merge-order note; standard spec-branch rebase on origin/main
  applies.** No code contradiction — the two settle by rebase + the reconciliation rule above.

### C2 — `event-driven-wake` (#329, MERGED, issue #111) — SHARED MACHINERY, integrate not duplicate
Merged event-driven unpark watches for the operator **clearing** the `.pipeline/HALT` marker
(`watchHaltCleared` chokidar seam + Waker latch racing the idle sleep) and re-dispatches. This spec's
cross-dispatch **progress-gated re-kick** (D2) is a different trigger (automatic, on last-dispatch
forward progress, no operator action) but touches the **same** daemon idle-loop / Waker / re-dispatch
path and the same `started`/`parked`/`isParked`/`isHalted` double-dispatch guards.

**Reconciliation:** D2 must reuse the existing idle-loop + guards (S6 asserts no double-dispatch); it
must NOT add a parallel wake path. Complementary triggers on shared infrastructure — no contradiction.

### C3 — `emit-intra-step-build-progress-and-stall-as-events` (#347, unbuilt spec) — READ-ONLY SHARED PRIMITIVE, no conflict
Its `build-progress-watcher` reads `task-status.json` via `task-progress.ts` (`countFromParsed`)
**read-only** for observability and explicitly never modifies the breaker/decision logic. This spec
changes the decision using the same primitive. No shared mutable state → independent. Opportunity:
this spec may reuse `countFromParsed` rather than re-parsing.

### C4 — `daemon-auto-park` / durable `noEvidenceAttempts` — SAME SUBSYSTEM, extension not conflict
This spec extends the existing zero-progress park path (`checkAndAutoPark`, durable
`noEvidenceAttempts`): the zero-progress threshold and behavior are unchanged (S3); only positive-
progress attempts are prevented from reaching budget-exhaustion `failed`. No contradiction.

## Verdict
**No blocking conflicts.** One overlap (C1) and one shared-machinery integration (C2) are carried
into the plan as explicit merge-order / integration notes. Clean to proceed to `/plan`.
