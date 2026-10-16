# Conflict Check: Build, charge and review a routed fix on the child that hosts it (#3211)

**Date:** 2026-10-15
**Stories checked:** `.docs/stories/a-routed-fix-cannot-be-built-charged-and-reviewed-.md` (Stories 1–9)
against every overlapping story in `.docs/stories/` and the overlapping APPROVED ADRs.
**Result:** 3 blocking conflicts found and resolved by operator decision. 7 degrading conflicts:
D5 accepted as a known compromise, and the other six resolved. Re-check: clean (zero blocking).

## ADR corpus

- **Examined:**
  - `adr-2026-10-12-routed-whole-feature-repair` (D3–D17);
  - acceptance-RED: `adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance`, `adr-2026-07-21-engine-owned-acceptance-red-execution`, `adr-2026-08-09-recorded-red-exception-for-remediation`;
  - remediation: `adr-2026-07-13-kickback-build-no-op-escalation`, `adr-2026-07-26-cross-dispatch-kickback-livelock-bound`, `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class`, `adr-2026-08-29-operator-authorized-kickback-budget-recovery` (superseded; read for its #2944 notes), `adr-2026-08-12-cumulative-build-review-convergence-bound`, `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence`, `adr-2026-09-06-reopened-task-resolution`, `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback`, `adr-2026-08-25-as-built-remediable-findings-bounded-build-route`, `adr-2026-07-06-manual-test-fail-routing`, `adr-2026-08-31-kickback-ledger-read-fails-closed`;
  - stacked chain: `adr-2026-10-07-per-child-build-region`, `adr-2026-10-03-stacked-child-plans-identity-and-state`, the sliced-plan ownership ADR, `adr-2026-10-10-stacked-restack-journaled-replay`;
  - commit stamping: the session-hook task stamping and demote-task-stamping ADRs.
- **Narrowed out by subject:** providers, cost and telemetry export, memory, intake, release and
  changelog, DECIDE tooling, daemon process and UI, rebase resolution and publication, protected
  seal rebaseline and reseal, tautology and coverage rubrics, containment and live boundary.
- **Excluded as fully superseded:** none.

## Conflict: B1 — the host-entry no-op guard fires on an owner task's past completion

**Stories involved:** Story 1 (no-op criterion) vs Story 1 happy path, Story 6 happy path; ADR
**Files:** this spec's stories vs `.docs/decisions/adr-2026-07-13-kickback-build-no-op-escalation.md`
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-07-13-kickback-build-no-op-escalation
**Story ID:** Story 1
**ADR opposing sentence (verbatim):** "Historical completion alone does not make an admitted current repair non-dispatchable."
**Story opposing sentence (verbatim):** "Given round `r1` region entry, when `T1` is already complete on child 1's tree, then the feature halts with `kickbackOutcome` `derived-already-complete`."

**Description:** `T1` belongs to a closed child, so it is always complete, and every audit round
would halt. `kickbackOutcome` is also a field of the `kickback` event, which region entry does not emit.

**Resolution Options:**
1. Halt only when every routed task for the host is already evidence-complete, and carry the outcome on the halt record.
2. Keep the `T1` check for an `existing-task` item with no restage only.

**Resolution (operator):** Option 1. Story 1 was rewritten, and a negative criterion was added:
completed `T1` with a pending `rem-prd-audit-T1` does not halt.

## Conflict: B2 — custom-step charging vs the durable, tree-keyed kickback ledger

**Stories involved:** Story 5 (custom-step criteria) vs the livelock ADR
**Files:** this spec's stories vs `.docs/decisions/adr-2026-07-26-cross-dispatch-kickback-livelock-bound.md`
**Type:** contradiction / state-conflict
**Severity:** blocking
**ADR filename stem:** adr-2026-07-26-cross-dispatch-kickback-livelock-bound
**Story ID:** Story 5
**ADR opposing sentence (verbatim):** "The kickback bound is durable across dispatches and keyed on the tree, not the commit"
**Story opposing sentence (verbatim):** "then no task is appended and only the `lint-docs` counter is charged, in the round receipt."

**Description:** Today `scanKickbackVerdicts` bumps a durable counter keyed by tree under the
re-opened target gate (verified in `conductor.ts`), and that counter resets on progress. A count
summed from receipts would change what the cap means. The story also called the N=1 counter
process-local, which is false for custom steps.

**Resolution Options:**
1. Receipt charging covers `manual_test` only. A routed custom-step kickback keeps today's ledger bump, and the receipt echoes it.
2. Amend the livelock ADR to move custom-step charging into the receipt for stacked routed rounds.

**Resolution (operator):** Option 1. Story 5's custom-step criteria and its N=1 wording were rewritten.

## Conflict: B3 — verify-green vs two acceptance-RED ADRs that #2944 never amended

**Stories involved:** Story 3 vs `acceptance-specs-red-evidence.md` Story 1, `writing-system-tests-red-exit-gate.md` (negative path); ADRs
**Files:** this spec's stories vs `.docs/decisions/adr-2026-07-21-engine-owned-acceptance-red-execution.md`, `.docs/decisions/adr-2026-08-09-recorded-red-exception-for-remediation.md`
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-07-21-engine-owned-acceptance-red-execution
**Story ID:** Story 3
**ADR opposing sentence (verbatim):** "When the `acceptance_specs` completion gate reports the RED marker missing/invalid but spec files are committed, the engine executes the recorded contract itself"
**Story opposing sentence (verbatim):** "Given host 1's routed pass, when `acceptance_specs` runs, then the RED self-heal is never invoked and no `missing` RED refusal is recorded."
**ADR filename stem (second):** adr-2026-08-09-recorded-red-exception-for-remediation
**ADR opposing sentence (verbatim):** "An unrecorded green run stays rejected, with its reason unchanged."
**Story opposing sentence (verbatim):** "Given a child closed before this change with no `red/c1` ref, when its routed pass runs acceptance on passing specs, then the step completes without a refusal."

**Description:** Routed decision 9 amended only the lifecycle ADR. The engine-owned execution and
recorded-exception ADRs, and two older unscoped stories, still require RED or self-heal on every pass.
Story 3 also did not cover a present-but-invalid marker or say which `acceptance_red` state is emitted.

**Resolution Options:**
1. Add #3211 amendment notes to both ADRs, scope the two old stories to non-routed passes, and add criteria for the marker and the event state.
2. Model verify-green as a recorded RED exception kind.

**Resolution (operator):** Option 1.
- Amendment notes were added to engine-owned D2 and D5 and to recorded-exception D2 and D3.
- The two old stories now exclude a routed repair pass.
- Story 3 gains:
  - `mode: verify-green` on `acceptance_red`;
  - a legacy marker is not a refusal;
  - a digest mismatch fails.

## Degrading conflicts

| Id | Parties | Description | Resolution (operator) |
|---|---|---|---|
| D1 | Story 4 vs `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` D2, D3 ("In a stacked feature the typed cap evidence is recorded in the halted child's ledger") | A raise goes to the flat ledger, but the cap evidence was child-local | The cap halt for a whole-feature gate writes typed evidence and a generation to the flat ledger (Story 4 criterion). Amendment notes on the ADR's D2 and D3 |
| D2 | Story 5 order vs spec B Story 5 "exactly one `kickback` event" | A taskless round could emit a second `kickback` from the caller, or after a crash before the marker | Story 5 criterion: the caller emits no second event. The crash duplicate is accepted, as in spec B |
| D3 | Story 2 `Round:` stamping vs Story 8 operator-commit refusal (ADR D5) | Operator commits through the hook are stamped, so a reroute resets them off the branch | Accepted. They stay at `rejected/<roundId>/<n>`, and `remediation_rerouted` names the ref (Story 8 criterion) |
| D4 | Story 2 vs `adr-2026-10-03-stacked-child-plans-identity-and-state` D8 ("`task-status.json` and `current-task` stay flat") | The story said "child 2's task status" | Reworded to the flat task status through host 2's execution projection |
| D5 | Story 4 stored `authored` 0 fails closed vs `plan-growth-budget-reads-authored-0-and-cap-0-for-.md` S1/S2 and `offer-ship-or-continue-at-remediation-budget.md` Story 2 | Older stories re-derive `authored` | Accepted as a known compromise, as in spec A (stacked features only) |
| D6 | Story 1 append vs `kickback-cap-raise-replays-the-halted-lap-s-remedi.md` ("Given an unreadable kickback ledger, when a remediation round would append, then the feature halts fail-closed") | Region entry appends with no ledger read; settlement fails closed before dispatch | The old criterion is scoped to N=1 features |
| D7 | Story 3 create-only `red/c<k>` vs `build-loop-cannot-complete-a-feature-child-by-chil.md` Story 1 (resumed closure) and per-child D5 (a child with no owned criteria has no marker) | A resumed closure would be refused permanently; flag-off parity was unclear | `red/c<k>` is written only with routing on and a RED marker present; a same-digest blob is accepted on resume (Story 3 criteria) |

A finding that `round-stamp` needs a release-gate migration or waiver was rejected.
`classifyBreakingSurfaces` flags `hook wiring` only for paths under `hooks/`, and
`src/conductor/src/engine/git-hook-assets.ts` is not one (architecture review V19).

## Pairs examined and found compatible

- Spec B Story 3 (FAIL-only join handed to #3211) vs Story 5: a sequenced hand-off.
- Spec B Story 3 (mixed-round `restage: false`) vs Story 6: consistent.
- Spec B Story 5 (one kickback and one rewind per round, stack-unique rem ids, journal fence) vs Stories 1, 2 and 9: consistent.
- #2944 Story 7 (raises go to the flat ledger; the execution-child resolver) vs Story 4: consistent.
- #2944 Stories 6 and 15 (teardown of `red/`, outbox events, the `credit` flag) vs Stories 3, 7 and 8: consistent.
- #2944 Stories 1 and 16 (N=1 golden guard) vs Stories 2 and 9: consistent, through the `routingEligible` short-circuit.
- Per-child D10 (child ledgers refuse growth and `pendingRepair`) vs `routedRepairCredit`: the credit is neither, and D10 is amended by #2944.
- The cumulative-convergence and rebase-refund ADRs vs Story 7: amended or unchanged, as Story 7 states.
- Reopened-task resolution vs Story 6: amended by #2944.
- Seal rotation (`compose-sealed…` Story 2) vs Story 2: already scoped.
- `prepare-commit-msg-reconciles-self-stamped-trailer` vs Story 2: `Round:` is a separate trailer from `Task:`.
- Oscillation: none. Settlement retries are capped at 3. Reroutes move strictly upward (at most N−1). Unverified claims are bounded by region caps, and the credit is single-use.

## Re-check (2026-10-15)

The re-check found no blocking conflicts. It found four degrading leftovers, all resolved by the operator:

| Id | Description | Resolution |
|---|---|---|
| R1 | B2's resolution contradicted routed decision 10 ("the taskless charges under their gate keys (`manual_test`, or the custom step's id)") | #3211 amendment note on routed decision 10: only `manual_test` is charged in the receipt; custom steps keep the ledger bump with a receipt echo. Story 5's user sentence reworded |
| R2 | The new `mode` field on `acceptance_red` was not in the lifecycle ADR's decision 1 field list | #3211 amendment note on `adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance` decision 1 |
| R3 | The no-op ADR D1 audits through the `kickback` event, which routed region entry does not emit | #3211 amendment note on `adr-2026-07-13-kickback-build-no-op-escalation` D1 |
| R4 | Story 3 named the flat RED marker path | Corrected to `.pipeline/children/1/acceptance-specs-red.json` (per-child D5) |

Final state: zero blocking conflicts; D5 is accepted as a degrading compromise.

## Recurring patterns (from the spec A and B checks)

- Older unscoped stories state N=1 behaviour as universal (B3, D5, D6).
- #2944 amendment notes landed on an incomplete set of ADRs (B2, B3, D1).
- "Exactly one `kickback` event" breaks at crash windows (D2).
