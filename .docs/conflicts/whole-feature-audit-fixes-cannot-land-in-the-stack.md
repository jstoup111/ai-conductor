# Conflict Check: Route whole-feature audit fixes to the owning stacked child (#2944)

**Date:** 2026-10-12
**New stories:** `.docs/stories/whole-feature-audit-fixes-cannot-land-in-the-stack.md` (15 stories)

**ADR corpus:** repo-wide. Every approved ADR was loaded. Fully superseded ADRs were excluded and
partially superseded ones retained. The examined set is:
- the new `adr-2026-10-12-routed-whole-feature-repair`;
- the 15 ADRs it amends: four stacked-chain ADRs, prd-audit, as-built, reopened-task, one-owner,
  manual-test fail routing, validation-group join, no-op escalation, budget recovery, the convergence
  bound, acceptance-RED lifecycle, and sliced-plan ownership;
- unamended neighbours: `adr-2026-08-31-kickback-ledger-read-fails-closed`,
  `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence`, and the protected-artifact
  seal ADRs.

The remaining ADRs were narrowed out by subject: providers, cost, memory, intake, release, DECIDE
tooling, daemon process and UI.

**Story corpus:** 593 files, narrowed by subject to about 45:
- the stacked chain (#2941–#2943);
- remediation, kickback, budget and growth;
- `manual_test`, validation groups, acceptance RED, repair obligations, the seal, and events.

Every pair sharing a behaviour, entity or gate was checked in both directions. Three independent
sweeps were run: the stacked chain, the remediation gates, and a cross-provider oscillation hunt.

**Delivery split.** The check ran over the full 15-story design before it was split into four specs
(ADR decision 18). This spec keeps Stories 1, 6, 7 and 15 in part, and adds Story 16 (the dark
launch setting). Story 16 touches no existing story's behaviour.

**Result:** PASSED.
- No blocking conflicts remain.
- No oscillating conflicts were found. Every candidate loop is bounded by the cascade cap, region
  caps, lap caps, or the rollback halt.
- Degrading conflicts were accepted by the operator.

## Resolved blocking conflicts

| # | Conflict | Type | Parties | Resolution |
|---|---|---|---|---|
| 1 | Automatic repair on a closed-child commit versus marker suppression | contradiction | `a-change-to-one-stacked-child-cannot-be-carried-in.md` S9; `build-loop-cannot-complete-a-feature-child-by-chil.md` S1, S14 vs new S6 | Old criteria scoped to "no routing round open". ADR decision 7 suppresses the automatic repair for every closed child while a marker exists. |
| 2 | Closed children never re-run versus the re-validation queue | contradiction | `a-change-…` S11 vs new S13 | Old S11 reworded: the restack never re-runs closed children itself, and invalidated children re-validate through the queue. |
| 3 | Rewind refusal names #2944 versus #3203 | contradiction | `build-loop-…` S12; `a-change-…` S9 vs new S7 | Old stories re-pointed to #3203. Restack ADR decision 9 gains a #3203 note. |
| 4 | Base refresh during an open round could replay a host to its closure | state conflict | `build-loop-…` S14; `a-change-…` S1, S9 vs new S6 | ADR decision 7 defers a base refresh while a marker exists (`restack_refused` reason `deferred-base-refresh`). New S6 criterion; old stories scoped. |
| 5 | Order of the next host, the queue and the leaf | sequencing | new S4 vs new S12 | ADR decisions 6 and 13: next child host, then the queue, then the leaf host's items, then the leaf gates. A host's exit acknowledges its own queue entry. |
| 6 | No-op guard fires at route resolution before anything is appended | contradiction | `kickback-to-build-no-op-when-target-evidence-stamped.md` S2 vs new S6, S8 | ADR decision 7: the guard runs at host region entry. Old S2 scoped to N=1. New S8 criterion. |
| 7 | Self-heal re-runs RED on a missing marker versus verify-green | contradiction | `acceptance-specs-hide-missing-red-evidence-and-com.md` S8 vs new S8 | ADR decision 9: a routed or re-validation pass is not a self-heal run. Old story scoped. |
| 8 | Review base is always the parent tip versus a routed snapshot base | contradiction | `build-loop-…` S9 vs new S11 | Old S9 criteria for child 1 and child 2 scoped to outside routed and re-validation passes. |
| 9 | New refs never deleted at teardown | resource contention | `a-change-…` S14 vs new S5, S6, S8, S13 | ADR decision 6 lists the refs. Restack decision 11 note. New S6 criterion: explicit-name deletion, no glob. |

## Resolved degrading conflicts

| Conflict | Parties | Resolution |
|---|---|---|
| Unconditional task-membership refusal | `build-loop-…` S12 vs new S4 | Old criterion scoped to no open route granting the execution projection |
| Whole-feature kickbacks land on the leaf | `build-loop-…` S4 vs new S3 | Old criteria re-pointed to the execution child |
| Growth recorded only in the flat ledger | `build-loop-…` S11 vs new S4, S9 | Old line reworded: never a child ledger; the receipt is the authority, the flat ledger its cache |
| Where a rem task's child comes from | `build-loop-…` S6 vs new S8 | `Child:` line authoritative; fail closed only when it and the cache are both absent (ADR decision 9; new S8) |
| Seal rotation trusts only engine-state ids | `compose-sealed-content-and-engine-remediation-appe.md` S2 vs new S8, S12 | "Recorded" now includes a route record's frozen allocation (ADR decision 9; old story and new S8) |
| A reroute moves the obligation boundary | `remediation-halts-when-the-owning-plan-task-is-alr.md` S3 vs new S10 | Old story gains the verified-reroute exception |
| Exactly one rewind per round | `parallel-validation-phase-fan-out-manual-test-prd-.md` vs new S3, S4 | ADR decision 7: one `kickback` event and one leaf `navigateBack` per round. New S6 criterion. |
| Existing-task suppression in mixed rounds | `plan-growth-allowance-is-spent-on-work-existing-ta.md` vs new S3 | ADR decision 3: existing-task gaps ride their host's hint without restage. New S3 criterion. |
| `manual_test` cap timing and reason | `manual-test-fail-routing.md` S3; `daemon-mode-kickbacks-…` vs new S9 | ADR decision 10: taskless caps are checked at admission in today's order and reason. New S9 criterion. |
| As-built prior findings after worktree recreation | `as-built-review-receives-bounded-inputs-and-return.md` vs ADR 08-25 note | ADR decision 10: prior findings also read the route records. New S9 criterion. |
| OVER_SCOPE "as today" versus refusal-rework routing | new S1 vs new S3 | S1 scoped to OVER_SCOPE with no recorded refuse decision |
| `daemon status` during a routed repair | `build-loop-…` vs new S7 | ADR decision 8 adds `daemon status` and the dashboard to the execution-child consumers. New S7 criterion. |
| Credit grant event name | new S11 vs new S15 | `routed_repair_phase` carries `credit` (ADR decision 16) |
| Gate-join earliest target before the region | `parallel-validation-…` vs new S1 | ADR decision 7: not routed, today's behaviour. New S1 criterion. |

## Accepted degrading conflicts (operator, 2026-10-12)

These older stories were written before stacking and are not scoped to N=1. For stacked features
they are governed by the #2944 amendment notes on their ADRs, and their text is left unchanged:
- **Charging at "BUILD dispatch":**
  - `kickback-cap-raise-replays-the-halted-lap-s-remedi.md` S3;
  - `over-scope-refusal-should-route-to-build-rework-in.md`;
  - `plan-growth-allowance-is-spent-on-work-existing-ta.md`;
  - `every-as-built-blocked-verdict-halts-needs-human-i.md`.

  For stacked features, the first host's dispatch applies (prd-audit decisions 5 and 6, and as-built
  decision 4 notes).
- **Growth denominator:** `plan-growth-budget-reads-authored-0-and-cap-0-for-.md` S1 and S2 derive
  `authored`. For stacked features it is stored from the sealed plan (prd-audit decision 6 note).
- **Existing-task restage timing:** `plan-growth-allowance-is-spent-on-work-existing-ta.md`
  restages before the rewind. For stacked features it restages at host region entry (as-built
  decision 9 note).

## Checked, no conflict

- **Refunds:** `feature-repair` never refunds; `routedRepairCredit` is a separate allowance.
- **Cursor kinds:** unchanged; `routedRepair` and `revalidating` are fields.
- **`closeChild`:** runs only at first closure; a routed exit never calls it.
- **Halt-record-only commits on the checked-out host:** allowed by the reroute guard.
- **Event dedup:** extending the persister's `eventId` allowlist is additive and survives a restart.
- **Ledger fails closed:** rebuilding stacked charges from receipts is stricter than
  `adr-2026-08-31-kickback-ledger-read-fails-closed` requires.
