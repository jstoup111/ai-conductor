# Architecture Review: Routed residue finding lands on a taskless host and halts the stack (#3590)
**Date:** 2026-11-05
**Mode:** Lightweight (Medium tier): technical feasibility and architectural alignment only
**Inputs reviewed:** explore output and operator decisions (`.docs/track/routed-residue-finding-lands-on-a-taskless-host-an.md`), approved diagram `.docs/architecture/routed-residue-finding-lands-on-a-taskless-host-an.md`, `adr-2026-10-12-routed-whole-feature-repair`, `adr-2026-07-13-kickback-build-no-op-escalation`
**Verdict:** APPROVED

## Feasibility

All claims are verified against the current source unless marked otherwise.

1. **Task binding wins over residue provenance.** `routeAdmittedRound` (`engine/routing/round-router.ts`)
   sends any item where `isResidue(source)` is true to the residue judge, before it looks at
   `ownerTaskIds`. `isResidue` returns true for an as-built finding whose reference kind is
   `adr-decision`, even when the gap's disposition is existing-task and the conductor has already
   resolved `ownerTaskIds` from the admitted binding (`conductor.ts`, `existingTaskOwnerIds`). The
   #3579 r2 record shows exactly this: item `existingTask: true, taskIds: ["25"]` with reason
   `residue-default`, and owner 1 from `Math.min(candidates)`. The fix tests the existing-task
   binding first. An item with `existingTask` and a non-empty `ownerTaskIds` goes through
   `deriveTaskBoundOwner`, like any task-bound item, and never reaches the judge. Confidence 95%
   (verified). No new code path is needed: the task-bound branch already exists.
   - **Scope limit.** Only an existing-task binding moves the item out of residue. A residue item
     whose `ownerTaskIds` come from a `parentTask` (new rem-* work) keeps today's judge path, per the
     operator-confirmed scope. `resolveResidueOwner` and the earliest-candidate default
     (#2940 decision 4b) are unchanged.
   - **Mixed rounds.** The mixed-round FAIL host is chosen from the `!isResidue` portion of the round.
     Reclassifying the item moves it into that portion, which is correct: it is now task-bound.
2. **A no-op audit host settles and the round advances.** `enterHostRegion`
   (`engine/routing/host-region-entry.ts`) already returns `derived-already-complete` without
   transitioning to `repairing` and without charging credit. The conductor
   (`enterRoutedHostRegion`) currently turns that into a needs-human HALT. Settling reuses existing
   machinery rather than adding a host state:
   - The conductor transitions the host `admitted → repairing` (an existing legal transition) with
     `credit: false`, and grants no repair credit. The `routed_repair_phase` event for that
     transition carries an additive optional field `reason: 'derived-already-complete'`.
   - It then calls the existing production continuation `exitRoutedHostAndReconcile`.
     `requestRoutedExit` already takes the **no-commit exit** (`done`, marker deleted) when the host
     tip equals its closure. A leaf host (no closure) takes the existing leaf `done` exit. If region
     entry did commit frozen blocks or restages on the host, the tip differs from the closure and the
     existing `built → restacked` exit carries those commits. A no-op settle therefore never strands
     a commit. Confidence 90% (verified in `routed-exit.ts`; the no-commit branch is exercised today
     by hosts whose BUILD made no commits).
   - The reconcile result is handled exactly as after a normal routed exit (`navigate-host`, queue
     admission, `leaf-returned`). On `leaf-returned` the leaf's gates re-run, so the as-built
     finding the no-op host carried is re-judged rather than silently dropped.
   - **The halt is kept where it still means "nothing anywhere".** The no-op halt is written,
     unchanged in body and class, only when the round has no later `pending` host **and** no other
     host ended `restacked` or `rerouted`. A single-host round and the N=1 path therefore keep
     today's behaviour exactly. Because hosts are entered in order, the halt can fire only at the
     round's last host.
3. **Recovery for an already-stuck round is `halt clear`.** A cleared needs-human HALT re-runs
   reconciliation, which navigates to the `admitted` host (`reconcileRounds`, `activeHost` arm),
   and `enterHostRegion` re-runs the completion check from the `admitted` state. With item 2 in
   place, #3579's r2 host 1 settles and host 2 is admitted. No routing ref is hand-edited and no
   CLI is added. Confidence 85% (inferred from the reconcile and entry code paths; a story pins it
   with a test that starts from the `admitted`, needs-human-halted state).

| Check | Finding |
|---|---|
| Stack compatibility | No new dependency |
| Prerequisites | None |
| Integration surface | One subsystem (`engine/routing/`) plus its conductor caller and one event variant |
| Data implications | No route-record schema change. One additive optional field on the `routed_repair_phase` event |
| Performance risk | None. The completion check already runs at host entry |
| Worktree isolation | No new shared resource |

## Alignment

- **`adr-2026-10-12-routed-whole-feature-repair` decision 2** already says no judgement can override
  a task-bound owner. Item 1 brings decision 3's residue definition into line with it. This is an
  amendment, not a reversal.
- **Decision 7, "The no-op guard"**, and **`adr-2026-07-13-kickback-build-no-op-escalation` D1**
  (as amended by #3211) make the routed no-op guard halt. Item 2 narrows that halt to rounds where no
  host did work. Both ADRs get dated amendment notes. The guard's purpose, never dispatching a
  provider into a guaranteed no-op, is kept: the settle path runs no provider.
- **Decision 6 host lifecycle** is unchanged. The settle uses only existing legal transitions
  (`admitted → repairing → done`, or `→ built → restacked` when entry committed).
- **Decision 10 receipts and credit.** No credit is granted for a settled no-op, matching today's
  derived-already-complete outcome.
- **Decision 16, events on the spine.** The no-op settle is recorded by extending the existing
  `routed_repair_phase` variant through the route-record outbox. No new channel is added, which
  satisfies the event-spine procedure.
- **No new ADR.** No structural decision is introduced: no new boundary, component, integration,
  persisted state shape or technology. Both governing ADRs are reused and amended.
- **Local pattern basis.** The settle follows the existing routed-exit continuation
  (`continueRoutedHostExit` → `exitRoutedHostAndReconcile` in `conductor.ts` and
  `routing/round-admission.ts`). Preserve these traits: one continuation for every host exit, the
  outbox drained before reconcile, and the reconcile result handled by one switch. The allowed
  variation is the entry point (host entry rather than the end of the region) and the
  `requireSatisfiedRegion` check, which does not apply to a no-op.

## Wiring Surface

| Surface | Production caller |
|---|---|
| Existing-task precedence in owner classification | Inside `routeAdmittedRound`, which the conductor's remediation planning already calls for every routed round |
| Settle decision (`derived-already-complete` → settle or halt) | `Conductor.enterRoutedHostRegion`, at the existing `derived-already-complete` switch arm |
| `routed_repair_phase.reason` field | Written through `transitionHost` / `routedRepairPhaseEvent` into the route-record outbox, and drained by `exitRoutedHostAndReconcile` to `.pipeline/events.jsonl` |

Early overlap scan: run `ai-conductor overlap-scan` on these paths before `/plan`. It is advisory.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A crash after `admitted → repairing` but before the exit resumes the host as `repairing` and dispatches a region with no work | Technical | Low | Low | Resume reaches the same no-commit exit after BUILD finds nothing. The cost is one region pass, bounded by existing caps |
| A no-op host's finding is skipped and re-raised next lap, repeating the same no-op route | Technical | Low | Medium | Item 1 removes the known misroute. A repeat is bounded by the existing kickback budget, and an all-no-op round still halts |
| A settle on the leaf host closes the round when an earlier host did work | Technical | Low | Medium | Intended: `leaf-returned` re-runs the leaf gates, which re-judge every finding |

## ADRs Created

None. Amended (dated notes beside the existing assertions):

- `adr-2026-10-12-routed-whole-feature-repair`, decisions 3 and 7
- `adr-2026-07-13-kickback-build-no-op-escalation`, D1
