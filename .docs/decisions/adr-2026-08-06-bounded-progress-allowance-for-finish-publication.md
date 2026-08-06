# ADR: A non-charging publication re-entry is bounded by its own allowance and a stuck-transition cap

**Date:** 2026-08-06
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer loop (#1342)

## Context

`adr-2026-08-06-publication-progress-is-its-own-disposition` routes a verified publication
advance back into FINISH without charging `stepMaxRetries`. Any re-entry that does not
charge a bounded counter needs a termination proof of its own, or the fix trades a spurious
HALT for an unbounded loop.

The observed run in #1342 (PR #1337) is the exact case that makes this non-trivial:
`establish_pr` advanced at try 2 AND again at try 4. That is not a defect — the
`write_shipped_record` transition commits, which leaves the branch unpushed again, so
`establish_pr` legitimately re-runs to publish it. A naive "each transition progresses at
most once" bound would halt a healthy run.

There is a direct precedent in the same retry loop. The build step's progress-bypass
(`adr-2026-07-12-progress-aware-build-halt`, implemented at `conductor.ts:4933-4936` and
`:6276-6303`) re-dispatches without charging the fixed budget, undoes the `attempt++`, and
is bounded by a separate `progressAttempts` counter checked against an `attempt_ceiling`.
Publication progress is the same shape of problem and should use the same shape of bound.

## Decision

Bound the non-charging re-entry with a single engine-level limit: a **total progress
allowance**. A counter of publication advances that bypassed the retry budget, checked
against a fixed ceiling set to twice the number of publication transitions (six transitions →
twelve). That admits a healthy five-to-six advance run plus legitimate revisits with margin,
and terminates well short of a loop regardless of which transitions repeat. The counter also
records the last transition seen, so the HALT reason names where the run stopped.

The counter is scoped to a single `finish` step execution — it resets when the step is
re-entered from outside, exactly as `progressAttempts` does.

**A per-transition stuck cap is deliberately NOT part of this decision.** It would halt a
repeating transition sooner and name it more precisely, but the allowance alone discharges
the termination obligation, and #1342's third outcome asks for a bounded halt naming the
stuck transition — which the allowance halt provides. A second counter is a diagnostic
refinement, recorded here as an available follow-up rather than built now.

The HALT class stays `needs-human`, matching the existing publication-exhaustion HALT.

## Consequences

- Termination is guaranteed: the allowance bounds the loop at twelve bypassed advances
  regardless of the machine's behavior.
- The healthy revisit observed in PR #1337 is permitted — two advances of an allowance of
  twelve.
- A stuck publication now halts with a strictly more useful message than today's generic
  "retry exhausted": it names the transition the run stopped on.
- A transition that repeats tightly burns the shared allowance rather than being caught by a
  dedicated cap, so it halts later than it could — up to twelve advances instead of four.
  Accepted: the delay is bounded, cheap (no provider dispatch except `judge_pr_prose`), and
  the halt still names the transition.
- The ceilings are constants rather than `settings.json` keys, so no configuration schema
  changes and the change carries no consumer migration surface. If a future publication
  machine grows past six transitions, the allowance must be revisited with it — the
  derivation (2× transition count) is recorded here so that is a visible obligation.
- Choosing constants over config means an operator cannot widen the allowance in the field.
  Accepted: the allowance is a correctness backstop, not a tuning knob, and a run that
  needs more than twelve verified advances is a defect to report, not to configure around.

## Alternatives rejected

- **No bound; rely on the machine always advancing.** Rejected outright — it is the failure
  mode #1342's third desired outcome names, and the state machine's own observation-driven
  design permits a transition to be re-selected.
- **A wall-clock timeout instead of a counter.** Rejected: non-deterministic, untestable
  without clock injection, and it would classify a slow-but-healthy provider judgment as a
  stall.
- **One shared counter (charge progress at a discounted rate).** Rejected: it reintroduces
  the conflation this change exists to remove — a long-but-healthy publication would still
  erode the transient budget.
