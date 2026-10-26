# Conflict Check: Remediation lap allowance derives from the feature's complexity tier (#2413)

**Date:** 2026-10-25
**New stories:** `.docs/stories/remediation-lap-caps-are-flat-integers-not-the-s-m.md` (Stories 1–5)
**Result:** PASSED — 0 blocking, 3 degrading (all resolved in place, operator-approved 2026-10-25),
0 oscillating.

## Inventory

- **Stories scanned:** every `.docs/stories/` file whose criteria mention kickback budgets, lap caps,
  lap allowances, `kickback-cap`, `max_appended_tasks`, or `max_remediation_laps` (37 files), plus a
  repository-wide search of `.docs/stories/` for `max_remediation_laps`. Only
  `kickback-ledger-json-reports-count-0-for-a-gate-wh.md` names that key.
- **ADRs examined (subject overlaps the stories):**
  - `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback` (D5 amended by #2413).
  - `adr-2026-08-25-as-built-remediable-findings-bounded-build-route` (D4 amended by #2413).
  - `adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework` (D5 amended by #2413).
  - `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class`: raise arithmetic from the recorded limit, compatible.
  - `adr-2026-10-12-routed-whole-feature-repair`: one charge per routing round; cap unchanged; compatible.
  - `adr-2026-08-22-as-built-review-runs-always-with-plan-gap`: mentions the default only inside its #1874 note, which points to adr-2026-08-25.
- **ADRs narrowed out:** every other approved ADR. None governs remediation lap allowance, the
  kickback budget line, or config default materialization. The ADRs that mention materialization
  (rubric branches, portable build-review policy, provider catalog, git guard, dispatcher seam,
  repo-wide ADR sweep, mechanical rubric faults, ac-prefixed skill names) concern unrelated keys.
- **Excluded as fully superseded:** `adr-2026-08-29-operator-authorized-kickback-budget-recovery`.

## Conflict: Flat-feature inspect output pinned byte-identical

**Stories involved:** #3364 Story 1 (no-child-state criterion) vs #2413 Story 4
**Files:** `.docs/stories/kickback-budget-inspect-child-shows-wrong-prd-audi.md` vs `.docs/stories/remediation-lap-caps-are-flat-integers-not-the-s-m.md`
**Type:** contradiction
**Severity:** degrading

**Description:** The #3364 criterion required flat-feature inspect output to be byte-identical to
its pre-#3364 output, so it could never admit Story 4's tier-and-allowance suffix or its `tier` and
`allowanceSource` JSON fields.

**Resolution Options:**
1. Restate the #3364 criterion so it pins only its own child-view behavior and admits the #2413 additions.
2. Drop the suffix from flat-feature inspect output (contradicts #2413 desired outcome 3).

**Recommendation and resolution:** Option 1, applied in place.

## Conflict: #2577 inspect fixtures assume an unconfigured cap of 1

**Stories involved:** #2577 Story 1 (pending-charge, generic-counter, and spent-cap criteria) vs #2413 Story 1
**Files:** `.docs/stories/kickback-ledger-json-reports-count-0-for-a-gate-wh.md` vs `.docs/stories/remediation-lap-caps-are-flat-integers-not-the-s-m.md`
**Type:** state-conflict
**Severity:** degrading

**Description:** Three criteria stated "cap 1" without saying where it came from. Under #2413 an
unconfigured feature's cap is 2, 3, or 4 by tier. Three other #2577 criteria that assumed the
implicit default had already been restated during `/stories`.

**Resolution Options:**
1. Pin each fixture to an explicit `architecture_review_as_built.max_remediation_laps: 1`.
2. Rewrite the expected figures for a stated tier.

**Recommendation and resolution:** Option 1, applied in place to all six #2577 criteria. This
preserves their intent: the display agrees with enforcement.

## Conflict: Tier suffix scope versus the build_review budget line

**Stories involved:** #3364 Story 1 (`build_review` block criterion) vs #2413 Story 4
**Files:** `.docs/stories/kickback-budget-inspect-child-shows-wrong-prd-audi.md` vs `.docs/stories/remediation-lap-caps-are-flat-integers-not-the-s-m.md`
**Type:** overlap
**Severity:** degrading

**Description:** Story 4 described the suffix as part of the shared budget line, which would also
render `build_review`. #3364 prints `Kickback budget (build_review): 4/6 consumed; 2 remaining`.

**Resolution Options:**
1. Limit the suffix and JSON fields to `prd_audit` and `architecture_review_as_built`, with a negative path asserting that `build_review` output is unchanged.
2. Extend the suffix to `build_review` and restate #3364.

**Recommendation and resolution:** Option 1, applied to #2413 Story 4.

## Compatible interactions noted

- #3364 requires that a child view's remediation budget line is identical to the halt's line. That
  agrees with #2413 Story 4's requirement that halt, inspect, and status show identical tier and
  allowance, and it constrains BUILD to resolve the tier from the same source on both surfaces.
- `plan-growth-allowance-is-spent-on-work-existing-ta.md` (`lap cap reached (n/n)`),
  `growth-exhausted-build-halt-hides-the-pending-grow.md`, `offer-ship-or-continue-at-remediation-budget.md`,
  `over-scope-refusal-should-route-to-build-rework-in.md`, `a-halted-feature-only-re-runs-when-a-human-clears-.md`,
  and `kickback-cap-raise-replays-the-halted-lap-s-remedi.md` assert relative or contains-style
  budget text and open JSON shapes, so the suffix and the new fields do not falsify them.
- No oscillation: no existing criterion requires a flat one-lap default or forbids the suffix.
