# ADR: Build completion authority — a build-end plan-completeness judgement gate

**Date:** 2026-07-21
**Status:** SUPERSEDED by adr-2026-07-21-completeness-as-build-review-rubric
**Deciders:** Operator (jstoup111), via /engineer DECIDE for #773

> **Superseded 2026-07-21.** This ADR proposed a NEW `build_completeness` step without recognizing
> that `build_review` (adr-2026-07-07-build-review-judgement-gate, #324 — merged) already IS the
> judgement gate at the build → manual_test seam with this exact machinery. The completeness
> judgement is instead folded into build_review as a default-on rubric item. See
> adr-2026-07-21-completeness-as-build-review-rubric. The rest of this ADR (fail-closed predicate,
> kickback bounding, fail-closed-on-unavailability, the holistic-not-per-task-stamp guardrail) is
> preserved there.

<!-- Companion to adr-2026-07-21-demote-task-stamping-to-telemetry -->

## Context

adr-2026-07-21-demote-task-stamping-to-telemetry deletes the per-task evidence gate that currently
decides "build done." Without a replacement, the build would advance on structure alone, and on the
**technical track** there is a real completeness hole: `prd_audit` is `skippableForTracks:
['technical']` (steps.ts 194-205) and `acceptance_specs` only proves the story-level acceptance
criteria RED→GREEN — neither guarantees that *every planned task* was actually implemented. The
operator's explicit requirement (DECIDE gate): keep **judgement** that "we actually did all the
work," or trust erodes and planned work silently goes unimplemented.

The design must add that judgement **without** reintroducing the wedge classes — i.e. holistic
plan-vs-diff reasoning, NOT per-task SHA pinning / reachability / path-corroboration accounting.

**Verified feasibility facts (grounded, confidence ~90%):**
- Steps are `StepDefinition`s in an ordered `ALL_STEPS`; inserting a gating step after `build`
  (mirroring `build_review`/`wiring_check`, both engine-dispatched `gating` `loopGate` steps added
  recently) is the established, low-friction extension (`buildStepRegistry` insert-by-`after`,
  steps.ts 444-540).
- Completion predicates are `(dir, ctx: CompletionContext) => Promise<CompletionResult>`
  (artifacts.ts 879-881). `ctx` already exposes `projectRoot`, `planPath`, and `getHeadSha` — enough
  to read the plan task set and the built HEAD; the diff is computed via git in `projectRoot` or an
  injected callback (the `wiringProbe` injection pattern).
- The existing semantic gates (`prd_audit`, `build_review`, `architecture_review_as_built`,
  `manual_test`) all follow **grader/skill writes `.pipeline/*` verdict → predicate reads it
  fail-closed** (e.g. `build_review` passes ONLY on exact `verdict:'PASS'`; missing/stale/malformed
  ⇒ not done). Verdict freshness plumbing (`verdictFreshness`, `routeClass`) is shared.
- Named gaps route through the existing `RemediationGap` interface (artifacts.ts 2140-2152):
  `{ id, disposition: 'build'|'acceptance_specs'|'architecture_review'|'plan'|'halt', rationale,
  tasks: {id,title}[] }`. `planRemediation` appends `rem-<source>-<gap>` tasks to the plan and
  re-seeds; `MAX_KICKBACKS_PER_GATE=2` (conductor.ts 242) bounds re-openings before HALT.
- On LLM unavailability the convention is **ladder-walk then HALT/park, never pass**
  (`invokeWithLadder`; missing verdict ⇒ not-done; rate-limit/session/auth handled by
  `RateLimitEpisode`, independent of the deleted no-evidence counter).

## Options Considered

### Option A: New gating step after `build`, grader-writes-verdict + fail-closed predicate (CHOSEN)
- **Pros:** mirrors `build_review`/`wiring_check` precedent; fully decoupled from the deleted
  `build`-predicate evidence code; reuses remediation + kickback bounding + fail-closed verdict
  plumbing unchanged; satisfies "deterministic reader, LLM only in the grader."
- **Cons:** adds a `StepName` union member, a predicate, a grader prompt/inputs module, and a skill
  or engine-dispatch path — more surface than editing one predicate.

### Option B: Redefine the existing `build` step's completion predicate to do the judgement
- **Pros:** no new step.
- **Cons:** `build`'s predicate (artifacts.ts 898-1088) is the exact code carrying the evidence
  coupling being deleted — folding the new gate in re-entangles it with machinery #773 removes;
  higher regression risk; muddies the "structural build vs judgement gate" separation.

### Option C: Inline LLM dispatch inside the predicate (no verdict file)
- **Pros:** one fewer artifact.
- **Cons:** breaks the deterministic-reader convention every other gate follows; a predicate is
  re-evaluated frequently and must stay cheap/pure — dispatching an LLM inside it is the wrong seam;
  no freshness/routeClass reuse.

## Decision

Adopt **Option A**: a new **gating** BUILD step — provisional name `build_completeness` — inserted
immediately after `build` and before `build_review`, with `enforcement: 'gating'`, `loopGate: true`,
`prerequisites: ['build']`, `kickbackTarget: 'build'`.

- **Grader (LLM, judgement):** reads the plan's task set and the actual build diff (plan `**Files:**`
  and task intents vs `git diff` over the build's commits) and judges **holistically** whether all
  planned work is present. It emits a fail-closed verdict artifact under `.pipeline/` (e.g.
  `.pipeline/build-completeness.json`) carrying `verdict: PASS|FAIL` and, on FAIL, **named gaps**
  shaped as `RemediationGap` (disposition `build`, concrete `tasks[]`). It reasons about *whether the
  work exists*, NOT about which SHA a stamp pins or whether a cited commit is reachable — this is the
  bright line that keeps the wedge classes deleted.
- **Predicate (deterministic, fail-closed):** `(dir, ctx)` reads the verdict artifact, freshness-gates
  it against the session, and returns `done` ONLY on an explicit fresh `PASS`; missing / stale /
  malformed / `FAIL` ⇒ `done:false` with `routeClass` set so the conductor routes the named gaps.
- **Remediation routing:** on FAIL the named gaps flow through the **existing** `planRemediation` /
  `appendRemediationTasks` path (disposition `build` → `rem-*` tasks appended → re-seed → re-dispatch
  build). No new routing code.
- **Wedge-proof bounding:** re-openings are bounded by `MAX_KICKBACKS_PER_GATE=2`; exceeding it writes
  the loop-halt marker (operator surfaced), exactly like `manual_test`. The gate therefore **cannot**
  wedge on a false-negative loop — it HALTs for a human instead, which is the correct failure mode.
- **Fail-closed on unavailability:** if the grader cannot reach a model after the ladder walk, no
  `PASS` verdict is written ⇒ predicate stays not-done ⇒ the existing `RateLimitEpisode`/HALT-park
  path handles it (independent of the deleted no-evidence counter). Never advance on unavailability.

## Consequences

### Positive
- Closes the technical-track completeness hole with a single holistic judgement in the trusted
  `build_review`/`prd_audit` class — the operator's "did we actually do the work" requirement, met.
- Zero new gating primitives: reuses verdict-file, freshness, remediation, and kickback machinery.
- The judgement is plan-vs-diff, so it does not resurrect per-task stamp bookkeeping (no pins, no
  reachability, no corroboration) — the wedge classes stay dead.

### Negative
- One more LLM dispatch per build cycle (cost/latency) — bounded and comparable to `build_review`.
- A holistic judge can false-PASS (miss a gap) — mitigated because the downstream outcome gates
  (acceptance GREEN, build_review, wiring_check, manual_test, as_built) still run and independently
  catch missing behavior; and false-FAIL is bounded by the kickback cap.

### Follow-up Actions
- [ ] Add the `build_completeness` step definition + `StepName` member + predicate + grader
      inputs/prompt (or skill), inserted after `build`, before `build_review`.
- [ ] Wire the FAIL verdict's named gaps to the existing `RemediationGap`/`planRemediation` path.
- [ ] Ensure the grader prompt forbids per-task SHA/reachability/corroboration reasoning (holistic
      plan-vs-diff only) — this is the guardrail that keeps the wedge classes from re-emerging.
- [ ] Acceptance coverage: FAIL emits routable gaps; PASS advances; stale/missing verdict ⇒ not-done;
      kickback cap HALTs rather than wedges; unavailability parks, never passes.
