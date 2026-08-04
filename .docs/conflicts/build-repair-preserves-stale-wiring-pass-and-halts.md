# Conflict Check: BUILD-verification member reuse after a repair

**Date:** 2026-08-03
**New stories:** `.docs/stories/build-repair-preserves-stale-wiring-pass-and-halts.md`
**Inventory:** the accepted `.docs/stories/` corpus plus `.docs/decisions/` ADRs, scanned against the
five contracts TS-1–TS-5 touch: step-status semantics, `build_review` prerequisites, the gate verdict
record, group membership and dispatchability, retry and kickback budget accounting, event-sink
registry exhaustiveness, the daemon backstop halt class, and selector verdict authority
**Verdict:** PASS — zero blocking conflicts; two accepted assertions require in-change-set amendment

## Pairwise Result Within the New Story Set

| Pair / interaction | Conflict types checked | Verdict and grounding |
|---|---|---|
| TS-1 reconciled kickback status vs TS-2 re-dispatch every member | contradiction, sequencing | Compatible (99%, verified from accepted text): TS-1 makes the member re-selectable; TS-2 makes the round dispatch it. TS-1 is the precondition, not a competing mechanism. |
| TS-2 dispatch every member vs TS-3 no redundant work | contradiction, overlap | Compatible (99%, verified): the two operate at different layers. TS-2 governs whether the member is entered; TS-3 governs whether entering it costs full verification work. A member is always entered and may still settle cheaply. |
| TS-3 settle-from-evidence vs TS-2 "join is the sole satisfaction authority" | state conflict | Compatible (99%, verified): the member's own evidence decides the member's verdict; the join still decides satisfaction for the round. One authority per question. |
| TS-1 reconciled status vs TS-4 tail-selection resolution | overlap, sequencing | Compatible (95%, verified/inferred): TS-1 removes the way the divergence is created on this path; TS-4 removes the way any divergence becomes a terminal-less park. Defense in depth, not duplication. |
| TS-4 resolution vs TS-2 dispatch rules | sequencing | Compatible (99%, verified): TS-4 dispatches a prerequisite the selector skipped; that dispatch flows through TS-2's membership rules unchanged. |
| TS-5 decision events vs TS-3 settle outcomes | overlap | Compatible (99%, verified): TS-5 reports the outcome TS-3 produces; it introduces no independent decision. |

## Adjacent Existing Contracts

| Existing contract | Interaction | Verdict |
|---|---|---|
| `add-a-judgement-gate-at-the-build-manual-test-seam.md` — "`stale` beats old satisfied verdict; `gateSatisfied` returns false and the step re-runs" | TS-1 selects `'stale'` precisely because of this rule. | No conflict (99%, verified) — the accepted rule is what makes TS-1 work. |
| `rekick-resume-runs-finish-while-the-build-gate-ver.md` — same `'stale'`-overrides-verdict rule | Same. | No conflict (99%, verified). |
| `post-rebase-build-invalidation-dispatches-a-full-b.md` — `advanceTail` resets `done → pending` only for steps actually kicked back, no hardcoded reset set | TS-1 writes `'stale'` on the BUILD-verification kickback branches; the rebase branch keeps `'pending'`. | No conflict (97%, verified) — different code paths. TS-1 carries an explicit negative path pinning the rebase reset target unchanged, and the ADR scopes decision 1 to the BUILD-verification branches. |
| `2026-07-12-wiring-reachability-gate.md` and `post-rebase-invalidation-re-runs-every-judged-gate.md` — enumerated post-rebase invalidation sets including `wiring_check` | Both pin the rebase path only; TS-1–TS-3 do not touch it. | No conflict (98%, verified) — implementation must not edit these fixtures. |
| `gate-step-completion-validates-against-code-state-.md` — "`wiring_check` (already HEAD-anchored) … explicitly out of scope and must be unchanged" | The chosen design **honors** this rather than amending it: no `codeStamp` is added to the gate verdict record and no second validity authority is layered over `wiring_check`. | No conflict (99%, verified) — this pin is the reason the alternative design was rejected (ADR Option B). |
| `wiring-check-retries-on-evidence-it-invalidated-it.md` — evidence recorded at `H1` with HEAD now `H2` is discarded and re-derived, completing `done` with no extra dispatch | TS-3 relies on exactly this behavior as the member's own reuse/recompute authority and modifies none of it. | No conflict (99%, verified) — the accepted rule is the mechanism TS-3 depends on. The `'stale'` in TS-1 is a state status, distinct from that story's pinned retry-*reason* text. |
| `deterministic-test-suite-step.md` — "one gate passes while the other remains pending … the partial result does not satisfy the group" | TS-2/TS-3 never leave a member `pending`-but-counted: a member is either dispatched and settled by the join, or excluded by an existing skip rule. | No conflict (97%, verified) — this assertion is the invariant the design restores. |
| `deterministic-test-suite-step.md` — width-1 ordering: "executes `wiring_check` before `test_suite` and still waits for both passing outcomes" | Under TS-2 a post-repair round may legitimately run a single member when the other is skipped by an existing rule. | **Amendment required, not a conflict** (95%, verified): declared member order and the wait-for-all-dispatched-members rule are unchanged; only the literal "executes both" phrasing needs a reuse-aware caveat. |
| `2026-07-12-wiring-reachability-gate.md` — "unsatisfied `wiring_check` blocks build review" selector/advanceTail integration assertion | TS-4 changes the divergence case from block-and-return to dispatch-the-prerequisite. `build_review` is still not entered. | **Amendment required, not a conflict** (95%, verified): the intent (review never proceeds on an unsatisfied wiring gate) is preserved and strengthened; the assertion's shape changes only in the divergence case. |
| `adr-2026-07-10-validation-group-join.md` — "a group whose effective width is ≤1 degrades to today's serial behavior with no semantic change" | TS-2's rounds still degrade the same way. | No conflict (99%, verified). |
| `parallel-validation-phase-fan-out-manual-test-prd-.md` — `parallel_started` reflects only dispatched members, observers never see a phantom member | TS-2 dispatches every non-skipped member, so the member list stays truthful; TS-5's per-member events are separate. | No conflict (99%, verified) — TS-2 carries this as an explicit negative path. |
| `adr-2026-07-29-deterministic-build-verification-fanout.md` — per-gate kickback budget, each failing gate charged once, review only after a green join | TS-3 charges nothing for a member that settled cheaply because nothing failed; the review ordering is untouched. | No conflict (99%, verified). |
| `adr-2026-07-26-cross-dispatch-kickback-livelock-bound.md` — no change to `isEngineComputedStep`'s retry budget; surface-delta and progress keys are deliberately different questions | TS-3 changes no budget rule; TS-4's bound is not keyed on a gate surface. | No conflict (99%, verified) — this ADR's reasoning is also the grounding for rejecting the surface-delta design. |
| `adr-2026-07-11-verdict-aware-resume-entry.md` — `checkGate` unchanged, clamp backward-only, one authority, no new satisfaction predicate | TS-4 reuses the existing clamp and predicate at a second call site and introduces neither a new predicate nor a forward move. | No conflict (98%, verified) — TS-4 carries all four constraints as explicit negative-path criteria. |
| `adr-2026-07-26-event-sink-registry-exhaustiveness.md` — the registry is a total record; a new `ConductorEvent` member fails compilation until declared | TS-5 declares both new types. | No conflict (99%, verified) — the ADR anticipates exactly this. |
| `staleness-decisions-invisible-in-daemon-log.md` — the derived subscription sets equal the pre-refactor literals except for the added type; and a render-set/switch reconciliation test | TS-5 adds two types with `persist`/`render` declarations and a render arm. | No conflict (92%, verified/inferred) — **flagged for implementation**: if that equivalence assertion was written as a whole-set snapshot rather than scoped to the types it covers, it must be re-scoped, not deleted. TS-5 carries this as an explicit negative-path criterion. |
| `conduct-loop-exits-silently-between-steps-no-termi.md` — the backstop leaves the run `halted`, worktree kept, feature retryable | The new ADR says the park is not automatically re-kicked. | No conflict (99%, verified): both hold at different granularity. A `.pipeline/HALT` marker exists and the worktree is kept, and its class is `needs-human` (`conductor.ts:6952`), which the daemon does not auto re-kick. TS-1 asserts on the marker class, which was read from source. |
| `gate-audit-2026-06-23.md` and `audit-trail-write-completeness-for-retro-under-fre.md` — gate verdict shape `{satisfied, reason, checkedAt}`, field-for-field audit derivation | The chosen design adds no field to the gate verdict record. | No conflict (99%, verified) — the alternative design's field-collision risk was eliminated by rejecting it. |

## Five-Type Scan

- **Contradiction:** none. Every apparent contradiction resolved to a different code path
  (rebase versus BUILD-verification kickback), a different layer (round entry versus work performed),
  or a different granularity (halt marker existence versus halt class).
- **Behavioral overlap:** intentional and compatible. TS-1 and TS-4 overlap as defense in depth against
  the same divergence, each closing a different half.
- **State conflict:** resolved by scoping the status reconciliation to the BUILD-verification kickback
  branches and by keeping one validity authority per member.
- **Resource contention:** none. No new lock, port, or shared mutable service; concurrency stays under
  the existing cap.
- **Sequencing conflict:** the reproduction test precedes every fix task; the status reconciliation
  precedes the membership and selection work; documentation and the two assertion amendments land in
  the same change set.

## Required Amendments (same change set)

1. `.docs/stories/deterministic-test-suite-step.md` — width-1 ordering assertion gains a reuse-aware
   caveat; declared member order and the wait-for-all-dispatched rule are unchanged.
2. `.docs/stories/2026-07-12-wiring-reachability-gate.md` — the selector/advanceTail integration
   assertion's divergence case changes from block-and-return to dispatch-the-prerequisite;
   `build_review` is still not entered.

Both follow the established precedent in this repository for a later feature refining a pinned
assertion, with a dated amendment note rather than a superseding ADR.

## Verify-Claims Verdict

Every interaction claim above cites accepted story text, an approved ADR, or a source line read
directly during this check. The one claim that was contested across two accepted artifacts — the
backstop's halt class — was settled by reading `conductor.ts:6952`. No unconfirmed load-bearing
assumption was used.

Verdict: CLEAR
