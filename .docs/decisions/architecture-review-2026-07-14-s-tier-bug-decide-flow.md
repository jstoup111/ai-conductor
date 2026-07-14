# Architecture Review: Lightweight DECIDE flow for size-S bugs (#668)

**Date:** 2026-07-14 · **Track:** technical · **Tier:** M · **Mode:** pre-implementation (lightweight+)
**Verdict:** APPROVED · **ADR:** adr-2026-07-14-s-tier-bug-decide-flow.md (APPROVED)

## Scope reviewed

The mini-spec authoring path (D1–D6 in the ADR): label-authoritative trigger, one combined artifact,
deterministic expand+stamp at land, fail-closed validation reusing existing predicates, and an
unchanged build pipeline.

## Feasibility

- **Reuses existing seams.** The three target gates already read specific files
  (`.docs/intake/<slug>.md` Owner, `.docs/stories/<slug>.md` `Status: Accepted`,
  `.docs/complexity/<slug>.md` `Tier:`). The expander writes exactly those, so satisfaction is
  mechanical and no reader is touched — lowest-risk integration point. (confidence: high — anchors
  verified: `owner-gate/provenance.ts:34-49`, `artifacts.ts:1860-1863`, `artifacts.ts:1887-1892`.)
- **`writeIntakeMarker` already exists** (`engineer/intake-marker.ts:44`); the only change is calling
  it unconditionally from the S-flow (today it's gated behind `--source-ref`). Additive, low blast
  radius. (confidence: high.)
- **`skippableForTiers: ['S']`** already delivers the build-time behaviour (`steps.ts`;
  `conductor.ts:1614-1623`), so D6 needs *no* build-pipeline change — the review confirms the S-flow
  must NOT add any new skip. (confidence: high.)

## Alignment / risks

- **Correctness gate integrity (target #1).** The design collapses ceremony, not verification:
  build_review, domain review, code-review are not in any skip list. The review requires a story +
  test asserting these steps still run under Tier S (see S6) so a future change can't quietly add
  them to the skip set. APPROVED on that condition (satisfied by S6/T11).
- **Fail-closed authoring.** Owner/stories/tier/ADR/RED-list checks must throw at land (not warn),
  matching the existing `land-spec.ts` hard-gate posture (231-236, 267-277). Negative stories
  S7–S9 lock this.
- **Trigger precision.** `size: S` alone must not trigger (non-bug refactors still need full DECIDE).
  The `bug`+`size: S` conjunction and the M/L regression are pinned by S10.
- **No dependency on `assessTier`.** Label-authoritative tier must not silently fall back to the LLM
  walk when the label is present; S1 asserts the bypass.

## Verdict

APPROVED. The design is additive, reuses verified gate readers, and satisfies the three failing gate
classes by construction without weakening any review. Proceed to stories.
