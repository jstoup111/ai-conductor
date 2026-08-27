# ADR: Remove retrospectives (full and micro) in one shot

Status: APPROVED
Date: 2026-08-26
Feature: remove-retrospectives-full-and-micro-from-feature- (jstoup111/ai-conductor#1905)

## Context

Operator decision 2026-08-25: retrospective behavior is rejected, inclusive of micro-retros.
Retro currently exists as (1) a first-class SHIP step (`retro` in `StepName`, advisory,
`rebase` prerequisite), (2) a daemon-completion provider-backed narrative call
(engineer-store `produceNarrative`, per adr-002-engineer-store-and-retro-redirect), and
(3) a `micro-retro` batch-boundary closeout obligation. The operator confirmed full purge.

`adr-2026-08-11-deprecated-no-op-step-retirement` (APPROVED) prescribes two-phase step
retirement: strip machinery, keep the name as a deprecated no-op, delete the name later. Its
evidence: in-flight `conduct-state.json` and step-keyed consumer `settings.json` entries hit
`Unknown step: <name>` on hard deletion.

## Options Considered

### Option A: two-phase retirement (comply with adr-2026-08-11)
- Pros: no `Unknown step` risk for in-flight state or consumer config.
- Cons: leaves a dead name occupying dispatch/config surface (the `wiring_check` residue is
  already tracked as its own defect, #1896); requires a second change to finish the purge.

### Option B: one-shot deletion with an explicit operator waiver
- Pros: complete purge in one change; no #1896-style residue; compiler enumerates every
  touchpoint via the `StepName` union.
- Cons: a live worktree whose `conduct-state.json` records `retro`, or a consumer
  `settings.json` keying `steps.retro.*`, breaks at engine update until state/config is
  cleaned.

## Decision

**Adopt Option B.** On 2026-08-26 the operator explicitly waived
`adr-2026-08-11-deprecated-no-op-step-retirement` for this change, accepting it as a
breaking change. The waiver is scoped to the retro removal only; the two-phase contract
remains in force for future step retirements.

1. `retro` is deleted from the `StepName` union, the step registry, and every exhaustive
   record keyed on it. `rebase.prerequisites` is re-pointed to
   `['architecture_review_as_built']`, preserving the #922 serial-publication fence
   (amends adr-2026-07-26-rebase-tail-current-branch-before-publication).
2. The daemon-completion retro narrative provider call is deleted: no provider call on
   `done`. Halt narratives (`renderHaltNarrative`) and the engineer-store format survive;
   `narrativeRef` (already optional) is absent for all non-halted outcomes (supersedes
   adr-002's narrative-production mechanism in part; the store-format half stands).
3. `micro-retro` is removed from the `pipeline_closeout.obligation` event union and the
   `CLOSEOUT_OBLIGATIONS` CLI allowlist in the same change, and the batch gate's enforced
   obligation roster shrinks with it (amends adr-2026-08-08-pipeline-owned-closeout-timestamps).
4. `skills/retro/` is deleted with all cross-skill/doc/template references, its
   `STEP_SKILL_INVOCATIONS` entry (per adr-2026-08-04-unresolved-step-command-fails-by-name),
   its model-table metadata (HARNESS.md regenerated), and the legacy `bin/conduct` retro step.
5. Historical `.docs/retros/` reports and retro-era spec artifacts remain as records.
   Recovery anchor: git tag `retro-last` marks the last pre-removal main commit.

## Consequences

- Positive: no retro provider spend, no dead step name, SHIP tail is
  `architecture_review_as_built → rebase → finish`, batch boundaries lose one obligation.
- Negative (accepted by waiver): engine update under a live worktree that references `retro`
  in `conduct-state.json`, or a consumer config with `steps.retro.*`, fails by name until
  cleaned. Mitigation: land between dispatches; the operator parks or finishes in-flight
  features at cutover; release is declared `Release-Semver: major`-class breaking via the
  PR's release metadata.
- `retro` was the only `enforcement: 'advisory'` built-in; the advisory branch remains
  reachable only via config-declared custom steps (behavior retained, untested by built-ins).
- Issue #717 is obsoleted (no retro to make reliable); #939's retro-specific root cause
  disappears and the issue is re-scoped or closed.

## Evidence

- Engine touchpoint map: exploration of `src/conductor/src/` on this branch (steps.ts:252-272,
  engineer-store.ts:292-348, daemon-runner.ts:743-785, conductor.ts:5898-5911,
  closeout-cli.ts:7, events.ts:597, complete-verifier.ts:8, step-runners.ts:874,
  phase-marker.ts:64, skill-invocation.ts:41, provider-model-policy.ts, resolved-config.ts,
  model-table-metadata.ts:57, artifacts.ts:306-312/3533-3572).
- Dangling-prerequisite failure mode verified: `stepSatisfied` returns permanently-pending for
  an unknown prerequisite name, producing a silent no-ship (gates.ts:11-33, state.ts:203-206,
  conductor.ts:7555-7580) — hence the rewire in the same change as the deletion.
