# ADR: build_review carries a cumulative convergence bound that tree movement cannot reset

**Date:** 2026-08-12
**Status:** APPROVED
**Deciders:** Engineer (DECIDE phase, #1521), operator-confirmed
**Relates to:** `adr-2026-07-26-cross-dispatch-kickback-livelock-bound.md` (#984 — introduced the
per-tree bound this ADR layers on, and whose reset rule is the mechanism that failed here),
`adr-2026-07-13-kickback-build-no-op-escalation.md` (#647 — the D2 no-op escalation, unchanged),
`adr-2026-07-07-build-review-judgement-gate.md` (the gate itself)
**Supersedes:** nothing. **Does not change:** `MAX_KICKBACKS_PER_GATE`'s value or meaning, the
per-tree reset rule, D2's escalation, any gate's PASS/FAIL judgment, or completion derivation.

## Context

Issue #1521. On 2026-08-12 the feature `per-task-wired-into-contracts-cost-build-cycles-th`
(implementing #1496) looped `build_review → remediate/build → build_review` eight times. The
persisted event ledger records eight `build_review` kickbacks and **every one of them reports
`count: 1`**:

```text
$ jq -r 'select(.type=="kickback" and .from=="build_review") | [.ts, .count, .to] | @tsv' \
    .worktrees/per-task-wired-into-contracts-cost-build-cycles-th/.pipeline/events.jsonl
2026-08-12T12:16:52.744Z  1  build
2026-08-12T13:23:34.126Z  1  build
2026-08-12T14:20:01.662Z  1  build
2026-08-12T15:41:53.742Z  1  build
2026-08-12T17:01:36.762Z  1  build
2026-08-12T17:23:42.754Z  1  build
2026-08-12T17:36:50.058Z  1  build
2026-08-12T18:03:20.037Z  1  build
```

Shipping stayed blocked until an operator parked the feature. One review lap alone logged
`8.7M → 19.3k tok`.

### The mechanism, verified

`bumpKickbackGate` (`kickback-ledger.ts:135-139`) computes:

```ts
const madeProgress =
  previous.treeHash !== input.treeHash || input.resolvedCount > previous.resolvedBefore;
const nextCount = madeProgress ? 1 : Math.min(previous.count + 1, MAX_KICKBACKS_PER_GATE);
```

Every remediation lap wrote real commits, so `treeHash` differed every time, so `madeProgress` was
true every time, so `count` was reset to 1 every time and `exhausted` was never reachable. This is
**not a defect in that rule.** ADR-2026-07-26 deliberately chose it: "a genuine tree change always
earns a fresh budget (fail-open)". The rule answers *"was this lap a no-op?"* and it answers it
correctly. Nothing in the system answers *"is this feature converging?"* — and that is the gap.

Confidence 99%, basis: verified — the source above, the event timeline, and the existing unit suite
(`test/engine/kickback-ledger.test.ts`, 9 passing) which reproduces the reset behavior directly.

### Why the obvious keys do not work

- **Reason text.** ADR-2026-07-26 D3 already rejected this on measured evidence: `build_review`
  reasons are LLM grader prose (`artifacts.ts:1115-1124`) and never produce two byte-equal strings,
  so a reason-keyed counter resets every lap and the livelock survives the fix. This ADR does not
  reopen that finding — it accepts it, and therefore the cumulative bound is **count-based only**.
- **Tree hash.** Already used, already reset by exactly the laps in question.
- **Rubric-item identity.** Considered and rejected below.

## Decision

**`build_review` gains a second, independent bound: a cumulative lap counter that tree movement
never resets.**

### D1 — A `cumulative` field on the gate's ledger entry

`KickbackGateEntry` gains `cumulative: number`. It is incremented on **every** kickback consumed for
that gate, unconditionally — the `madeProgress` branch does not touch it. `count` keeps its exact
current semantics.

The two bounds answer different questions and are deliberately not merged:

| Field | Question | Reset by |
|---|---|---|
| `count` | Was this lap a no-op over an unchanged tree? | any tree change or resolved-count increase |
| `cumulative` | Has this gate converged at all? | a PASS verdict for the gate |

Read tolerance is unchanged and is load-bearing for compatibility: `isKickbackGateEntry` treats a
missing `cumulative` as a legacy entry and folds it to `0` rather than rejecting the ledger. An
in-flight feature mid-run when this ships gets a fresh cumulative budget, never a spurious halt.

### D2 — A PASS clears the gate's cumulative count

Today nothing clears a gate entry on PASS; the only clear is `clearKickbackLedger` at
`conductor.ts:3506`, on a fresh feature session. A `build_review` PASS is genuine convergence, so it
resets `cumulative` to 0 (and leaves `count` alone). Without this, a feature that legitimately
passes `build_review`, later has its verdict invalidated by a rebase, and re-enters would carry
stale laps toward a halt it did not earn.

### D3 — The cap is 5, and exceeding it is a `needs-human` HALT

`MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW = 5`. On `cumulative > 5`, the conductor calls
`writeHaltMarker(projectRoot, reason, 'needs-human')` where `reason` names the gate, the cumulative
lap count, the cap, and `lastReason`.

**Why 5, stated as the assumption it is.** Typical healthy features close `build_review` in one or
two laps; the incident reached eight and was still running. 5 sits above the normal band and below
the observed pathology. This is a judgement, not a measurement — confidence 70%, basis: inferred
from the single incident timeline plus the existing `MAX_KICKBACKS_PER_GATE = 2` precedent. It is
the value most likely to need revision, which is precisely why D4 exists.

`needs-human` is chosen, not defaulted. `daemon-rekick.ts:184-192` skips a `needs-human` halt on
every sweep while `mechanical` and `unclassified` halts are cleared on base advance and
re-dispatched. Classifying anything weaker would let the sweep recycle the halt and sustain the very
loop this bound exists to stop — the identical trade-off ADR-2026-07-26 D4 accepted, for the
identical reason. **Accepted cost:** a feature that would have converged on lap 6 now waits for an
operator.

### D4 — Config-gated, default on

A new optional config block resolves to enabled when absent, mirroring `KickbackEscalationConfig`
(`types/config.ts:301-311`) exactly. `enabled: false` restores today's behavior byte-for-byte: no
cumulative increment is consulted, no halt path is reachable.

This is deliberately *more* gated than ADR-2026-07-26's D1, which left ledger persistence ungated as
fail-closed correctness. The asymmetry is intentional: persistence cannot produce a false halt,
whereas a wrong cap value can, and a false `needs-human` halt on a converging feature is the
expensive failure direction. The switch is the escape hatch for a cap that turns out to be too
tight.

### D5 — `cumulativeCount` on the `kickback` event

The `kickback` member of the `ConductorEvent` union gains an optional `cumulativeCount: number`
alongside its existing `count`. The `loop_halt` emitted at the cap carries the same figure in its
reason text.

This is not decoration and not optional scope. Per `.agents/skills/event-spine/SKILL.md`, the
`cumulative` ledger field is legitimate as **exception C** (durable state, read by name by its own
writer as a control input) *only because the occurrence is also emitted*. A cumulative counter that
lived solely in gitignored `.pipeline/` state would force an operator or the UI to read a
per-worktree file to reconstruct that a feature was failing to converge — a parallel channel wearing
an existing file as a disguise, which §3's corollary names explicitly. The event field is what keeps
D1 legal, and it is what makes the eight-identical-`count: 1` history above readable as one
non-converging feature rather than eight unrelated first offences.

### D6 — Scope: `build_review` only

The ledger's `gates` record is already gate-generic and the `cumulative` field is added generically,
but only the `build_review` kickback site consults the cumulative cap in this change.

`prd_audit` and `manual_test` share `build_review`'s re-wordable-reason property and are the natural
next candidates. Neither has an incident behind it. Extending to them is purely additive — one more
call site against a field that already exists — and is deliberately left for whichever issue
produces the evidence. `test_suite` and `wiring_check` are explicitly excluded: their reasons are
engine-computed and deterministic (ADR-2026-07-26 D3's table), so the tree-keyed bound plus D2
already terminate them.

This is the same "wrong size for this defect" reasoning ADR-2026-07-26 used to reject a full
progress-witness redesign, applied to itself.

## Alternatives considered

- **Rubric-item identity as the bound key** — halt when the same rubric item (`tautology`,
  `scope`, `rootCause`, `completeness`) fails N consecutive times regardless of tree movement.
  Genuinely attractive: it measures semantic convergence directly rather than proxying it by lap
  count, and the `rubric` booleans are engine-readable from `.pipeline/build-review.json`, so unlike
  reason text it is a stable key. Rejected for this change on blast radius — it reworks the
  anti-ping-pong seam every gate shares, and a grader that alternates between two rubric items would
  evade it while a plain lap count catches it. Recorded as the strongest candidate for a future
  refinement, and it composes with this bound rather than replacing it.
- **Raising `MAX_KICKBACKS_PER_GATE` or removing the tree-hash reset.** Rejected: both re-open
  ADR-2026-07-26's decisions, and removing the reset makes a legitimately nondeterministic step
  halt after two laps over a moving tree — the exact fail-open property that ADR chose on purpose.
- **A global per-feature lap budget across all gates.** Rejected: it conflates unrelated gates'
  budgets, so a feature that spent laps on `test_suite` would arrive at `build_review` pre-exhausted.
  Per-gate is the existing, correct granularity.
- **Deriving the cumulative count from `events.jsonl` at decision time** instead of storing it.
  Rejected: it makes a control decision depend on parsing a telemetry ledger whose reader
  (`parseLedger` in `timing-rollup.ts`) returns null on any malformed line, so one bad record would
  silently disable the bound. State belongs in the state file; the event is the observation of it.
- **`mechanical` rather than `needs-human` halt classification.** Rejected under D3 — the re-kick
  sweep would recycle it.

## Consequences

- **Positive.** The incident class terminates at 5 laps instead of running until an operator
  notices. The `kickback` event ledger becomes readable as a convergence history. Detection stays
  fully deterministic — no LLM is in the bound's decision path, per the repository's
  Deterministic-where-possible principle. The bound survives re-dispatch because it lives in the
  same durable ledger ADR-2026-07-26 established.
- **Preserved invariants.** `MAX_KICKBACKS_PER_GATE` keeps its value and meaning; the per-tree
  reset rule is untouched; D2's no-op escalation is untouched; no gate's PASS/FAIL judgment
  changes; a legacy ledger without `cumulative` reads clean.
- **Negative / watch.** A feature that would have converged on lap 6 now halts for a human — the
  accepted cost of D3, mitigated by D4's switch. The cap value is the least-evidenced part of this
  decision and should be revisited once several features have run under it; if operators find
  themselves routinely clearing this halt, the cap is too tight and that is the signal.
- **Known limitation (#497 class), accepted.** `.pipeline/` is gitignored, so deleting
  `.worktrees/<slug>` resets the cumulative count. This fails **open** — a fresh budget, never a
  spurious halt — which is the correct direction for a guard whose bad outcome is halting real work.
  Identical to the limitation ADR-2026-07-26 accepted for the same ledger.
