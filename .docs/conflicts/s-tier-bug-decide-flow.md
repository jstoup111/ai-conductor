# Conflict Check: Lightweight DECIDE flow for size-S bugs (#668)

**Date:** 2026-07-14 · **Tier:** M · **Stories:** s-tier-bug-decide-flow.md (S1–S10)
**Result:** CLEAN (no blocking conflicts; two merge-order notes)

## Method

Pairwise comparison of S1–S10 against each other and against in-flight harness work touching the
authoring/land seam, the complexity resolver, and the step/skip machinery.

## Internal consistency (S1–S10)

No contradictions. S1 (label trigger) and S10 (non-trigger) partition the input space cleanly
(`bug` ∧ `size: S` vs its complement). S3/S4/S5 assert three independent gates on disjoint files.
S6 asserts an invariant (skip set unchanged) that no other story mutates. S7–S9 are disjoint
negative branches of the same validator.

## Cross-feature merge-order notes

- **N1 — `#646 retry-classify-rerun-vs-route` (spec landed, unbuilt):** touches SHIP-tail retry
  routing, not the DECIDE authoring/land seam or `complexity.ts` tier resolution. No shared file.
  Orthogonal; no reconciliation needed.
- **N2 — `steps.ts` `configDisableAllowed` / `manual_test.disable` (merged, Unreleased):** the S-flow
  explicitly makes **no** change to `steps.ts` `skippableForTiers` (S6). If it later shares the file
  for an unrelated reason, standard spec-branch rebase on `origin/main` applies; the skip-set
  invariant test (T11) will catch any drift.

## Resource / state contention

None. New files (`templates/s-tier-mini-spec.md.template`, `parseMiniSpec`/`expandMiniSpec`,
`landSTierSpec`, `resolveTierFromLabels`) are additive. The one mutation to an existing symbol —
calling `writeIntakeMarker` unconditionally on the S-flow — widens a call site without changing the
marker's contents or the gate reader.

**Verdict:** CLEAN — proceed to plan.
