# Conflict Check: Place admitted whole-feature fixes in the owning stacked child (#3210)

**Date:** 2026-10-14
**New stories:** `.docs/stories/admitted-whole-feature-fixes-in-a-stacked-feature-.md` (Stories 1–7)

**ADR corpus:** repo-wide, narrowed by subject. Examined:
- `adr-2026-10-12-routed-whole-feature-repair` and
  `architecture-review-2026-10-14-admitted-whole-feature-fixes-in-a-stacked-feature-`;
- `adr-2026-10-10-stacked-restack-journaled-replay` (decisions 4, 7 and 9 in full);
- `adr-2026-09-11-finish-mergeability-respects-active-review-inputs`;
- `adr-2026-07-13-kickback-build-no-op-escalation`;
- `adr-2026-07-04-kickback-event-emission-and-log-prominence`;
- `adr-2026-08-22-one-owner-per-review-question`;
- `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback`;
- `adr-2026-08-25-as-built-remediable-findings-bounded-build-route` (decisions 7–9);
- `adr-2026-07-10-validation-group-join` (decision 3);
- `adr-2026-07-06-manual-test-fail-routing`;
- `adr-2026-09-06-reopened-task-resolution` (decision 9);
- `adr-2026-10-07-per-child-build-region` and
  `adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility`, through the routed ADR's
  amendment list and the region stories.

Narrowed out by subject: rebase resolution, force-with-lease, halt PRs, finish records and
publication, the mergeability gate, protected seals, audit trail and event sinks, intra-step
progress, halt events, the live boundary and containment, and kickback-budget recovery and ledger
read failure. No ADR was excluded as superseded.

**Story corpus:** narrowed by subject to the #2944 foundation
(`whole-feature-audit-fixes-cannot-land-in-the-stack.md`), the stacked restack
(`a-change-to-one-stacked-child-cannot-be-carried-in.md`), the per-child region
(`build-loop-cannot-complete-a-feature-child-by-chil.md`), `daemon-build-start-base-refresh.md`,
`parallel-validation-phase-fan-out-manual-test-prd-.md` and `manual-test-fail-routing.md`.

Every pair sharing a behaviour, entity or gate was checked in both directions.

**Result:** PASSED. No blocking conflicts. No oscillating conflict remains: the one latent loop (C3)
was removed by design. The degrading conflicts below were accepted by the operator on 2026-10-14.

## Resolved conflicts

| # | Conflict | Type | Parties | Resolution |
|---|---|---|---|---|
| C5 | An aborted `prepared` round's `remediation_routed` is drained before reconciliation deletes it, so the re-admitted round emits a second event | contradiction | Story 5 vs Story 7, routed ADR D7 order | `remediation_routed` is written by the marker transaction; reconciliation aborts every `prepared` round no marker names (review F11). Stories 5 and 7 updated |
| C3 | Keeping an `applied` journal with a pending follow-on while a round is open makes #3212's exit restack `restack-outstanding`, so the round never closes | oscillating (latent) | Story 6 vs restack ADR decision 9 and routed ADR D13 | The recovery-site deferral is dropped. The route-writer fence refuses while an `applied` journal has a pending follow-on, so no round opens until it runs. Story 5 gains that criterion; Story 6 drops the recovery criterion |
| C7 | The routed round's `kickback` event was required to carry the round id, changing a variant reused verbatim | contradiction | Story 5 vs `adr-2026-07-04-kickback-event-emission-and-log-prominence` D4 | "carrying the round id" removed; `remediation_routed` correlates the round |
| C6 | The FAIL-only join criterion read as the ADR's end state | sequencing | Story 3 vs routed ADR D3 and D18 | Criterion reworded as unchanged in this spec, with #3211 named as the deliverer |
| Gap | Re-kick and FINISH behaviour on deferral was unspecified | overlap | Story 6 vs `adr-2026-09-11-finish-mergeability-respects-active-review-inputs` D5 | The re-kick resume continues instead of halting; a deferred FINISH publishes nothing |
| Gap | No criterion for the leaf no-op guard on a routed round | overlap | Story 5 vs `adr-2026-07-13-kickback-build-no-op-escalation` D1, routed ADR D7 | Story 5: no leaf append and no leaf no-op guard for a routed round |

## Accepted degrading conflicts

**C1. Re-kick and FINISH base refresh are deferred while a round is open.**
- **Parties:** Story 6 vs `adr-2026-09-11-finish-mergeability-respects-active-review-inputs`.
- **ADR filename stem:** adr-2026-09-11-finish-mergeability-respects-active-review-inputs
- **Story ID:** Story 6
- **ADR opposing sentence (verbatim):** "Re-kick retains mandatory play-forward rebase onto the advanced base before retrying its gate and cannot take mergeable-skip."
- **Story opposing sentence (verbatim):** "Given a round open, when the daemon re-kick resume reaches its base refresh, then it emits `restack_refused` with reason `deferred-base-refresh`, runs no base-refresh restack, leaves every branch and `refs/conductor/demo/` ref unchanged, keeps the re-kick request, and continues the resume instead of halting."
- **Accepted because:** the later APPROVED `adr-2026-10-12-routed-whole-feature-repair` decision 7
  defers exactly these refreshes. The play-forward still runs, at the first preflight after the
  round closes and before any gate retry or publish.

**C2. Restack Story 10's FINISH criterion carries no "no routing round open" qualifier.**
- **Parties:** Story 6 vs `a-change-to-one-stacked-child-cannot-be-carried-in.md` Story 10.
- **Story opposing sentence (verbatim):** "Stacked features always restack at FINISH and re-kick".
- **Accepted because:** that story records another feature's delivered behaviour, which routing
  leaves unchanged while the setting is off. The ADR side is governed by routed decision 7.

**C4. The `REKICK` request is kept on deferral.**
- **Parties:** Story 6 vs `adr-2026-10-10-stacked-restack-journaled-replay` decision 7.
- **ADR opposing sentence (verbatim):** "The one-shot `REKICK` sentinel is consumed before a restack runs, so crash recovery depends only on the journal."
- **Accepted because:** on deferral no restack runs, so the sentence still holds. `.pipeline/REKICK`
  not surviving worktree recreation is pre-existing (#497).

**C8. One owner for several bound tasks.**
- **Parties:** Story 2 vs `adr-2026-10-12-routed-whole-feature-repair` Context and assumption A1.
- **ADR opposing sentence (verbatim):** "Every task-bound finding therefore has exactly one owning child (`taskSlices` in the sealed coverage-binding envelope)."
- **Story opposing sentence (verbatim):** "Given a three-child stack, when as-built admits a REMEDIABLE finding citing `task T2,T3`, then the owner is `2` with reason `multi-task-earliest`, and no routing judgement call is made."
- **Accepted because:** the operator decided the earliest-owner rule on 2026-10-14 (review F4). Story
  ownership stays total; the rule only picks one owner when a finding cites several tasks.

**Crash window before the caller's `kickback`.** A crash after the marker transaction and before
the caller emits `kickback` loses that one telemetry event; reconciliation re-navigates the leaf, and
the durable `remediation_routed` and `routed_repair_phase` events still record the round.

## Pairs judged compatible

- Story 1 flag-off and N=1 parity vs #2944 Stories 1 and 16: the cursor reads routing refs only when
  the setting is on, and an open round never trips `isUnroutedRepairPending`.
- Story 1 refusals vs prd-audit decision 7, as-built classification and routed decision 7's
  pre-region rule.
- Story 3 residue call vs `adr-2026-08-22-one-owner-per-review-question` D1, amended by #2944.
- Story 3 mixed-round no-restage vs reopened-task decision 9 and as-built decision 8.
- Story 5 one rewind vs validation-group-join decision 3.
- Story 6 marker skip vs restack decisions 7 and 9, amended by #2944, and #2944 Story 7 co-origins.
- Story 4 host selection vs sliced-plan ownership: slices are never changed.
- Story 7 vs the event-spine principle and #2944 Story 15.
- `daemon-build-start-base-refresh`: runs before any round can exist.
