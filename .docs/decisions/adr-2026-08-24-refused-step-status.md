# ADR: A typed `refused` step status distinct from `failed`

Status: APPROVED (operator, 2026-08-24)
**Date:** 2026-08-24
**Source:** jstoup111/ai-conductor#1753 (respec after PR #1824)

## Context

A step can terminate without its own work failing: the protected-artifact seal refuses the
dispatch before any work runs; a step's skill concludes a human is required; a validation-group
verdict halts for operator judgement. On current main all three of these stamp the step
`failed` in `conduct-state.json` (`conductor.ts` — the retries-exhausted path after
`verifyProtectedArtifactSeal`, the two step-written needs-human halt sites, and the
validation-group halt commit), which is indistinguishable from the step's work genuinely
failing. The residue misleads operators and telemetry: `step_failed` fires for work that never
ran or that ended in a judgement, and the honest cause lives only in the HALT text.

Two of the five refusal-shaped paths were already fixed without a status (live-boundary
deferral, missing-worktree preflight: halt with no stamp), and the finish gates restage as
`stale`. Three sites remain, each hand-rolled differently. The prior #1753 spec (discarded
after #1824 rewrote the dispatch seam) expressed "preserve status" as no mutation at all; the
operator has now chosen a recorded, typed outcome instead.

## Decision

1. **`StepStatus` gains a `refused` member** (`src/conductor/src/types/steps.ts`), written only
   through the `ConductStateStore` mutation port (adr-2026-08-01). `refused` means: this step's
   own work did not fail — an entry condition, environmental guard, or human-judgement boundary
   ended the attempt.
2. **`refused` does not satisfy prerequisites.** `stepSatisfied` continues to count only
   `done | skipped | stale`; no second satisfaction predicate is added (adr-2026-07-11,
   adr-2026-08-19-tree-attesting-gates). After the halt is cleared, the existing read-only
   resume clamp re-admits the refused step; no state hand-edit and no resume-time mutation.
3. **A `step_refused` event joins the `ConductorEvent` union**, carrying the step name, a
   refusal kind (`seal | needs-human | validation-verdict`), and the reason. It is declared in
   the compile-time-exhaustive sink registry (render + persist + audit) at introduction
   (adr-2026-07-26); no sidecar channel.
4. **The three remaining stamp sites adopt it**: the seal retries-exhausted path, the
   step-written needs-human halt sites, and the validation-group halt commit record `refused`
   instead of `failed`. Their HALT writing is unchanged: same `writeHaltMarker` seam, existing
   closed `HaltClass` vocabulary only (adr-2026-07-28), committed halt record inherited
   (adr-2026-08-23), operator lever preserved (adr-2026-08-05).
5. **Genuine failure semantics are untouched.** Provider/work failure still stamps `failed`,
   emits `step_failed`, and blocks dependents. Routing stays on typed result kinds, never
   reason text (adr-2026-08-19-unretryable, adr-2026-08-18). Verdict-FAIL kickback routing
   (build_review FAIL → build) is not a halt and is out of scope.

## Consequences

- Consumers that render or aggregate step statuses (daemon status, report renderer, retro,
  resume clamp) must handle the new member; TypeScript exhaustiveness surfaces every site.
- The status file now distinguishes "work failed" from "attempt refused" mechanically, so
  #1753's class of misdiagnosis (completed work read as failed) cannot recur at these sites.
- Pre-change state files never contain `refused`; readers need no migration. A `refused` value
  read by an older engine would fail closed (unknown status ≠ satisfied), which is acceptable.

## Alternatives rejected

- **No mutation at all** (prior spec's shape): behaviorally equivalent at the refused step but
  invisible on the spine and in `conduct-state.json`; leaves `in_progress`/`pending` residue
  that cannot be told apart from a crash.
- **Restage as `stale`:** overloads "inputs changed" semantics with "entry refused".

## Amends

`architecture-review-2026-08-21-a-gate-halt-marks-a-completed-build-failed-and-the.md`
conditions 2 and 5 (no status mutation; prefer extending `retry_decision.signal`): superseded
by this decision for the respec — the mutation rides the port, and the new event member
declares all sinks as adr-2026-07-26 permits.
