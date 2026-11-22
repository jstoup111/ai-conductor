# Architecture Review: BUILD settles without a dispatch when no work is owed (#3659)

**Date:** 2026-11-15
**Inputs reviewed:** explore output and track marker for jstoup111/ai-conductor#3659 (technical
track, Tier M, lightweight review); the approved architecture diagram
`.docs/architecture/zero-work-build-re-raises-a-cleared-halt-from-even.md`.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | Engine TypeScript only. No new dependency, service or infrastructure. |
| Prerequisites | jstoup111/ai-conductor#3658 (spec PR #3691) amends the same stall-remediation ADR and moves remediation inputs into the child region. This spec is sequenced behind it. |
| Integration surface | Three engine seams: the step loop before a BUILD attempt opens, the build-stall remediation outcome handling, and the engine-owned remediation plan schema. Plus the `/remediate` skill contract and the remediation-planner persona. |
| Data implications | No persisted format changes. The BUILD verdict gains an additive typed outcome. The remediation plan schema gains one verdict for the build-stall sources. |
| Performance risk | One completion check per non-explicit BUILD dispatch. The same authority already runs at the dispatch boundary for a persisted `done`. |
| Worktree isolation | No shared resource. All state is per worktree and per child region. |

Verified from source:

- A restack never invalidates `build` on content. `GATE_SURFACE` has no `build` key, so `build`
  joins a revalidate entry only when its verdict is unsatisfied or the reduced completion check
  fails. A full completion check can pass on the same tree, so settling loses no required work.
- The audit-round no-op exit (`settleDerivedNoOpHost`) refuses any non-audit record. A revalidate
  round therefore settles BUILD in the step loop and continues to its remaining gates.
- `acceptance_specs` already settles before dispatch for `no-owned-criteria`: it writes the
  verdict, marks the step done, and emits `gate_verdict` and an unmetered `step_completed`.
- A planner `halt` outcome carries no halt class for the stall path, so `writeStallHalt` falls
  back to `needs-human`. A third, halt-free outcome removes the need to reclassify that HALT.
- `halt_clear_authorized` carries neither the cleared reason nor the child. `loop_halt` carries
  `step`, `reason`, and `child` for region steps, so earlier halt reasons are read from `loop_halt`.

## Alignment

- **adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch.** D4 (one completion authority)
  is reused: the no-work-owed check calls `checkStepCompletion` and adds obligations to it. D3
  (the re-check never writes) governs a persisted `done`; the new settle applies to a BUILD that
  is not yet `done`, so D3 is not contradicted. D5 (unreadable means dispatch) is preserved.
- **adr-2026-07-13-kickback-build-no-op-escalation.** D1 is unchanged. A pending repair
  authorization counts as work present, so the new settle never runs where D1's guard runs. The
  taskless-obligation and operator-round amendments to D1 are preserved as conditions of the check.
- **adr-2026-07-10-daemon-stall-remediation.** D3, D4 and D7 are amended for the `no-work-owed`
  verdict. D1, D2, D5 and D6 are unchanged; the disagreement resume is charged to D6's budget.
- **adr-2026-10-12-routed-whole-feature-repair.** Decision 14 already lists the gates a revalidate
  round re-runs and does not include BUILD. Settling BUILD and continuing matches it. Decision 7's
  audit-round settle is unchanged. No amendment.
- **adr-2026-08-05-build-settle-outcome-stamp.** D3's no-op-cycle refusal is unchanged: a gate
  kickback pending against BUILD counts as work owed, so that refusal still decides a failed gate
  that returns to a complete BUILD. D4 stamps every terminal outcome of a BUILD
  attempt. The new settle opens no attempt, so no stamp is written. No amendment.
- **adr-2026-07-28-total-halt-classification-legacy-boundary.** No new HALT writer is added.
- **Event spine.** The settle rides the existing `gate_verdict` and `step_completed` events with
  an additive typed outcome. The earlier halt reasons are read from the existing ledger. No new
  channel, file or ledger.
- **Design principle.** Machinery decides whether work is owed. The one judgement, whether a
  stall question is moot, stays with the remediation and is constrained by schema and confirmed
  by the engine.
- **Operator command.** The operator declined a new settle command on 2026-11-15. Existing
  commands cover the path: halt clear, then the next dispatch settles.

## Wiring Surface

| New production surface | Called from |
|---|---|
| The no-work-owed check (engine function) | The step loop in `conductor.ts` before a BUILD attempt opens, beside the existing `acceptance_specs` `no-owned-criteria` settle; and the build-stall outcome handling in the same file when the planner returns `no-work-owed`. |
| BUILD verdict outcome `no-work-owed` | Written by the existing verdict writer at both call sites; read by the existing `gate_verdict` consumers. |
| Planner outcome `no-work-owed` | Returned by `planRemediation` for the build-stall sources and consumed by the build-stall branch of the retry loop. |
| Remediation plan schema verdict | Validated by the engine-owned plan contract (`remediation-plan-contract.ts`) and projected by `remediation-projection.ts`. |
| Earlier-halt-reasons input | Built by the build-stall branch from the persisted event ledger and passed in the stall-question context to `planRemediation`. |
| `/remediate` skill and remediation-planner persona text | Loaded by the existing remediate dispatch. |

Early overlap scan (advisory): eight unmerged spec branches also touch `conductor.ts`; none
touches the remediation plan contract, the projection, the remediate skill or the planner persona.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| The check settles a BUILD that still has work | Technical | Low | High | Unreadable state counts as work present; the check reuses the existing completion authority; `test_suite` and `build_review` still run after the settle. |
| The remediation returns `no-work-owed` to escape a real question | Technical | Low | Medium | The engine confirms the verdict; a contradicted verdict resumes BUILD with the pending work named, under the existing round budget. |
| Textual conflict with #3691 in the stall-remediation ADR | Integration | Medium | Low | Sequenced behind #3658; reconcile the amendment notes when it lands. |
| An earlier halt reason is labelled cleared while still in force | Technical | Low | Medium | Assumption A4 of the ADR; a BUILD is not dispatched while a HALT is present. |

## ADRs Created

- `adr-2026-11-15-build-settles-without-dispatch-when-no-work-is-owed` (new).
- `adr-2026-07-10-daemon-stall-remediation` D3, D4 and D7 amended.

## Conditions

1. The spec is blocked by jstoup111/ai-conductor#3658, and its amendment notes are reconciled
   against that spec's amendments to the same ADR when it lands.
2. The plan confirms assumption A5 of the new ADR (one step-loop call site reaches stacked
   children and routed revalidate hosts) or adds the routed-entry call site.
