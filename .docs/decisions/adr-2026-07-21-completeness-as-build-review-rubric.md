# ADR: Plan-completeness judgement as a default-on build_review rubric item

**Date:** 2026-07-21
**Status:** APPROVED
**Deciders:** Operator (jstoup111), via /engineer DECIDE for #773
**Supersedes:** adr-2026-07-21-build-end-plan-completeness-gate
**Extends:** adr-2026-07-07-build-review-judgement-gate (#324)

## Context

adr-2026-07-21-build-end-plan-completeness-gate proposed a NEW `build_completeness` gating step
(after `build`, before `build_review`) to serve as the replacement completion authority once the
per-task evidence gate is deleted. That proposal was made without recognizing that
**`build_review` already IS a judgement gate at the build → manual_test seam**
(adr-2026-07-07-build-review-judgement-gate, #324):

- Same seam, same machinery the new-step ADR reinvented: an input-starved grader fed exactly
  `{ diff, planBody }`, writing `.pipeline/build-review.json`, read by a fail-closed
  `CUSTOM_COMPLETION_PREDICATES.build_review` (fresh exact `PASS` only), with kickback via a
  `buildReviewSelfHeals` counter bounded by `MAX_KICKBACKS_PER_GATE`.
- Its rubric, however, judges **diff honesty only** (verified from `build-review-prompt.ts`):
  (1) tautology, (2) scope — *no unrelated files*, (3) root cause. It explicitly does **not** judge
  whether **all planned work was implemented** (under-coverage). "Scope" is the over-coverage half
  ("nothing extra"); completeness is the missing under-coverage half ("nothing missing").
- `build_review` is **opt-in, default-off** (adr-2026-07-07 decision #2: a top-level
  `build_review.enabled` resolver flag; when off the step is `skipped`).

A parallel `build_completeness` step would duplicate this machinery and sit redundantly beside
`build_review` at the same seam. The right design is to **extend the existing gate**.

**Verified (confidence ~95%, read of `build-review-prompt.ts` + adr-2026-07-07):** build_review's
grader already receives the diff and the approved plan — precisely the inputs a completeness
judgement needs. No new inputs are required.

## Options Considered

### Option A: Add a `completeness` rubric item to build_review; make it default-on (CHOSEN)
- **Pros:** reuses 100% of shipped build_review machinery (grader/inputs/prompt/verdict/predicate/
  kickback); DRY; the grader already has (diff + plan); completeness + scope become the two halves
  (under/over-coverage) of one honest-diff judgement.
- **Cons:** changes adr-2026-07-07's deliberate opt-in/default-off stance (must make the completeness
  dimension always active); touches the rubric's "all items or FAIL" contract.

### Option B: Add completeness to build_review but keep it opt-in/default-off
- **Pros:** no change to the default topology.
- **Cons:** with the evidence gate deleted AND build_review off, **nothing** judges completeness —
  reopens the exact hole #773 must close. Rejected by the operator.

### Option C: Keep a separate `build_completeness` step (the superseded ADR)
- **Cons:** redundant machinery adjacent to build_review; two graders reading (diff + plan) at the
  same seam. Rejected.

## Decision

Adopt **Option A**. Fold the plan-completeness judgement into the existing `build_review` gate:

1. **Rubric extension.** Add a 4th rubric item — **Completeness: every planned task's work is
   present in the diff (no planned task silently unimplemented)** — to `build-review-prompt.ts`,
   under the same **all-items-or-FAIL** rule. Extend the verdict schema's `rubric` object with a
   `completeness` field. The grader still reasons **holistically over (diff vs plan)** and is
   explicitly forbidden from per-task SHA/reachability/corroboration reasoning (the guardrail that
   keeps the deleted wedge classes from re-emerging).
2. **Default-on completion authority.** Because build_review now carries the sole completeness
   judgement that replaces the deleted evidence gate, its completeness dimension must be **active by
   default**. Concretely: `build_review` runs by default (the completeness rubric is unconditional),
   so a fresh project gets completeness gating with no opt-in. (The diff-honesty rubric items may
   remain a tunable dial, but the step no longer silently `skipped`-defaults out of existence — the
   completeness item always runs.) This supersedes adr-2026-07-07 decision #2's default-off stance
   for the completeness dimension.
3. **Everything else reused unchanged.** Verdict artifact `.pipeline/build-review.json`, fail-closed
   predicate, `buildReviewSelfHeals` kickback bounded by `MAX_KICKBACKS_PER_GATE` (HALT at cap, no
   wedge), fail-closed-on-unavailability (ladder-walk → no PASS → existing RateLimitEpisode
   park/HALT). No new StepName, predicate, or grader module.
4. **Gaps → remediation.** A completeness FAIL seeds `pendingRetryHints.set('build', <reasons>)` and
   navigates back to `build` exactly as build_review's existing kickback does; the reasons name the
   missing work. (This reuses build_review's kickback rather than the RemediationGap/planRemediation
   path the superseded ADR referenced — build_review's self-heal block is the shipped mechanism.)

## Consequences

### Positive
- Zero redundant machinery: #773's completion authority is one rubric item on a gate that already
  ships, already sits at the right seam, already reads (diff + plan).
- Closes the technical-track completeness hole by default (no per-project opt-in needed).
- Completeness (under-coverage) + scope (over-coverage) form a symmetric honest-diff judgement.

### Negative
- Reverses a deliberate default-off decision from adr-2026-07-07 — projects that opted out of
  build_review's diff-honesty grading now get the completeness item regardless. Mitigated by keeping
  the diff-honesty items tunable while making only completeness unconditional.
- One rubric item more per build_review run (already an LLM dispatch; marginal cost).

### Follow-up Actions
- [ ] Add the `completeness` rubric item + verdict `rubric.completeness` field to
      `build-review-prompt.ts` / `build-review` verdict validation.
- [ ] Make build_review's completeness dimension default-on (adjust the `build_review.enabled`
      resolver default / skip idiom so completeness always runs); update model/effort/retry maps if
      the step's default activation changes.
- [ ] Grader prompt forbids per-task SHA/reachability/corroboration reasoning (holistic plan-vs-diff).
- [ ] Sequence: completeness dimension enforcing BEFORE the `build` predicate's `evidenceStamps.has`
      check is removed (no completion hole) — unchanged from the demotion ADR.
- [ ] Update HARNESS.md model table / docs for build_review's changed default activation.
