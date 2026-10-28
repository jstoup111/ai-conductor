# Coherence: Foundation for routing whole-feature fixes to the owning stacked child (#2944)

**Plan:** .docs/plans/whole-feature-audit-fixes-cannot-land-in-the-stack.md
**Stories:** .docs/stories/whole-feature-audit-fixes-cannot-land-in-the-stack.md
**Track:** technical, so there are no FR rows. **Tier:** L.
**Source-Ref:** jstoup111/ai-conductor#2944

This is the foundation spec of a four-spec delivery (ADR decision 18). Outcomes delivered by
#3210, #3211, #3212 and #3203 are waived here, and each waiver names its home.

## Traceability

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Quote / Notes |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 |  | gap | **Classification first.** Leaf-gate findings are classified and admitted exactly as today. PLAN_GAP, DESIGN, OVER_SCOPE and malformed-evidence findings halt or refuse as they do now, whether or not an implementing child exists. — outcome-1: delivered by #3210; waived in `.docs/coherence-waivers/whole-feature-audit-fixes-cannot-land-in-the-stack.md`. |
| outcome | outcome-2 |  | gap | **Admitted work goes to its owning child.** Work from a FIXABLE or REMEDIABLE finding lands in the child that owns the cited story or decision. — outcome-2: delivered by #3210; waived in `.docs/coherence-waivers/whole-feature-audit-fixes-cannot-land-in-the-stack.md`. |
| outcome | outcome-3 |  | gap | If that child cannot host the fix because a prerequisite lives in a later child, the fix lands in the earliest child that can. — outcome-3: delivered by #3210 and #3211; waived in `.docs/coherence-waivers/whole-feature-audit-fixes-cannot-land-in-the-stack.md`. |
| outcome | outcome-4 | story-15 | gap | The chosen child, the reason and any fallback are recorded before the change is made, and are observable on the event spine. — outcome-4: delivered by #3210 (recording) with events delivered here; waived in `.docs/coherence-waivers/whole-feature-audit-fixes-cannot-land-in-the-stack.md`. |
| outcome | outcome-5 |  | gap | **Children above re-validate.** After a routed fix, every child above the fixed one is re-validated. The leaf gates then re-run under their existing lap caps. — outcome-5: delivered by #3212; waived in `.docs/coherence-waivers/whole-feature-audit-fixes-cannot-land-in-the-stack.md`. |
| outcome | outcome-6 |  | gap | **Feature budgets stay feature-wide.** Repair budgets (prd_audit and as-built laps and growth) keep their per-feature meaning, and a pending repair settles exactly once at the target child's dispatch, including after a crash. — outcome-6: delivered by #3211; waived in `.docs/coherence-waivers/whole-feature-audit-fixes-cannot-land-in-the-stack.md`. |
| outcome | outcome-7 |  | gap | **Routed remediation tasks** carry their child, and the plan stays valid after every routed append. — outcome-7: delivered by #3211; waived in `.docs/coherence-waivers/whole-feature-audit-fixes-cannot-land-in-the-stack.md`. |
| outcome | outcome-8 |  | gap | **Landing skill.** A human or agent with a manual change, such as a reviewer-requested edit, can get it landed in the correct child. Its commits are refused if made on the wrong child. — outcome-8: delivered by #3203; waived in `.docs/coherence-waivers/whole-feature-audit-fixes-cannot-land-in-the-stack.md`. |
| outcome | outcome-9 | story-1, story-16 | covered | **N=1 features** route and remediate exactly as today. |
| story | story-1 | task-3 | covered | Classification runs first, and features without children are untouched |
| story | story-6 | task-4 | covered | Routing refs are torn down by explicit name |
| story | story-7 | task-1, task-2, task-12, task-13, task-14, task-15, task-16, task-17, task-19 | covered | Every operator and engine surface acts on the child being repaired |
| story | story-15 | task-5, task-6, task-7, task-8, task-11 | covered | Every routing step is visible on the event spine, exactly once |
| story | story-16 | task-18 | covered | Routing stays off until the project turns it on |
| task | task-1 | story-7 | covered | Serves story 7. |
| task | task-2 | story-7 | covered | Serves story 7. |
| task | task-3 | story-1 | covered | Serves story 1. |
| task | task-4 | story-6 | covered | Serves story 6. |
| task | task-5 | story-15 | covered | Serves story 15. |
| task | task-6 | story-15 | covered | Serves story 15. |
| task | task-7 | story-15 | covered | Serves story 15. |
| task | task-8 | story-15 | covered | Serves story 15. |
| task | task-11 | story-15 | covered | Serves story 15. |
| task | task-12 | story-7 | covered | Serves story 7. |
| task | task-13 | story-7 | covered | Serves story 7. |
| task | task-14 | story-7 | covered | Serves story 7. |
| task | task-15 | story-7 | covered | Serves story 7. |
| task | task-16 | story-7 | covered | Serves story 7. |
| task | task-17 | story-7 | covered | Serves story 7. |
| task | task-18 | story-16 | covered | Serves story 16. |
| task | task-19 | story-7 | covered | Serves story 7. |
| adr | adr-2026-10-12-routed-whole-feature-repair | story-1, story-6, story-7, story-15, story-16 | covered | Decision-by-decision plan mapping in the plan's Architecture Obligation Coverage; judged under §4f. |
| adr | adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback | story-16 | covered | Constrains this spec only through the dark-launch setting (story-16); its #2944 amendments are implemented by #3210, #3211 or #3212, as the plan's Architecture Obligation Coverage records; judged under §4f. |
| adr | adr-2026-08-25-as-built-remediable-findings-bounded-build-route | story-16 | covered | Constrains this spec only through the dark-launch setting (story-16); its #2944 amendments are implemented by #3210, #3211 or #3212, as the plan's Architecture Obligation Coverage records; judged under §4f. |
| adr | adr-2026-09-06-reopened-task-resolution | story-16 | covered | Constrains this spec only through the dark-launch setting (story-16); its #2944 amendments are implemented by #3210, #3211 or #3212, as the plan's Architecture Obligation Coverage records; judged under §4f. |
| adr | adr-2026-08-22-one-owner-per-review-question | story-16 | covered | Constrains this spec only through the dark-launch setting (story-16); its #2944 amendments are implemented by #3210, #3211 or #3212, as the plan's Architecture Obligation Coverage records; judged under §4f. |
| adr | adr-2026-07-13-kickback-build-no-op-escalation | story-16 | covered | Constrains this spec only through the dark-launch setting (story-16); its #2944 amendments are implemented by #3210, #3211 or #3212, as the plan's Architecture Obligation Coverage records; judged under §4f. |
| adr | adr-2026-08-29-operator-authorized-kickback-budget-recovery | story-16 | covered | Constrains this spec only through the dark-launch setting (story-16); its #2944 amendments are implemented by #3210, #3211 or #3212, as the plan's Architecture Obligation Coverage records; judged under §4f. |
| adr | adr-2026-07-06-manual-test-fail-routing | story-16 | covered | Constrains this spec only through the dark-launch setting (story-16); its #2944 amendments are implemented by #3210, #3211 or #3212, as the plan's Architecture Obligation Coverage records; judged under §4f. |
| adr | adr-2026-07-10-validation-group-join | story-16 | covered | Constrains this spec only through the dark-launch setting (story-16); its #2944 amendments are implemented by #3210, #3211 or #3212, as the plan's Architecture Obligation Coverage records; judged under §4f. |
| adr | adr-2026-08-12-cumulative-build-review-convergence-bound | story-16 | covered | Constrains this spec only through the dark-launch setting (story-16); its #2944 amendments are implemented by #3210, #3211 or #3212, as the plan's Architecture Obligation Coverage records; judged under §4f. |
| adr | adr-2026-10-03-stacked-child-plans-identity-and-state | story-6, story-7 | covered | Decision-by-decision plan mapping in the plan's Architecture Obligation Coverage; judged under §4f. |
| adr | adr-2026-10-07-per-child-build-region | story-7 | covered | Decision-by-decision plan mapping in the plan's Architecture Obligation Coverage; judged under §4f. |
| adr | adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance | story-16 | covered | Constrains this spec only through the dark-launch setting (story-16); its #2944 amendments are implemented by #3210, #3211 or #3212, as the plan's Architecture Obligation Coverage records; judged under §4f. |
| adr | adr-2026-10-10-stacked-restack-journaled-replay | story-6, story-15 | covered | Decision-by-decision plan mapping in the plan's Architecture Obligation Coverage; judged under §4f. |
| adr | adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility | story-16 | covered | Constrains this spec only through the dark-launch setting (story-16); its #2944 amendments are implemented by #3210, #3211 or #3212, as the plan's Architecture Obligation Coverage records; judged under §4f. |
| criterion | Story 1 happy: Given an N=1 feature, when `prd_audit` returns a FIXABLE finding, then the rem task is appended on the feature branch, the flat `pendingRepair` is recorded and the loop rewinds to `build` exactly as before this change, and the `PATH`-shimmed `git` in the golden suite records no command naming `refs/conductor/<slug>/routes`, `repairing` or `revalidate`. | 3 | covered | "the `PATH`-shimmed `git` argv log of the N=1 FIXABLE lap contains no argument naming `refs/conductor/<slug>/routes`" | diff-local |
| criterion | Story 1 negative: Given an N=1 feature, when a `manual_test` FAIL or a custom-step kickback is returned, then today's kickback runs with today's counter, `routingEligible` returns false, and the `PATH`-shimmed `git` records no command naming a routing ref. | 18 | covered | "today's kickback runs with today's counter, `routingEligible` returns false" | diff-local |
| criterion | Story 1 negative: Given an unsliced plan, when a whole-feature gate admits work, then the cursor reports `no-child`, and remediation behaves exactly as for an N=1 feature. | 18 | covered | "`resolveActiveChild` returns `no-child` and the goldens match the N=1 lap of Task 3" | diff-local |
| criterion | Story 6 happy: Given a feature with route records, a marker, a queue and `red/c1`, when shipped-record teardown or reclaim runs, then each of those refs is deleted by its explicit name, and no glob deletion is used. | 4 | covered | "records no `for-each-ref` call and no argument ending in `*` or `/` during teardown" | diff-local |
| criterion | Story 6 negative: Given an N=1 feature, when shipped-record teardown or reclaim runs, then no command or `update-ref --stdin` line names `routes/`, `rejected/`, `repairing`, `revalidate` or `red/`. | 4 | covered | "the mocked git runner records no argument, no `cat-file` stdin line and no `update-ref --stdin` line naming" | diff-local |
| criterion | Story 7 happy: Given host 1 `repairing`, when `resolveActiveChild` runs, then it reports the existing kind with `routedRepair: {child: 1, roundId}`, and the restack planner still sees the leaf as the active range. | 12 | covered | "resolves the leaf (child 3, `isLeaf: true`) as the active range without throwing" | diff-local |
| criterion | Story 7 happy: Given host 1 `repairing`, when the operator runs `task status` with no `--child`, then it reports child 1's tasks. | 15 | covered | "`conduct task status` with no `--child` reports the rows of the flat `.pipeline/task-status.json` filtered to child 1's membership" | diff-local |
| criterion | Story 7 happy: Given host 1 `repairing`, when the operator runs `daemon status`, then it shows child 1 as the child being worked, as `1/3`. | 19 | covered | "with host 1 `repairing`, `daemon status` renders ` child 1/3` for the feature." | diff-local |
| criterion | Story 7 happy: Given host 1 `repairing`, when region state is read or written, then child 1's per-child region state is used. | 14 | covered | "a `build` status written by the loop lands in `.pipeline/children/1/conduct-state.json` (the mutation port)" | diff-local |
| criterion | Story 7 happy: Given host 1 `repairing`, when the operator runs `kickback-budget raise --gate prd_audit`, then the raise lands in the flat feature ledger, ignoring the execution-child default. | 17 | covered | "`kickback-budget raise --gate prd_audit` writes the raise into `.pipeline/kickback-ledger.json`" | diff-local |
| criterion | Story 7 happy: Given a closed child 2 and no open round, when the operator runs `rewind --child 2`, then it is refused with a message naming #3203. | 16 | covered | "`rewind: child 2 is closed and cannot be rewound (#3203)`" | diff-local |
| criterion | Story 7 negative: Given host 1 `repairing` and an operator commit with no `Round:` stamp past `closed/c2`, when the cursor runs, then it accepts `repair-pending` with child 2 as a co-origin, and does not halt. | 13 | covered | "`runStackPreflight` writes no `.pipeline/HALT` and the feature does not halt" | diff-local |
| criterion | Story 7 negative: Given host 1 `repairing`, when the cursor reports `repair-pending` for children 1 and 2 and child 2's commits carry another round's `Round:` stamp, then the feature halts needs-human naming child 2. | 13 | covered | "`runStackPreflight` writes a `needs-human` HALT whose text names child 2 and round `r7`" | diff-local |
| criterion | Story 7 negative: Given host 1 `repairing`, when the restack executor reads the cursor, then it does not throw, because the cursor kind is unchanged. | 12 | covered | "`resolveActiveChild` returns kind `repair-pending` with `routedRepair: {child: 1, roundId: 'r1'}`" | diff-local |
| criterion | Story 15 happy: Given a route record whose outbox holds a `routed_repair_phase` event, when the feature resumes, then `.pipeline/events.jsonl` holds that event exactly once, carrying `child`. | 11 | covered | "delivers that event to `events.jsonl` once, carrying `child`, and empties the route record's outbox" | diff-local |
| criterion | Story 15 negative: Given a crash after an outbox entry was persisted and before it was removed from the outbox, when the outbox is drained again, then the persister deduplicates by `eventId`, and the event appears once. | 8 | covered | "the persister suppresses it by `eventId`, the outbox is empty, and `events.jsonl` holds the event once" | diff-local |
| criterion | Story 15 negative: Given a crash after the state transition and before draining, when the feature resumes, then the pending event is still delivered. | 11 | covered | "delivers that event to `events.jsonl` once, carrying `child`, and empties the route record's outbox" | diff-local |
| criterion | Story 15 negative: Given an N=1 feature, when it remediates, then none of the four new events is emitted. | 3 | covered | "the lap's `.pipeline/events.jsonl` contains no event of type `remediation_routed`, `remediation_rerouted`" | diff-local |
| criterion | Story 15 negative: Given the canonical event append fails, when the outbox is drained, then the entry stays in the outbox for the next drain. | 8 | covered | "`drainOutbox` returns `persist-failed`, the entry is still in the route record's outbox" | diff-local |
| criterion | Story 15 negative: Given a persister restarted after an event was persisted, when the same `eventId` is drained again, then it is suppressed, and a replayed event keeps its original occurrence time. | 7 | covered | "persisting `e1` again returns `'duplicate'` and appends nothing" | diff-local |
| criterion | Story 15 negative: Given the outbox removal compare-and-swap fails, when the next drain runs, then the entry is retried and still appears once in the log. | 8 | covered | "the next drain removes the entry while `events.jsonl` still holds the event once" | diff-local |
| criterion | Story 16 happy: Given a three-child stack whose project sets `stacked_prs.route_whole_feature_fixes: true`, when `routingEligible` is evaluated, then it returns true. | 18 | covered | "`routingEligible` returns true for a three-child stack whose config sets `stacked_prs.route_whole_feature_fixes: true`" | diff-local |
| criterion | Story 16 negative: Given a three-child stack whose project leaves `stacked_prs.route_whole_feature_fixes` unset, when `routingEligible` is evaluated, then it returns false, and the `PATH`-shimmed `git` records no command naming `refs/conductor/demo/routes`, `repairing` or `revalidate`. | 18 | covered | "false for that stack with the setting unset" | diff-local |
| criterion | Story 16 negative: Given an N=1 feature whose project sets `stacked_prs.route_whole_feature_fixes: true`, when `routingEligible` is evaluated, then it returns false, because the cursor reports `no-child`. | 18 | covered | "false for an N=1 feature with the setting `true` because the cursor reports `no-child`" | diff-local |

## Judgement Record

- **Design-wide passes (before the split).** All judges were fresh subagents, Claude and Codex, with
  opus for Tier L.
  - Coverage (plan §7a) passed all 173 criteria of the full design, the last one on a fourth round
    the operator approved.
  - The contradiction sweeps found 8, then 1, then 13 grounded conflicts. Each was resolved in the
    ADR, stories or plan, or carried into #3210–#3212 as an open finding.
  - The architecture-obligation judgements found 41 weak rows, then 38.
- **Split.** On 2026-10-12 the operator split delivery into four specs (ADR decision 18) because one
  99-task build was not buildable. This artifact covers the foundation spec only.
- **Foundation-spec passes.** Fresh opus subagents ran coverage, §4d, §4f, §4g and reachability over
  this spec three times.
  - Round 1: coverage 24 of 24. Two blocking findings: flag gating of the drain and cursor reads, and
    teardown's self-contradiction. Plus unreachable primitives and 4 weak obligation rows.
  - Round 2: coverage 23 of 24. Three §4d findings: co-origin definition, N=1 teardown stdin,
    duplicated predicate. Plus 3 weak obligation rows.
  - Every finding was fixed in place. Primitives without a production caller here moved to their first
    callers (#3210 and #3212), and those moves are posted on the issues.
  - The last open claim (Story 7: "does not halt") was re-judged after a no-HALT check was added to
    Task 13.
- **Operator decisions in this DECIDE pass:**
  - outcome-8 (landing skill) moved to #3203;
  - delivery split into #2944, #3210, #3211 and #3212, behind a default-off setting;
  - claim 161 of the full design was given a fourth judge round.
