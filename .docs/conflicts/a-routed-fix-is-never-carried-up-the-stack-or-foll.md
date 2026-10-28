# Conflict Check: Carry a routed fix up the stack and re-validate the children above (#3212)

**Date:** 2026-10-23
**Stories checked:** `.docs/stories/a-routed-fix-is-never-carried-up-the-stack-or-foll.md` (Stories 1–11)
against every file in `.docs/stories/`, and against the approved ADRs selected below.
**Result:** 2 blocking and 14 degrading conflicts were found. All were resolved by the operator on
2026-10-23. A re-check after the edits found no remaining conflict.

## ADR corpus

**Examined:**
- In full: `adr-2026-10-12-routed-whole-feature-repair`,
  `adr-2026-10-10-stacked-restack-journaled-replay`,
  `adr-2026-10-17-stacked-feature-publication-as-native-stack`, `adr-2026-10-07-per-child-build-region`.
- Their relevant decisions and stacked-routing notes:
  - `adr-2026-10-03-stacked-child-plans-identity-and-state`
  - `adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility`
  - `adr-2026-07-13-kickback-build-no-op-escalation`
  - `adr-2026-07-06-manual-test-fail-routing`
  - `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback`
  - `adr-2026-08-25-as-built-remediable-findings-bounded-build-route`
  - `adr-2026-09-06-reopened-task-resolution`
  - `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence`
  - `adr-2026-08-12-cumulative-build-review-convergence-bound`
  - `adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance`
  - `adr-2026-07-26-cross-dispatch-kickback-livelock-bound`
  - `adr-2026-09-11-selective-post-rebase-verification`
  - `adr-2026-07-20-post-rebase-delta-aware-invalidation`
  - `adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch`
  - `adr-2026-10-01-daemon-session-command-contracts`
  - `adr-2026-10-20-operator-acceptance-is-durable-case-state`
  - `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal`
  - `adr-2026-07-27-project-config-scaffolder`

**Narrowed out:**
- Memory, intake, ledger and dependency ADRs.
- Daemon supervision, park, auth, rate-limit, respawn, lock and provider ADRs.
- Release, version, migration and changelog ADRs.
- PR body, prose and ship-tail ADRs, other than stacked publication.
- Attribution, evidence-judge, seal and protected-artifact ADRs.
- Build-review rubric, finding and adjudication ADRs.
- Cost, timing and telemetry ADRs.
- DECIDE, coherence, land and ADR-lint ADRs.

**Excluded:** the 6 fully superseded ADRs.

## Blocking conflicts

### Conflict: Routing default stays off vs routing on by default

**Stories involved:** spec A Story 16 "Routing stays off until the project turns it on" vs Story 11
**Files:** `.docs/stories/whole-feature-audit-fixes-cannot-land-in-the-stack.md` vs this spec's stories
**Type:** contradiction
**Severity:** blocking
**Description:** Spec A asserts that the setting defaults to `false`, and Story 11 asserts that it
defaults to `true`.
**Resolution (operator, 2026-10-23):** Spec A Story 16 is rewritten in place:
- an unset key resolves to `true`;
- an explicit `false` turns routing off.

The `Routing on` term in specs B and C is corrected in place the same way.

### Conflict: Follow-on base refresh always runs vs deferred while children are queued

**Stories involved:** restack Story 9 "Operator commits on a closed child are carried upward
automatically" vs Story 10
**Files:** `.docs/stories/a-change-to-one-stacked-child-cannot-be-carried-in.md` vs this spec's stories
**Type:** contradiction
**Severity:** blocking
**Description:** Restack Story 9 equates "no routing round open" with "no `repairing` marker", and
has the follow-on base refresh run. Story 10 defers that refresh while the queue holds a child.
**Resolution (operator, 2026-10-23):** Restack Story 9 is amended in place:
- the automatic repair is gated only on the marker;
- the base refresh runs only when there is no marker, no open route record and no queued child;
- a new criterion defers it with `deferred-base-refresh` when the repair queued a child.

## Degrading conflicts (all resolved)

| Id | Parties | Resolution applied |
|---|---|---|
| C-2 | Spec B and C `Routing on` terms vs Story 11 | Terms corrected in place (default `true`) |
| C-4 | Restack Story 11 (queue credited to #2944, unconditional) vs Story 7 | Now credits #3212, and applies only with routing on |
| C-5 | Story 10 follow-on suppression vs restack Story 9 `deferred-base-refresh` | Story 10 records `restack_refused` `deferred-base-refresh` |
| C-6 | Leaf gates and publication vs a queue-only state | New Story 6 negative path: queued child, no marker, so no leaf gate and no FINISH or publication step |
| K1 | Routed D6 and D15 vs Story 6 | Story 6 Given adds "the queue is empty" |
| K2 | Routed D4 vs Story 8 (last ack closes the round) | Story 8: the last ack leaves the round open until `returnToLeaf` records the switch; D14 note |
| K3 | Restack D7 (`REKICK` consumed) vs Story 10 | Restack D7 note: a deferred follow-on keeps the request in `REKICK` (not consumed in the preflight, re-armed by recovery) |
| K4 | Restack D7 recovery row vs Story 10 | The same D7 note covers the `applied` with a follow-on row |
| K5 | As-built D9 note vs Story 2 | As-built D9 note: only tip equality selects the no-commit exit |
| K6 | Routed D14 acknowledgement vs Story 8 | D14 note records C3 and C4: per-gate freshness, gate union, replay tuple |
| K7 | Routed D14 production vs Story 7 (routing off) | D14 note: production and consumption gated on `routingEligible` |
| K8 | Routed D13 return order vs Story 5 | Story 5 Given adds "the queue is empty" |
| K9 | Routed D13 no-commit cases vs Story 2 | D13 note adds the taskless-host case; Story 2 criterion added |
| A-1/A-5 | Rem-block merge with routing off; host-exit ack event | Story 4 criterion: routing off means no union merge. Story 7 criteria: host-exit ack records `child_revalidated` |

## Assumptions carried to the plan

These do not change any story. Each is settled by an approved condition or by code, and the plan
must honour it.

| Id | Assumption | Settlement |
|---|---|---|
| A-2 | The queue outbox drain must not race an open journal | C2: the fence covers queue writers too, and the drain is ordered after journal recovery |
| A-3 | An aborted `prepared` record does not block base refresh forever | Verified: `round-admission.ts` aborts by deleting the record |
| A-4 | `mode: verify-green` is emitted in a `revalidate` pass | Story 8 requires verify-green; the plan task emits the mode |
| A-6 | Refusal precedence when published and the queue is unreadable | The published refusal belongs to the routed exit; deferral belongs to base refresh. They are separate paths |
| A-7 | Inherited rem blocks vs the `build_review` plan input | C3: replay proof normalises inherited rem blocks |
| A-8 | A failed `applied` CAS halts on every recovery | Existing restack D7 needs-human halt naming the ref; the runbook section covers clearing it |
| A-9 | "One kickback per round" applies to audit rounds | `revalidate` rounds are preflight-created and record no kickback |

## Compatible pairs

Story 1 through Story 11 were checked in both directions against these, and are compatible:
- routed D6–D18;
- restack D4, D5 and D8–D12;
- publication D11;
- per-child region D1, D5, D9 and D10;
- identity D14 and sliced-plan D3;
- no-op D1 and D2, manual-test D2 and D3;
- prd-audit D2, D5 and D6, reopened-task D8 and D9;
- refund D2, cumulative-bound D1, selective verification, delta-aware invalidation and tree-attesting D1;
- persister dedup and the config-key registry.

Among the stories, specs A, B and C and the restack stories are compatible with Stories 1–11 after
the edits above.

## ADR amendments made

The amendments are dated 2026-10-23 and are additive:
- `adr-2026-10-12-routed-whole-feature-repair` D13 and D14;
- `adr-2026-10-10-stacked-restack-journaled-replay` D7;
- `adr-2026-08-25-as-built-remediable-findings-bounded-build-route` D9.

No superseding ADR was created.
