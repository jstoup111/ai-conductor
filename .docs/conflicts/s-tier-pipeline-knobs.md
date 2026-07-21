# Conflict Check: Small features are cheap through the existing pipeline's own knobs (#668)

**Date:** 2026-07-21 · **Tier:** M · **Stories:** s-tier-pipeline-knobs.md (S1–S8)
**Result:** CLEAN (no blocking conflicts; three reconciliation notes)

## Method

Pairwise comparison of S1–S8 against each other, and against the three specs the operator directive
named for explicit reconciliation: the rejected PR #670, the #188 escalation ladder
(`adr-2026-07-05-retry-as-escalation-ladder`), and the #715 per-dispatch engine-rebuild cache.

## Internal consistency (S1–S8)

No contradictions. S1/S2 partition the input space (S profile applies; M/L unchanged). S3 and S6 assert
disjoint invariants on the skip set (S3: authoring-ceremony skips unchanged; S6: evidence gates never
tier-skippable). S5 (budget floor) and S7 (escalation fires) are complementary halves of the same #188
reconciliation. S8 asserts a state-safety invariant no other story mutates.

## Cross-feature / cross-spec reconciliation

- **R1 — PR #670 (`s-tier-bug-decide-flow`, CLOSED):** #670 proposed a **separate** lightweight DECIDE
  flow — a `size: S`+`bug` trigger, a new `.docs/s-tier/<slug>.md` mini-spec artifact type, an
  `expandMiniSpec` machinery, and a bespoke `landSTierSpec` primitive that satisfied the owner/stories/
  ADR gates "by construction" via **new** machinery. **This spec directly supersedes that approach**
  per operator directive: no separate flow, no new step/artifact type, no new land primitive. We reach
  the same goal (#656/#662/#625 cannot recur for S) by the opposite means — making the *existing*
  pipeline cheap so S work is not bypassed, so the machinery that already stamps those gates simply
  runs (ADR D6). #670's branch is deleted; no shared file, no merge-order coupling — it is replaced,
  not integrated.

- **R2 — #188 retry-as-escalation ladder (`adr-2026-07-05`, landed):** load-bearing dependency, not a
  conflict. This spec's "lower base, ladder as safety net" (ADR D3) **relies on** `escalateAttempt`
  (`escalation.ts:76`) and its default-on `escalate` (`resolved-config.ts:170`). The one hard
  constraint — S `max_retries` must stay ≥3 so the model-bump rung at attempt 3 is reachable — is #188
  Decision 4 restated; S5 pins it. We touch no #188 code (no edit to `escalation.ts`, no change to
  `DEFAULT_STEP_ESCALATE`, no new escalation counter). Fully consistent.

- **R3 — #715 per-dispatch engine-rebuild cache (`engine-rebuild-content-cache`, spec/open):** #715
  caches the npm-install + tsup engine rebuild across re-dispatches — a build-performance concern in
  the dispatch/rebuild layer. It shares **no file** with this spec (resolver table + metadata vs the
  rebuild cache). Orthogonal cost work at a different layer; no reconciliation needed. If both land,
  standard rebase applies with no semantic overlap.

## Resource / state contention

None. The change is additive rows in `DEFAULT_STEP_TIER_OVERRIDES` (`resolved-config.ts:144-158`) plus
`STEP_RATIONALE` entries and a HARNESS.md regen — no existing row's value is altered except by adding
absent `S` keys. The optional D5 label→tier seed writes the same `Tier:` line the existing
`parseComplexityTier` reader already consumes; it adds no second source of truth.

**Verdict:** CLEAN — proceed to plan.
