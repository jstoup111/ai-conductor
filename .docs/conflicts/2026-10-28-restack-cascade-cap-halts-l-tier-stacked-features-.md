# Conflict Check: Restack cascade cap is sized by the feature's complexity tier (#3472)

**Date:** 2026-10-28
**New stories:** `.docs/stories/restack-cascade-cap-halts-l-tier-stacked-features-.md` (Stories 1–4)
**Result:** PASSED — 0 blocking, 2 degrading (resolved under delegated approval 2026-10-28),
0 oscillating.

## Inventory

- **Stories scanned:** every `.docs/stories/` file whose criteria mention the cascade cap, cascade
  counts, `MAX_RESTACK_CASCADES_PER_CHILD`, `--gate restack`, `kickback-budget inspect` output or
  `daemon status` budget lines. The substantive overlaps are:
  - `a-change-to-one-stacked-child-cannot-be-carried-in.md` (#2943) Story 13: cascade charging,
    the cap halt and its recovery.
  - `a-routed-fix-is-never-carried-up-the-stack-or-foll.md` (#2944) Story 3 and Story 9: the routed
    exit's cap halt and the re-validation termination bound.
  - `stacked-repair-restack-conflict-above-the-repaired.md` (#3435): the routed halt detail carries
    the `cascade-cap` reason.
  - `engine-cannot-represent-more-than-one-branch-step-.md` (#2942): `--gate restack --child` is
    validated against the `cascades` ref.
  - `kickback-budget-inspect-child-shows-wrong-prd-audi.md` (#3364): childless inspect output is
    unchanged by child views.
  - `kickback-ledger-json-reports-count-0-for-a-gate-wh.md` (#2577): inspect and status budget lines.
  - `manual-reviewer-edits-cannot-be-landed-safely-in-t.md` (#3203) Story 14: daemon status lines
    for operator rounds.
- **ADRs examined (subject overlaps the stories):**
  - `adr-2026-10-10-stacked-restack-journaled-replay` decision 10 (amended by #3472).
  - `adr-2026-10-12-routed-whole-feature-repair`: the re-validation bound needs a finite per-child
    cap, which stays finite. Compatible, left unchanged.
  - `adr-2026-10-24-operator-route-round-for-closed-stacked-children`: an operator round's exit
    restack is charged one cascade. Compatible.
  - `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` (#2943 amendment):
    `restack` pseudo-gate recovery. Unchanged.
  - `adr-2026-10-03-stacked-child-plans-identity-and-state` (#2943 amendment): `--child` validation
    against the ref. Unchanged.
- **In-flight work:** #3475 (hotfix in progress in
  `.worktrees/engineer-restack-raise-refused-after-an-earlier-raise-for-a`, uncommitted) moves the
  restack limit out of the shared ledger entry and into the per-originating-child cap evidence.
  These stories assume that model, and #3475 is recorded as a land dependency. Its desired outcome
  ("a raise for one originating child does not change the limit enforced for any other") matches
  Story 3's negative path.
- **ADRs narrowed out:** every other approved ADR. None governs the cascade bound, its config or
  its display.

## Conflict: #2943 Story 13 fixes the bound at 3 for every feature

**Stories involved:** #2943 Story 13 (the count-reaches-3 happy path, the fourth-repair negative
path and the "The bound is 3" Done When) vs #3472 Story 1
**Files:** `.docs/stories/a-change-to-one-stacked-child-cannot-be-carried-in.md` vs `.docs/stories/restack-cascade-cap-halts-l-tier-stacked-features-.md`
**Type:** contradiction
**Severity:** degrading

**Description:** Story 13 states, with no tier, that the fourth repair from one child halts and
that the bound is 3. Under #3472 a tier-L feature's fourth repair proceeds, and it halts only
after 8.

**Resolution Options:**
1. Pin Story 13's fixtures to a feature with no recorded tier (allowance 3) and restate its Done
   When as the tier-resolved bound. Its tests' fixtures record no tier, so they keep passing.
2. Leave Story 13 unchanged. It would then contradict #3472 Story 1 for tier L.

**Recommendation and resolution:** Option 1, applied in place in a separate prior commit, following
the #2413 precedent of pinning another feature's fixtures.

## Conflict: Routed stories name the removed constant

**Stories involved:** #2944 Story 3 (cap-halt negative path) and Story 9 (termination negative
path) vs #3472 Story 1 (Done When: no fixed cascade constant)
**Files:** `.docs/stories/a-routed-fix-is-never-carried-up-the-stack-or-foll.md` vs `.docs/stories/restack-cascade-cap-halts-l-tier-stacked-features-.md`
**Type:** overlap
**Severity:** degrading

**Description:** The criteria say "reached `MAX_RESTACK_CASCADES_PER_CHILD`" and "terminates within
`MAX_RESTACK_CASCADES_PER_CHILD` per origin". #3472 removes the constant. Their behavior is
unchanged: a child at its allowance halts, and the loop stays bounded per origin.

**Resolution Options:**
1. Leave the criteria unchanged. The `adr-2026-10-10` decision 10 amendment states that a citation
   of `MAX_RESTACK_CASCADES_PER_CHILD` as a bound now means the resolved per-child allowance. Their
   shipped plan and coherence rows quote the criteria byte for byte, and a rewrite would
   desynchronize them for no behavioral gain.
2. Rewrite both criteria and their shipped plan and coherence rows.

**Recommendation and resolution:** Option 1, recorded here as accepted.

## Checked, no conflict

- #3435's routed halt carrying the `cascade-cap` reason: #3472 only adds a tier and allowance
  suffix to the same detail. Compatible.
- #2942's `--child` validation against the `cascades` ref: unchanged.
- #3364 childless inspect output: #3472 Story 4 prints cascade lines only for stacked features and
  keeps childless output unchanged. Compatible.
- #2577 budget lines in inspect and status: the restack summary is a separate block or line, and
  the remediation `KICKBACK BUDGET` lines are unchanged. Compatible.
- #3203 Story 14 status lines: the new `RESTACK CASCADES [<slug>]:` line is additive. Compatible.
- Sequencing: #3475 must land first (land dependency). No other in-flight spec edits
  `cascade-cap.ts`, the restack executor, or `adr-2026-10-10` decision 10. The overlap scan is
  clean, and open spec PRs #3462, #3442, #3403 and #3216 touch none of them.
