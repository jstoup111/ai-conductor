# Track: One build_review PASS clears the convergence cap

Track: technical

Scope boundary: `build_review` only, operator-confirmed 2026-08-18. The change is to the **reset
semantics** of the existing convergence bounds — not a new counter, not a new cap, and not a
re-decision of any approved threshold. `MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW` (5,
`adr-2026-08-12` D3) and `MAX_RUBRIC_FAILURES_BUILD_REVIEW` (4, `adr-2026-08-17` D4) keep their
values and meanings.

Excluded: `prd_audit` and `manual_test`, which `adr-2026-08-12` D6 left for whichever issue produces
their evidence; the per-tree `count` bound and its reset rule (`adr-2026-07-26`); any rubric's
PASS/FAIL judgement, finding identity, or the disposition store; infrastructure-failure budget lanes
(#1629); and cap re-calibration of any kind.

## What the defect actually is

`resetKickbackGateCumulativeInLedger` is called at `conductor.ts:8521` on **every** `build_review`
step completion, not only in the case `adr-2026-08-12` D2 was written to protect. D2's stated reason
is narrow — "a feature that legitimately passes `build_review`, later has its verdict invalidated by
a rebase, and re-enters would carry stale laps toward a halt it did not earn" — but the implemented
reset is unconditional.

`build_review` is re-opened by far more than a rebase. Any BUILD repair invalidates the prior
verification round (`conductor.ts:9909`), so a kickback from `manual_test`, `prd_audit`, `simplify`,
or `finish` routes back through `build` and re-runs `build_review`. Each intervening PASS zeroes the
counter, so a feature that oscillates PASS → FAIL never accumulates toward any bound.

Measured over the 15 features with `build_review` kickback history in `.daemon/evals-raw`, the
cumulative cap fired on 4; the longest run reached 16 kickbacks without firing. Confidence 95%,
basis: verified — the call site above, `kickback-ledger.ts:180,203-215`, and the per-feature
`kickback`/`loop_halt` records.

## Why this is a reset fix and not another bound

Two lap-count-shaped alternatives were weighed and declined on measurement (below). The decisive
fact is that `adr-2026-08-17` already replaced lap count with a well-calibrated key: per-rubric
failures at threshold 4, separating 5 of 5 spinning features from 6 of 6 healthy ones on its corpus.
That bound trips early and is measured. Its D5 inherits the same PASS reset, and its own text parks
this question here: "Whether `cumulative` should also carry a never-reset floor is
`adr-2026-08-12`'s question and is left to it."

So the value this feature adds is not a new detector. It is making the resets unreachable-proof, so
the bounds that already exist actually hold across a PASS oscillation. Nothing approved is
re-litigated and no threshold is re-derived.

## Chosen approach (operator-confirmed)

**The invalidator refunds; the PASS reset is deleted.**

`cumulative` and `rubricFailures` stop being cleared on a `build_review` PASS. In its place, the
rebase-invalidation site — which already decides that `build_review` was invalidated and emits
`kickback from: 'rebase' to: 'build_review'` (`conductor.ts:8955-9010`) — issues an explicit credit
back to the gate's convergence counters. Nothing else refunds.

Why each element is forced:

- **The credit is issued where the knowledge lives.** The invalidation site holds
  `classifyGateInvalidation`'s decision directly. A reset qualified at re-entry instead would have to
  re-derive that provenance from a persisted verdict file, which
  `adr-2026-08-03-build-repair-member-reuse-validity` binds as insufficient authority on its own.
- **Conditional, not blanket.** `classifyGateInvalidation` can PRESERVE `build_review` when the
  rebase delta misses its declared surface (`conductor.ts:8966-8979`); only an actually-invalidated
  gate is credited. Confidence 95%, basis: verified.
- **One-shot per invalidation**, so a single rebase cannot be re-consumed across later laps.
- **The refund has a named cause**, which is what makes "why did the bound not fire?" answerable
  after the fact — the third issue outcome — without reconstructing it from ledgers by hand.
- **The occurrence rides the existing spine**, per `adr-2026-08-12` D5 and `adr-2026-08-17` D8: a
  convergence counter mutating in gitignored `.pipeline/` state without a corresponding event is the
  parallel channel the event-spine skill forbids.

## Approaches weighed and declined

- **A deferred reset honored only on invalidation re-entry** (the intake's hypothesis (a)). Same
  protected case, but it adds a pending-reset state to the ledger entry and must re-derive the
  re-entry's provenance from a verdict file at consumption time. Declined for the stale-authority
  reason above; B obtains the same outcome with no new state.
- **A never-resetting floor beside `cumulative`** (the intake's hypothesis (b), the shape
  `adr-2026-08-12` used when it added `cumulative` beside `count`). Declined: it makes three
  convergence counters on one entry and must answer
  `adr-2026-08-05-build-settle-outcome-stamp`'s "a counter change cannot make the first repeat free",
  while delivering nothing the reset fix does not.
- **Deleting the PASS reset and re-calibrating the cap as a lifetime bound.** Explored with the
  operator and declined on measurement: at cap 5 a lifetime counter fires on 7 of the 15 corpus
  features, all of which eventually shipped, so most of those halts would interrupt slow convergence;
  raising it to 8 fires on 4 but only after roughly nine laps of spend — the same "late and largely
  unreachable" failure `adr-2026-08-17` documents for the existing cap. Lap count is a weak proxy for
  convergence and re-tuning it does not improve on the per-rubric key that already exists.
- **A new, earlier detector.** Out of scope by operator direction: `adr-2026-08-17`'s bound is the
  early trip, and it is measured. This feature exists to stop that bound being zeroed.

Engine-internal control-flow and kickback-ledger change; no user-facing product capability, so
acceptance criteria live directly in the stories.
