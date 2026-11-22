# ADR: BUILD settles without a dispatch when no work is owed

**Date:** 2026-11-15
**Status:** APPROVED
**Deciders:** operator (composer session for jstoup111/ai-conductor#3659)

<!-- Works within adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch (one completion
     authority), adr-2026-07-13-kickback-build-no-op-escalation (its guard is unchanged) and
     adr-2026-10-07-per-child-build-region (the engine-derived `no-owned-criteria` precedent).
     Amends adr-2026-07-10-daemon-stall-remediation D3, D4 and D7. -->

## Context

In a five-child stack, a revalidate round re-dispatched BUILD for a child whose planned tasks were
all complete and that had no open remediation case. The BUILD agent had nothing to do. It read an
old `loop_halt` reason from `.pipeline/events.jsonl` and wrote it to the halt marker. The build-stall
remediation concluded that no work was owed, but its only halt-free outcome is "route to build",
so it halted `unanswerable`, which is written as `needs-human`. Clearing the HALT dispatched the
same BUILD again, with the same result (jstoup111/ai-conductor#3659).

Three gaps produce the loop:

- Nothing checks whether BUILD has work before a provider is dispatched. `acceptance_specs` has
  such a check (`no-owned-criteria`); BUILD does not. The routed-entry check that settles a
  complete host runs for audit rounds only.
- The build-stall remediation can answer a question or halt for a human. It cannot say that the
  question is moot.
- The remediation is not told that a halt reason it is reading has already been cleared.

A restack never invalidates `build` on content: `GATE_SURFACE` has no `build` key. `build` joins a
revalidate round only when its stored verdict is unsatisfied or the reduced completion check
fails, so a full completion check can pass on the same tree.

## Options Considered

### Option A: the engine decides, at every BUILD dispatch
- **Pros:** No provider runs, so no agent can re-raise an old halt. One check serves the dispatch
  boundary and the remediation verdict.
- **Cons:** Adds a check to the dispatch path of every round kind.

### Option B: tell the agents
- **Pros:** Smallest change.
- **Cons:** Relies on prompt discipline for a fact the engine can compute, and still pays for the
  dispatch.

### Option C: settle revalidate rounds only
- **Pros:** Narrow.
- **Cons:** A plain resume or any other path that dispatches a BUILD with no work can still loop.

## Decision

Option A. Each numbered item is a citable decision.

1. **One engine-owned no-work-owed check.** It reports `no-work-owed` only when all of these hold
   for the execution child: the existing BUILD completion authority (`checkStepCompletion` for
   `build`, with the full completion context) reports done; no open remediation case is eligible
   for BUILD; the child hosts no taskless obligation; no repair authorization is pending; and no
   gate kickback is pending against BUILD. A gate that failed and sent the run back to BUILD is
   work owed even when every task reads complete, so the existing no-op-cycle refusal
   (adr-2026-08-05-build-settle-outcome-stamp D3) keeps deciding that case.
   Anything it cannot read counts as work present. There is no second definition of "BUILD
   complete": the check adds obligations to the existing authority and does not replace it.
2. **The dispatch boundary settles BUILD when the check passes.** Before a BUILD attempt opens,
   if BUILD is not already `done` or `skipped` and the check reports `no-work-owed`, the engine
   writes the BUILD verdict and marks the step `done` through the existing step-state and verdict
   writers. No provider is dispatched, no attempt is opened, and no retry or kickback budget is
   charged. This follows the `acceptance_specs` `no-owned-criteria` precedent.
3. **An explicit instruction always dispatches.** A run started with `--from build` and an
   operator round dispatch BUILD without consulting the check.
4. **A revalidate round continues to its remaining gates.** A BUILD settled under decision 2 on a
   revalidate round leaves the round open; the child's other queued gates run as they do today.
   The audit-round `derived-already-complete` exit is unchanged and is not used for revalidate
   rounds.
5. **The settle is reported on the existing event spine.** The engine emits the existing
   `gate_verdict` and unmetered `step_completed` events. The BUILD verdict records the typed
   outcome `no-work-owed` and whether the dispatch boundary or a remediation verdict produced it.
   No new event channel, file or ledger is added.
6. **The build-stall remediation gains the verdict `no-work-owed`.** It is valid only for the
   build-stall sources and is enforced by the engine-owned remediation plan schema. It means the
   stall question needs no answer because BUILD has nothing left to do.
7. **The engine confirms a `no-work-owed` verdict with the check.** When the check agrees, BUILD
   settles as in decision 2 and the run continues to the next gate. When the check finds work,
   BUILD resumes in the retry loop with an engine-written hint naming the pending work. Every
   stall remediation dispatch already charges one remediation round, so repeats are bounded by
   the existing budget and no further charge is added. Exhausting that budget halts as it does
   today, with the question preserved.
8. **Earlier halt reasons are an input to the remediation, not a rule.** For a build-stall
   remediation the engine supplies the most recent distinct `loop_halt` reasons recorded on the
   event spine for the same step and execution child, labelled as no longer in force. The
   remediation judges whether live state still supports the question. The engine does not compare
   halt text.
9. **No new operator command.** The supported operator path past a BUILD with nothing to do is
   the existing halt clear command followed by the next dispatch, which settles under decision 2.
   When the check finds work, the existing task and remediation-case commands address it.
10. **The kickback no-op guard is unchanged.** A remediation that routes work into an
    already-complete BUILD still halts under adr-2026-07-13-kickback-build-no-op-escalation D1. A
    pending repair authorization is work present under decision 1, so the two never overlap.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | A restack adds `build` to a revalidate entry only when its verdict is unsatisfied or the reduced completion check fails, never on replayed content (`GATE_SURFACE` in `gate-invalidation.ts` has no `build` key; gate selection in `restack-transition.ts`) | verified | 90% | yes | Settling could skip a BUILD that a restack required, and decision 4 would need a content condition | — |
| A2 | The BUILD completion authority checks plan tasks, engine-appended `rem-*` tasks, open repair obligations, uncommitted paths and Done-when checks, scoped to the active child (`CUSTOM_COMPLETION_PREDICATES.build` in `artifacts.ts`) | verified | 90% | yes | Decision 1 would need further conditions | — |
| A3 | The `/remediate` halt categories and the plan disposition grammar are enforced by the engine-owned plan contract (`remediation-plan-contract.ts`), so a new verdict is a schema change and not a prose change | verified | 90% | yes | Decision 6 could not be schema-enforced | — |
| A6 | A gate kickback into BUILD is readable before dispatch (`pendingBuildKickbackGate` in `conductor.ts`, already consulted by the no-op-cycle refusal) | verified | 90% | yes | A failed gate could loop against a settled BUILD, and decision 1 would need another signal | — |
| A4 | A BUILD dispatch for a step and child happens only after every earlier HALT for it was cleared, so every earlier `loop_halt` reason on the spine is no longer in force (`isHalted` park-gate in `daemon-deps.ts`; `loop_halt` carries `step`, and `child` for region steps) | inferred | 90% | yes | Decision 8 would label a live halt as cleared, and the input would need pairing with clear records | APPROVED by operator 2026-11-15 |
| A5 | The step-loop site that settles `acceptance_specs` as `no-owned-criteria` is reached for stacked children and routed revalidate hosts, so decision 2 needs one call site | inferred | 85% | yes | The plan needs a second call site at routed host entry | APPROVED by operator 2026-11-15 |

## Consequences

### Positive
- A BUILD with nothing to do costs no provider dispatch and cannot raise a halt.
- A build stall whose question is moot ends without a human.
- A remediation that reads an old halt reason is told that it was cleared.
- No new operator command, event channel or file.

### Negative
- Every non-explicit BUILD dispatch pays one completion check.
- A defect in the check would settle a BUILD that had work. The check fails toward dispatch on
  any unreadable state, and `test_suite` and `build_review` still run after it.
- The remediation plan schema, its skill contract and the tests that pin the verdict list change.

### Follow-up Actions
- [ ] Amend adr-2026-07-10-daemon-stall-remediation D3, D4 and D7 (this spec).
- [ ] Reconcile with jstoup111/ai-conductor#3658, which amends the same ADR and moves remediation
      inputs into the child region.
