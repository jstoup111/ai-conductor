# Conflict Check: Halt records committed on stacked child branches make every restack conflict (#3451)

**Date:** 2026-10-28
**New stories:** `.docs/stories/halt-records-committed-on-stacked-child-branches-m.md` (Stories 1–3)
**Result:** PASSED after resolution. 3 blocking contradictions were resolved by rewriting the
superseded #2943 criteria in place. 0 conflicts remain, and no degrading conflict was accepted.

## Inventory

- **Stories scanned for the subject** (halt records, stacked restack, child branches):
  - `a-change-to-one-stacked-child-cannot-be-carried-in.md` (#2943)
  - `stacked-repair-restack-conflict-above-the-repaired.md` (#3421, building)
  - `a-routed-fix-cannot-be-built-charged-and-reviewed-.md`
  - `manual-reviewer-edits-cannot-be-landed-safely-in-t.md`
  - `build-loop-cannot-complete-a-feature-child-by-chil.md`
  - `stacked-features-cannot-be-published-reviewed-and-.md`
  - `a-halt-leaves-no-committed-pushed-record-for-the-o.md`
  - `automatic-rebase-preserves-merges-carrying-unique-.md`
  - `no-daemon-level-metrics-queue-depth-halts-and-gate.md`
  - `daemon-commits-carry-no-bot-co-authored-by-trailer.md`
  - `daemon-commits-co-authored-by-the-configured-bot.md`
  - `path-policy-still-decides-feature-ownership-by-fol.md`

  The other story files do not mention halt records or stacked replay.
- **ADRs examined:**
  - `adr-2026-10-10-stacked-restack-journaled-replay` (amended 2026-10-28 by this spec)
  - `adr-2026-10-07-per-child-build-region`
  - `adr-2026-08-23-committed-halt-record`
  - `adr-2026-10-17-stacked-feature-publication-as-native-stack`
  - `adr-2026-10-12-routed-whole-feature-repair`
  - `adr-2026-10-24-operator-route-round-for-closed-stacked-children`
  - `adr-2026-10-25-operator-recorded-restack-conflict-resolution`
- **ADRs narrowed out:** every other approved ADR. None governs halt-record placement or stacked
  replay membership.

## Conflict: Halt-only conflicts kept the upper child's record

**Stories involved:** #2943 Story 6 vs #3451 Story 2
**Files:** `.docs/stories/a-change-to-one-stacked-child-cannot-be-carried-in.md` vs `.docs/stories/halt-records-committed-on-stacked-child-branches-m.md`
**Type:** contradiction
**Severity:** blocking

**Description:** #2943 Story 6 kept child 2's record whenever both ranges carried conflicting halt
records. #3451 Story 2 requires the newer record, which can be child 1's.

**Resolution Options:**
1. Rewrite #2943 Story 6's criterion to the newest-record rule, keeping "no resolver is dispatched".
2. Keep the upper-child rule (reverses the approved ADR amendment).

**Recommendation:** Option 1. Operator-approved 2026-10-28 and applied.

## Conflict: A mixed halt-record and code conflict went to the resolver whole

**Stories involved:** #2943 Story 6 vs #3451 Story 1
**Files:** same as above
**Type:** contradiction
**Severity:** blocking

**Description:** #2943 sent a conflict on `.docs/halted/demo.md` plus `src/c.ts` to the resolver,
unresolved. #3451 Story 1 forbids the resolver from receiving the halt-record path.

**Resolution Options:**
1. Rewrite the #2943 criterion: the code path goes to the resolver, and the halt path keeps the side being rebuilt.
2. Keep the whole-conflict hand-off (contradicts #3451 desired outcome 2).

**Recommendation:** Option 1. Operator-approved 2026-10-28 and applied.

## Conflict: An unentered leaf moved to the rewrite of a pre-region halt record

**Stories involved:** #2943 Story 1 vs #3451 Story 1
**Files:** same as above
**Type:** contradiction
**Severity:** blocking

**Description:** #2943 Story 1 moved the leaf to `H'`, the rewrite of the pre-region halt-record
commit `H`. Under #3451, `H` is halt-record-only and is not replayed, so `H'` never exists.

**Resolution Options:**
1. Rewrite the #2943 criterion. The leaf moves to the single commit `H` maps to, and the
   no-`leaf-moved`-ref and no-stray-commit outcomes are kept.
2. Keep replaying pre-region halt-record commits (a special case that contradicts the bookkeeping rule).

**Recommendation:** Option 1. Operator-approved 2026-10-28 and applied.

## Pairs checked with no conflict

- **#3421 Stories 1 and 4** (conflict-halt text and recipe): compatible. The halt text is unchanged.
  #3421's recorded candidate subjects come from `replayCandidates`, so they inherit the omission.
  The code overlap with that in-flight build is sequenced with a depends-on #3421 edge at land
  (operator decision 2026-10-28).
- **Halt-record-only tolerances on closed children and hosts** (#2943 Story 1 past-closure discard;
  routed, operator-round and manual-reviewer stories): compatible in both directions. The
  bookkeeping commit is itself halt-record-only.
- **Build-region Story 13** (records on the active child, never pushed) and the **publication
  stories**: compatible, because placement is unchanged.
- **Committed-halt-record stories** (flat commit and push): compatible. #3451 Story 3 keeps them
  unchanged.
- **Oscillation check:** satisfying #3451 Story 2 (newest record) leaves #3451 Story 1 (no resolver)
  true, and the reverse also holds. Satisfying the rewritten #2943 Story 6 leaves the #3421 FR-9
  recorded-subject check true, and the reverse also holds.
