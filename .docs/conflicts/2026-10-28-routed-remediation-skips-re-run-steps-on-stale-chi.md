# Conflict Check: Routed remediation skips re-run steps on stale child verdicts, then exits markerless

**Date:** 2026-10-28
**Stories checked:** `.docs/stories/routed-remediation-skips-re-run-steps-on-stale-chi.md` (Stories 1–5)
**Result:** Passed after resolution. One blocking conflict and one degrading conflict were resolved
by narrowing this spec's own criteria. One suspected conflict proved disjoint. No accepted story or ADR on main changes.

## Conflict: A refused resume exit cannot be the parked HALT with the host still repairing

**Stories involved:** Story 5 (this spec) vs `a-routed-fix-is-never-carried-up-the-stack-or-foll` Story 1, and `stack-preflight-refusals-end-the-run-with-no-halt-` Story 2
**Files:** [.docs/stories/routed-remediation-skips-re-run-steps-on-stale-chi.md] vs [.docs/stories/a-routed-fix-is-never-carried-up-the-stack-or-foll.md], [.docs/stories/stack-preflight-refusals-end-the-run-with-no-halt-.md], [.docs/decisions/adr-2026-10-12-routed-whole-feature-repair.md]
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-10-12-routed-whole-feature-repair
**Story ID:** Story 5
**ADR opposing sentence (verbatim):** "A rollback halts as restack decision 5 already requires"
**Story opposing sentence (verbatim):** "Given an interrupted host whose routed exit is refused on resume, when the run stops, then it writes the parked HALT of Story 4 naming round `r5`, host 1 and the exit's refusal reason, and host 1 stays `repairing`."

**Description:** The exit moves the host to `built` before its restack, and a restack rollback
leaves the host `built` under a needs-human HALT ("host 1 is still `built`, and the feature halts
needs-human naming the failed check"). A preflight-reached exit refusal writes needs-human
("`.pipeline/HALT` is written needs-human with that detail in its first line"). The old criterion
demanded a `mechanical` parked HALT and a `repairing` host for every refusal, which no exit can
satisfy alongside those stories.

**Resolution Options:**
1. A refused resume exit stops exactly as an in-loop exit refusal does from the same state, and records no routing stall.
2. Narrow the criterion to refusals before the `built` compare-and-swap only.
3. Pick one class for every exit refusal across callers and amend the other stories.

**Selected:** Option 1. It follows decision 13's single exit continuation and leaves the restack
and preflight stories untouched. Story 5's criterion, the D13 #3455 note, the diagram and the
architecture review now say this.

## Conflict: An already-wedged feature carries a needs-human HALT

**Stories involved:** Story 1 (this spec) vs `let-an-operator-park-settle-without-a-needs-human-` Story 2
**Files:** [.docs/stories/routed-remediation-skips-re-run-steps-on-stale-chi.md] vs [.docs/stories/let-an-operator-park-settle-without-a-needs-human-.md]
**Type:** state-conflict
**Severity:** degrading

**Description:** Story 1 said a wedged feature heals "without any operator action", but the
existing markerless path writes a needs-human HALT (`daemon-runner.ts` `terminateFeature`), and the
other story keeps it refused "by its halt disposition".

**Resolution Options:**
1. The wedged feature heals after the operator clears that HALT, with no verdict edited by hand.
2. Scope the fixture to a wedged state with no live HALT.

**Selected:** Option 1. The manual verdict deletion the current runbook needs is gone; the one HALT
clear stays.

## Checked, not a conflict: an authorized crossed HALT

`stack-preflight-refusals-end-the-run-with-no-halt-` Story 3 replaces a live HALT "that a matching
resume authorization permits crossing". That rule belongs to the stack preflight's own stop
(`runStackPreflight`'s wrapper). The conductor loop's parked stop never meets such a HALT: the
daemon's resume-authorization sweep (`consumeResumeAuthorizations`) clears an authorized HALT
before dispatch. So Story 4's "left byte-identical" and the preflight's replacement govern disjoint
stops. Verified from the code and the preflight comment, 80%.

## Related finding resolved: revalidate hosts and the resume exit

Story 5 required all four region verdicts written in the round, but a `revalidate` round keeps
`build` and `acceptance_specs` `done` by status. The resume-exit test is now "every region gate
satisfied under the round scope", and Story 5 gains a `revalidate` happy path.

## Accepted assumptions (no text conflict)

- Stall identity and progress follow #3445 as landed (identical non-closed round sets;
  `routed_repair_phase` or `remediation_routed` resets). Parked and preflight stalls on one round
  share the count. Errs toward `needs-human`; architecture-review Condition 1 maps onto the landed shape.
- `adr-2026-07-28-total-halt-classification-legacy-boundary` requires provable retry safety for
  `mechanical`. A parked stop is retry-safe because the next preflight re-reads durable routing
  state, and #3445's cap bounds it.
- The overlay mask also reaches other overlay readers (dashboard, halt-clear, auto-resume, FINISH
  fence). It applies only while a marker names the active child, so FINISH is unaffected.

## Compatible

- `persist-routed-forward-build-verdict-before-select`: the forward verdict is written through `writeVerdict(..., activeRegionChild)`, so the stamp covers it.
- `gate-satisfied-without-dispatch-leaves-no-state-ke`: no marker at FINISH.
- `clamp-resume-entry-to-a-runnable-step-and-halt-whe` and `adr-2026-07-11-verdict-aware-resume-entry` D5: one satisfaction authority; the mask lives in the overlay both read.
- `markerless-no-verdict-daemon-exit-is-always-classi` and `conduct-loop-exits-silently-between-steps-no-termi`: the parked arm is already exempt; this spec gives it a marker.
- `admitted-whole-feature-fixes-in-a-stacked-feature-` (no restage on resume) and `whole-feature-audit-fixes-cannot-land-in-the-stack` (a `repairing` host resumes its region): consistent.
- `routed-repair-opens-a-new-round-while-an-earlier-r`: stall machinery reused, not redefined.

## Examined

Stories: a-routed-fix-cannot-be-built-charged-and-reviewed-, routed-repair-opens-a-new-round-while-an-earlier-r, routed-round-growth-halt-misreports-cap-overrun-as, a-routed-fix-is-never-carried-up-the-stack-or-foll, admitted-whole-feature-fixes-in-a-stacked-feature-, whole-feature-audit-fixes-cannot-land-in-the-stack, stacked-repair-restack-conflict-above-the-repaired, stack-preflight-refusals-end-the-run-with-no-halt-, manual-reviewer-edits-cannot-be-landed-safely-in-t, build-loop-cannot-complete-a-feature-child-by-chil, successful-stacked-restack-halts-on-a-stale-reopen, markerless-no-verdict-daemon-exit-is-always-classi, let-an-operator-park-settle-without-a-needs-human-, multi-child-feature-cannot-resume-after-an-operato, clamp-resume-entry-to-a-runnable-step-and-halt-whe, conduct-loop-exits-silently-between-steps-no-termi, persist-routed-forward-build-verdict-before-select, gate-satisfied-without-dispatch-leaves-no-state-ke. Unmerged spec branches grepped for routed-repair, overlay, parked and markerless terms; the named routed-leaf, routed-verify-green, stacked-no-op-rebase and planner-escalation stories are already on main.

ADRs examined: adr-2026-10-12-routed-whole-feature-repair, adr-2026-10-07-per-child-build-region, adr-2026-10-24-operator-route-round-for-closed-stacked-children, adr-2026-10-10-stacked-restack-journaled-replay, adr-2026-10-03-stacked-child-plans-identity-and-state, adr-2026-07-11-verdict-aware-resume-entry, adr-2026-07-28-total-halt-classification-legacy-boundary.

Narrowed out: adr-2026-07-10-validation-group-join (`test_suite` and `build_review` are not validation-group members); adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity (SHIP-tail gates only; its rule never makes an unstamped verdict more trusted, which agrees).
