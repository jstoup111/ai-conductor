# Conflict Report: Post-rebase gate-first mechanical re-verify (#420)

**Date:** 2026-07-08
**New stories:** `.docs/stories/post-rebase-build-invalidation-dispatches-a-full-b.md` (5 stories)
**Result:** PASS — 0 blocking. 2 degrading contradictions with prior shipped stories, both
resolved by the APPROVED `adr-2026-07-08-post-rebase-gate-first-mechanical-reverify` amendment
(notes appended to the superseded story text). 1 coverage note routed to `/plan`.

## Conflict 1: Phase 9.0 FR-5 asserts unconditional build invalidation

**Stories involved:** "Invalidate downstream gates on a file-changing clean rebase" (FR-5,
`.docs/stories/phase-9.0-rebase-on-latest.md:129-161`) vs new Story 1 (evidence-intact build is
confirmed mechanically, not invalidated).
**Type:** contradiction (verified — FR-5 text: "the daemon writes `satisfied:false` …
verdicts for `build` (and `manual_test` if it ran)", unconditional; new Story 1 makes the build
write conditional on the mechanical pre-verify).
**Severity:** degrading (documentation-level: FR-5 describes shipped behavior this feature
deliberately amends; both cannot be true simultaneously as normative text).

**Resolution (applied):** the new APPROVED ADR amends FR-5/FR-6 — invalidation *semantics*
stay (rebased tree is never trusted unverified); the *mechanism* for `build` becomes
mechanical-check-first. Appended an amendment note to the FR-5 story pointing at the ADR.
The FR-6 "re-verify through the normal loop" story is NOT contradicted: when the pre-verify
fails, re-verification still flows through the existing kickback loop unchanged.

## Conflict 2: build_review seam story pins the re-verify target set including build

**Stories involved:** build_review kickback story negative path
(`.docs/stories/add-a-judgement-gate-at-the-build-manual-test-seam.md:120` — "the re-verify
target set is `{build, build_review, manual_test}`") vs new Stories 1/3 (build conditionally
absent from the kicked-back set).
**Type:** contradiction (verified quote above).
**Severity:** degrading (same shape as Conflict 1 — prior story text pinned the set to protect
a specific guarantee).

**Resolution (applied):** the guarantee that story's line 120 actually protects — the selector
must not jump to `manual_test` past a stale `build_review` — is fully preserved: new Story 3
keeps `build_review` unconditionally invalidated and re-passing before `manual_test`.
Only `build`'s membership becomes evidence-conditional. Amendment note appended citing the ADR.

## Non-conflicts examined (verified compatible)

- **Rekick gated rebase resolution** (`2026-07-05-rekick-gated-rebase-resolution.md`): governs
  HOW conflicts resolve before verdicts apply; orthogonal to what happens after a clean
  `changed` outcome.
- **PRD-audit kickback preserves task-status / engine-owned task-status (ADR 2026-07-05):**
  aligned — the pre-verify is the same derive-from-evidence machinery those decisions mandate.
- **Evidence-gate grammar #417 (spec PR #418) and path-corroboration pair #424/#425 (PRs
  #426/#427, open):** all three tighten/fix `deriveCompletion`'s evidence matching; the
  pre-verify consumes whatever derive behavior is merged. Either merge order is safe: a
  stricter derive only pushes the pre-verify toward fail-closed (dispatch), never toward a
  false confirm.
- **Ship→CI kickback loop (#421 spec, merged):** complementary — it is the documented CI
  backstop for the ADR's accepted suite-run safety delta.

## Coverage note (routed to /plan, not a story conflict)

`applyRebaseVerdicts` has a third production call site: `daemon-rekick.ts:360`
(`resumeRebaseFirst`, re-kick play-forward). Per the ADR's fail-closed default, that caller may
ship capability-absent (unconditional invalidation, today's behavior) — the plan must make that
choice explicit and test it, not leave it implicit.
