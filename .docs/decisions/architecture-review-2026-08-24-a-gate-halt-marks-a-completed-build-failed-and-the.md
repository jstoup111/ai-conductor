# Architecture Review: A gate halt marks a completed build failed, and the residue blocks every later resume (respec)
**Date:** 2026-08-24
**Source:** jstoup111/ai-conductor#1753 — respec against post-#1824 main
**Tier:** M (lightweight review: §2 Feasibility, §4 Alignment)
**Track:** technical
**Stories reviewed:** none yet — inputs are `.docs/track/a-gate-halt-marks-a-completed-build-failed-and-the.md` (approach A, comprehensive scope), `.docs/architecture/a-gate-halt-marks-a-completed-build-failed-and-the.md`, and `adr-2026-08-24-refused-step-status.md`
**Supersedes:** `architecture-review-2026-08-21-a-gate-halt-marks-a-completed-build-failed-and-the.md` (spec discarded after PR #1824 rewrote the dispatch seam)
**Verdict:** APPROVED WITH CONDITIONS

## Scope boundary (binding, from the track marker)

Comprehensive within the residual gaps: a typed `refused` step status plus a `step_refused`
spine event at the three sites that still stamp `failed` on post-#1824 main — the
protected-artifact seal retries-exhausted path, the step-written needs-human halt sites, and the
validation-group halt commit — and a prerequisite-naming needs-human HALT on gate-blocked loop
exits. Excluded: paths already delivered on main (live-boundary deferral, missing-worktree
preflight, finish-gate `stale` restaging, `clampToRunnablePrerequisite` resume walk), retired
build_review rubric machinery, genuine-failure semantics, seal/live-boundary detection rules,
daemon re-kick policy.

## What changed since the 2026-08-21 review

PR #1824 (issue #1805) retired the `scope`/`completeness`/`rootCause`/`tautology` rubrics,
moved scope-as-intent grading to `prd_audit` and design conformance to the as-built
architecture review, and rewrote the dispatch/validation seams. Independently, main now defers
live-boundary verdicts (`pendingLiveBoundaryHalt`), preflights missing worktrees without a
`failed` stamp, and always walks resume entry back to a runnable step. Of #1753's outcomes: O4
is fully delivered, O2 is delivered except for needless re-runs caused by residual `failed`
stamps, O1 is delivered for two of five refusal-shaped paths, O3's prerequisite names reach the
`gate_blocked` event but never the operator-visible HALT.

## Feasibility

Evidence verified by direct read of `src/conductor/src/engine/` on post-#1824 main, 2026-08-24.

| Check | Finding |
|---|---|
| Residual stamp sites | **Verified.** (1) Seal violation → synthetic `success: false` → retries-exhausted `saveConductorStepStatus(state, step.name, 'failed')` (conductor.ts ~:8499). (2) Step-written needs-human halts stamp `failed` before `emitLoopHalt` (~:7587, ~:8365). (3) Validation-group halts (incl. as-built plan-gap) commit `{[step.name]: 'failed'}` (~:6028, also ~:5899, ~:6384). Line seeds are rediscovery hints, not anchors. |
| Completed steps | **Verified.** The seal check runs pre-dispatch of the *entering* step, so a completed `build` keeps `done` on current main; the stamp lands on the step about to run, forcing a needless re-run after the halt clears. |
| Gate-blocked exit | **Verified.** `checkGate` (gates.ts:15-33) names unsatisfied prerequisites in the `gate_blocked` event; the loop returns markerless and the daemon-only finally backstop writes the generic "loop exited without a terminal verdict" needs-human HALT (~:9823-9848) that names neither prerequisite nor status. Residual-path-only: the common path dispatches the prerequisite (adr-2026-08-03-build-repair D4). |
| Typed facet precedent | **Verified.** `StepRunResult` already routes by typed facets (`worktreeMissing`, `permissionDenied`, `unretryableInputs` — adr-2026-08-19). `refused` follows the same shape. |
| Status union widening | **Verified impact set.** `StepStatus` (`types/steps.ts:35`) is consumed by `stepSatisfied` (`engine/state.ts:203-206`), the resume clamp, renderers, and daemon status; TypeScript exhaustiveness surfaces every consumer. Decision recorded in `adr-2026-08-24-refused-step-status.md` (DRAFT pending approval). |
| Stack / data / integration | No new dependencies, schema, or external surface. Touches `conductor.ts`, `gates.ts`, `types/steps.ts`, `types/events.ts`, `engine/state.ts`, `event-sinks.ts`, renderers. |
| Worktree isolation | Unaffected; all state is per-worktree `.pipeline/`. |

## Alignment

Repo-wide ADR sweep re-run 2026-08-24 (full pass over all `adr-*.md`, no keyword filter). No
APPROVED ADR is violated by the design as conditioned below; the one uncovered structural
decision (widening the persisted `StepStatus` union) is made explicit in
`adr-2026-08-24-refused-step-status.md`.

- **Typed-facet routing:** adr-2026-08-19-unretryable-step-runner-failures-route-by-kind and
  adr-2026-08-18-mechanical-rubric-faults — refusal is a typed result kind; no reason-text
  matching. The three sites become adopters.
- **One classifier:** adr-2026-07-13-retry-classify-rerun-vs-route — the refusal lane extends
  the existing classification seam; no parallel routing mechanism.
- **Mutation port:** adr-2026-08-01-conduct-state-mutation-port — the `refused` write rides
  `ConductStateStore`; no direct writer.
- **Resume stays read-only:** adr-2026-07-11-verdict-aware-resume-entry and
  adr-2026-08-19-tree-attesting-gates D3/D7 — `refused` is simply not satisfied under the one
  existing predicate; the backward-only clamp re-admits it; resume never mutates.
- **Halt vocabulary closed:** adr-2026-07-28-total-halt-classification — no new `HaltClass`;
  the gate-blocked residual HALT is `needs-human`; seal keeps `protected-artifact`.
- **Halt seam intact:** adr-2026-08-23-committed-halt-record and
  adr-2026-08-11-halt-events-ride-the-persisted-spine — all halts continue through
  `writeHaltMarker`; the committed halt record and persisted `loop_halt` are inherited, not
  reimplemented.
- **Event spine:** adr-2026-07-26-event-sink-registry-exhaustiveness — `step_refused` is a new
  `ConductorEvent` member with a complete sink-registry row (render/persist/audit) at
  introduction. No sidecar, no ad-hoc log.
- **Operator lever:** adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever — refused
  outcomes still write a clearable marker naming the stage and clearing action; recovery uses
  the existing rewind verb (adr-2026-08-19-operator-step-rewind-through-the-mutation-port).
- **Status preservation precedent:** adr-2026-07-29-operator-park-scheduling-unit-boundary
  #5/#8 — a typed non-failure termination never rewrites completed work's status; `refused` is
  recorded only on the terminating step, never on completed steps.
- **Plan-gap semantics:** adr-2026-08-22-as-built-review-runs-always-with-plan-gap — a
  plan-gap halt is a verdict awaiting a human, not a failure of the step's work; recording it
  `refused` aligns the status with that ADR's semantics.
- **Focused local pattern basis (refusal exits).** Role: a termination that halts without
  recording the step's work as failed. Traits to preserve: typed facet on the result; halt via
  `writeHaltMarker` with a closed class; reason names its evidence; status write through the
  port. Applies because the three in-scope sites lack these traits while
  `worktreeMissing`/`pendingLiveBoundaryHalt` exemplify them. Allowed variation: one facet with
  a discriminated `kind` vs. per-site facets. Rediscovery seeds: `worktreeMissing`,
  `pendingLiveBoundaryHalt`, `consumePendingLiveBoundaryHalt`, `unretryableInputs` in
  `conductor.ts`. No departure authorised.

Diagram accuracy: `.docs/architecture/a-gate-halt-marks-a-completed-build-failed-and-the.md`
(updated 2026-08-24) matches this design.

## Wiring Surface

| New/changed surface | Called from in production |
|---|---|
| `refused` member of `StepStatus` | Written via `ConductStateStore` at the three refusal sites in `conductor.ts`'s dispatch/halt paths; read by `stepSatisfied` (`engine/state.ts`), the resume clamp, `report-renderer.ts`, and daemon status rendering. |
| `step_refused` `ConductorEvent` member | Emitted by the loop at each refusal site; declared in the exhaustive sink registry (`event-sinks.ts`) so `EventPersister` lands it in `.pipeline/events.jsonl` alongside render/audit sinks. |
| `StepRunResult.refused` typed facet (or discriminated kind) | Produced at the seal verdict site, the step-written needs-human halt sites, and the validation-group halt commit; consumed by the loop's result handling before the retry/failed stamp. |
| Prerequisite-naming residual HALT | The finally-backstop HALT writer in `Conductor.run`, fed by the last `gate_blocked` event's prerequisite names and each named step's recorded status. |

Overlap scan (`conduct-ts overlap-scan` over the files above) run 2026-08-24: only stale
`spec/*` branches overlap `conductor.ts`; no in-flight dependent work. Advisory, non-blocking.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A genuine work failure gets misclassified as refused | Data | Low | High | Facet is set only at the three named sites, never derived from provider output; negative-path story asserts `failed` still stamps and blocks dependents. |
| Widening `StepStatus` breaks a non-exhaustive consumer (renderer, daemon status, retro) | Technical | Medium | Medium | Compile-time exhaustiveness where present; stories cover renderer/daemon-status display of `refused`; sweep consumers during plan. |
| Converting the validation-group stamp changes kickback/lap accounting | Technical | Low | High | Verdict-FAIL kickback routing is event-driven, not status-driven, and is explicitly out of scope; story pins that a build_review FAIL still routes to build unchanged. |
| Older engine reads a `refused` state file | Integration | Low | Low | Unknown status is not satisfied — fail-closed re-run; no migration needed. |

## ADRs Created

- `adr-2026-08-24-refused-step-status.md` — **DRAFT**, must be APPROVED before stories proceed.

## Conditions

1. Refusal is a typed facet/result kind; no routing on output or reason text
   (adr-2026-08-19-unretryable, adr-2026-08-18).
2. The `refused` write rides the `ConductStateStore` mutation port; no other status mutation on
   the refusal path; completed steps' statuses are never touched (adr-2026-08-01,
   adr-2026-07-29 #5/#8).
3. `stepSatisfied` and `checkGate` keep their single predicate; resume stays read-only and
   backward-only; `--from-step` exempt (adr-2026-07-11, adr-2026-08-19-tree-attesting).
4. The prerequisite-naming HALT applies only on the residual markerless `gate_blocked` exit;
   the common path keeps dispatching the runnable prerequisite (adr-2026-08-03 D4); the HALT
   uses class `needs-human` and flows through `writeHaltMarker` (adr-2026-07-28,
   adr-2026-08-23).
5. `step_refused` declares all sinks in the exhaustive registry at introduction
   (adr-2026-07-26); no new channel of any other shape.
6. Stories include negative paths proving (a) a genuinely failed step still records `failed`,
   emits `step_failed`, and blocks dependents; (b) a build_review verdict-FAIL kickback is
   unchanged.
7. `adr-2026-08-24-refused-step-status.md` reaches `Status: APPROVED` before
   `/stories`; the spec does not land with it in DRAFT.
