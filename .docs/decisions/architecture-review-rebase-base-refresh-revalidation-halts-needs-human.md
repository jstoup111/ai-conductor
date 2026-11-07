# Architecture Review: Rebase base-refresh revalidation halts needs-human at child BUILD entry

**Date:** 2026-10-31
**Inputs reviewed:** the explore output and technical intent in
`.docs/track/rebase-base-refresh-revalidation-halts-needs-human.md`, intake #3477 (with #3473 folded
in), the approved diagram `.docs/architecture/rebase-base-refresh-revalidation-halts-needs-human.md`,
and `adr-2026-10-12-routed-whole-feature-repair` with its #3445, #3455 and #3459 amendments.
**Mode:** lightweight (Medium tier). Sections 2 and 4 only.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

The design is buildable on the current stack. It needs no new package, service, persisted format,
ref, CLI surface or schema. Every piece it composes already exists on main (`049a655847`):

| Claim | Basis | Confidence |
|---|---|---|
| The region-entry guard in `enterRoutedHostRegion` (`src/conductor/src/engine/conductor.ts`) refuses a `revalidating` execution unless the marker's `host` and `roundId` match the execution. | verified (read) | 98% |
| `resolveActiveExecutionChild` (`routing/execution-child.ts`) sets `roundId` only for `routed-host`. The cursor (`child-cursor.ts`) sets `routedRepair` whenever a marker exists, and that wins the source. A `revalidating` execution therefore never matches a marker, so the guard can never pass. | verified (read) | 97% |
| Queue consumption (`consumeLowestQueued`, `routing/revalidation-queue.ts`) is called only by resume preflight (`restack/stack-preflight.ts`) and the routed-exit continuation (`continueRoutedHostExit`, `conductor.ts`). Nothing calls it before BUILD-region entry on the in-loop path. | verified (grep and read) | 95% |
| The #3473 path falls through `continueRoutedHostExit` to its final `resolveExecutionChild` arm, returns `acceptance_specs` for a `revalidating` child, and is then refused at region entry. Admission at region entry therefore covers it without a routed-exit-specific fix. | verified (read) | 85% |
| `consumeLowestQueued` returns `busy` while a repair marker exists, and refuses through the #3445 fence while another round blocks. A later resume therefore cannot open a duplicate `revalidate` round. | verified (read) | 95% |
| `admitRound` drains the routing outbox inside admission. The helper drains before reconciling only to reproduce the preflight's "a failed outbox never enters reconciliation" rule. | verified (read) | 90% |
| By the next region entry, the in-loop `rebase` step has applied its restack journal. The stacked branch of `runRebaseStepBody` (`conductor.ts`) runs the stack preflight, including journal recovery, before it restacks. It returns `success: true` only for `noop`, `mergeable_skip` (neither queues a child), or a `runRestack` result of kind `applied`. Every other restack result (`unavailable`, `refused`, halted) and a deferred base refresh return `success: false`, so the loop does not advance to a region step on them. | verified (read; operator asked for verification 2026-10-31) | 95% |

**Prerequisites.** None outstanding. Blockers #3445 (PR #3521) and #3455 (PR #3543) have merged;
the fence and `busy`/`stalled` results this design relies on are on main.

**Integration surface.** One module boundary: the `routing/` package and its two engine callers
(`conductor.ts`, `restack/stack-preflight.ts`). No external API.

**Data implications.** None. The design reads and writes the existing
`refs/conductor/<slug>/revalidate`, `repairing` and `routes/r<n>` refs only through existing
store functions.

**Performance.** Region entry reads one extra ref (the marker) only when the cursor already
resolved `revalidating`. The flat N=1 path and stacks with an empty queue do no extra work.

**Worktree isolation.** No new port, database, file path or queue. Routing refs are per-feature
under the feature's own slug.

## Alignment

- **Governing ADR reused, not duplicated.** `adr-2026-10-12-routed-whole-feature-repair` already
  governs where consumption, reconciliation and region entry happen. This change revises where an
  existing step runs. It makes no new structural decision, so it needs no new ADR. It is recorded
  as three additive amendment notes:
  - **D7:** the shared reconcile→consume helper, plus region-entry reconciliation.
  - **D8:** region entry admits before refusing, and the halt reason names the queued child,
    generation, open rounds and marker owner.
  - **D14:** consumption runs at three points, and each queue head is admitted at most once.
- **Pattern consistency.** The helper reuses the preflight's existing order: drain, then
  reconcile, then consume, then re-reconcile on `stalled`. It also reuses #3445's bounded
  routing-stall stop (`recordRoundStall`). One function replaces the two divergent copies of the
  consume half, so the change removes duplication instead of adding a third copy.
- **D8's single resolver.** Region entry still uses `resolveExecutionChild`, and the change adds no
  cursor kind or source. Excluded by the scope boundary: reworking or removing the `revalidating`
  source.
- **D7's base-refresh deferral is unchanged.** The in-loop restack that queues the child ran with
  every round closed and the queue empty, so it was permitted. The admission it now triggers is
  ordinary queue consumption.
- **State management.** No new boolean flags. Outcomes stay on the existing discriminated unions:
  `ReconcileRoundsResult` and `ConsumeLowestQueuedResult`. The helper's result must be an
  exhaustive union matched with `assertNever` at each caller.
- **Security.** No new input boundary. The halt reason renders ref contents that the engine
  already validated, such as child ids and round ids.
- **Diagram accuracy.** The approved diagram shows the three callers, the helper, and the
  region-entry sequence. No container- or system-level diagram changes.

**Focused local pattern basis.**
- **Precedent.** The preflight's reconcile→consume block in `restack/stack-preflight.ts`
  (`runStackPreflightInner`, the `consumeLowestQueued` call and its `stalled` re-reconcile).
- **Traits to preserve:**
  - consumption only after a non-continuing reconcile result (`none`, `aborted`, `deferred`,
    `leaf-returned`, `quiescent`);
  - `stalled` re-reconciles before it records the bounded stall;
  - `unavailable` never admits.
- **Why it applies.** It is the one path that already recovers this exact state (the issue's
  confirmed workaround).
- **Allowed variation.** Each caller keeps its own mapping from the helper's outcome to its
  return type: a preflight result, a routed-exit region index, or a region-entry decision.
- **Rediscovery seeds.** `consumeLowestQueued`, `reconcileRounds`, `recordRoundStall`,
  `continueRoutedHostExit`, `enterRoutedHostRegion`.

## Wiring Surface

- **Shared queue admission helper** (new export in a new file, `routing/queue-admission.ts`, inside the
  existing `routing/` package). It imports `consumeLowestQueued` and `reconcileRounds` across module
  boundaries, so existing tests that mock those modules still intercept the helper's calls. It has three
  production callers:
  - `runStackPreflightInner` in `restack/stack-preflight.ts`, which replaces its inline
    consume block;
  - `continueRoutedHostExit` in `conductor.ts`, which replaces its inline consume block;
  - `enterRoutedHostRegion` in `conductor.ts`, which is reached from the gate loop's region-step
    branch for every BUILD-region step.
- **Region-entry refusal reason.** This is a changed string in the existing
  `haltChildRegionRefusal` HALT body. It rides the existing `loop_halt` event and the HALT marker.
  No new event type.

Advisory overlap scan: `ai-conductor overlap-scan --files src/conductor/src/engine/conductor.ts
src/conductor/src/engine/restack/stack-preflight.ts src/conductor/src/engine/routing/revalidation-queue.ts`
(the report is surfaced in the session).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Region-entry reconciliation runs with a restack journal not yet recovered | Data | Very low (verified: the in-loop rebase advances only on an applied restack) | High | The helper is reached only after the in-loop restack step completed. Any reconcile result only the preflight may act on (`resume-exit`) ends with a `mechanical` HALT, so the daemon re-kick's preflight runs journal recovery first (condition 1). |
| Admission at region entry and on resume opens two `revalidate` rounds for one head | Data | Low | High | Consumption goes only through `consumeLowestQueued`, which returns `busy` under a marker and refuses through the #3445 fence. Required as an acceptance criterion (condition 2). |
| Unifying the routed-exit and preflight copies changes their behavior | Technical | Medium | Medium | Each caller keeps its outcome mapping, and the existing preflight and routed-exit tests stay green unchanged (condition 3). |
| A region-entry fence refusal loops through mechanical re-kicks | Technical | Low | Medium | It reuses #3445's bounded stop: three identical stops write `needs-human`. |

## ADRs Created

None. Amended: `adr-2026-10-12-routed-whole-feature-repair` D7, D8 and D14 (additive notes dated
2026-10-31, #3477).

## Conditions

1. At region entry, the helper acts only on `navigate-host` and queue admission. Every other
   continuing reconcile result ends with a `mechanical` HALT naming the result, and region entry
   never runs the routed exit or journal recovery itself.
2. Stories must include a criterion that a resume after an in-loop admission continues the
   admitted round and creates no second `revalidate` round for the same queue head.
3. The existing resume-preflight and routed-exit behavior tests pass without edits to their
   expectations. Only their call into the helper changes.
4. When nothing is queued, behavior is unchanged: the run proceeds to whole-feature gates. This is
   covered by an acceptance criterion.
