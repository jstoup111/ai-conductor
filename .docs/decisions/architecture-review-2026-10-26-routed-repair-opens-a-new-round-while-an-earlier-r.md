# Architecture Review: Routed repair opens a new round while an earlier round is still open

**Date:** 2026-10-26
**Mode:** Lightweight (Tier M): Technical Feasibility and Architectural Alignment
**Inputs reviewed:** explore output and track `.docs/track/routed-repair-opens-a-new-round-while-an-earlier-r.md`
(technical track, comprehensive scope, approach B); approved diagram
`.docs/architecture/routed-repair-opens-a-new-round-while-an-earlier-r.md`; intake jstoup111/ai-conductor#3445;
`adr-2026-10-12-routed-whole-feature-repair` (decisions 6, 7, 13, 14); `.pipeline/events.jsonl` and route
records of `build-review-re-raises-already-decided-findings-ev`; the in-flight #3446 spec worktree.
**Verdict:** APPROVED WITH CONDITIONS

## Root Cause (verified against code and the event spine)

- **Resume exit does not continue its round (verified, 90%).** `runStackPreflight`'s `resume-exit` arm
  (`restack/stack-preflight.ts`) calls `requestRoutedExit` and returns `repaired` without reconciling.
  The conductor's resume treats `repaired` like `clear` and activates the plain stack cursor. With the
  marker deleted by the exit restack, `resolveExecutionChild` reports source `cursor`, not `routed-host`,
  so the round's next host is never admitted. The spine shows this sequence for r1→r2 and r4→r5: host
  `built`, a halt, several `executor_started`, host `restacked`, `child_started` 2 with no admission, and
  then `remediation_routed` for a new round.
- **Admission is fenced only by the per-host marker (verified, 95%).** `admitRound` refuses only when a
  marker exists. Every host exit deletes the marker, so audit routing in `conductor.ts` creates and
  admits a fresh round while an older one has pending hosts.
- **Reconciliation walks oldest-first, then stops early (verified, 85%).** With two open rounds,
  `reconcileRounds` advances the older round into the newer round's marker, producing
  `round advance cas-failed` on every resume (r3/r4). When `advanceRound` closes a round because
  another is open, reconcile returns `deferred`. Callers then fall through to the plain cursor, which
  is the same leak.
- **Base-refresh deferral skips reconciliation (inferred, 75%).** When a base refresh is due and a round
  is open, the preflight returns `clear` before `reconcileRounds`. Between hosts, with no marker, resume
  then runs the plain cursor.

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new package, service or tool. Plain TypeScript inside existing routing and restack modules. |
| Prerequisites | Depends on #3446 (spec PR #3458), which makes every stopping preflight result write a HALT whose first line states the reason, and makes a live journal owner a `mechanical` HALT that the daemon re-kicks. This spec routes its stuck-rounds and fence stops through that path as `mechanical` HALTs. Land with `--depends-on jstoup111/ai-conductor#3446`. |
| Integration surface | `routing/round-admission.ts`, `routing/routed-exit.ts`, `restack/stack-preflight.ts`, and the two `conductor.ts` exit/admission sites. Two module directories plus the conductor, all already wired together. |
| Data implications | No persisted-format change. The fence enumerates existing `routes/«roundId»` refs. The escalation counter must reuse existing durable state or the spine (see Conditions); it adds no ref namespace. |
| Performance risk | Admission and reconcile add one `for-each-ref` plus one blob read per round. Rounds per feature are single digits. |
| Worktree isolation | All state is per-feature git refs and `.pipeline/`. No ports, services or shared files. |

**Layering (verified, 90%).** The import-graph ratchet (`test/structural/layer-ratchet.ts`, #3424) rejects
new cycles. `round-admission.ts` already imports `advanceRound` from `routed-exit.ts`, so `routed-exit.ts`
cannot import `reconcileRounds`. The exit-plus-reconcile continuation therefore lives in
`round-admission.ts`. Both callers already import that module (`conductor.ts`, `stack-preflight.ts`).

## Alignment

- **ADR decision 13 already states the intended order:** "The cursor then follows the record: next child
  host, else queue, else leaf host's items, else leaf gates". The code violates it on the resume path, so
  this fix restores the ADR's intent rather than departing from it.
- **ADR decisions 6 and 14 nest revalidate rounds inside an open audit round** (child hosts → queue → leaf
  host). The intake's literal outcome 1 would forbid that. The operator chose a kind-aware fence on
  2026-10-26: `audit` admission needs no other non-closed round, and `revalidate` admission needs every
  other non-closed round to be waiting on the queue with no `admitted`, `repairing` or `built` host.
- **State transitions stay explicit.** Host states and round phases are unchanged. The new behavior is a
  guard and an ordering on the existing enum-driven state machine, and every new result arm stays under
  `assertNever` exhaustive switches.
- **Event spine.** The stop reuses #3446's preflight HALT path (`.pipeline/HALT` plus `loop_halt`) with class
  `mechanical`. It adds no parallel channel. Round progress keeps emitting `routed_repair_phase` and `remediation_routed`
  through the existing outboxes.
- **Machinery, not discipline.** One continuation function is the only exit path. Preferably a structural
  test asserts that `requestRoutedExit` is imported only by `round-admission.ts`, so a future caller
  cannot skip reconciliation.
- **ADR handling.** A governing APPROVED ADR exists, so no new ADR is created. `adr-2026-10-12` is amended
  in place with dated `#3445` notes beside decisions 6, 7 and 13. No in-flight spec or open PR edits that
  ADR (checked 2026-10-26).

## Wiring Surface

| New or changed surface | Production caller (design-time) |
|---|---|
| Routing exit continuation in `round-admission.ts` (exit, then reconcile, then the next routed step) | The conductor's in-loop BUILD-region exit (replacing its direct `requestRoutedExit` + `reconcileRounds` pair) and `runStackPreflight`'s `resume-exit` arm |
| `admitRound` kind-aware fence | Existing callers: audit routing and taskless kickback admission in `conductor.ts`, and `consumeLowestQueued` in `revalidation-queue.ts` |
| Pre-allocation fence check in audit routing | The conductor's whole-feature audit routing, before `createRouteRecord` |
| `reconcileRounds` marker-owner-first, continue-after-close walk | Existing callers: `runStackPreflight` and the continuation above |
| Base-refresh deferral reconciles | `runStackPreflight`'s `baseRefreshDue` branch |
| Mechanical stuck-rounds HALT plus 3-strike needs-human escalation | `runStackPreflight` result, consumed by #3446's preflight stop handling in conductor resume, the rebase step and daemon rekick; re-kicked by the daemon's episode-end sweep through `resolveHaltRetention` |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Draining an older round's leaf host after a newer round runs repairs against items the newer audit supersedes | Technical | Medium | Medium | The leaf host re-runs its gates, and whole-feature validation re-runs after the last round closes. Stale items fail fast as no-ops under existing no-op escalation. |
| The kind-aware fence rejects a legitimate nested revalidate admission | Technical | Low | High | Derive the fence from `selectNextHost` (the same function that chooses `queue`), not a parallel predicate. Test the nested audit→queue→leaf sequence end to end. |
| #3458's Story 1 says a reconciliation `round advance cas-failed` stop is needs-human, contradicting this spec's bounded mechanical stop | Integration | High | Medium | Conflict C1, resolved 2026-10-26: when #3458 merges, this spec amends that criterion in place to a non-routing example and defers routing-round stops to #3445. Hard dependency edge. |
| A retry loop burns daemon dispatches before escalation | Technical | Low | Low | A fixed cap of 3 consecutive identical stops, reset by any routing progress. |
| Changing the in-loop exit call site regresses the queue-wins-over-leaf-return ordering | Technical | Medium | High | The continuation returns the same distinctions the conductor branches on today. Existing realgit routing tests stay green as the regression bar. |

## ADRs Created

None. Amended `adr-2026-10-12-routed-whole-feature-repair` decisions 6, 7 and 13, with dated notes by #3445.

## Conditions

1. **Single exit path.** Every routed host exit goes through the one continuation in `round-admission.ts`.
   No production module other than `round-admission.ts` calls `requestRoutedExit` directly.
2. **Kind-aware fence derived from host selection.** The revalidate admission test reuses
   `selectNextHost`'s `queue` outcome.
3. **The first stuck stops are `mechanical`, not needs-human.** Escalation happens only on the 3rd consecutive
   identical stop with no routing progress. The counter lives in existing durable state or is derived
   from the spine. It adds no new ref namespace or sidecar file (event-spine skill).
4. **Depends on #3446.** Land with the dependency edge, and reconcile the stop arm against #3446's merged
   shape before BUILD.
5. **Self-heal is proven on the observed shape.** A test reconstructs the r3/r4 refs (r3 host 1
   `restacked`, host 2 `pending`; r4 host 1 `built`, marker on r4). It proves resume completes r4 host 1,
   then runs r3 host 2, then r4 host 2, then returns to the leaf, with no `cas-failed`.

## Assumptions

| Assumption | Basis | Confidence | Impact if wrong | Approval |
|---|---|---|---|---|
| The resume-exit arm returning `repaired` is the origin of r1→r2 and r4→r5 | verified | 90% | The fix misses the real leak | n/a |
| The base-refresh deferral is a further leak between hosts | inferred | 75% | One extra code path changed needlessly (harmless) | APPROVED by operator 2026-10-26 |
| Revalidate rounds must stay nested inside open audit rounds (kind-aware fence) | verified | 90% | The fence blocks the queue | APPROVED by operator 2026-10-26 |
| A `mechanical` HALT is the retryable stop: the daemon's episode-end sweep clears and re-kicks it | verified | 90% | Stuck features wait for an operator | APPROVED by operator 2026-10-26 |
| A cap of 3 consecutive identical stops before HALT | inferred | 70% | Over- or under-retries | APPROVED by operator 2026-10-26 |
| Running an older round's unadmitted hosts after a newer round, rather than settling them, is safe | inferred | 70% | Wasted repair work on superseded items | APPROVED by operator 2026-10-26 |
