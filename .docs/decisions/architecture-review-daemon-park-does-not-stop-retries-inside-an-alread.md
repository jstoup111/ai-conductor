# Architecture Review: Park stops retries inside an already-dispatched step

**Date:** 2026-09-22
**Mode:** lightweight (tier M): feasibility and alignment
**Input:** PRD `.docs/specs/daemon-park-does-not-stop-retries-inside-an-alread.md` (FR-1–FR-14), diagram
`.docs/architecture/daemon-park-does-not-stop-retries-inside-an-alread.md`
**Source:** jstoup111/ai-conductor#2103
**Verdict:** APPROVED

## Feasibility

- **The serial attempt seam exists (verified 97%).** The serial retry loop in `conductor.ts` sends
  every `continue` path back to one per-attempt dispatch site. That covers rate-limit waits, stale
  sessions, auth refresh, finish publication, test_suite infrastructure retries, mechanical-fault
  retries, and budgeted retries. At that site, dispatch forks into self-host (`runSelfBuildDispatch`)
  or ordinary (`stepRunner.run`). Today only the self-host branch checks park, inside its admission
  window. One check per branch, using the same predicate, covers every serial attempt.
- **A mid-loop stop already resumes cleanly (verified 95%).** `stopAtOperatorParkBoundary(true)`
  emits the boundary event and returns `operator-parked`. It writes no step status, so the step stays
  `in_progress`, and `findResumeIndex` resumes it after unpark. The attempt counter is a loop local
  and never persists, so resume starts a fresh budget. The self-host path already reaches this return
  mid-loop (`result.operatorParkedBeforeDispatch`), so nothing on the ordinary path is new territory.
- **A declined attempt spends no counters (verified 90%).** The stop returns before completion
  checks, progress-retry classification, and escalation-ladder resolution for the next attempt, so no
  escalation rung, no-evidence count, or retry budget is charged. Tests must pin this down.
- **Group members need a new outcome (verified 95%).** The member attempt loop in `group-core.ts`
  checks only an abort signal before each dispatch, and on abort it returns `no-verdict "aborted"`.
  The join counts `no-verdict` as a failed branch. A park therefore needs its own `parked`
  `BranchOutcome`. `classifyOutcome` switches over outcomes exhaustively with no `default`, so the
  compiler flags every consumer that must handle the new kind.
- **The running-work report reuses existing readers (verified 90%).** `daemon-dashboard.ts` already
  projects each feature's latest `provider_attempt` lifecycle (preparing, running, recovering, or
  settled) from `.pipeline/events.jsonl`. The daemon pidfile liveness check in `daemon-lock.ts` is
  already a public read. The park CLI composes the two, so no new store and no process inspection
  are needed.
- **Interactive runs are unaffected (verified 99%).** `operatorParkBoundary` is injected at exactly
  one site (`daemon-cli.ts`). Every check short-circuits when it is absent.
- **Stack, data, and isolation:** no new dependency, no schema or migration, no new port or shared
  resource. The `BranchOutcome` union and the `operator_park_boundary` event shape change inside the
  engine. Both are internal types with no consumer-visible schema.

## Alignment

Against the repo-wide ADR sweep (317 APPROVED ADRs scanned at the Decision-section level):

| ADR | Relation | Resolution |
|---|---|---|
| adr-2026-07-29-operator-park-scheduling-unit-boundary D4, D10 | Conflicts | Amended in place with decisions 11–14 (operator-approved 2026-09-22). No new ADR. |
| adr-2026-07-13-park-all-dispatch-paths D2 | Constrains | The attempt gate uses the same `isOperatorParked` predicate and store. No second mechanism. |
| adr-2026-07-04-operator-park-marker D3 | Already mandates | Non-interruption holds. This feature redefines "next decision point" as the next attempt. |
| adr-2026-07-30-provider-preparation-lifecycle-supervision D5 | Constrains | The running-work report reads persisted events only, never `ps` or pane contents. |
| adr-2026-07-30-provider-preparation-lifecycle-supervision D2 | Considered | The synchronous spawn permit lives inside the step runner, which has no park view. Putting park there would thread daemon state into every runner. The conductor seam covers every attempt instead. Aux sub-calls count as part of their attempt (amended FR-6). |
| adr-2026-07-12-progress-aware-build-halt D1 | Constrains | A declined attempt is never classified as a zero-delta miss (ADR decision 12). |
| adr-2026-07-05-retry-as-escalation-ladder D1/D2 | Constrains | A declined attempt advances no ladder rung (ADR decision 12). |
| adr-2026-07-10-validation-group-join D2 | Constrains | A parked member is `parked`, never `no-verdict`, so the group does not fail (ADR decision 13). |
| adr-2026-07-13-retry-classify-rerun-vs-route D4 | Considered | Precedent for extending an existing event rather than adding one. Applied to `operator_park_boundary`, the park-owned event (ADR decision 14). |
| adr-2026-08-11-halt-events-ride-the-persisted-spine D1 | Supports | Park reporting stays on the persisted spine. No sidecar. |
| adr-2026-07-04-event-driven-halt-clear-wake D3 | Supports | Resume after unpark goes through the existing gate. There is no bespoke resume path. |
| adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever | Supports | A declined attempt leaves the durable park marker as the operator's lever. |

**Pattern basis: declined-attempt stop.** The local precedent is the self-host admission park check
and its `operatorParkedBeforeDispatch` result (`conductor.ts`, symbols `runSelfBuildDispatch`,
`stopAtOperatorParkBoundary`). Keep these traits: the same predicate, fail toward parked, a typed
result consumed at the dispatch site, and no status write. Allowed variation: the ordinary branch
checks before its runner call rather than inside an admission window, because it has no window.

**Pattern basis: group member stop.** The local precedent is the abort check in the member attempt
loop (`group-core.ts`, `runGroupBranchInner`). Keep these traits: check before every member
dispatch, and settle the member before the join. Allowed variation: the outcome is a new `parked`
kind, not `no-verdict`.

**Event spine.** The declined-attempt report extends the existing `operator_park_boundary` event
with an attempt boundary. That event's sink flags already cover render and persist. The park
command's running-work report reads the spine through an existing projection. It adds no watcher,
poller, or sidecar file.

## Wiring Surface

- **Attempt park check (ordinary path).** Called from the serial retry loop's per-attempt dispatch
  site in `conductor.ts`, beside the existing self-host check. Uses the daemon-injected
  `operatorParkBoundary` from `daemon-cli.ts`.
- **Group member park check.** Called from the member attempt loop in `group-core.ts` before each
  member dispatch. The predicate is threaded through the group deps that the conductor builds for
  built-in and configured groups.
- **`parked` BranchOutcome.** Produced by the group member loop and consumed by the join
  classification in `group-core.ts` and by the conductor's group-result handling, which maps it to
  the typed `operator-parked` termination.
- **Attempt boundary on `operator_park_boundary`.** Emitted by the conductor's park stop and
  rendered by the existing daemon-log renderer in `daemon-cli.ts`.
- **Running-work report.** Invoked from the `daemon park` command in `daemon-park-cli.ts` after the
  marker write. It composes the provider-attempt lifecycle projection exported from
  `daemon-dashboard.ts` with liveness from `daemon-lock.ts`.
- **Runbook text.** The emergency-stop runbook and the park operator documentation.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A retry path dispatches without passing the per-attempt site | Technical | Low | High | One test per enumerated `continue` path asserts that no dispatch follows a park. |
| The `parked` outcome is mishandled by a group consumer | Technical | Medium | Medium | Exhaustive switch with no `default`. Join tests for mixed pass, parked, and fail members. |
| Resumed group re-runs already-passed members | Knowledge | Medium | Low | The operator accepted existing group resume rules. Out of scope. |
| The report reads "stopped" while the daemon is between attempts | Technical | Low | Low | The attempt gate declines the next dispatch, so "no attempt running" stays true after park. |

## ADRs Created

None. `adr-2026-07-29-operator-park-scheduling-unit-boundary` is amended in place with decisions
11–14, following the operator's preference for amendments over new minimal ADRs.

## Conditions

None.
