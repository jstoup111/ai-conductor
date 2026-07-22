# Architecture Review: Demote task-stamping from gate to telemetry (#773)
**Date:** 2026-07-21
**Stories reviewed:** (pre-stories; technical track — input is the explore output + operator-approved intent)
**Verdict:** APPROVED

> **Revised 2026-07-21 (post-delivery).** The operator identified that `build_review`
> (adr-2026-07-07, #324 — merged/shipped) ALREADY is the judgement gate at the build → manual_test
> seam with the exact machinery this review's "new step" originally proposed. The design is revised to
> FOLD a default-on completeness rubric item into `build_review` instead of adding a parallel step.
> The superseding ADR is `adr-2026-07-21-completeness-as-build-review-rubric`; the original
> `adr-2026-07-21-build-end-plan-completeness-gate` is SUPERSEDED. Feasibility/Wiring/ADR sections
> below are updated to match; the verdict (APPROVED) stands.

## Feasibility
- **Reuse the existing gate — even lower friction.** `build_review` already dispatches an
  input-starved grader fed `{ diff, planBody }` → `.pipeline/build-review.json` → fail-closed
  predicate → `buildReviewSelfHeals` kickback. #773 adds a 4th rubric item (completeness) and makes
  the completeness dimension default-on. No new StepName/predicate/grader module.
- **Grader already has the inputs.** The completeness judgement needs (plan, diff) — exactly what the
  build_review grader already receives. Verified from `build-review-prompt.ts`.
- **Kickback reused.** A completeness FAIL reuses `buildReviewSelfHeals` (seed build hint,
  `navigateBack('build')`), bounded by `MAX_KICKBACKS_PER_GATE=2` → HALT at cap.
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
- **State-machine change** is additive (a rubric item on the existing build_review gate + a default-on
  flip) rather than a rewrite of `build`, keeping the structural-build vs judgement-gate separation clean.
- No domain-type or security-boundary changes (internal engine machinery).

## Domain Integrity
- The new gate reasons holistically (plan-vs-diff), explicitly NOT per-task SHA/reachability/
  corroboration — the guardrail that prevents the wedge classes from re-emerging. Verdict is a
  closed enum (PASS|FAIL), no boolean-flag ambiguity.

## Wiring Surface (design-time)
- **Completeness rubric item** → added to `build-review-prompt.ts` `buildGraderPrompt`; already
  dispatched by the existing build_review grader path in the conductor build loop.
- **`rubric.completeness` verdict field** → added to the build_review verdict schema +
  `validateBuildReviewVerdict` in `artifacts.ts`; read by the existing `build_review` predicate.
- **Default-on activation** → `config.ts`/`resolved-config.ts` build_review resolution + `steps.ts`
  activation so the completeness dimension runs without a per-project opt-in.
- **Completeness FAIL** → consumed by the existing `buildReviewSelfHeals` block (conductor.ts):
  seed build hint, `navigateBack('build')`.
- **No new StepName / predicate / grader module.**

## Risks
| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| New gate false-NEGATIVE loops (wedge) | Technical | Low | High | Bounded by MAX_KICKBACKS_PER_GATE=2 → HALT for human, cannot spin |
| New gate false-POSITIVE (misses a gap) | Technical | Medium | Medium | Downstream outcome gates (acceptance GREEN/build_review/wiring/manual_test/as_built) independently catch missing behavior |
| Completion HOLE during migration (stamp gate removed before completeness enforcing) | Technical | Medium | High | Sequence: build_review completeness default-on + proven enforcing BEFORE deleting the `build` stamp predicate (plan Task 9 → 10) |
| build_review default-on reverses adr-2026-07-07 opt-in (projects that opted out get completeness) | Technical | Medium | Medium | Keep diff-honesty items tunable; only the completeness dimension is unconditional |
| Deleting whole autoheal.ts drops `parsePlanTaskPaths`/`TASK_ID_PATTERN` used by wiring | Technical | Medium | High | Preserve/relocate those utilities before deletion (verified import sites) |
| LLM unavailability silently passes the gate | Technical | Low | High | Fail-closed: no PASS verdict ⇒ not-done ⇒ existing RateLimitEpisode park/HALT |

## ADRs Created (APPROVED)
- `adr-2026-07-21-demote-task-stamping-to-telemetry` — the demotion decision (what is deleted, what
  survives as telemetry, utility-preservation constraint, attribution-enforcement → advisory).
- `adr-2026-07-21-completeness-as-build-review-rubric` — the replacement completion authority: a
  default-on completeness rubric item folded into the existing `build_review` gate (reuses grader/
  verdict/fail-closed predicate/`buildReviewSelfHeals` kickback; wedge-proof; fail-closed on
  unavailability). **Supersedes** `adr-2026-07-21-build-end-plan-completeness-gate` (the original
  new-step proposal, now SUPERSEDED).

## Conditions
- None blocking. Two sequencing conditions carried into the plan: (1) land the new completeness gate
  before removing the `build` stamp predicate; (2) preserve/relocate the shared plan-parsing
  utilities before deleting evidence code.
