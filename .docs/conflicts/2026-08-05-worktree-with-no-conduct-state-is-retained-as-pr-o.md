# Conflict Check: Worktree classification and retained reasons (#1329)

**Date:** 2026-08-05
**Stories checked:** `.docs/stories/worktree-with-no-conduct-state-is-retained-as-pr-o.md`
(Stories 1-6) against the accepted story set in `.docs/stories/`, with focused pairwise review
against every accepted story asserting behavior over `.worktrees/` classification, the retained
bucket, HALT/park precedence, or dispatch eligibility.

**Result:** PASSED — zero blocking conflicts, one degrading overlap accepted and resolved in place.

## Pairs examined

| Existing artifact | Interaction with #1329 stories | Verdict |
|---|---|---|
| `daemon-reaps-a-feature-worktree-at-pr-open-before-.md` S4 (retain/reap decisions logged with reason) | S4 asserts the **daemon log** line for a verified ship carries reason `pr-open-awaiting-main`, emitted at the ship site (`daemon-runner.ts:454`). #1329 Story 3 changes the **dashboard scan's** reason derivation, a different surface. A verified ship still legitimately yields that reason. | No conflict (~92%) |
| `daemon-reaps-a-feature-worktree-at-pr-open-before-.md` S4 negative path (undeterminable disposition must not default to a fabricated reason) | #1329 Story 3 strengthens the same principle in the dashboard: probe failure degrades to an explicit unknown. Same direction, no contradiction. | Reinforcing |
| `daemon-reaps-a-feature-worktree-at-pr-open-before-.md` S5 (retained worktrees listed and reclaimable) | Overlap: S5 asserts every retained worktree is listed under a retained category enumerated from `.worktrees/`. #1329 Story 1 moves never-started worktrees OUT of that category into their own bucket. | Degrading overlap — resolved below |
| `daemon-halt-reconciliation.md` | Governs HALT precedence and re-kick. #1329 Story 2 preserves HALT and park as higher-precedence buckets and adds no new resume path. | No conflict (~90%) |
| `engineer-worktree-isolation.md` | Concerns `engineer-` prefixed worktrees. #1329 Story 1 explicitly keeps `engineer-`/`resolve-` prefixed directories out of both buckets, matching today's exclusion. | No conflict |
| `2026-07-09-daemon-merged-pr-guard-on-retry.md` | Guards re-dispatch of merged PRs. #1329 Story 4 keeps shipped-and-retained slugs excluded from ELIGIBLE, so no merged feature becomes eligible. | No conflict — Story 4 is the explicit non-regression |
| `mid-loop-pipeline-wipe-549.md` | Concerns loss of `.pipeline/` mid-run. Interacts with Story 1: a wiped `conduct-state.json` would now classify never-started rather than retained. Both classifications leave the feature dispatchable and the wipe story's remedy path unchanged; the new bucket is strictly more accurate about what is on disk. | No conflict (~85%) |

## Conflict: Never-started worktrees leave the retained-worktree category

**Stories involved:** #1329 Story 1 vs `daemon-reaps-a-feature-worktree-at-pr-open-before-.md`
Story S5
**Type:** overlap
**Severity:** degrading

**Description:** S5 asserts the dashboard renders a retained-worktree category enumerated from
`.worktrees/` on disk, with each retained worktree listed and reclaimable by name. #1329 Story 1
removes never-started worktrees from that category. A never-started worktree is therefore no
longer surfaced by S5's category — it is surfaced by the new one instead. The categories remain
disk-enumerated and no worktree becomes invisible, but S5's category is narrower than when it was
written.

**Resolution options:**
1. Keep never-started worktrees in the retained category with a different reason string — rejected:
   it preserves exactly the conflation `adr-2026-08-05-worktree-classification-evidence-derived-reasons`
   exists to remove, and keeps them excluded from ELIGIBLE.
2. Split the bucket and carry S5's operator affordances (disk enumeration, named reclaim) into the
   remedy line of every bucket, so no affordance is lost — **selected**.
3. Supersede S5 — rejected: S5's assertions about retained worktrees remain true for genuinely
   retained worktrees; only the membership narrows.

**Recommendation applied:** Option 2. #1329 Story 5's happy path was amended in place to require
the retained row's remedy line to name the existing reclaim verb, so S5's reclaim affordance stays
operator-reachable under the new rendering.

## ADR impact

None. Neither resolution changes an APPROVED ADR, and no superseding ADR is required.
