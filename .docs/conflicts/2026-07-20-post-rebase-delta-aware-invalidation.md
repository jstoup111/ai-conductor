# Conflict Check: Post-rebase delta-aware gate invalidation (#655)

**Date:** 2026-07-20
**New stories:** `.docs/stories/post-rebase-invalidation-re-runs-every-judged-gate.md`
**Scanned against:** the rebase/gate story + ADR family (`2026-07-12-wiring-reachability-gate`,
`post-rebase-build-invalidation-dispatches-a-full-b` (#420), `phase-9.0-rebase-on-latest`,
`add-a-judgement-gate-at-the-build-manual-test-seam`, and the APPROVED ADRs
`adr-2026-07-08-post-rebase-gate-first-mechanical-reverify`, `adr-2026-07-12-wiring-check-gate`).

**Result:** PASS — 0 blocking conflicts. 1 degrading overlap, resolved by ADR amendment (below).

---

## Overlap (degrading, resolved): wiring_check unconditional invalidation → conditional

**Stories involved:** New Story "Foreign main-side runtime change re-runs manual_test/wiring_check
but preserves the audits" (and "Test-only rebase delta preserves…") vs existing
`2026-07-12-wiring-reachability-gate.md` (lines 156–161).
**Type:** behavioral overlap · **Severity:** degrading (not blocking)

**Description:** The wiring story asserts `wiring_check` is *unconditionally* in the post-rebase
invalidation set `{build, build_review, wiring_check, manual_test}` on any file-changing rebase.
The new design preserves `wiring_check` on a **test/docs-only** delta. Confidence this is a genuine
overlap: ~95% (both texts speak to the same `applyRebaseVerdicts` invalidation set).

**Why it is NOT a contradiction:** the wiring gate's stated rationale is "a stale `satisfied`
wiring verdict cannot survive a rebase that moved or deleted the verified references." `wiring_check`
verifies **production reachability**, whose references are runtime paths. A test-only/docs-only
delta cannot move or delete a runtime reachability target, so preserving `wiring_check` on such a
delta upholds the gate's protective intent. The new rule (`wiring_check` invalidated iff the delta
contains runtime source) is a strict *narrowing*, not a reversal.

**Resolution applied (Option 1 — least disruptive):** amended
`adr-2026-07-20-post-rebase-delta-aware-invalidation.md` with an "Amends:
adr-2026-07-12-wiring-check-gate" reference and a "Refinement of the wiring_check invariant"
section stating the narrowed trigger condition. The wiring gate's step, topology, and predicate are
unchanged, so no superseding ADR is required (mirrors how `adr-2026-07-08` amended `phase-9.0`
without flipping its status). The wiring story's pinned invalidation-set assertion and its test are
updated in this feature's implementation — the exact precedent the wiring story itself set when it
amended #420's pinned enumeration.

---

## Pairs reasoned through and found clean

- **vs #420 gate-first (build pre-verify):** no conflict. This feature explicitly leaves `build` on
  its mechanical pre-verify and excludes it from the delta-aware surface map (Story "The build gate's
  mechanical pre-verify is unaffected"). The #420 negative path "noop/changelog_resolved → no
  invalidation" is preserved verbatim by fail-through and by the `changed`-only decision gate. (~93%)
- **vs #420 / build_review "stale beats old satisfied verdict":** no conflict. The new preservation
  keeps a judged gate `done` (never stale), acting *upstream* of that rule; `build_review` itself is
  never preserved (re-runs on any code/test delta), so its stale-beats-satisfied behavior is intact. (~90%)
- **vs phase-9.0 rebase ordering/gating:** no conflict. This feature changes only *which verdicts*
  the rebase path writes/sweeps, not when the rebase step runs or its HALT/finish ordering. (~95%)
- **vs build_review seam registry (`manual_test.prerequisites`) and wiring topology:** no conflict.
  No prerequisite/topology edges change; only the post-rebase invalidation *trigger* narrows. (~95%)
- **vs verdict-freshness (#649/#652) / retry-classification (#646/#653):** no conflict — explicit
  non-goals; this feature governs only the invalidation *set*, never how a re-run verdict's freshness
  or a retry is classified once a gate is selected. (~92%)

## Verdict

**Conflict check passed** (0 blocking). One degrading overlap with the wiring-reachability gate,
resolved by ADR amendment; the wiring test update is scoped into this feature's plan. Proceed to
`/plan`.
