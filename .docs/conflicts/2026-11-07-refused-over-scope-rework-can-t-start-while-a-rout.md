# Conflict Check: Refused over-scope rework can't start while a routing round is open (#3597)

**Date:** 2026-11-07
**Stories checked:** `.docs/stories/refused-over-scope-rework-can-t-start-while-a-rout.md` (Stories 1–3)
against every file in `.docs/stories/`. Interacting stories were read in full:

- routed-repair-opens-a-new-round-while-an-earlier-r
- routed-remediation-skips-re-run-steps-on-stale-chi
- rebase-base-refresh-revalidation-halts-needs-human
- routed-residue-finding-lands-on-a-taskless-host-an
- operator-command-to-inspect-and-recover-wedged-rou
- a-routed-fix-is-never-carried-up-the-stack-or-foll
- admitted-whole-feature-fixes
- routed-repair-hosts-a-finding-on-a-stack-child-tha
- stacked-repair-restack-conflict
- over-scope-refusal-should-route-to-build-rework-in
- over-scope-halt-accepts-one-criterion-per-clear-so
- prd-audit-has-no-criterion-key-for-an-over-scope-f
- treat-re-affirmed
- refusing-a-newly-raised
- over-scope-accept-stranded
- add-a-judgement-gate
- build-review-halts-needs-human-when-the-judge-reje

**Result:** 0 blocking conflicts. 4 degrading conflicts, each resolved by operator decision on
2026-11-07. Stories were updated in place, and one amendment note was added to
`adr-2026-10-12-routed-whole-feature-repair` D7.

## ADRs examined

- `adr-2026-10-12-routed-whole-feature-repair` (D7, D13, D14, D15 and amendments #3445, #3455, #3459, #3477, #3590)
- `adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework`
- `adr-2026-08-24-over-scope-decision-block-and-durable-refusals` (D6)
- `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback`
- `adr-2026-08-29-build-review-remediate-case-adjudication` (D8)
- `adr-2026-10-07-per-child-build-region`

## ADRs narrowed out

- `adr-2026-10-24-operator-route-round-for-closed-stacked-children`: abandon mode does not interact.
- `adr-2026-10-10-stacked-restack-journaled-replay`: the exit restack is unchanged.
- `adr-2026-09-07-durable-prd-widening`: decision capture is unchanged.
- `adr-2026-07-10-validation-group-join`: the guard sits before the group.
- `adr-2026-07-13-kickback-build-no-op-escalation`: the no-op guard placement is unchanged.
- The build_review severity, scope and lap ADRs: none of them governs gate entry, the fence or the
  refusal halt.

## Conflict: The fence bound contradicts D7's unbounded fence stop

**Stories involved:** Story 3 (this spec) vs ADR D7 and Story 2 of routed-repair-opens-a-new-round-while-an-earlier-r
**Files:** `.docs/stories/refused-over-scope-rework-can-t-start-while-a-rout.md` vs `.docs/decisions/adr-2026-10-12-routed-whole-feature-repair.md`
**Type:** overlap
**Severity:** degrading
**ADR filename stem:** adr-2026-10-12-routed-whole-feature-repair
**Story ID:** Story 3
**ADR opposing sentence (verbatim):** "A fence refusal ends the run with a `mechanical` HALT naming the blocking round, which the daemon's episode-end sweep re-kicks without an operator."
**Story opposing sentence (verbatim):** "Given the same fence refusal recurring three consecutive times with no intervening routing progress, when the daemon re-kicks, then the third HALT is written `needs-human` naming the same blocking round."

**Description:** If the bound holds, the D7 sentence fails on the third stop. The story's scope
was also unclear: it bounded only refusal rework, while the review bounded the shared admission.

**Resolution Options:**
1. Bound every stacked-route fence stop through the routing stall, and add a #3597 amendment note
   on D7. This matches #3477's region-entry bound.
2. Drop the bound and keep the fence unbounded, as D7 states.
3. Bound refusal rework only.

**Recommendation and resolution:** Option 1, selected by the operator. Story 3 now bounds every
stacked audit fence stop, and D7 carries the amendment note.

## Conflict: The guard tests the marker alone, which D7 says is not the test

**Stories involved:** Story 2 vs ADR D7 base-refresh bullet and Story 4 of routed-remediation-skips-re-run-steps-on-stale-chi
**Files:** `.docs/stories/refused-over-scope-rework-can-t-start-while-a-rout.md` vs `.docs/decisions/adr-2026-10-12-routed-whole-feature-repair.md`
**Type:** state-conflict
**Severity:** degrading
**ADR filename stem:** adr-2026-10-12-routed-whole-feature-repair
**Story ID:** Story 2
**ADR opposing sentence (verbatim):** "The marker alone is not the test, because it is deleted between hosts."
**Story opposing sentence (verbatim):** "As the operator of a stacked feature, I want no whole-feature gate to run while a repair marker or a revalidation queue entry exists, on any path into that gate, so that leaf audits only ever judge a feature whose routed rounds have finished."

**Description:** Take a non-closed round with a `pending` host, no marker and an empty queue. That
state passes the marker-or-queue guard, so `prd_audit` could start and hit the fence again. This
breaks Story 3's first happy path.

**Resolution Options:**
1. Make the guard refuse while any route record is not `closed`, in addition to the marker and
   queue checks.
2. Keep the marker/queue guard and rely on reconciliation always admitting the next host first.

**Recommendation and resolution:** Option 1, selected by the operator. Story 2 now defines
"routed work is outstanding" to include a non-closed route record, and adds a pending-host criterion.

## Conflict: A fence refusal reads as the "no refusal rework admitted" case

**Stories involved:** Story 3 vs over-scope-halt-accepts-one-criterion-per-clear-so, prd-audit-has-no-criterion-key-for-an-over-scope-f, over-scope-refusal-should-route-to-build-rework-in TI-4
**Files:** `.docs/stories/refused-over-scope-rework-can-t-start-while-a-rout.md` vs `.docs/decisions/adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework.md`
**Type:** contradiction
**Severity:** degrading
**ADR filename stem:** adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework
**Story ID:** Story 3
**ADR opposing sentence (verbatim):** "If the planner cannot produce such tasks, or returns a human disposition, the route is the existing refused HALT."
**Story opposing sentence (verbatim):** "Given refusal rework refused by the round-admission fence, when the HALT body is written, then it contains no `revise-decision` entry and no over-scope decision block requesting a new decision, and the recorded refusal decisions remain preserved for the next audit lap."

**Description:** The existing criteria name "no refusal rework admitted" or "rework not possible"
as the trigger for the refused HALT, which carries a revise-decision entry. A fence refusal fits
those words, and today's code treats it that way.

**Resolution Options:**
1. Define a fence refusal as a routing deferral, not "rework not possible". The mechanical HALT
   lists the refused keys for context, with no decision block. A spent allowance or a planner that
   cannot produce rework keeps the refused HALT.
2. Keep the decision block in the mechanical fence HALT.

**Recommendation and resolution:** Option 1, selected by the operator. The story preamble and
Story 3 state the deferral meaning. The D7 note records it against `adr-2026-10-03` D3, which is
unchanged.

## Conflict: A resumed settled host might re-dispatch build_review

**Stories involved:** Story 1 vs routed-remediation-skips-re-run-steps-on-stale-chi Stories 1 and 5
**Files:** `.docs/stories/refused-over-scope-rework-can-t-start-while-a-rout.md` vs `.docs/stories/routed-remediation-skips-re-run-steps-on-stale-chi.md`
**Type:** sequencing
**Severity:** degrading

**Description:** Story 1 says a resumed host takes its routed exit without re-running
`build_review`. Existing routed stories re-dispatch `build_review` when its verdict is not
satisfied for the current round. The settled arm saves only the step status, so a raw FAIL verdict
may stay on disk.

**Resolution Options:**
1. Add a criterion that adjudication settlement leaves `build_review` satisfied in the current
   round, as a clean PASS does.
2. Leave it to the plan to verify.

**Recommendation and resolution:** Option 1, selected by the operator. Story 1 gains that criterion
and a resume Done-When check.

## Pairs checked with no conflict

- No existing story requires an adjudication-settled `build_review` to go straight to the next step.
  adjudication D8 makes it an effective PASS.
- No existing story lets leaf gates run with a marker present. a-routed-fix-is-never-carried-up
  Story 6 forbids it.
- treat-re-affirmed is compatible: re-affirming a refusal appends nothing, and `halt clear` then
  makes routing progress.

## Re-check

After the resolutions, a re-check found no blocking or degrading conflicts. Story 3's
non-fence negative path keeps the existing refused HALT for a spent allowance or a planner that
cannot produce rework. That is consistent with `adr-2026-10-03` D3 and the earlier refusal
stories.
