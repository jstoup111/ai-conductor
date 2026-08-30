# ADR: Counterfactual sensitivity is judged from the excerpt, not decreed by exit code

**Date:** 2026-08-30
**Status:** APPROVED
**Deciders:** James Stoup (operator), composer DECIDE for #2051
**Supersedes:** adr-2026-08-17-framework-agnostic-tautology-scoped-run (decisions D2–D4 only) and the closed-provider-field-set rule of adr-2026-08-19-engine-stamped-rubric-judged-result-envelope (D2 as amended by #1748, extended by exactly one field)

## Context

The testQuality counterfactual preflight classifies every completed nonzero process exit on the
reverted-production checkout as `red` — positive sensitivity evidence
(`build-review-test-quality-preflight.ts:455`). #1915 recorded two real counterfactual runs that
exited nonzero during Rails boot / database authentication with 0 examples executed. Under the
current rule those infrastructure exits supply sensitivity support for tests that never ran
(#2051). The #1593 stance — a reverted-tree collection failure is evidence the changed production
matters — was deliberate and remains valid for its case; the defect is that exit code alone cannot
distinguish that case from an environment that never came up.

adr-2026-08-17 refused to restore a mechanical distinction because it would require the
per-framework output parsing that decision removed. This ADR agrees with that refusal and resolves
the tension the other way: the distinction is a judgement call, so it moves to the reviewer that
already reads the excerpt — no runner-output parsing enters the engine.

## Options Considered

### Option A: Framework-aware marker matching in the engine
- **Pros:** deterministic, token-free.
- **Cons:** couples the engine to each runner's output format; consumer projects bring arbitrary
  runners, so the pattern list grows forever; misfires on exactly the hard sub-case (reverted-import
  collection failure vs boot failure, both 0 examples). Rejected by adr-2026-08-17 already.

### Option B: Skill-text-only weighing guidance, no typed change
- **Pros:** no engine change.
- **Cons:** prompt-only enforcement drifts; the typed `red` classification keeps asserting a fact
  the scan has not established, violating the evidence-derived-reasons doctrine
  (adr-2026-08-05-worktree-classification-evidence-derived-reasons).

### Option C (chosen): Neutral mechanical facts + schema-constrained reviewer judgement under v3
- **Pros:** machinery keeps the bookkeeping (exit code, excerpt, validation, persistence); the LLM
  makes the one judgement the question actually requires; zero framework coupling; #1593's genuine
  case still creditable by the reviewer.
- **Cons:** sensitivity evidence is no longer purely deterministic; a few reviewer tokens per lap.

## Decision

1. **The preflight's completed-run classification becomes descriptive, not evidentiary.** A
   completed nonzero exit is recorded as the neutral fact it is — exit code, run kind, bounded
   head/tail excerpt — and no longer implies sensitivity by itself. Exit zero remains
   `stayed-green`. This supersedes adr-2026-08-17 D2–D4's exit-code-decides-RED reading while
   preserving its core prohibition: **no runner-output parsing enters the engine.** Launch,
   timeout, and signal outcomes remain the mechanical-fault lane
   (adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane), unchanged.

2. **The testQuality reviewer's result gains one optional top-level field,
   `counterfactualSensitivity`,** with the closed vocabulary `supports | indeterminate |
   not-applicable`:
   - `supports` — the excerpt shows the intended tests (or their collection of reverted
     production) failed because the reverted code matters. This preserves #1593: a
     reverted-import collection failure is creditable — by the reviewer reading the excerpt, not
     by exit-code fiat.
   - `indeterminate` — the process died before the intended tests could bear on behavior
     (bootstrap, authentication, external infrastructure; the #1915 shapes). Contributes neither
     sensitivity support nor a finding.
   - `not-applicable` — no completed nonzero counterfactual exists for this lap.

3. **The contract version stays `v3`.** `counterfactualSensitivity` is not a finding-identity
   input, so per adr-2026-08-16 D4 no version change is permitted, and per the `boundTo` precedent
   (adr-2026-08-21-review-bound-by-plan-done-when-criteria D2) the field lands additively:
   engine-validated against the closed vocabulary, excluded from finding identity, and a missing or
   malformed value → envelope reject → `absent` rerun — no kickback, no convergence-cap tick.
   Stored dispositions remain valid. This extends adr-2026-08-19 D2's closed field set by exactly
   this one field, by supersession as that decision requires; the set is closed again at three
   (`findings`, `relocationAudit`, `counterfactualSensitivity`).

4. **The reviewer's independent obligation is unchanged.** `test-insensitive` still requires a
   concrete stub-passable assertion (adr-2026-08-22-build-review-opt-in-rubric-container D3); a
   `red`-flavored counterfactual never was and still is not a finding by itself, and
   `indeterminate` can never suppress or manufacture one.

5. **Cache and drift machinery are reused, not extended.** Editing
   `skills/build-review-test-quality/SKILL.md` changes `skillDigest`
   (adr-2026-08-21-engine-identity-in-build-review-cache-key D3), so every cached judgement
   re-judges under the new contract automatically. The closed vocabulary lives in the one
   engine-side source mechanically bound to the skill text (adr-2026-08-16 D5).

## Consequences

### Positive
- The #2051 false-evidence class closes for every test runner, current and future, with no
  pattern list and no per-framework coupling.
- Typed evidence stops asserting facts the scan has not established (adr-2026-08-05 doctrine).
- No disposition invalidation, no cache migration, no contract-version churn.

### Negative
- Sensitivity evidence gains an LLM judgement step: it costs tokens and is not bit-reproducible.
- One more field in the envelope validation surface; the closed field set had to be reopened once.

### Follow-up Actions
- [ ] Amendment notes on adr-2026-08-17 (D2–D4 and the "Why #1593 is not reopened" rationale) and
      adr-2026-08-13-engine-managed-build-review-rubric-branches §3 ("normal test failure is the
      expected RED evidence").
- [ ] Neutral treatment for unrevertable external state (migrations/DDL) and a HEAD comparison
      run remain explicitly out of scope — follow-ups on #2051's thread.
