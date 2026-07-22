# Architecture Review: Demote task-stamping from gate to telemetry (#773)
**Date:** 2026-07-21
**Stories reviewed:** (pre-stories; technical track — input is the explore output + operator-approved intent)
**Verdict:** APPROVED

## Feasibility
- **Gate placement — feasible, low friction.** Insert a new `gating` `loopGate` step after `build`,
  mirroring `build_review`/`wiring_check` (both added recently the same way via `buildStepRegistry`
  insert-by-`after`, steps.ts 444-540). Predicate contract `(dir, ctx)=>CompletionResult`
  (artifacts.ts 879-881) already exposes `projectRoot`, `planPath`, `getHeadSha` — sufficient to
  read the plan task set + built HEAD; diff computed via git or an injected callback.
- **Semantic-gate pattern reused.** Grader writes `.pipeline/*` verdict → deterministic fail-closed
  predicate reads it (exactly `build_review`/`prd_audit`). No inline LLM in the predicate.
- **Remediation reused.** Named gaps use the existing `RemediationGap` (disposition `build`); no new
  routing. Kickback bounded by `MAX_KICKBACKS_PER_GATE=2`.
- **Deletion is safe.** All five separate same-named gates verified INDEPENDENT of the deleted
  evidence graph. Only utility symbols (`parsePlanTaskPaths`, `TASK_ID_PATTERN`) live in autoheal.ts
  and must be preserved/relocated.

## Complexity
- Tier **L** (recorded in .docs/complexity). Blast radius across the build-completion authority +
  a net-new gate + large test rewrite. Full architecture treatment applied.

## Alignment
- **Matches the repo Design Principle** ("removal, not another guard" for a failing machinery class;
  "deterministic where possible, LLM only where necessary" — the LLM is the grader, the engine
  predicate is a deterministic fail-closed reader).
- **State-machine change** is additive (new step) rather than a rewrite of `build`, keeping the
  structural-build vs judgement-gate separation clean.
- No domain-type or security-boundary changes (internal engine machinery).

## Domain Integrity
- The new gate reasons holistically (plan-vs-diff), explicitly NOT per-task SHA/reachability/
  corroboration — the guardrail that prevents the wedge classes from re-emerging. Verdict is a
  closed enum (PASS|FAIL), no boolean-flag ambiguity.

## Wiring Surface (design-time)
- **New step `build_completeness`** → wired into `ALL_STEPS`/`buildStepRegistry` in `steps.ts`,
  dispatched by the conductor build loop's step runner (same path as `build_review`).
- **New completion predicate** → registered in `CUSTOM_COMPLETION_PREDICATES` (artifacts.ts),
  invoked by `checkStepCompletion`.
- **New grader inputs/prompt module** (or a skill) → dispatched by the engine like the `build_review`
  grader (`build-review-inputs.ts`/`-prompt.ts` precedent); writes `.pipeline/build-completeness.json`.
- **FAIL verdict gaps** → consumed by the existing `planRemediation`/`appendRemediationTasks` path
  (conductor.ts), disposition `build`.
- **New `StepName` union member** → `types/index.ts`.

## Risks
| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| New gate false-NEGATIVE loops (wedge) | Technical | Low | High | Bounded by MAX_KICKBACKS_PER_GATE=2 → HALT for human, cannot spin |
| New gate false-POSITIVE (misses a gap) | Technical | Medium | Medium | Downstream outcome gates (acceptance GREEN/build_review/wiring/manual_test/as_built) independently catch missing behavior |
| Completion HOLE during migration (stamp gate removed before new gate lands) | Technical | Medium | High | Sequence: land new gate BEFORE deleting the `build` stamp predicate (ADR follow-up) |
| Deleting whole autoheal.ts drops `parsePlanTaskPaths`/`TASK_ID_PATTERN` used by wiring | Technical | Medium | High | Preserve/relocate those utilities before deletion (verified import sites) |
| LLM unavailability silently passes the gate | Technical | Low | High | Fail-closed: no PASS verdict ⇒ not-done ⇒ existing RateLimitEpisode park/HALT |

## ADRs Created (APPROVED)
- `adr-2026-07-21-demote-task-stamping-to-telemetry` — the demotion decision (what is deleted, what
  survives as telemetry, utility-preservation constraint, attribution-enforcement → advisory).
- `adr-2026-07-21-build-end-plan-completeness-gate` — the replacement completion authority (new
  gating step, grader-writes-verdict + fail-closed predicate, remediation routing, wedge-proof
  bounding, fail-closed on unavailability).

## Conditions
- None blocking. Two sequencing conditions carried into the plan: (1) land the new completeness gate
  before removing the `build` stamp predicate; (2) preserve/relocate the shared plan-parsing
  utilities before deleting evidence code.
