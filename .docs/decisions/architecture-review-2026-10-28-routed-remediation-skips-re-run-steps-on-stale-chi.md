# Architecture Review: Routed remediation skips re-run steps on stale child verdicts, then exits markerless
**Date:** 2026-10-28
**Inputs reviewed:** explore output and track marker `.docs/track/routed-remediation-skips-re-run-steps-on-stale-chi.md` (technical track, Comprehensive scope); intake #3455; diagram `.docs/architecture/routed-remediation-skips-re-run-steps-on-stale-chi.md`; `adr-2026-10-12-routed-whole-feature-repair` (decisions 7, 9 and 13, with the #3445 amendments); `adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity`
**Mode:** Lightweight (Tier M): feasibility and alignment only
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

The design has three parts. Each is checked against the code on local main `d156e727eb`.

**1. Round stamp on child region verdicts.**
- `GateVerdict` (`src/conductor/src/engine/gate-verdicts.ts`) is a plain JSON record, and readers
  check only `satisfied`. `readVerdict` returns `null` only when `satisfied` is not a boolean. An
  optional `routedRound` field is additive, and older readers ignore it. Verified, 95%.
- Child verdicts are written through `writeVerdict(dir, step, verdict, child)` and
  `computeAndWriteVerdict`, which resolves the child from `ctx.activeChild`. There are 22 non-test
  call sites. Verified by grep, 90% that all child writes reach `writeVerdict`. The stamp belongs
  at that single writer, or one adjacent seam, not at each caller.
- The executing round is durable: `refs/conductor/<slug>/repairing` holds `{host, roundId}`
  (`readRepairMarker`, `routing/route-record-store.ts`). `resolveExecutionChild` already exposes
  `roundId` to the conductor (the in-loop exit call in `conductor.ts`). Verified, 90%.

**2. Round-scoped read.**
- Every selection reads verdicts through `readGateVerdictOverlay` (`conductor.ts`). For an active
  region child, it already replaces each region verdict with the child's record, and deletes the
  entry when the child has none. A routed-round mask fits inside that existing loop. Verified, 95%.
- With the entry deleted, `gateSatisfied` (`selector.ts`) falls back to the step status: `done` and
  `skipped` pass, `pending` and `in_progress` do not. So the selector rule stays unchanged.
  Verified, 95%.
- Restage runs once per `(roundId, host)`, only while the host is `admitted`, before the
  `repairing` transition (`routing/host-region-entry.ts` `enterHostRegion`, and
  `routing/operator-round.ts`). A resume inside the round therefore keeps its stamped verdicts.
  Verified, 95%.
- Already-wedged features heal without operator action. Their verdicts from earlier laps are
  unstamped, so they are masked and the re-pended steps re-run. Inferred from the two log traces in
  #3455, 85%.

**3. Classified parked exit.**
- `advanceTail` returns `'parked'` when `selectNextGate` returns `parked`. The step loop then sets
  `parkedForRouting`, which exempts the run from the catch-all diagnostic HALT. A refused
  `completeRun` sets the same flag. `completeRun` returns `false` while a marker, an open round, an
  unreadable queue or a queued child exists (`conductor.ts` `completeRun` / `routedRoundOpen`).
  Both exits reach the daemon without a marker, and `daemon-runner.ts` reports
  `loop ended without DONE or HALT marker`. Verified, 95%.
- Stack preflight admits a queued round and resumes or exits a held host at the next dispatch
  (`restack/stack-preflight.ts`: `reconcileRounds`, `consumeLowestQueued`). A `mechanical` re-kick
  therefore makes progress where progress is possible. Verified, 90%.
- The bounded stall (`recordRoundStall`, the `routing_rounds_stalled` event, attempts 1–2
  `mechanical`, then `needs-human`) belongs to #3445. Its spec is on main and its build is in
  `test_suite`. It is not on main yet. This is a prerequisite (Condition 1).

**4. Interrupted exit of a finished host region.**
- The host moves from `repairing` to `built` only inside `requestRoutedExit`
  (`routing/routed-exit.ts`, the `transitionHost(..., 'built', ...)` call). The in-loop exit runs
  only right after `build_review` completes inside the same run (`conductor.ts`, the
  `step.name === 'build_review'` closure branch). Verified, 90%.
- After an interruption between those two points, resume admits the host as `repairing`, which
  resumes the region rather than taking `resume-exit`. Every region gate is then satisfied by
  in-round verdicts, so the loop parks. Inferred, 75%. Operator decision 2026-10-28: include it,
  since no landed or in-flight spec covers a finished `repairing` host (searched `.docs/plans`,
  `.docs/stories` and unmerged `spec/*` branches; existing coverage is only a crash after `built`).
- Feasible on the existing seam: when selection on a routed host finds every region gate satisfied
  by the executing round, the loop invokes the same exit continuation as the in-loop exit, before
  any parking decision. No new module. "Satisfied" means under the round scope of part 2, so a
  `revalidate` host whose `build` stayed `done` also exits. A refusal from that exit stops exactly as
  an in-loop exit refusal does (`conductor.ts`, the `exited.kind === 'halted'` arm: an exit-written
  HALT stands, otherwise `haltChildRegionRefusal` writes needs-human) and records no routing stall.
  Verified, 90%.

**Prerequisites.** #3445 merged and built. No migration, no config key, no new dependency.

**Integration surface.** Three engine modules that already depend on each other: `gate-verdicts.ts`,
`conductor.ts`, and `routing/round-admission.ts` (consumed only). No module boundary is added.
Worktree isolation is unaffected, since all state is per-worktree `.pipeline/` plus existing
per-feature refs.

**Performance.** The overlay adds one marker read per selection. That is a local `git` ref read,
the same one `advanceTail` already does for routed parking. It is negligible.

## Alignment

- **Governing ADR reused, not duplicated.** `adr-2026-10-12-routed-whole-feature-repair` owns
  region entry (decision 9), the routed exit (decision 13) and stops during routing (decision 7, as
  amended by #3445). All three rules are recorded as additive `Amended 2026-10-28 by #3455` notes on those decisions. No new ADR is
  needed: the change extends a durable record the ADR already governs, and makes no new structural
  decision.
- **Engine-stamped identity.** The stamp is minted and written by the engine at the verdict writer.
  It is never echoed by a provider. This follows `adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity`
  decision 2, which says to stamp at the settle boundary and ignore provider-supplied identity.
- **One exit continuation (decision 13).** A finished host region found on resume uses the same
  exit continuation as the in-loop exit (decision 13 as amended by #3445 and #3455). No second exit
  path is added.
- **Event spine.** The parked stop reuses #3445's `routing_rounds_stalled` event and the existing
  `loop_halt`. It adds no new channel, sidecar or counter file.
- **Selector purity preserved.** `selectNextGate` and `gateSatisfied` stay pure and unchanged.
  Round scoping lives in the overlay, which is already the conductor's input-projection seam.
- **N=1 parity (decision 17).** Nothing is stamped or masked without a routed marker naming the
  active child. Flat features read exactly what they read today.
- **Fail-safe direction.** Only satisfied verdicts are masked. A missed stamp hides a pass that
  should have counted, so the step re-runs once. An unsatisfied verdict is never hidden, so the mask
  can never skip a gate. That is the safe direction of error for target #2.
- **Local pattern basis (leaf return).** `restageLeafGates` in `routing/routed-exit.ts` already
  pairs a re-pend with explicit verdict invalidation for the leaf's whole-feature gates. The host
  region now gets the equivalent guarantee through the round scope. That scope also covers verdicts
  written before this change, which an invalidate-at-restage approach would miss.
- **Advisory overlap scan.** `conductor.ts` is also touched by unmerged spec branches
  `planner-escalation-to-architecture-review-still-ha`, `routed-leaf-acceptance-specs-completion-still-requ`,
  `routed-verify-green-refuses-the-leaf-host-which-ne` and `stacked-no-op-rebase-never-satisfies-its-gate-afte`.
  The scan matched only the file, not shared functions. No blocking dependency is proposed.

## Wiring Surface

| New or changed surface | Production caller (design-time) |
|---|---|
| `GateVerdict.routedRound` (optional field) | Written by the existing region-step verdict writes, reached from `advanceTail`'s success tail and the validation join. Read by `readGateVerdictOverlay`. |
| Round stamp at the child verdict writer | Every existing child-region `writeVerdict` / `computeAndWriteVerdict` call while a routed marker names the active child. |
| Routed-round mask in `readGateVerdictOverlay` | Existing callers of the overlay: `advanceTail`'s gate selection and resume entry. |
| Routed exit of a finished host region on resume | The gate selection in `advanceTail`, before its `parked` arm, through the existing exit continuation the in-loop BUILD-region exit uses. |
| Classified parked stop | `advanceTail`'s `parked` arm and the step loop's refused-`completeRun` arm, through #3445's `recordRoundStall`, then the existing HALT writer and `loop_halt`. |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A child verdict writer bypasses the stamp seam, so an in-round step re-runs after resume | Technical | Medium | Low | Stamp at the single writer, not per caller. A test covers every region step under a routed marker. Failure direction is a redo, never a skip. |
| A prior-lap `satisfied:false` kickback on a step the round did not restage would be masked, letting its `done` status pass | Technical | Low | Medium | The mask ignores only *satisfied* verdicts from other rounds. An unsatisfied verdict from any round still blocks, so the mask can only cause a re-run, never a skip. |
| #3445's `recordRoundStall` shape differs from its plan when it lands | Integration | Low | Medium | Condition 1: BUILD verifies the landed shape first and maps onto it without widening scope. |
| A parked stall that cannot progress re-kicks twice before reaching an operator | Technical | Medium | Low | Bounded at 3 identical stalls by #3445's counter. Each attempt costs one dispatch and no provider turn. |

## ADRs Created

None. `adr-2026-10-12-routed-whole-feature-repair` is amended (decisions 7, 9 and 13, `Amended
2026-10-28 by #3455`).

## Conditions

1. BUILD starts after #3445 (spec `routed-repair-opens-a-new-round-while-an-earlier-r`) has merged.
   Verify the landed `recordRoundStall` / `routing_rounds_stalled` shape first. If it differs, map
   the parked stop onto what landed without widening scope.
2. The round mask applies only while a routed marker names the active region child. Flat, N=1 and
   unrouted child regions must read verdicts exactly as before.
3. The parked stop never overwrites a live `.pipeline/HALT`, matching the existing stop path. An
   authorized HALT never reaches it: the daemon's resume-authorization sweep clears that HALT before
   dispatch, and the authorized-crossing replacement belongs to the stack preflight stop alone.
