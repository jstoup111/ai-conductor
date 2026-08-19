# Architecture Review: the invalidator refunds build_review convergence laps

**Date:** 2026-08-18
**Status:** APPROVED WITH CONDITIONS
**Feature:** jstoup111/ai-conductor#1694
**Reviews:** `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence.md`
**Sweep:** all 490 files in `.docs/decisions/` enumerated; every ADR bearing on the kickback ledger,
the `build_review` FAIL block, the post-rebase invalidation path, the event union and its sinks, and
halt classification read in full. Base `9b5ae42cc`.

## Verdict

Architecturally sound, and materially better than the design that entered review. Two of the
intake's constructs were withdrawn — a second counter and a re-calibrated cap — and the surviving
change is the smallest one that reaches the stated outcomes: it deletes an over-broad trigger and
re-keys the exemption onto the occurrence that justifies it. Approval is conditional on the five
mechanical conditions in §4.

The design's central claim is measured, not assumed, and the measurement is what selected it.

## 1. What review changed, in order

**Reversal 1 — the shape (withdrawn on scope).** The intake proposed a never-resetting floor beside
`cumulative`. Review found it answers the *same* question as `cumulative` with a different reset
rule, unlike `adr-2026-08-12`'s original layering where `count` and `cumulative` answer genuinely
different questions. It also owes a third unevidenced threshold and must answer
`adr-2026-08-05-build-settle-outcome-stamp`'s "a counter change cannot make the first repeat free".
Withdrawn.

**Reversal 2 — the lifetime cap (falsified by measurement, operator-rejected).** The next design
deleted the PASS reset and re-read `cumulative` as a lifetime bound. Replaying the 15-feature corpus:
at cap 5 it fires on 7 features, all of which eventually shipped; at cap 8 it fires on 4, but only
after roughly nine laps of spend. That reproduces the "late and largely unreachable" failure
`adr-2026-08-17` documents for the existing cap. The operator rejected it on that evidence.

**Reversal 3 — the event carrier (corrected on a sweep finding).** The design first carried the
refund on `rebase_gate_invalidated`, which is semantically the closest event. The sweep established
that it is emitted from `runRebaseStep` via `emitGateInvalidationEvents` (`conductor.ts:9587`) — a
different function at a different time from the refund — and that `adr-2026-07-20`'s fail-closed
fallback re-opens gates without producing it. A refund carried there would be missing exactly when
the fallback fires. Moved to the co-located `kickback` emission.

## 2. The measurement that decided it

The live risk was that the refund's condition is as broad as the reset it replaces.
`adr-2026-07-20-post-rebase-delta-aware-invalidation` preserves `build_review` **iff the rebase delta
is empty**, so every file-changing rebase invalidates it — a plausibly frequent event.

Counted over the same 15-feature corpus: rebase-origin invalidations of `build_review`
(`kickback` records with `from: 'rebase'`, `to: 'build_review'`) occur **once**, against 95
`build_review` kickbacks.

So D2's protected case is real but rare, and the replacement trigger is roughly two orders of
magnitude narrower than the PASS reset. Confidence 90%, basis: verified over the persisted ledgers;
the residual is corpus completeness (reaped worktrees are absent, and `.pipeline/` is gitignored —
the #497 class).

Had this number come back large, the correct verdict was to reject the design rather than tune it.
It is recorded here because it is the fact the approval rests on.

## 3. Constraints checked against the sweep

| Constraint | Source | Status |
|---|---|---|
| The preserve/invalidate partition is that ADR's to own | `adr-2026-07-20` | Read, never modified — the refund inherits the existing loop's condition rather than re-deriving it |
| Fail-closed fallback invalidates everything when the delta cannot be computed | `adr-2026-07-20` | Refund fires there too; fail-open for the budget, the correct direction |
| No on-disk verdict/status/timestamp is sole authority | `adr-2026-08-03` | Satisfied — the decision is taken at the site that holds it, not re-derived from a verdict file |
| A new union member obliges an `EVENT_SINKS` declaration | `adr-2026-07-26` | Avoided — additive optional field on an existing member, the shape `adr-2026-08-12` D5 and `adr-2026-08-17` D8 already set |
| A durable counter is exception-C legal only if the occurrence is emitted | event-spine skill, `adr-2026-08-12` D5 | Satisfied by D3 |
| A counter change cannot make the first repeat free | `adr-2026-08-05` | Not engaged — this ADR adds no counter; it removes a clear |
| A new halt writer must be `needs-human` unless retry safety is mechanically provable | `adr-2026-07-28` | Not engaged — no new halt path; the existing cap halt is reached more often, unchanged in class |
| `count`'s fail-open per-tree reset is deliberate | `adr-2026-07-26` | Untouched |
| Reasons are grader prose and never byte-stable | `adr-2026-07-26` D3 | Not engaged — nothing in this change reads reason text |

## 4. Conditions of approval

1. **The refund's condition is inherited, not copied.** It must key on the same verdict predicate the
   re-open loop already uses (`satisfied === false && kickback.from === 'rebase'`), so the refunded
   set and the invalidated set cannot drift. A re-implementation of `adr-2026-07-20`'s partition at
   this site is a rejection.
2. **One-shot per invalidation.** The credit is applied where the gate is re-opened and never
   re-evaluated on a later lap. A test must fail if a single rebase credits twice.
3. **`build_review` only.** No other gate's ledger entry is written by this path.
4. **Field-shaped emission, one-to-one with the credit.** No new `ConductorEvent` member, no
   `refundedAt`-style stamp in the ledger or any artifact — that is the event-spine corollary
   violation, not the cheap option.
5. **Forward-compatible with `adr-2026-08-17`.** The clear and the credit must operate on whichever
   convergence fields the entry carries, so the change is correct both before and after
   `rubricFailures` is implemented. Conflict-check adjudicates the landing order.

## 5. Residual risk

The corpus is 15 features from one machine and cannot see reaped worktrees, so both headline numbers
(95 kickbacks, 1 rebase invalidation) are lower bounds on the true population and the *ratio* is the
load-bearing quantity rather than either count. If rebase-origin invalidation of `build_review` is
materially more common in populations not represented here, the refund's trigger widens toward the
PASS reset it replaces and the fix degrades toward today's behavior — it does not become incorrect,
it becomes ineffective. The observable signal is the refund field on the `kickback` event, which is
why D3 is not optional scope.

Second, this change makes `adr-2026-08-12`'s cap 5 reachable as designed for the first time. That cap
carries 70% confidence by its own account. If operators routinely clear cumulative-cap halts after
this lands, the correct response is to revisit the cap — a separate question with its own evidence —
not to restore the reset.
