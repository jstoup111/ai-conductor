# Implementation Plan: Foundation for routing whole-feature fixes to the owning stacked child

**Date:** 2026-10-12
**Design:** .docs/decisions/adr-2026-10-12-routed-whole-feature-repair.md
**Stories:** .docs/stories/whole-feature-audit-fixes-cannot-land-in-the-stack.md
**Conflict check:** Clean as of 2026-10-12 (.docs/conflicts/whole-feature-audit-fixes-cannot-land-in-the-stack.md)

## Summary

This is the first of four specs that deliver `adr-2026-10-12-routed-whole-feature-repair` (decision
18); the others are #3210, #3211 and #3212. It lays the foundation and keeps routing dark behind
`stacked_prs.route_whole_feature_fixes`, which defaults to `false`. The plan has 17 tasks. Task ids
are kept from the design-time plan, so ids 9, 10 and 20–99 belong to the later specs.

## Technical Approach

- **Durable homes (Tasks 1, 4, 5).**
  - `src/conductor/src/engine/routing/route-types.ts` holds the branded `RoundId`, the host and
    round state unions, and the parsers the drain and cursor read.
  - `routing-refs.ts` names every routing ref (`routes/<roundId>`, `rejected/<roundId>/<n>`,
    `repairing`, `revalidate`, `red/c<k>`). Shipped-record teardown and reclaim delete them by
    explicit name, and only for a feature with durable child state.
  - `route-record-store.ts` is the only reader and writer of route-record blobs. It writes only
    through `update-ref --stdin` compare-and-swap, and refuses writes while a restack journal is
    non-terminal.
- **Events (Tasks 6–8, 11).**
  - The four routing members join the `ConductorEvent` union, each carrying `child`.
  - The persister deduplicates them by `eventId`.
  - Route-record outboxes are drained at least once by the stack preflight, after journal recovery
    and before the cursor runs.
- **One idea of the child being worked (Tasks 12–17, 19).**
  - The cursor reports `routedRepair` and `revalidating` fields on its existing kinds.
  - One execution-child resolver drives region entry, both region-state activators, the mutation
    port, `task-cli`, `rewind`, `kickback-budget`, re-kick resume authorisation, dispatch identity
    and `daemon status`.
  - Whole-feature budgets stay in the flat ledger.
  - The closed-child rewind refusal names #3203.
- **Dark launch and N=1 parity (Tasks 2, 3, 18).**
  - `routingEligible` requires both durable child state and the new setting.
  - The N=1 golden suite records its goldens first and guards, through a `PATH`-shimmed `git`, that
    no routing ref is touched.
  - A structural guard keeps switches over the new unions exhaustive.
- **Reachability.** Everything here has a production caller in this spec:
  - routing-ref teardown, from the shipped-record sweep and reclaim;
  - the outbox drain, from the stack preflight;
  - the cursor's marker and queue reads, from `resolveActiveChild`;
  - the execution-child resolver, from region entry and the CLIs;
  - `routingEligible`, from the gap loop.

  The route-record constructors, the transition checks, the outbox append and the routing ports
  move to #3210, their first caller; the restack-journal writer exemption moves to #3212.
- **Open PRs.** #3136, #3133, #3142 and #3135 touch `events.ts` and `event-sinks.ts`. Expect rebase
  conflicts on the event union; the additions are new members only.

## Prerequisites

- #2941, #2942 and #2943 are shipped.
- The #3019 N=1 golden suite exists; Task 3 extends it first (C2).

## Task Dependency Graph

```
- → 1
1 → 2
- → 3
1 → 4
1,4 → 5
1 → 6
3,6 → 7
5,7 → 8
5,8,18 → 11
3,5,18 → 12
12 → 13
2,12 → 14
14 → 15
14 → 16
14 → 17
1,3 → 18
14 → 19
```

## Integration Points

- After Task 8: a route-record fixture's outbox entry reaches `.pipeline/events.jsonl` exactly once.
- After Task 14: region entry, the CLIs and `daemon status` agree on the execution child for a
  hand-written marker.
- After Task 18: with the setting off, no stacked or N=1 feature reaches any routing code.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an N=1 feature, when `prd_audit` returns a FIXABLE finding, then the rem task is appended on the feature branch, the flat `pendingRepair` is recorded and the loop rewinds to `build` exactly as before this change, and the `PATH`-shimmed `git` in the golden suite records no command naming `refs/conductor/<slug>/routes`, `repairing` or `revalidate`. | 3 | "the `PATH`-shimmed `git` argv log of the N=1 FIXABLE lap contains no argument naming `refs/conductor/<slug>/routes`" | diff-local |
| Story 1 negative: Given an N=1 feature, when a `manual_test` FAIL or a custom-step kickback is returned, then today's kickback runs with today's counter, `routingEligible` returns false, and the `PATH`-shimmed `git` records no command naming a routing ref. | 18 | "today's kickback runs with today's counter, `routingEligible` returns false" | diff-local |
| Story 1 negative: Given an unsliced plan, when a whole-feature gate admits work, then the cursor reports `no-child`, and remediation behaves exactly as for an N=1 feature. | 18 | "`resolveActiveChild` returns `no-child` and the goldens match the N=1 lap of Task 3" | diff-local |
| Story 6 happy: Given a feature with route records, a marker, a queue and `red/c1`, when shipped-record teardown or reclaim runs, then each of those refs is deleted by its explicit name, and no glob deletion is used. | 4 | "records no `for-each-ref` call and no argument ending in `*` or `/` during teardown" | diff-local |
| Story 6 negative: Given an N=1 feature, when shipped-record teardown or reclaim runs, then no command or `update-ref --stdin` line names `routes/`, `rejected/`, `repairing`, `revalidate` or `red/`. | 4 | "the mocked git runner records no argument, no `cat-file` stdin line and no `update-ref --stdin` line naming" | diff-local |
| Story 7 happy: Given host 1 `repairing`, when `resolveActiveChild` runs, then it reports the existing kind with `routedRepair: {child: 1, roundId}`, and the restack planner still sees the leaf as the active range. | 12 | "resolves the leaf (child 3, `isLeaf: true`) as the active range without throwing" | diff-local |
| Story 7 happy: Given host 1 `repairing`, when the operator runs `task status` with no `--child`, then it reports child 1's tasks. | 15 | "`conduct task status` with no `--child` reports the rows of the flat `.pipeline/task-status.json` filtered to child 1's membership" | diff-local |
| Story 7 happy: Given host 1 `repairing`, when the operator runs `daemon status`, then it shows child 1 as the child being worked, as `1/3`. | 19 | "with host 1 `repairing`, `daemon status` renders ` child 1/3` for the feature." | diff-local |
| Story 7 happy: Given host 1 `repairing`, when region state is read or written, then child 1's per-child region state is used. | 14 | "a `build` status written by the loop lands in `.pipeline/children/1/conduct-state.json` (the mutation port)" | diff-local |
| Story 7 happy: Given host 1 `repairing`, when the operator runs `kickback-budget raise --gate prd_audit`, then the raise lands in the flat feature ledger, ignoring the execution-child default. | 17 | "`kickback-budget raise --gate prd_audit` writes the raise into `.pipeline/kickback-ledger.json`" | diff-local |
| Story 7 happy: Given a closed child 2 and no open round, when the operator runs `rewind --child 2`, then it is refused with a message naming #3203. | 16 | "`rewind: child 2 is closed and cannot be rewound (#3203)`" | diff-local |
| Story 7 negative: Given host 1 `repairing` and an operator commit with no `Round:` stamp past `closed/c2`, when the cursor runs, then it accepts `repair-pending` with child 2 as a co-origin, and does not halt. | 13 | "`runStackPreflight` writes no `.pipeline/HALT` and the feature does not halt" | diff-local |
| Story 7 negative: Given host 1 `repairing`, when the cursor reports `repair-pending` for children 1 and 2 and child 2's commits carry another round's `Round:` stamp, then the feature halts needs-human naming child 2. | 13 | "`runStackPreflight` writes a `needs-human` HALT whose text names child 2 and round `r7`" | diff-local |
| Story 7 negative: Given host 1 `repairing`, when the restack executor reads the cursor, then it does not throw, because the cursor kind is unchanged. | 12 | "`resolveActiveChild` returns kind `repair-pending` with `routedRepair: {child: 1, roundId: 'r1'}`" | diff-local |
| Story 15 happy: Given a route record whose outbox holds a `routed_repair_phase` event, when the feature resumes, then `.pipeline/events.jsonl` holds that event exactly once, carrying `child`. | 11 | "delivers that event to `events.jsonl` once, carrying `child`, and empties the route record's outbox" | diff-local |
| Story 15 negative: Given a crash after an outbox entry was persisted and before it was removed from the outbox, when the outbox is drained again, then the persister deduplicates by `eventId`, and the event appears once. | 8 | "the persister suppresses it by `eventId`, the outbox is empty, and `events.jsonl` holds the event once" | diff-local |
| Story 15 negative: Given a crash after the state transition and before draining, when the feature resumes, then the pending event is still delivered. | 11 | "delivers that event to `events.jsonl` once, carrying `child`, and empties the route record's outbox" | diff-local |
| Story 15 negative: Given an N=1 feature, when it remediates, then none of the four new events is emitted. | 3 | "the lap's `.pipeline/events.jsonl` contains no event of type `remediation_routed`, `remediation_rerouted`" | diff-local |
| Story 15 negative: Given the canonical event append fails, when the outbox is drained, then the entry stays in the outbox for the next drain. | 8 | "`drainOutbox` returns `persist-failed`, the entry is still in the route record's outbox" | diff-local |
| Story 15 negative: Given a persister restarted after an event was persisted, when the same `eventId` is drained again, then it is suppressed, and a replayed event keeps its original occurrence time. | 7 | "persisting `e1` again returns `'duplicate'` and appends nothing" | diff-local |
| Story 15 negative: Given the outbox removal compare-and-swap fails, when the next drain runs, then the entry is retried and still appears once in the log. | 8 | "the next drain removes the entry while `events.jsonl` still holds the event once" | diff-local |
| Story 16 happy: Given a three-child stack whose project sets `stacked_prs.route_whole_feature_fixes: true`, when `routingEligible` is evaluated, then it returns true. | 18 | "`routingEligible` returns true for a three-child stack whose config sets `stacked_prs.route_whole_feature_fixes: true`" | diff-local |
| Story 16 negative: Given a three-child stack whose project leaves `stacked_prs.route_whole_feature_fixes` unset, when `routingEligible` is evaluated, then it returns false, and the `PATH`-shimmed `git` records no command naming `refs/conductor/demo/routes`, `repairing` or `revalidate`. | 18 | "false for that stack with the setting unset" | diff-local |
| Story 16 negative: Given an N=1 feature whose project sets `stacked_prs.route_whole_feature_fixes: true`, when `routingEligible` is evaluated, then it returns false, because the cursor reports `no-child`. | 18 | "false for an N=1 feature with the setting `true` because the cursor reports `no-child`" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-12-routed-whole-feature-repair#D1 | task | task-18, task-12 | the gap loop in `conductor.ts` calls `routingEligible` exactly once per admitted lap, asserted by a spy, and with `false` the N=1 FIXABLE lap's plan, kickback-l |
| adr-2026-10-12-routed-whole-feature-repair#D2 | no-change | none | Implemented by #3210 per decision 18; this foundation spec routes nothing, because `routingEligible` is false while `stacked_prs.route_whole_feature_fixes` defaults to `false`. |
| adr-2026-10-12-routed-whole-feature-repair#D3 | no-change | none | Implemented by #3210 per decision 18; this foundation spec routes nothing, because `routingEligible` is false while `stacked_prs.route_whole_feature_fixes` defaults to `false`. |
| adr-2026-10-12-routed-whole-feature-repair#D4 | task | task-15 | with host 1 `repairing`, `conduct task status` with no `--child` reports the rows of the flat `.pipeline/task-status.json` filtered to child 1's membership plus |
| adr-2026-10-12-routed-whole-feature-repair#D5 | no-change | none | Implemented by #3211 per decision 18; this foundation spec routes nothing, because `routingEligible` is false while `stacked_prs.route_whole_feature_fixes` defaults to `false`. |
| adr-2026-10-12-routed-whole-feature-repair#D6 | task | task-1, task-5, task-4 | `parseRoundId` in `routing/route-types.ts` returns a branded `RoundId` for `r1` and `r999` (`MAX_ROUTE_ROUNDS`) and returns `undefined` for `r0`, `r1000`, `1`, |
| adr-2026-10-12-routed-whole-feature-repair#D7 | no-change | none | Implemented by #3210 per decision 18; this foundation spec routes nothing, because `routingEligible` is false while `stacked_prs.route_whole_feature_fixes` defaults to `false`. |
| adr-2026-10-12-routed-whole-feature-repair#D8 | task | task-12, task-14, task-13, task-15, task-16, task-17, task-19 | with host 1 `repairing`, `resolveActiveChild` returns kind `repair-pending` with `routedRepair: {child: 1, roundId: 'r1'}` and `child` 3 (the leaf), and with no |
| adr-2026-10-12-routed-whole-feature-repair#D9 | no-change | none | Implemented by #3211 per decision 18; this foundation spec routes nothing, because `routingEligible` is false while `stacked_prs.route_whole_feature_fixes` defaults to `false`. |
| adr-2026-10-12-routed-whole-feature-repair#D10 | task | task-17 | with host 1 `repairing`, `kickback-budget raise --gate prd_audit` writes the raise into `.pipeline/kickback-ledger.json` and leaves `.pipeline/children/1/kickba |
| adr-2026-10-12-routed-whole-feature-repair#D11 | no-change | none | Implemented by #3211 per decision 18; this foundation spec routes nothing, because `routingEligible` is false while `stacked_prs.route_whole_feature_fixes` defaults to `false`. |
| adr-2026-10-12-routed-whole-feature-repair#D12 | no-change | none | Implemented by #3211 per decision 18; this foundation spec routes nothing, because `routingEligible` is false while `stacked_prs.route_whole_feature_fixes` defaults to `false`. |
| adr-2026-10-12-routed-whole-feature-repair#D13 | no-change | none | Implemented by #3212 per decision 18; this foundation spec routes nothing, because `routingEligible` is false while `stacked_prs.route_whole_feature_fixes` defaults to `false`. |
| adr-2026-10-12-routed-whole-feature-repair#D14 | no-change | none | Implemented by #3212 per decision 18; this foundation spec routes nothing, because `routingEligible` is false while `stacked_prs.route_whole_feature_fixes` defaults to `false`. |
| adr-2026-10-12-routed-whole-feature-repair#D15 | no-change | none | Implemented by #3212 per decision 18; this foundation spec routes nothing, because `routingEligible` is false while `stacked_prs.route_whole_feature_fixes` defaults to `false`. |
| adr-2026-10-12-routed-whole-feature-repair#D16 | task | task-6, task-7, task-8, task-11 | `EVENT_SINKS` declares `remediation_routed`, `remediation_rerouted`, `routed_repair_phase` and `child_revalidated` with `persist: true`. |
| adr-2026-10-12-routed-whole-feature-repair#D17 | task | task-3, task-18 | in `n1-golden-routing-guard.test.ts` the N=1 FIXABLE lap appends the rem task on the feature branch's plan, records the flat `pendingRepair` in `.pipeline/kickb |
| adr-2026-10-12-routed-whole-feature-repair#D18 | task | task-18 | `routingEligible` returns true for a three-child stack whose config sets `stacked_prs.route_whole_feature_fixes: true`, false for that stack with the setting un |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D1 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D2 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D3 | no-change | none | The #2944 amendment of this decision is implemented by #3210 and #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D4 | no-change | none | The #2944 amendment of this decision is implemented by #3210 and #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D5 | no-change | none | The #2944 amendment of this decision is implemented by #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D6 | no-change | none | The #2944 amendment of this decision is implemented by #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D7 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D8 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D1 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D2 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D3 | no-change | none | The #2944 amendment of this decision is implemented by #3210 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D4 | no-change | none | The #2944 amendment of this decision is implemented by #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D5 | no-change | none | The #2944 amendment of this decision is implemented by #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D6 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D7 | no-change | none | The #2944 amendment of this decision is implemented by #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D8 | no-change | none | The #2944 amendment of this decision is implemented by #3210 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D9 | no-change | none | The #2944 amendment of this decision is implemented by #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-09-06-reopened-task-resolution#D1 | no-change | none | The #2944 amendment of this decision is implemented by #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-09-06-reopened-task-resolution#D2 | no-change | none | The #2944 amendment of this decision is implemented by #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-09-06-reopened-task-resolution#D3 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-09-06-reopened-task-resolution#D4 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-09-06-reopened-task-resolution#D5 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-09-06-reopened-task-resolution#D6 | no-change | none | The #2944 amendment of this decision is implemented by #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-09-06-reopened-task-resolution#D7 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-09-06-reopened-task-resolution#D8 | no-change | none | The #2944 amendment of this decision is implemented by #3212 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-09-06-reopened-task-resolution#D9 | no-change | none | The #2944 amendment of this decision is implemented by #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-09-06-reopened-task-resolution#D10 | no-change | none | Decision 10 was retired by #3164 (coverage_binding no longer admits repairs); #2944 does not revive it. |
| adr-2026-09-06-reopened-task-resolution#D11 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-09-06-reopened-task-resolution#D12 | no-change | none | The #2944 amendment of this decision is implemented by #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-08-22-one-owner-per-review-question#D1 | no-change | none | The #2944 amendment of this decision is implemented by #3210 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-07-13-kickback-build-no-op-escalation#D1 | no-change | none | The #2944 amendment of this decision is implemented by #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-07-13-kickback-build-no-op-escalation#D2 | no-change | none | The #2944 amendment of this decision is implemented by #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-07-13-kickback-build-no-op-escalation#D3 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-08-29-operator-authorized-kickback-budget-recovery#D1 | task | task-17 | with host 1 `repairing`, `kickback-budget raise --gate prd_audit` writes the raise into `.pipeline/kickback-ledger.json` and leaves `.pipeline/children/1/kickba |
| adr-2026-08-29-operator-authorized-kickback-budget-recovery#D2 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-08-29-operator-authorized-kickback-budget-recovery#D3 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-08-29-operator-authorized-kickback-budget-recovery#D4 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-08-29-operator-authorized-kickback-budget-recovery#D5 | no-change | none | The #2944 amendment of this decision is implemented by #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-08-29-operator-authorized-kickback-budget-recovery#D6 | task | task-17 | with host 1 `repairing`, `kickback-budget raise --gate prd_audit` writes the raise into `.pipeline/kickback-ledger.json` and leaves `.pipeline/children/1/kickba |
| adr-2026-08-29-operator-authorized-kickback-budget-recovery#D7 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-08-29-operator-authorized-kickback-budget-recovery#D8 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-07-06-manual-test-fail-routing#D1 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-07-06-manual-test-fail-routing#D2 | no-change | none | The #2944 amendment of this decision is implemented by #3210 and #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-07-06-manual-test-fail-routing#D3 | no-change | none | The #2944 amendment of this decision is implemented by #3212 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-07-06-manual-test-fail-routing#D4 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-07-10-validation-group-join#D1 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-07-10-validation-group-join#D2 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-07-10-validation-group-join#D3 | no-change | none | The #2944 amendment of this decision is implemented by #3210 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-07-10-validation-group-join#D4 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-07-10-validation-group-join#D5 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-08-12-cumulative-build-review-convergence-bound#D1 | no-change | none | The #2944 amendment of this decision is implemented by #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-08-12-cumulative-build-review-convergence-bound#D2 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-08-12-cumulative-build-review-convergence-bound#D3 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-08-12-cumulative-build-review-convergence-bound#D4 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-08-12-cumulative-build-review-convergence-bound#D5 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-08-12-cumulative-build-review-convergence-bound#D6 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D1 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D2 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D3 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D4 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D5 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D6 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D7 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D8 | task | task-5, task-4 | every write in `route-record-store.ts` reaches git only as `update-ref --stdin` with a `start`, the stored blob's object id as the expected old value and `prepa |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D9 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D10 | task | task-14, task-12 | `resolveExecutionChild` returns child 1 (`routed-host`) when the cursor carries both `routedRepair` child 1 and `revalidating` child 2, child 2 (`revalidating`) |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D11 | no-change | none | The #2944 amendment of this decision is implemented by #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D12 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D13 | task | task-15, task-16, task-17 | with host 1 `repairing`, `conduct task status` with no `--child` reports the rows of the flat `.pipeline/task-status.json` filtered to child 1's membership plus |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D14 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D15 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-07-per-child-build-region#D1 | task | task-12 | with host 1 `repairing`, `resolveActiveChild` returns kind `repair-pending` with `routedRepair: {child: 1, roundId: 'r1'}` and `child` 3 (the leaf), and with no |
| adr-2026-10-07-per-child-build-region#D2 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-07-per-child-build-region#D3 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-07-per-child-build-region#D4 | task | task-14 | `resolveExecutionChild` returns child 1 (`routed-host`) when the cursor carries both `routedRepair` child 1 and `revalidating` child 2, child 2 (`revalidating`) |
| adr-2026-10-07-per-child-build-region#D5 | no-change | none | The #2944 amendment of this decision is implemented by #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-10-07-per-child-build-region#D6 | no-change | none | The #2944 amendment of this decision is implemented by #3210 and #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-10-07-per-child-build-region#D7 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-07-per-child-build-region#D8 | no-change | none | The #2944 amendment of this decision is implemented by #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-10-07-per-child-build-region#D9 | no-change | none | The #2944 amendment of this decision is implemented by #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-10-07-per-child-build-region#D10 | task | task-17 | with host 1 `repairing`, `kickback-budget raise --gate prd_audit` writes the raise into `.pipeline/kickback-ledger.json` and leaves `.pipeline/children/1/kickba |
| adr-2026-10-07-per-child-build-region#D11 | task | task-16, task-15, task-17, task-19 | with a closed child 2, the leaf active and no open round, `rewind --child 2 build` exits 1 with stderr `rewind: child 2 is closed and cannot be rewound (#3203)` |
| adr-2026-10-07-per-child-build-region#D12 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-07-per-child-build-region#D13 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-07-per-child-build-region#D14 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance#D1 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance#D2 | no-change | none | The #2944 amendment of this decision is implemented by #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance#D3 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance#D4 | no-change | none | The #2944 amendment of this decision is implemented by #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-10-10-stacked-restack-journaled-replay#D1 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-10-stacked-restack-journaled-replay#D2 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-10-stacked-restack-journaled-replay#D3 | no-change | none | The #2944 amendment of this decision is implemented by #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-10-10-stacked-restack-journaled-replay#D4 | no-change | none | The #2944 amendment of this decision is implemented by #3211 and #3212 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-10-10-stacked-restack-journaled-replay#D5 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-10-stacked-restack-journaled-replay#D6 | no-change | none | The #2944 amendment of this decision is implemented by #3211 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-10-10-stacked-restack-journaled-replay#D7 | no-change | none | The #2944 amendment of this decision is implemented by #3210 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-10-10-stacked-restack-journaled-replay#D8 | no-change | none | The #2944 amendment of this decision is implemented by #3212 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-10-10-stacked-restack-journaled-replay#D9 | task | task-16 | with a closed child 2, the leaf active and no open round, `rewind --child 2 build` exits 1 with stderr `rewind: child 2 is closed and cannot be rewound (#3203)` |
| adr-2026-10-10-stacked-restack-journaled-replay#D10 | no-change | none | The #2944 amendment of this decision is implemented by #3211 and #3212 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-10-10-stacked-restack-journaled-replay#D11 | task | task-4 | with `closed/c1` present, after `deleteFeatureConductorRefs('demo', git)` (the shipped-record teardown and reclaim path used by `mergeable-sweep.ts` and `park-r |
| adr-2026-10-10-stacked-restack-journaled-replay#D12 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-10-stacked-restack-journaled-replay#D13 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D1 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D2 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D3 | no-change | none | The #2944 amendment of this decision is implemented by #3210 (`adr-2026-10-12-routed-whole-feature-repair` decision 18); this foundation spec routes nothing, so the decision holds as written here. |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D4 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D5 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D6 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D7 | no-change | none | Unchanged by #2944: the decision holds as written for stacked and N=1 features, and no #2944 amendment note applies to it. |

## Tasks

### Task 1: Route record, marker and queue types with their parsers
**Story:** 7
**Type:** infrastructure

**Steps:**
1. Write failing test(s): `src/conductor/test/engine/routing/route-types.test.ts` — `parseRoundId`, `parseRouteRecord`, `parseRepairMarker` and `parseRevalidationQueueRecord`.
2. Verify RED
3. Implement: `src/conductor/src/engine/routing/route-types.ts` with the named constant `MAX_ROUTE_ROUNDS` (999, the round bound that teardown enumerates in Task 4), branded `RoundId` (format `r<n>`, `n` from 1 to `MAX_ROUTE_ROUNDS`) with `parseRoundId`, `HostState` ('pending', 'admitted', 'repairing', 'reroute-moved', 'built', 'restacked', 'done', and the terminal 'rerouted' for a source host a verified reroute moved away from), `RoundPhase` ('prepared', 'open', 'closed'), `RouteKind` ('audit', 'revalidate'), `RoutedItem {findingId, kind, owner, host, reason, fallback[]}`, `FrozenAllocation` (per host: rem-* ids and block bodies), `RoundReceipt` (opaque slot settled by Group D), `OutboxEntry {eventId, occurredAt, event}`, `RouteRecord {roundId, kind, phase, items, allocation, hosts: per-host state, currentHostIndex, receipt, outbox}`, `RepairMarker {host, roundId}`, `RevalidationQueueRecord {generation, entries: [{child, closureSha, state}], outbox}`, and the blob parsers `parseRouteRecord`, `parseRepairMarker` and `parseRevalidationQueueRecord` that the drain (Tasks 8, 11) and the cursor (Task 12) read through. Round-id allocation, the host and round-phase transition checks, the round-cap halt and the routing port seam are not in this spec; they land with their first caller in #3210.
4. Verify GREEN, commit.

**Done when:**
- [test] `parseRoundId` in `routing/route-types.ts` returns a branded `RoundId` for `r1` and `r999` (`MAX_ROUTE_ROUNDS`) and returns `undefined` for `r0`, `r1000`, `1`, `routes/r1` and an empty string.
- [test] `parseRouteRecord` returns a typed `RouteRecord` for a JSON blob carrying every declared field, and returns `undefined` for a blob missing `outbox` or whose `phase` is not a `RoundPhase`.
- [test] `parseRepairMarker` and `parseRevalidationQueueRecord` return typed values for valid blobs, and return `undefined` for a marker whose `host` is above `MAX_CHILD_ID` and for a queue entry without `closureSha`.

**Files likely touched:**
- `src/conductor/src/engine/routing/route-types.ts` — new types, the round bound and the blob parsers
- `src/conductor/test/engine/routing/route-types.test.ts` — parser tests

**Dependencies:** none

### Task 2: Structural guard for exhaustive switches over routing unions (C3)
**Story:** 7
**Type:** infrastructure

**Steps:**
1. Write failing test(s): `src/conductor/test/structural/routing-exhaustive-switch.test.ts` — parses `src/conductor/src/engine/routing/*.ts`, `engine/child-cursor.ts` and every module that imports `routing/route-types.js` or `routing/execution-child.js` with the TypeScript compiler API; fails on any `switch` whose discriminant is typed `HostState`, `RoundPhase`, `RouteKind`, `ExecutionChildResolution['source']` or reads `routedRepair` or `revalidating`, when that switch has a `default` clause or lacks an `assertNever` call after its last case.
2. Verify RED against an in-memory fixture.
3. Implement: the guard plus a shared `assertNever(value: never): never` helper in `routing/route-types.ts`.
4. Verify GREEN, commit.

**Done when:**
- [test] `routing-exhaustive-switch.test.ts` fails on an in-memory fixture containing `switch (state) { case 'pending': break; default: break; }` with `state: HostState`, naming the file and line.
- [test] `routing-exhaustive-switch.test.ts` fails on an in-memory fixture whose `switch` over `RouteKind` omits `'revalidate'` and has no `assertNever`, and passes on the real routing modules and `child-cursor.ts`.

**Files likely touched:**
- `src/conductor/test/structural/routing-exhaustive-switch.test.ts` — structural guard
- `src/conductor/src/engine/routing/route-types.ts` — `assertNever`

**Dependencies:** Task 1

### Task 3: N=1 golden remediation lap with a PATH-shimmed git guard (C2)
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test(s): `src/conductor/test/engine/n1-golden-routing-guard.test.ts` — for the `flag-off-unsliced` and `flag-on-unsliced` cells of `n1-golden-shared.ts`, put a shim directory first on `PATH` whose `git` script appends its argv (one JSON line) to a log and then execs the real git resolved before the shim; drive one Conductor run from `prd_audit` with a stub prd_audit runner returning one FIXABLE finding owned by Task 2 of the golden plan, through the rem-task append, to the loop's rewind to `build`.
2. Record the goldens for this lap (`<cell>-fixable-lap-plan`, `-kickback-ledger`, `-conduct-state`, `-events`) on this branch BEFORE any routing code lands (Tasks 12 to 19 of this spec depend on it, and the later specs #3210, #3211 and #3212 build on the recorded goldens), then verify RED by deleting one recorded fixture line.
3. Implement: the shim helper in `n1-golden-shared.ts` (`withGitArgvShim(root, fn)` returning the recorded argv lines) and the new test; no production change.
4. Verify GREEN, commit.

**Done when:**
- [test] in `n1-golden-routing-guard.test.ts` the N=1 FIXABLE lap appends the rem task on the feature branch's plan, records the flat `pendingRepair` in `.pipeline/kickback-ledger.json` and leaves `conduct-state.json` rewound to `build`, each byte-identical to the goldens recorded before routing landed.
- [test] the `PATH`-shimmed `git` argv log of the N=1 FIXABLE lap contains no argument naming `refs/conductor/<slug>/routes`, `refs/conductor/<slug>/repairing` or `refs/conductor/<slug>/revalidate`, and the test fails when a fixture call runs `git rev-parse -q --verify refs/conductor/n1-golden/repairing` inside the lap.
- [test] the lap's `.pipeline/events.jsonl` contains no event of type `remediation_routed`, `remediation_rerouted`, `routed_repair_phase` or `child_revalidated`.

**Files likely touched:**
- `src/conductor/test/engine/n1-golden-routing-guard.test.ts` — new golden guard
- `src/conductor/test/engine/n1-golden-shared.ts` — `withGitArgvShim`
- `src/conductor/test/fixtures/n1-golden/*-fixable-lap-*.golden` — recorded fixtures

**Dependencies:** none

### Task 4: Routing ref names and explicit-name teardown
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing test(s): `src/conductor/test/engine/routing/routing-refs.test.ts` for the name builders; extend `src/conductor/test/engine/restack/restack-refs-cleanup.test.ts` with a real-git repository holding `closed/c1`, `routes/r1`, `rejected/r1/1`, `routes/r2`, `repairing`, `revalidate` and `red/c1`, and a decoy ref `refs/conductor/demo/routes-extra`.
2. Verify RED
3. Implement: `src/conductor/src/engine/routing/routing-refs.ts` with the named constant `MAX_REJECTED_PINS_PER_ROUND` (`MAX_CHILD_ID - 1`), `routeRecordRefFor(slug, roundId)`, `rejectedPinRefFor(slug, roundId, n)` with `n` from 1 to `MAX_REJECTED_PINS_PER_ROUND`, `repairMarkerRefFor`, `revalidationQueueRefFor`, `redRefFor(slug, child)`, and `routingTeardownRefNames(slug)` that enumerates every `routes/r1` to `routes/r<MAX_ROUTE_ROUNDS>`, each round's `rejected/r<n>/1` to `rejected/r<n>/<MAX_REJECTED_PINS_PER_ROUND>` pins, the marker, the queue and `red/c1` to `red/c<MAX_CHILD_ID>`. In `restack/restack-refs-cleanup.ts`, teardown probes the explicit closure names `refs/conductor/<slug>/closed/c1` to `closed/c<MAX_CHILD_ID>` and every routing name in the SAME single `git cat-file --batch-check` (no `for-each-ref`, no `rev-parse` per name, no read of `.pipeline/children`, so it works after the feature worktree is removed); durable child state is decided from that probe, and routing names join the `update-ref --stdin` delete transaction only if at least one closure name exists. Discovery is a fixed explicit list, never ref listing, so a round id left after a gap is still found. The closure names are probed first, in one `cat-file --batch-check`; routing names are built through `routeRecordRefFor`, `rejectedPinRefFor` and `redRefFor` inside `routingTeardownRefNames` and probed in a second call only when a closure exists, so an N=1 teardown sends no routing name to git on any channel.
4. Verify GREEN, commit.

**Done when:**
- [test] with `closed/c1` present, after `deleteFeatureConductorRefs('demo', git)` (the shipped-record teardown and reclaim path used by `mergeable-sweep.ts` and `park-reconciliation.ts`) the refs `routes/r1`, `rejected/r1/1`, `routes/r2`, `repairing`, `revalidate` and `red/c1` no longer exist, and each was deleted by its explicit name in the single `update-ref --stdin` transaction.
- [test] the mocked git runner records no `for-each-ref` call and no argument ending in `*` or `/` during teardown, and the decoy `refs/conductor/demo/routes-extra` still exists afterwards.
- [test] `routingTeardownRefNames('demo')` contains `refs/conductor/demo/repairing`, `refs/conductor/demo/revalidate`, `refs/conductor/demo/red/c9`, `refs/conductor/demo/rejected/r1/1` and `refs/conductor/demo/rejected/r999/8` (`MAX_REJECTED_PINS_PER_ROUND`), contains no `rejected/r1/9`, and every entry starts with `refs/conductor/demo/`.
- [test] with `closed/c2` present and the feature worktree's `.pipeline/children` removed, teardown probes `closed/c1` to `closed/c9` in one `git cat-file --batch-check` call, then the routing names in a second call, and deletes the existing routing refs.
- [test] for an N=1 feature with no `closed/c1` to `closed/c9` ref and a stale `refs/conductor/demo/routes/r1`, the mocked git runner records no argument, no `cat-file` stdin line and no `update-ref --stdin` line naming `routes/`, `rejected/`, `repairing`, `revalidate` or `red/`, and `routes/r1` still exists afterwards.

**Files likely touched:**
- `src/conductor/src/engine/routing/routing-refs.ts` — ref names and teardown list
- `src/conductor/src/engine/restack/restack-refs-cleanup.ts` — teardown list union and batched existence check
- `src/conductor/test/engine/routing/routing-refs.test.ts` — name tests
- `src/conductor/test/engine/restack/restack-refs-cleanup.test.ts` — real-git teardown test

**Dependencies:** Task 1

### Task 5: Route record store with reads, compare-and-swap updates and the restack-journal writer fence
**Story:** 15
**Type:** infrastructure

**Steps:**
1. Write failing real-git tests: `src/conductor/test/engine/routing/route-record-store.test.ts`; route record, marker and queue fixtures are written by the test with `git hash-object -w` and `git update-ref`.
2. Verify RED
3. Implement: `src/conductor/src/engine/routing/route-record-store.ts` following the `restack-journal.ts` pattern (`hash-object -w` plus `update-ref --stdin`): `readRouteRecord` (typed through `parseRouteRecord`, else `unreadable` or `absent`), `writeRouteRecord(stored, next)` (compare-and-swap update of an existing record, the expected old value being the stored blob's object id; the outbox drain of Task 8 is its caller), `readRepairMarker` and `readRevalidationQueue` (read by the cursor in Task 12); every write first reads `readRestackJournal` and refuses with `restack-journal-open` while the journal state is not `applied` or `aborted`, with no writer exemption. Record, marker and queue creation, and the restack's own-transaction exemption, are not in this spec (#3210 and #3212).
4. Verify GREEN, commit.

**Done when:**
- [test] every write in `route-record-store.ts` reaches git only as `update-ref --stdin` with a `start`, the stored blob's object id as the expected old value and `prepare`/`commit`, asserted over the mocked runner's argv for a route record update.
- [test] with an injected concurrent writer that rewrites `refs/conductor/demo/routes/r1` between `readRouteRecord` and `writeRouteRecord`, the write returns `cas-failed` and the concurrent blob is left in place.
- [test] with a restack journal in state `moved`, `writeRouteRecord` returns `restack-journal-open` and leaves the ref unchanged, and with the journal `applied` the same write commits.
- [test] `readRouteRecord` returns `unreadable` for a blob that is not valid route-record JSON and `absent` when the ref does not exist.
- [test] `readRepairMarker` and `readRevalidationQueue` return the typed fixture values from their refs and `absent` when the ref does not exist.

**Files likely touched:**
- `src/conductor/src/engine/routing/route-record-store.ts` — store
- `src/conductor/test/engine/routing/route-record-store.test.ts` — real-git and mocked-runner tests

**Dependencies:** Tasks 1, 4

### Task 6: The four routing members on the ConductorEvent union
**Story:** 15
**Type:** infrastructure

**Steps:**
1. Write failing test(s): extend `src/conductor/test/engine/event-sinks.test.ts` — the union accepts the four members and `EVENT_SINKS` declares them (the `satisfies Record` must fail to compile without them); a compile-type fixture rejects each member without `child`.
2. Verify RED
3. Implement: in `src/conductor/src/types/events.ts` add `remediation_routed {eventId, occurredAt, roundId, kind, items: [{findingId, owner, host, reason}], child}`, `remediation_rerouted {eventId, occurredAt, roundId, from, to, evidence, child}`, `routed_repair_phase {eventId, occurredAt, roundId, host, phase, credit, child}` and `child_revalidated {eventId, occurredAt, child, generation, closureSha, outcome}`, each with a required `child: ChildId`; add the four rows with `persist: true` to `src/conductor/src/engine/event-sinks.ts`.
4. Verify GREEN, commit.

**Done when:**
- [test] `EVENT_SINKS` declares `remediation_routed`, `remediation_rerouted`, `routed_repair_phase` and `child_revalidated` with `persist: true`.
- [test] a compile-type fixture rejects each of the four events when `child` or `eventId` is omitted, and rejects a `routed_repair_phase` whose `phase` is not a `HostState`.
- [test] each of the four events round-trips through `EventPersister` to `events.jsonl` with every declared field, including `child`.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — four members
- `src/conductor/src/engine/event-sinks.ts` — four rows
- `src/conductor/test/engine/event-sinks.test.ts` — declaration and round-trip tests

**Dependencies:** Task 1

### Task 7: Persister dedup by eventId for the routing events, keeping occurrence time
**Story:** 15
**Type:** negative-path

**Steps:**
1. Write failing test(s): extend `src/conductor/test/engine/event-persister.test.ts`.
2. Verify RED
3. Implement: in `src/conductor/src/engine/event-persister.ts` add the four types to the replay-dedup set used by `observationEventId` (renamed `REPLAY_DEDUP_EVENT_TYPES`), and for those four types write `ts` from the event's `occurredAt` instead of the persist time; add `persistDurably(event)` that resolves `'persisted'` or `'duplicate'` only after `appendFileSync` returns and rejects with `EventPersistError` when the append throws.
4. Verify GREEN, commit.

**Done when:**
- [test] persisting the same `routed_repair_phase` twice with one `eventId` writes one line to `events.jsonl`, and the same holds for `remediation_routed`, `remediation_rerouted` and `child_revalidated`.
- [test] after a new `EventPersister` is constructed over an `events.jsonl` that already holds an event with `eventId` `e1`, persisting `e1` again returns `'duplicate'` and appends nothing.
- [test] a `child_revalidated` with `occurredAt` `2026-10-12T00:00:00.000Z` persisted with a later fake clock is written with `ts` `2026-10-12T00:00:00.000Z`.
- [test] `persistDurably` rejects with `EventPersistError` when the injected append throws, and ordinary non-routing events with equal payloads still append twice.

**Files likely touched:**
- `src/conductor/src/engine/event-persister.ts` — dedup set, occurrence time, `persistDurably`
- `src/conductor/test/engine/event-persister.test.ts` — dedup tests

**Dependencies:** Tasks 3, 6

### Task 8: At-least-once outbox drain
**Story:** 15
**Type:** negative-path

**Steps:**
1. Write failing real-git tests: `src/conductor/test/engine/routing/route-outbox.test.ts`; route records holding outbox entries are written by the test with `git hash-object -w` and `git update-ref` (the outbox append that writes an entry with its state change lands with #3210).
2. Verify RED
3. Implement: in `route-record-store.ts`, `drainOutbox(slug, ref, persist)` that, for each entry in order, calls `persist` (default `EventPersister.persistDurably`) and only after it resolves removes that entry by a CAS write from the exact blob it read; a failed `persist` stops the drain and leaves the entry; a failed removal CAS returns `retry` and leaves the entry for the next drain. The same functions serve the route record and the queue ref.
4. Verify GREEN, commit.

**Done when:**
- [test] when the process is killed (fault injected) after `persist` resolved and before the removal CAS, a second `drainOutbox` persists the entry again, the persister suppresses it by `eventId`, the outbox is empty, and `events.jsonl` holds the event once.
- [test] when the injected canonical append throws, `drainOutbox` returns `persist-failed`, the entry is still in the route record's outbox, and the next drain with a working append delivers it once.
- [test] when the removal CAS fails because an injected concurrent writer changed the ref, `drainOutbox` returns `retry`, and the next drain removes the entry while `events.jsonl` still holds the event once.

**Files likely touched:**
- `src/conductor/src/engine/routing/route-record-store.ts` — outbox drain
- `src/conductor/test/engine/routing/route-outbox.test.ts` — crash and failure tests

**Dependencies:** Tasks 5, 7

### Task 11: Resume drains every routing outbox before the cursor runs
**Story:** 15
**Type:** negative-path

**Steps:**
1. Write failing test(s): extend `src/conductor/test/engine/restack/stack-preflight.realgit.test.ts` — on the three-child stack with `stacked_prs.route_whole_feature_fixes: true` (unless a case says otherwise), a route record fixture blob written by the test with `git hash-object -w` and `git update-ref`, holding one undrained outbox entry (process killed before drain).
2. Verify RED
3. Implement: `drainRoutingOutboxes(worktree, slug, persist)` in `route-record-store.ts` that finds every round with a non-empty outbox by enumerating route records with `git for-each-ref refs/conductor/<slug>/routes/` (never via the marker, which a round's `applied` transaction may already have deleted), and drains each of them (the queue ref's outbox is added by #3212); call it in `runStackPreflight` after the second journal recovery and before `resolveActiveChild` (Group C inserts round reconciliation between this drain and the cursor); it runs only when BOTH durable child state exists (`hasDurableChildState` is true) AND `stacked_prs.route_whole_feature_fixes` is true, which is exactly the `routingEligible` condition (durable child state alone is not); otherwise no routing ref is enumerated or read. Use `routingSettingOn(config)` from Task 18's helper together with the durable-state check.
4. Verify GREEN, commit.

**Done when:**
- [test] with a route record whose outbox holds one undrained `routed_repair_phase` entry, the next `runStackPreflight` delivers that event to `events.jsonl` once, carrying `child`, and empties the route record's outbox.
- [test] `runStackPreflight` calls `drainRoutingOutboxes` after both `recoverRestackJournal` calls and before `resolveActiveChild`, asserted by the order of calls on spies.
- [test] for a worktree with no durable child state, `runStackPreflight` never calls `drainRoutingOutboxes` and the mocked git runner records no argument naming `routes`, `repairing` or `revalidate`.
- [test] on a three-child stack with `stacked_prs.route_whole_feature_fixes` unset and a route record holding an undrained entry, `runStackPreflight` never calls `drainRoutingOutboxes` and no git command it runs names `routes/`, `repairing` or `revalidate`.
- [test] with no marker and a route record whose host is `restacked` and whose outbox holds an undrained `routed_repair_phase` entry, the next `runStackPreflight` finds that round by `for-each-ref` over `routes/` and delivers that event to `events.jsonl` exactly once.

**Files likely touched:**
- `src/conductor/src/engine/routing/route-record-store.ts` — `drainRoutingOutboxes`
- `src/conductor/src/engine/restack/stack-preflight.ts` — drain call
- `src/conductor/test/engine/restack/stack-preflight.realgit.test.ts` — resume delivery test

**Dependencies:** Tasks 5, 8, Task 18

### Task 12: Cursor fields routedRepair and revalidating, with kinds unchanged
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing real-git tests: extend `src/conductor/test/engine/child-cursor.test.ts` with the three-child stack, `stacked_prs.route_whole_feature_fixes: true` (unless a case says otherwise), marker `{host: 1, roundId: 'r1'}`, host 1 `repairing`, and one round-stamped commit on `feat/c1/demo` past `closed/c1`; extend `src/conductor/test/engine/restack/restack-executor.realgit.test.ts` with the same fixture.
2. Verify RED
3. Implement: in `resolveActiveChild` (`engine/child-cursor.ts`), after every `no-child` return, and only when BOTH durable child state exists AND the caller passes `stacked_prs.route_whole_feature_fixes` as true (the `routingEligible` condition; callers pass the loaded setting, absent meaning false), read `readRepairMarker` and the queue head through `route-record-store.ts`; add optional fields `routedRepair: {child, roundId}` and `revalidating: {child, generation}` to the `active` and `repair-pending` results; the kind, `child`, `position`, `isLeaf` and `branch` stay the cursor's own values. Use `routingSettingOn(config)` from Task 18's helper together with the durable-state check.
4. Verify GREEN, commit.

**Done when:**
- [test] with host 1 `repairing`, `resolveActiveChild` returns kind `repair-pending` with `routedRepair: {child: 1, roundId: 'r1'}` and `child` 3 (the leaf), and with no marker it returns the same result without `routedRepair`.
- [test] with host 1 `repairing`, `activeFor` in `restack/restack-executor.ts` resolves the leaf (child 3, `isLeaf: true`) as the active range without throwing, and the executor passes child 3 as `options.active` to `planRestackRanges`.
- [test] with the queue ref at generation 2 headed by child 2 and no marker, `resolveActiveChild` returns kind `active` with `revalidating: {child: 2, generation: 2}`.
- [test] for an N=1 feature `resolveActiveChild` returns `no-child` and the mocked git runner records no argument naming `refs/conductor/<slug>/repairing` or `refs/conductor/<slug>/revalidate`.
- [test] on the three-child stack with `stacked_prs.route_whole_feature_fixes` unset and the marker present, `resolveActiveChild` returns no `routedRepair` or `revalidating` field and no git command it runs names `routes/`, `repairing` or `revalidate`.

**Files likely touched:**
- `src/conductor/src/engine/child-cursor.ts` — marker and queue fields behind the setting
- `src/conductor/src/engine/restack/stack-preflight.ts` and `restack/restack-executor.ts` — pass the loaded setting to `resolveActiveChild`
- `src/conductor/test/engine/child-cursor.test.ts` — field tests
- `src/conductor/test/engine/restack/restack-executor.realgit.test.ts` — leaf active range test

**Dependencies:** Tasks 3, 5, Task 18

### Task 13: repair-pending accepts unstamped co-origins and halts on another round's commits
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing real-git tests: extend `child-cursor.test.ts` with host 1 `repairing` plus (a) an operator commit with no `Round:` trailer past `closed/c2`, and extend both `child-cursor.test.ts` and `src/conductor/test/engine/restack/stack-preflight.realgit.test.ts` with (b) a commit past `closed/c2` carrying `Round: r7`. Case (a) asserts on the cursor result only: today's automatic restack still runs in this spec, so no preflight run is asserted for it.
2. Verify RED
3. Implement: in `resolveActiveChild`, when `routedRepair` is present, read each repair child's post-closure commits' `Round:` trailers (`git log --format=%(trailers:key=Round,valueonly)`); report `coOrigins` (closed children whose post-closure commits carry no `Round:` trailer) and `foreignRoundChildren` (children other than `routedRepair.child` with any commit stamped by another round); in `runStackPreflight`, before any cascade check or restack, a non-empty `foreignRoundChildren` writes a `needs-human` halt through `writeHaltMarker` naming each child and round. A closed child other than the host is a co-origin only when ALL of its post-closure commits carry no `Round:` stamp; any other non-host child in `repairChildren` (including one stamped with the current round, or mixed) halts needs-human naming it.
4. Verify GREEN, commit.

**Done when:**
- [test] with host 1 `repairing` and an unstamped operator commit past `closed/c2`, `resolveActiveChild` returns `repair-pending` with `repairChildren` [1, 2], `coOrigins` [2] and an empty `foreignRoundChildren`, so the foreign-round halt condition is not met.
- [test] with host 1 `repairing` and child 2's post-closure commit stamped `Round: r7`, `resolveActiveChild` returns `foreignRoundChildren` [2] and `runStackPreflight` writes a `needs-human` HALT whose text names child 2 and round `r7`, with no restack journal created.
- [test] a commit past `closed/c1` stamped with the open round `r1` is neither a co-origin nor a foreign-round child.
- [test] with a non-host child 2 whose post-closure commits carry the current round's `Round:` stamp, `resolveActiveChild` reports child 2 as a foreign-round child.
- [test] with host 1 `repairing` (hand-written marker) and an operator commit with no `Round:` stamp past `closed/c2`, `runStackPreflight` writes no `.pipeline/HALT` and the feature does not halt (today's automatic restack may still run).

**Files likely touched:**
- `src/conductor/src/engine/child-cursor.ts` — `coOrigins`, `foreignRoundChildren`
- `src/conductor/src/engine/restack/stack-preflight.ts` — foreign-round halt
- `src/conductor/test/engine/child-cursor.test.ts` — co-origin tests
- `src/conductor/test/engine/restack/stack-preflight.realgit.test.ts` — halt test

**Dependencies:** Task 12

### Task 14: One execution-child resolver drives conductor region entry, both activators, the mutation port and dispatch identity
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing test(s): `src/conductor/test/engine/routing/execution-child.test.ts` for the resolver; extend `src/conductor/test/engine/stacked-region-loop.test.ts` and `src/conductor/test/engine/stacked-region-events.test.ts` with an injected `resolveActiveChild` reporting `repair-pending` with `routedRepair: {child: 1, roundId: 'r1'}` on the three-child stack.
2. Verify RED
3. Implement: `src/conductor/src/engine/routing/execution-child.ts` with `resolveExecutionChild(cursor, slug)` returning `{source: 'routed-host', target, roundId}`, else `{source: 'revalidating', target, generation}`, else `{source: 'cursor', target}`, else `{source: 'none'}` for `no-child`, else `{source: 'refused', cursor}`, by an exhaustive switch over `cursor.kind` with no default arm; `target` is an `ActiveChildLifecycleTarget` for that child's branch. In `conductor.ts`, region entry (the `isRegionStep` block), `activateChildRegionState`, `activateChildRegionStateForResume` and the post-region re-resolution call sites use it, so `createRoutedConductStateStore(root, child)`, `activeRegionChild`, `withActiveRegionChild` and the dispatch context's `activeChild` all carry the execution child.
4. Verify GREEN, commit.

**Done when:**
- [test] `resolveExecutionChild` returns child 1 (`routed-host`) when the cursor carries both `routedRepair` child 1 and `revalidating` child 2, child 2 (`revalidating`) when only `revalidating` is present, the cursor child otherwise, and `none` for `no-child`.
- [test] with host 1 `repairing`, the conductor's region entry calls `enterChildRegion` with child 1 and branch `feat/c1/demo`, not the leaf.
- [test] with host 1 `repairing`, a `build` status written by the loop lands in `.pipeline/children/1/conduct-state.json` (the mutation port), and `activateChildRegionStateForResume` reads child 1's overlay into the loop state.
- [test] with host 1 `repairing`, the `step_started` event for `build` carries `child` 1 and the dispatch context passed to the build runner has `activeChild` 1.

**Files likely touched:**
- `src/conductor/src/engine/routing/execution-child.ts` — resolver
- `src/conductor/src/engine/conductor.ts` — region entry, activators, dispatch identity use the resolver
- `src/conductor/test/engine/routing/execution-child.test.ts` — resolver tests
- `src/conductor/test/engine/stacked-region-loop.test.ts` — region entry and state tests
- `src/conductor/test/engine/stacked-region-events.test.ts` — dispatch identity test

**Dependencies:** Tasks 2, 12

### Task 15: task-cli defaults to the execution child
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing test(s): extend `src/conductor/test/engine/recovery-cli-child-default.sweepG3.test.ts` (or `task-cli.test.ts`) with the cursor reporting host 1 `repairing`.
2. Verify RED
3. Implement: in `engine/task-cli.ts` replace the cursor-child default with `resolveExecutionChild(cursor, slug)`; task status stays flat in `.pipeline/task-status.json`, so the default filters its rows to the execution child's membership plus the round's routed tasks, and no per-child task-status file is introduced.
4. Verify GREEN, commit.

**Done when:**
- [test] with host 1 `repairing`, `conduct task status` with no `--child` reports the rows of the flat `.pipeline/task-status.json` filtered to child 1's membership plus the round's routed tasks, and not the leaf's.
- [test] with no marker and no queue, `conduct task status` with no `--child` still reports the cursor child's tasks.

**Files likely touched:**
- `src/conductor/src/engine/task-cli.ts` — execution-child default
- `src/conductor/test/engine/recovery-cli-child-default.sweepG3.test.ts` — consumer test

**Dependencies:** Task 14

### Task 16: rewind defaults to the execution child and refuses closed children naming #3203 (C6)
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing test(s): extend `src/conductor/test/engine/rewind-child.test.ts`.
2. Verify RED
3. Implement: in `dispatchRewindCommand` (`engine/rewind.ts`), default `--child` from `resolveExecutionChild`; refuse an explicit closed child that is not the execution child with `rewind: child <n> is closed and cannot be rewound (#3203)`.
4. Verify GREEN, commit.

**Done when:**
- [test] with a closed child 2, the leaf active and no open round, `rewind --child 2 build` exits 1 with stderr `rewind: child 2 is closed and cannot be rewound (#3203)` and leaves `.pipeline/children/2/conduct-state.json` unchanged.
- [test] `rewind.ts` contains no `#2944` reference, asserted by reading the source.
- [test] with host 1 `repairing`, `rewind build` with no `--child` rewinds child 1's region state, and `rewind --child 1 build` is not refused.

**Files likely touched:**
- `src/conductor/test/engine/recovery-cli-child-default.test.ts` — refusal text names #3203
- `src/conductor/test/engine/recovery-cli-child-default.sweepG3.test.ts` — refusal text names #3203
- `src/conductor/src/engine/rewind.ts` — default and refusal message
- `src/conductor/test/engine/rewind-child.test.ts` — refusal and default tests

**Dependencies:** Task 14

### Task 17: kickback-budget keeps whole-feature gates flat, and daemon-rekick authorises against the execution child
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing test(s): extend `src/conductor/test/cli/kickback-budget.test.ts` and `src/conductor/test/engine/daemon-rekick.test.ts` with the cursor reporting host 1 `repairing`.
2. Verify RED
3. Implement: in `engine/kickback-budget-cli.ts`, the show and mutation defaults use `resolveExecutionChild` for region gates only; whole-feature gates (`prd_audit`, `architecture_review_as_built`, `manual_test` and post-region custom steps) never take the execution-child default and target the flat ledger. In `consumeResumeAuthorizations` (`engine/daemon-rekick.ts`), the halted gate picks the ledger: whole-feature gates (`prd_audit`, `architecture_review_as_built`, `manual_test` and custom post-region steps) read the flat feature ledger, and region gates read the ledger of `resolveExecutionChild`'s child. The `restack` pseudo-gate's cap evidence and resume authorisation stay in the active (leaf) child's ledger, as `adr-2026-10-10-stacked-restack-journaled-replay` decision 10 requires; it is neither a whole-feature gate nor read from the execution child. The `prd_audit` cap halt and its cap evidence in check 4 are hand-written fixtures (the halt itself is produced by #3211's settlement). The flat-ledger default for whole-feature gates also applies to stacked features with the setting off: today `kickback-budget-cli` defaults them to the cursor child while the engine reads them from the flat ledger, so this aligns the CLI with the engine.
4. Verify GREEN, commit.

**Done when:**
- [test] with host 1 `repairing`, `kickback-budget raise --gate prd_audit` writes the raise into `.pipeline/kickback-ledger.json` and leaves `.pipeline/children/1/kickback-ledger.json` byte-identical.
- [test] with host 1 `repairing`, `kickback-budget show --gate build_review` with no `--child` reads child 1's ledger.
- [test] with host 1 `repairing` and a `build_review` cap authorization in child 1's ledger, `consumeResumeAuthorizations` reads child 1's ledger and consumes it, while the same authorization in the leaf's ledger is not consumed.
- [test] after a `prd_audit` cap halt raised at host 1's dispatch and `kickback-budget raise --gate prd_audit`, `consumeResumeAuthorizations` consumes the authorization from the flat `.pipeline/kickback-ledger.json`, leaves child 1's ledger byte-identical, and the feature resumes.

**Files likely touched:**
- `src/conductor/src/engine/kickback-budget-cli.ts` — whole-feature flat rule and execution-child default
- `src/conductor/src/engine/daemon-rekick.ts` — execution-child ledger
- `src/conductor/test/cli/kickback-budget.test.ts` — consumer test
- `src/conductor/test/engine/daemon-rekick.test.ts` — consumer test

**Dependencies:** Task 14

### Task 18: The dark-launch flag gate, wired into the gap loop, keeps N=1 and unsliced features off routing
**Story:** 16
**Type:** negative-path

**Steps:**
1. Write failing test(s): `routingEligible` and `loadConfig` unit cases; extend `n1-golden-routing-guard.test.ts` with two more laps on the `flag-off-unsliced` and `flag-on-unsliced` cells (a `manual_test` FAIL and a post-region custom-step kickback) and a `flag-on-unsliced` FIXABLE lap, each under the `PATH`-shimmed `git` of Task 3 and with a spy on `routingEligible`.
2. Verify RED (a fixture whose gap loop skips the `routingEligible` call, or calls it twice in one admitted lap, must fail the test).
3. Implement: add `route_whole_feature_fixes` (boolean, default `false`) to the `stacked_prs` block in `config.ts`, applied whether or not the project config has a `stacked_prs` block; a single `routingEligible(cursor, config)` gate in `conductor.ts`, true only when the cursor kind is `active` or `repair-pending` (durable child state) and `stacked_prs.route_whole_feature_fixes` is `true`, and false when the `stacked_prs` block is absent. Wire its production call site: the conductor gap loop calls `routingEligible` once per admitted lap at the point where admitted work flows to today's remediation and kickback path. In this spec that path runs unchanged for either result, byte for byte with `false`; #3210, #3211 and #3212 add the routed branch behind `true`. Export `routingSettingOn(config)` and `routingEligible(cursor, config)` from `routing/route-types.ts` for reuse; Tasks 11 and 12 use this helper rather than re-implementing the predicate.
4. Verify GREEN, commit.

**Done when:**
- [test] `routingEligible` returns true for a three-child stack whose config sets `stacked_prs.route_whole_feature_fixes: true`, false for that stack with the setting unset (and the `PATH`-shimmed `git` records no command naming `refs/conductor/demo/routes`, `repairing` or `revalidate`) and with the `stacked_prs` block absent, false for an N=1 feature with the setting `true` because the cursor reports `no-child`, and false for an N=1 feature with the setting unset.
- [test] `loadConfig` yields `stacked_prs.route_whole_feature_fixes === false` both when the `stacked_prs` block is present without the key and when the block is absent.
- [test] the gap loop in `conductor.ts` calls `routingEligible` exactly once per admitted lap, asserted by a spy, and with `false` the N=1 FIXABLE lap's plan, kickback-ledger and conduct-state match the Task 3 goldens byte for byte.
- [test] for an N=1 `manual_test` FAIL and an N=1 custom-step kickback, today's kickback runs with today's counter, `routingEligible` returns false, and the `PATH`-shimmed `git` records no command naming `refs/conductor/<slug>/routes`, `repairing` or `revalidate`.
- [test] for the `flag-on-unsliced` cell with an admitted FIXABLE finding, `resolveActiveChild` returns `no-child` and the goldens match the N=1 lap of Task 3, and none of the three laps writes a `remediation_routed`, `remediation_rerouted`, `routed_repair_phase` or `child_revalidated` line to `events.jsonl`.

**Files likely touched:**
- `src/conductor/src/engine/config.ts` — `stacked_prs.route_whole_feature_fixes` default `false`
- `src/conductor/src/engine/conductor.ts` — `routingEligible` gate and its gap-loop call site
- `src/conductor/test/engine/config.test.ts` — default with and without the block
- `src/conductor/test/engine/n1-golden-routing-guard.test.ts` — shimmed-git laps and the call-count spy

**Dependencies:** Tasks 1, 3

### Task 19: daemon status and the dashboard show the execution child
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing test(s): extend `src/conductor/test/engine/daemon-observe-cli.test.ts` and `src/conductor/test/engine/daemon-dashboard.test.ts` with the cursor reporting `repair-pending`, `routedRepair` child 1, on the three-child stack.
2. Verify RED
3. Implement: `activeChildStatusLabel` (`engine/daemon-observe-cli.ts`) and the dashboard's active-child loader (`engine/daemon-dashboard.ts`) accept `active` and `repair-pending` cursors and label `resolveExecutionChild`'s child; the dashboard reads that child's overlay.
4. Verify GREEN, commit.

**Done when:**
- [test] with host 1 `repairing`, `daemon status` renders ` child 1/3` for the feature.
- [test] with host 1 `repairing`, the dashboard entry renders ` (child 1/3)` and shows child 1's region statuses from `.pipeline/children/1/conduct-state.json`.
- [test] with no marker and the leaf active, both surfaces still render `3/3`, and the N=1 golden `flag-on-ineligible-daemon-status` fixture is unchanged.

**Files likely touched:**
- `src/conductor/src/engine/daemon-observe-cli.ts` — execution-child label
- `src/conductor/src/engine/daemon-dashboard.ts` — execution-child label and overlay
- `src/conductor/test/engine/daemon-observe-cli.test.ts` — status test
- `src/conductor/test/engine/daemon-dashboard.test.ts` — dashboard test

**Dependencies:** Task 14

## Verification

- [ ] All happy path criteria are covered by at least one task.
- [ ] All negative path criteria are covered by at least one task.
- [ ] Every task has a `Done when:` block of falsifiable checks, each on one physical line.
- [ ] Dependencies are explicit and acyclic.
