# ADR: a rebase that invalidates build_review refunds its convergence laps; a PASS never clears them

**Date:** 2026-08-18
**Status:** APPROVED
**Deciders:** Engineer (DECIDE phase, #1694), operator-confirmed — including an operator rejection of
a lifetime-counter design after its corpus measurement, and an operator-confirmed scope of "fix the
reset, let the per-rubric bound do the catching".
**Relates to:** `adr-2026-08-12-cumulative-build-review-convergence-bound.md` (#1521 — whose D2 this
ADR replaces), `adr-2026-08-17-build-review-rubric-repetition-short-circuit.md` (#1652 — whose D5
inherits the same reset and explicitly leaves this question here),
`adr-2026-07-26-cross-dispatch-kickback-livelock-bound.md` (#984 — the ledger and the per-tree reset,
untouched), `adr-2026-07-20-post-rebase-delta-aware-invalidation.md` (the preserve/invalidate
partition this refund is conditioned on), `adr-2026-07-08-post-rebase-gate-first-mechanical-reverify.md`,
`adr-2026-08-03-build-repair-member-reuse-validity.md` (no on-disk verdict is sole authority),
`adr-2026-08-05-build-settle-outcome-stamp.md` ("a counter change cannot make the first repeat free"),
`adr-2026-07-26-event-sink-registry-exhaustiveness.md` (why this is a field, not a union member),
`adr-2026-07-28-total-halt-classification-legacy-boundary.md`
**Supersedes:** `adr-2026-08-12` **D2 only**. **Constrains:** `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` (#1629, spec PR #1724, open and unmerged at this writing) — its D4 allowance takes this ADR's reset rule instead of a PASS reset; see D6. **Does not change:**
`MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW` (5), `MAX_RUBRIC_FAILURES_BUILD_REVIEW` (4),
`MAX_KICKBACKS_PER_GATE` (2) or its per-tree reset rule, the `cumulative_kickback_bound` config
contract, D2's no-op escalation, the fresh-base disposition, any rubric's PASS/FAIL judgement,
finding identity, the disposition store's schema, or completion derivation.

## Context

Issue #1694. `adr-2026-08-12` D2 decided that "a `build_review` PASS is genuine convergence, so it
resets `cumulative` to 0". The reason it gave is narrow and specific: "a feature that legitimately
passes `build_review`, later has its verdict invalidated by a rebase, and re-enters would carry stale
laps toward a halt it did not earn."

The implemented reset is unconditional. `conductor.ts:8521` calls
`resetKickbackGateCumulativeInLedger` on **every** `build_review` step completion, and `build_review`
is re-opened by far more than a rebase — any BUILD repair invalidates the prior verification round
(`conductor.ts:9909`), so a `manual_test`, `prd_audit`, `simplify`, or `finish` kickback routes
through `build` and re-runs it. A feature that oscillates PASS → FAIL therefore returns every
convergence counter to zero on each pass and can never reach any bound.

Measured over the 15 features with `build_review` kickback history in `.daemon/evals-raw` (95
kickbacks total, reconstructed from each feature's `events.jsonl`):

| lifetime `build_review` kickbacks | features | cumulative cap fired |
|---|---|---|
| 16 | `loop-halt-never-reaches-events-jsonl` | no |
| 10 | `stale-manual-test-discovered-at-finish` | yes |
| 9 | `finish-publication-burns-its-retry-budget` | no |
| 9 | `rubric-cache-identity-is-sha-anchored` | no |
| 8 | `out-of-plan-production-edits` | no |
| 6 | `harden-intake-ledger-durability` | no |
| 6 | `live-daemon-e2e-tier-covers-only-claude` | yes |
| 5 | three features | one yes |
| ≤4 | five features | one yes |

Confidence 95%, basis: verified — `conductor.ts:8521`, `kickback-ledger.ts:180,203-215`, and the
per-feature `kickback`/`loop_halt` records above.

### The measurement that chose the design

The decisive number is how often D2's protected case actually occurs. Counting rebase-origin
invalidations of `build_review` (`kickback` records with `from: 'rebase'`, `to: 'build_review'`)
across the same corpus:

**1 occurrence, across 15 features and 95 kickbacks.**

Confidence 90%, basis: verified over the persisted ledgers; the residual is corpus completeness —
features whose worktree was reaped before harvest are absent, and `.pipeline/` is gitignored (the
#497 class).

Two consequences follow, and they point the same way:

- **D2 pays for a case that occurs once in fifteen features, with a reset that fires on every PASS.**
  The exemption is right; its trigger is roughly two orders of magnitude too broad.
- **A refund keyed on the actual occurrence cannot re-open the hole**, because the occurrence is
  rare. This was the live risk in the design: `adr-2026-07-20` preserves `build_review` iff the
  rebase delta is empty, so *every* file-changing rebase invalidates it, and a refund on that
  condition could plausibly have been as common as the PASS reset it replaces. The corpus says it is
  not.

### What this ADR is not

It is not a new detector and not a re-calibration. `adr-2026-08-17`'s per-rubric bound (threshold 4)
separated 5 of 5 spinning features from 6 of 6 healthy ones on its corpus; that is the early trip.
Its D5 inherits this same PASS reset and says so: "Whether `cumulative` should also carry a
never-reset floor is `adr-2026-08-12`'s question and is left to it." This ADR answers that question
so the bound that already exists cannot be zeroed.

## Decision

### D1 — The `build_review` PASS no longer clears any convergence counter

`resetKickbackGateCumulativeInLedger` is removed from the step-completion path and from the ledger's
exported surface. **No counter on the gate's kickback ledger entry is cleared by a `build_review`
PASS.** `cumulative` and `rubricFailures` accumulate across the feature's whole session,
cleared only by `clearKickbackLedger` on a genuinely fresh feature session (`conductor.ts:3506`,
unchanged) and by D2 below.

`count` and its per-tree reset are untouched. `adr-2026-07-26`'s fail-open property — "a genuine tree
change always earns a fresh budget" — is a property of `count`, not of the convergence counters, and
is preserved exactly.

### D2 — The rebase that invalidates the gate refunds its convergence laps

Where `advanceTail` handles `lastRebaseOutcome.kind === 'changed'` (`conductor.ts:8955-9010`), the
loop that re-opens each invalidated target additionally credits `build_review`'s convergence
counters back to their empty state — `cumulative → 0`, `rubricFailures → {}` — before re-opening it.

Three conditions, each load-bearing:

1. **Only when the gate was actually invalidated.** The existing loop already keys on a verdict with
   `satisfied === false` and `kickback.from === 'rebase'`, which is precisely `adr-2026-07-20`'s
   invalidated set: a gate that ADR *preserved* has no such verdict and is not re-opened, so it is
   not credited either. The condition is inherited rather than re-derived, so the two cannot drift.
2. **Only `build_review`'s own ledger entry.** The `gates` record is gate-generic; the credit names
   one gate.
3. **Exactly once per invalidation.** The credit is applied at the moment the gate is re-opened, not
   re-evaluated on later laps, so one rebase cannot keep crediting as the feature re-fails.

**Why this site and not a qualified reset at re-entry.** The alternative — arm a pending reset at
PASS and honor it at the next re-entry if that re-entry was rebase-caused — must re-derive the
re-entry's provenance from a persisted verdict file at consumption time.
`adr-2026-08-03-build-repair-member-reuse-validity` binds that "no on-disk gate verdict, step status,
or timestamp is sufficient authority on its own". At the invalidation site the decision is in hand,
so no re-derivation and no new ledger state are needed.

**Fail direction.** If the rebase path's delta or feature surface cannot be computed,
`adr-2026-07-20` falls back to invalidate-everything; the refund then fires too. That is fail-open
for the budget — a fresh budget, never a spurious halt — which is the correct direction for a guard
whose bad outcome is halting real work, and it is the same direction `adr-2026-08-12` accepted for
the #497 class.

### D3 — The refund rides the existing `kickback` event as an additive optional field

The `kickback` member of `ConductorEvent` gains an optional field carrying what was credited and to
which gate. It is emitted at `conductor.ts:9005-9011`, the site that already emits
`kickback { from: 'rebase', to: 'build_review' }`, one-to-one with the credit.

**A field, not a union member.** `adr-2026-07-26-event-sink-registry-exhaustiveness` makes
`EVENT_SINKS` a total `Record<ConductorEvent['type'], SinkDeclaration>`, so a new member forces a
sink declaration and a compilation break; an additive optional field on an existing member does not,
and `adr-2026-08-12` D5 (`cumulativeCount`) and `adr-2026-08-17` D8 (`rubricFailures`) already
established that shape on this exact member.

**Not `rebase_gate_invalidated`, though it is semantically closer.** That event is emitted from
`runRebaseStep` via `emitGateInvalidationEvents` (`conductor.ts:9587`), a different function at a
different time from the refund, and it is not emitted on `adr-2026-07-20`'s fail-closed fallback —
so a refund carried there would be missing exactly when the fallback fires. The `kickback` emission
is co-located with the credit and covers the fallback.

**Why any emission at all.** Per `.agents/skills/event-spine/SKILL.md`, the durable counters are
legal as exception C — state read by name by its own writer as a control input — **only because the
occurrence is also emitted**. A refund that silently mutated gitignored `.pipeline/` state would be
the parallel channel §3's corollary names, and would leave "why did the bound not fire?" answerable
only by hand from ledger archaeology. This is the half of the change that delivers issue outcome 3.

### D4 — No new config gate

`adr-2026-08-12` D4's `cumulative_kickback_bound.enabled` switch is unchanged and continues to
disable the cumulative bound wholesale. This change adds no second switch: it does not introduce a
threshold, and its failure direction is toward *more* halting only in the sense that the approved cap
becomes reachable as designed. A feature in flight when this ships keeps its ledger; the absent
`cumulative` read tolerance in `isKickbackGateEntry` is unchanged, so a legacy entry still reads
clean.

### D5 — Scope: `build_review` only

`prd_audit` and `manual_test` remain where `adr-2026-08-12` D6 left them — for whichever issue
produces their evidence. They do not consult a cumulative cap today, so the reset's removal changes
nothing for them.

### D6 — The rule is the entry's, not one counter's

Operator decision, 2026-08-18, taken against the conflict recorded in
`.docs/conflicts/one-build-review-pass-clears-the-convergence-cap-s.md`.

D1 and D2 are stated over **every** lap-counting field on `KickbackGateEntry`, present or future,
rather than over `cumulative` and `rubricFailures` by name:

- **No such counter is cleared by a `build_review` PASS.**
- **Each is credited back by a rebase that invalidated the gate**, under D2's three conditions.

This binds `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` (#1629), whose D4 adds a
bounded mechanical-fault allowance to this same entry and whose plan task-6 currently reads
"Implement the advance, the declared ceiling constant, and the PASS reset beside the existing
cumulative reset", justified as "matching how `cumulative` resets". That symmetry is the thing this
ADR removes. #1629's spec PR is open and unmerged, so rather than leave its build following an
instruction that no longer describes the code, the rule is settled here once for the entry.

**The concern this decision overrides, stated because it is real.** A mechanical-fault allowance is a
*retry* budget, not a convergence bound: its faults are transient by construction, and a subsequent
PASS is genuine evidence the fault cleared. Under D6 a feature can therefore carry mechanical-fault
laps toward that lane's ceiling across a PASS that resolved them, and halt for infrastructure trouble
it recovered from. The operator weighed this and chose one rule for the entry over per-counter
reset semantics; the mitigation is that the rebase credit applies to the allowance too, and that
#1629 owns its own ceiling and may set it with this rule in view. If that lane halts features whose
faults demonstrably cleared, the correct response is #1629's ceiling or a lane-specific credit
trigger — not restoring a PASS reset to this entry.

## Alternatives considered

- **A deferred reset honored only on invalidation re-entry** (the intake's hypothesis (a)). Same
  protected case and the same outcome, but it adds a pending-reset state to `KickbackGateEntry` and
  must re-derive provenance from a persisted verdict at consumption time, against
  `adr-2026-08-03`'s invariant. Rejected as strictly more state for the same behavior.
- **A never-resetting floor beside `cumulative`** (the intake's hypothesis (b), and the layering
  shape `adr-2026-08-12` used when it added `cumulative` beside `count`). Rejected: it makes three
  convergence counters on one entry, requires a third threshold with no evidence behind it, and must
  answer `adr-2026-08-05-build-settle-outcome-stamp`'s "a counter change cannot make the first repeat
  free" — while delivering nothing the reset fix does not. The layering precedent does not transfer:
  `cumulative` was added beside `count` because the two answer different questions, whereas a floor
  beside `cumulative` answers the *same* question with a different reset rule, which is a reset fix
  wearing a counter as a disguise.
- **Deleting the PASS reset and re-calibrating `cumulative` as a lifetime cap.** Explored with the
  operator and rejected on measurement: at cap 5 a lifetime counter fires on 7 of the 15 corpus
  features, all of which eventually shipped, so most of those halts would interrupt slow convergence;
  at cap 8 it fires on 4, but only after roughly nine laps of spend — the same "late and largely
  unreachable" failure `adr-2026-08-17` documents for the existing cap. Lap count is a weak proxy for
  convergence and re-tuning it does not improve on the per-rubric key that already exists. The
  operator's verdict on this option was explicit.
- **Keeping D2 and accepting the hole**, on the ground that `adr-2026-08-17`'s bound catches 5 of 5
  spinning features anyway. Rejected: that bound inherits the identical reset (its D5), so the hole
  is not narrower for it — it is the same hole. `adr-2026-08-17` measured the reset as costless to
  keep *on its corpus*, where no feature oscillated more than twice; that is evidence the reset was
  not the binding constraint there, not evidence it is safe.
- **A new `ConductorEvent` member for the refund.** Rejected under D3 on
  `adr-2026-07-26-event-sink-registry-exhaustiveness` — a member obliges a sink declaration for an
  occurrence that is already one-to-one with an emitted `kickback`.

## Consequences

- **Positive.** Both convergence bounds become reachable for a feature that intermittently passes —
  the shape every long spin in the corpus took. The exemption D2 was written for survives, keyed on
  the occurrence that justifies it rather than on a proxy that fires roughly a hundred times more
  often. The refund is observable, so "why did the bound not fire?" is answerable from the persisted
  spine rather than by hand. No threshold is introduced or re-derived, and no LLM enters the bound's
  decision path — the property `adr-2026-08-12` recorded and `adr-2026-08-17` preserved.
- **Preserved invariants.** `count` and its per-tree reset; `MAX_KICKBACKS_PER_GATE`;
  `MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW`; `MAX_RUBRIC_FAILURES_BUILD_REVIEW`; D2's no-op escalation;
  the fresh-base disposition; the `cumulative_kickback_bound` contract; legacy-ledger read tolerance;
  `adr-2026-07-20`'s preserve/invalidate partition, which this change reads and never modifies.
- **Negative / watch.** A feature that genuinely converges slowly across a PASS now carries its
  earlier laps and can reach the cap where before it could not. That is the intended effect, and it
  is the direction `adr-2026-08-12` D3 already accepted ("a feature that would have converged on lap
  6 now waits for an operator"); this change makes that accepted cost actually payable. On the corpus
  it moves the cumulative cap from firing on 4 of 15 features to a larger set, and
  `adr-2026-08-17`'s bound trips before it on the spinning ones. If operators find themselves
  routinely clearing cumulative-cap halts after this lands, the signal is that cap 5 — flagged by
  `adr-2026-08-12` as its least-evidenced decision at 70% confidence — is too tight, and that is a
  cap question, not a reset question.
- **Known limitation (#497 class), accepted and unchanged.** `.pipeline/` is gitignored, so deleting
  `.worktrees/<slug>` still resets every counter. Fails open, identical to what
  `adr-2026-07-26` and `adr-2026-08-12` accepted.
- **Cross-feature.** D6 constrains #1629's unmerged allowance design. That feature keeps ownership of
  its ceiling, its terminal state, and its halt rendering; only the reset rule moves here. Its plan
  task-6 must be amended before it builds, and that amendment is a precondition recorded in this
  feature's conflict artifact.
- **Sequencing.** `adr-2026-08-17`'s `rubricFailures` field is APPROVED and merged but not yet
  implemented on this base. D1 and D2 are written to clear and credit whichever convergence fields
  the entry carries, so this change is correct both before and after that implementation lands. The
  ordering hazard is conflict-check's to adjudicate.
