# Architecture Review: A gate halt marks a completed build failed, and the residue blocks every later resume
**Date:** 2026-08-21
**Source:** jstoup111/ai-conductor#1753
**Tier:** M (lightweight review: §2 Feasibility, §4 Alignment)
**Track:** technical
**Stories reviewed:** none yet — input is `.docs/track/a-gate-halt-marks-a-completed-build-failed-and-the.md` (approach A, comprehensive scope) and `.docs/architecture/a-gate-halt-marks-a-completed-build-failed-and-the.md`
**Verdict:** APPROVED WITH CONDITIONS

## Scope boundary (binding, from the track marker)

Comprehensive: every pre-dispatch refusal (protected-artifact seal, missing-worktree preflight, self-host live boundary) gets one typed refused outcome that never stamps the step `failed`; resume entry always lands on a step `checkGate` admits; a prerequisite-gate halt names the unsatisfied prerequisite and the blocking step's status. Genuine step failures keep `failed`. Excluded: seal/live-boundary detection rules, task-status counter desync, daemon re-kick policy.

## Feasibility

Evidence is from the current `src/conductor/src/engine/` source (verified by direct read, 2026-08-21).

| Check | Finding |
|---|---|
| Root cause | **Verified.** The seal verdict at the BUILD/SHIP dispatch boundary is packaged as `result = { success: false, output: reason }` and falls through the per-attempt retry loop into the retries-exhausted path, which calls `saveConductorStepStatus(state, step.name, 'failed')`. The step's own work never ran. Search seeds: `verifyProtectedArtifactSeal(`, `protectedArtifactIssue`, `Exhausted retries — route through the recovery menu` in `conductor.ts`. |
| Existing precedents for a refusal that does not stamp failed | **Verified.** Two of the three refusal sites already avoid the stamp, each by a hand-rolled early return: (1) `missingWorktreeResult()` returns `{ success: false, worktreeMissing: true }` and the loop returns through `emitLoopHalt` before any status write; (2) the live-boundary verdict is deferred to `pendingLiveBoundaryHalt` and consumed at the next dispatch boundary, explicitly so "the completed step keeps its own verdict". Only the seal site lacks this treatment. |
| Typed facet precedent | **Verified.** `StepRunResult` already carries typed, non-message facets that route by kind: `worktreeMissing`, `permissionDenied`, `unretryableInputs` (adr-2026-08-19). A `refused` facet follows the same shape; no message matching. |
| Resume gap | **Inferred (~60%).** `clampToRunnablePrerequisite` runs only inside the verdict-clamp branch (`resumeClamp.earliestGateIdx < startIndex`). With `build = failed` and no clamp, the candidate from `findResumeIndex` can land downstream and hit the markerless `gate_blocked` return — the livelock #1052 fixed for the clamped case. Must be pinned by a failing test before the fix; if the test passes on current HEAD, the observed jump had another cause and that cause goes to intake. |
| Halt wording | **Verified.** `checkGate` (`gates.ts`) returns `Prerequisites not satisfied: <names>`; the loop emits it as `gate_blocked` and returns markerless; the finally-backstop then writes a HALT from `resolveLastStep` + breadcrumb (`lastEventType`), never from `gate.reason`. |
| Stack / data / integration | No new dependencies, schema, or external surface. Touches `conductor.ts` (dispatch loop, resume entry, finally backstop), `gates.ts` (reason shape), `types/events.ts` (if a signal is added), `halt-marker.ts` (no new class — see conditions). |
| Worktree isolation | Unaffected; all state is per-worktree `.pipeline/`. |

## Alignment

Repo-wide sweep over all 505 files in `.docs/decisions/` (delegated, full pass). Governing APPROVED ADRs and how the design sits against them:

- **The refused-vs-failed distinction is already decided; this feature applies it.**
  `adr-2026-08-19-unretryable-step-runner-failures-route-by-kind` D1–D3: a non-retriable runner outcome is a typed facet on the result, classified at the step-runner seam, terminating in a halt that names the cause rather than "retries exhausted". `adr-2026-07-29-operator-park-scheduling-unit-boundary` #5/#8: a typed non-failure termination never rewrites the work's status. `adr-2026-07-13-retry-classify-rerun-vs-route` non-goals: no second routing mechanism. → The three refusal sites become adopters of the existing typed-facet shape; **no new ADR** (structural prerequisite not met — no new boundary, decomposition, integration seam, state architecture, or technology).
- **Status writes go through the mutation port.** `adr-2026-08-01-conduct-state-mutation-port`: no direct writer; no generic status ordering. "Preserve the prior status" is expressed as *no mutation at all* on the refusal path.
- **Resume entry stays a read-only, backward-only clamp.** `adr-2026-07-11-verdict-aware-resume-entry` D1/D4/D5 and `adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch` D3/D7: the clamp may only lower the index, `checkGate` stays state-only, no second satisfaction predicate, resume never mutates state (rejected Option C). `adr-2026-08-03-build-repair-member-reuse-validity` D4 already applies `clampToRunnablePrerequisite` at the selection site "rather than only at resume entry" — generalising it to the unclamped resume path is within that grant.
- **`gate_blocked` halt is the residual, not the common path.** adr-2026-08-03-build-repair D4 decided the loop resolves an unsatisfied prerequisite by dispatching it instead of returning markerless `gate_blocked`. The new halt wording applies only when no runnable prerequisite exists.
- **Halt class vocabulary is closed.** `adr-2026-07-28-total-halt-classification-legacy-boundary`: `needs-human` or `mechanical` only; `adr-2026-08-05-build-settle-outcome-stamp` D6 refused a label-only class. The seal refusal keeps `PROTECTED_ARTIFACT_HALT_CLASS`; the gate-blocked residual is `needs-human`.
- **Event spine.** `adr-2026-07-26-event-sink-registry-exhaustiveness`, `adr-2026-08-11-halt-events-ride-the-persisted-spine`, adr-2026-08-19-unretryable D5: prefer extending `retry_decision.signal` (adding `'refused'`) over a new `ConductorEvent` member; if a member is minted it declares all three sinks. No sidecar, no new ledger.
- **Operator lever.** `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever`: the refusal still writes a marker naming the stage and the clearing action — unchanged from today for the seal.
- **Focused local pattern basis (refusal exits).** Role: a pre-dispatch refusal that terminates the attempt without recording the step's work as failed. Traits to preserve: typed facet on `StepRunResult`; early return before any `saveConductorStepStatus(..., 'failed')`; halt written via `writeHaltMarker` with a closed class; reason names its evidence. Applies because the seal site is the one of three that lacks these traits. Allowed variation: whether the three sites share one facet name or a discriminated `refused.kind`. Rediscovery seeds: `worktreeMissing`, `pendingLiveBoundaryHalt`, `consumePendingLiveBoundaryHalt`, `unretryableInputs` in `conductor.ts`. No departure from the pattern is authorised.

Diagram accuracy: `.docs/architecture/a-gate-halt-marks-a-completed-build-failed-and-the.md` matches this design (refusal → outcome recorder → HALT with prior status preserved; resume walk unconditional; gate-blocked residual names prerequisite + status).

## Wiring Surface

| New/changed surface | Called from in production |
|---|---|
| `StepRunResult.refused` typed facet (or discriminated kind) | Produced at the BUILD/SHIP seal verdict site, `missingWorktreeResult`, and the live-boundary consumption point in `conductor.ts`'s per-step dispatch; consumed by the same loop's result handling before the retry/failed stamp. |
| Unconditional `clampToRunnablePrerequisite` at resume entry | `Conductor.run` start-index derivation (the `this.resume` branch), reached by every daemon re-dispatch. |
| `gate_blocked` residual halt text (prerequisite + status) | The `checkGate` rejection return in the gate loop and the finally-backstop HALT writer in `Conductor.run`. |
| `retry_decision.signal: 'refused'` (or equivalent) | Emitted by the loop at the refusal site; persisted by `EventPersister` via `EVENT_SINKS`. |

Overlap scan: run `conduct-ts overlap-scan --files src/conductor/src/engine/conductor.ts src/conductor/src/engine/gates.ts src/conductor/src/types/events.ts` before `/plan` (advisory; recorded below).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Resume gap hypothesis is wrong (observed jump to `test_suite` had another cause) | Technical | Medium | Medium | Pin with a failing test on current HEAD before changing resume; if it passes, file intake and keep the resume change out. |
| A genuine build failure gets misclassified as refused | Data | Low | High | Refusal facet is set only at the three pre-dispatch sites, never from provider output; negative-path story asserts `failed` still stamps and blocks dependents. |
| Dispatch-loop edit regresses retry/escalation paths | Technical | Medium | High | Refusal short-circuits before `escalateAttempt`; existing retry tests run; no change to `checkGate` or the satisfaction predicate. |

## ADRs Created

None. Structural prerequisite not met; governing ADRs cited above are reused.

## Conditions

1. Refusal is a typed facet on `StepRunResult`; no routing on `output` text (adr-2026-08-19 D1).
2. The refusal path performs **no** status mutation; all other status writes stay on `ConductStateStore` (adr-2026-08-01).
3. Resume entry change is read-only and backward-only; `checkGate` and `stepSatisfied` unchanged; `--from-step` exempt (adr-2026-07-11).
4. The prerequisite-naming halt applies only on the residual markerless `gate_blocked` path; the common path keeps dispatching the prerequisite (adr-2026-08-03-build-repair D4).
5. No new `HaltClass`; no new event channel — extend `retry_decision.signal` or declare all sinks for a new member (adr-2026-07-28, adr-2026-07-26).
6. Stories include a negative path proving a genuinely failed build still records `failed` and blocks `test_suite`.
