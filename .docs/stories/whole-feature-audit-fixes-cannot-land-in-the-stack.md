**Status:** Accepted

# Stories: Foundation for routing whole-feature fixes to the owning stacked child (#2944)

Technical track (no PRD). Sources:
- the scope boundary in `.docs/track/whole-feature-audit-fixes-cannot-land-in-the-stack.md`
  (the foundation spec of a four-spec split: #2944, #3210, #3211, #3212; outcome 6 is #3203);
- `adr-2026-10-12-routed-whole-feature-repair` (decisions 6, 8, 16, 17 and 18, foundation parts);
- the conditions C1–C6 of
  `architecture-review-2026-10-12-whole-feature-audit-fixes-cannot-land-in-the-stack`.

Terms used below:
- **Stacked feature:** a feature whose cursor reports durable child state (#2942).
- **Three-child stack:** a stacked feature with slug `demo` and positions `1`, `2` and `3`, with
  every child already built and the leaf at its whole-feature gates.
  - `feat/c1/demo` is closed at `refs/conductor/demo/closed/c1`. It owns task `T1` (Story 1 of the
    feature's plan) and file `src/a.ts`.
  - `feat/c2/demo` is closed at `closed/c2`. It owns task `T2` (Story 2) and adds file `src/b.ts`,
    which exports `parseB`.
  - The leaf `feat/daemon-demo` (position 3) owns task `T3` (Story 3). It is checked out in the clean
    feature worktree, and the loop is on `prd_audit`.
  - The plan has 12 authored tasks. The default `prd_audit` and as-built lap caps are 1, and the
    growth cap is 3.
- **Routing refs:**
  - the route record `refs/conductor/demo/routes/<roundId>`;
  - the marker `refs/conductor/demo/repairing`;
  - the queue `refs/conductor/demo/revalidate`.
- **Admitted work:** what today's classification admits. That is task work orders (FIXABLE,
  REMEDIABLE, refusal rework, merged `/remediate` gaps) and taskless obligations (a `manual_test`
  FAIL, a post-region custom-step kickback).
- **Host:** the child whose region builds a routed fix.
- **Execution child:** the routed host, else the re-validating child, else the cursor child.
- **N=1 feature:** a feature whose cursor reports `no-child`: no durable child state.
- Reason values other than `prerequisite-paths` and `residue-default` are named by BUILD; the
  criteria below only require that each placement records a reason.

## Story 1: Classification runs first, and features without children are untouched

**Requirement:** Scope outcomes 1 and 7; ADR decisions 1 and 17

As an operator, I want routing to start only after today's classification, and only for stacked
features, so that no finding the existing ADRs forbid becomes work and single-branch features behave
exactly as before.

### Acceptance Criteria

#### Happy Path
- Given an N=1 feature, when `prd_audit` returns a FIXABLE finding, then the rem task is appended on the feature branch, the flat `pendingRepair` is recorded and the loop rewinds to `build` exactly as before this change, and the `PATH`-shimmed `git` in the golden suite records no command naming `refs/conductor/<slug>/routes`, `repairing` or `revalidate`.

#### Negative Paths
- Given an N=1 feature, when a `manual_test` FAIL or a custom-step kickback is returned, then today's kickback runs with today's counter, `routingEligible` returns false, and the `PATH`-shimmed `git` records no command naming a routing ref.
- Given an unsliced plan, when a whole-feature gate admits work, then the cursor reports `no-child`, and remediation behaves exactly as for an N=1 feature.

### Done When
- [ ] A golden-suite test asserts, through a `PATH`-shimmed `git`, that an N=1 remediation lap touches no routing ref.

## Story 6: Routing refs are torn down by explicit name

**Requirement:** Scope outcome 2; ADR decision 6

As an operator, I want every ref the routing machinery creates removed when a feature ships or is
reclaimed, so that a reused slug never inherits a stale round.

### Acceptance Criteria

#### Happy Path
- Given a feature with route records, a marker, a queue and `red/c1`, when shipped-record teardown or reclaim runs, then each of those refs is deleted by its explicit name, and no glob deletion is used.

#### Negative Paths
- Given an N=1 feature, when shipped-record teardown or reclaim runs, then no command or `update-ref --stdin` line names `routes/`, `rejected/`, `repairing`, `revalidate` or `red/`.

### Done When
- [ ] Shipped-record teardown and reclaim delete every routing ref of a stacked feature by explicit name, with no glob delete, and touch no routing ref for an N=1 feature.

## Story 7: Every operator and engine surface acts on the child being repaired

**Requirement:** Scope outcome 2; ADR decision 8; review condition C6

As an operator, I want `task`, `kickback-budget`, `rewind` and region state to target the child
under repair, so that my commands and the engine's writes never land on the leaf by mistake.

### Acceptance Criteria

#### Happy Path
- Given host 1 `repairing`, when `resolveActiveChild` runs, then it reports the existing kind with `routedRepair: {child: 1, roundId}`, and the restack planner still sees the leaf as the active range.
- Given host 1 `repairing`, when the operator runs `task status` with no `--child`, then it reports child 1's tasks.
- Given host 1 `repairing`, when the operator runs `daemon status`, then it shows child 1 as the child being worked, as `1/3`.
- Given host 1 `repairing`, when region state is read or written, then child 1's per-child region state is used.
- Given host 1 `repairing`, when the operator runs `kickback-budget raise --gate prd_audit`, then the raise lands in the flat feature ledger, ignoring the execution-child default.
- Given a closed child 2 and no open round, when the operator runs `rewind --child 2`, then it is refused with a message naming #3203.

#### Negative Paths
- Given host 1 `repairing` and an operator commit with no `Round:` stamp past `closed/c2`, when the cursor runs, then it accepts `repair-pending` with child 2 as a co-origin, and does not halt.
- Given host 1 `repairing`, when the cursor reports `repair-pending` for children 1 and 2 and child 2's commits carry another round's `Round:` stamp, then the feature halts needs-human naming child 2.
- Given host 1 `repairing`, when the restack executor reads the cursor, then it does not throw, because the cursor kind is unchanged.

### Done When
- [ ] One execution-child resolver is used by region entry, both region-state activators, the mutation port, `task-cli`, `kickback-budget-cli`, `rewind`, `daemon-rekick` resume authorisation and dispatch identity, and a test per consumer asserts it.
- [ ] Every switch over the new cursor fields and route states is exhaustive, with no default arm (C3).
- [ ] The closed-child rewind refusal names #3203 (C6).

## Story 15: Every routing step is visible on the event spine, exactly once

**Requirement:** Scope outcome 2; ADR decision 16

As an operator watching the daemon, I want each routing decision, reroute, phase change and
re-validation outcome on the existing event stream, so that every consumer sees it without a new
reader.

### Acceptance Criteria

#### Happy Path
- Given a route record whose outbox holds a `routed_repair_phase` event, when the feature resumes, then `.pipeline/events.jsonl` holds that event exactly once, carrying `child`.

#### Negative Paths
- Given a crash after an outbox entry was persisted and before it was removed from the outbox, when the outbox is drained again, then the persister deduplicates by `eventId`, and the event appears once.
- Given a crash after the state transition and before draining, when the feature resumes, then the pending event is still delivered.
- Given an N=1 feature, when it remediates, then none of the four new events is emitted.
- Given the canonical event append fails, when the outbox is drained, then the entry stays in the outbox for the next drain.
- Given a persister restarted after an event was persisted, when the same `eventId` is drained again, then it is suppressed, and a replayed event keeps its original occurrence time.
- Given the outbox removal compare-and-swap fails, when the next drain runs, then the entry is retried and still appears once in the log.

### Done When
- [ ] The `ConductorEvent` union carries the four new members with `child`.
- [ ] Persister dedup covers them by `eventId`, asserted by a test.
- [ ] Tests assert at-least-once delivery from the route record outbox across crashes.

## Story 16: Routing stays off until the project turns it on

**Requirement:** ADR decision 18

As an operator, I want the routing machinery to ship dark until every part of it has landed, so that
no stacked feature runs on a half-built router.

### Acceptance Criteria

#### Happy Path
- Given a three-child stack whose project sets `stacked_prs.route_whole_feature_fixes: true`, when `routingEligible` is evaluated, then it returns true.

#### Negative Paths
- Given a three-child stack whose project leaves `stacked_prs.route_whole_feature_fixes` unset, when `routingEligible` is evaluated, then it returns false, and the `PATH`-shimmed `git` records no command naming `refs/conductor/demo/routes`, `repairing` or `revalidate`.
- Given an N=1 feature whose project sets `stacked_prs.route_whole_feature_fixes: true`, when `routingEligible` is evaluated, then it returns false, because the cursor reports `no-child`.

### Done When
- [ ] `routingEligible` requires both durable child state and the setting, asserted by a test for each combination.
- [ ] The setting defaults to `false` when the project config omits it.
