# Conflict Check: Observed-close (#492)

**Date:** 2026-07-10
**New stories:** `issues-close-on-first-production-observation-of-th.md` (8 stories, Accepted)
**Scope examined:** issue-ref/write-back stories+specs, halt-PR rehabilitation, mergeable-watch
and `sweepBestEffort` contracts, #462 wiring-gate direction, evidence/shipped-record/finish-record
semantics, intake dedup anchors.
**Result:** 1 blocking + 1 degrading conflict found — both RESOLVED (operator-selected). Zero
blocking conflicts remain.

## Conflict 1: Halt-PR rehabilitation re-injects `Closes` — RESOLVED

**Stories involved:** "Ship-time trailer is conditional on the declaration" (new) vs the
halt-PR rehabilitation flow (adr-2026-07-03-halt-pr-rehabilitation-at-finish lineage)
**Files:** `.docs/stories/issues-close-on-first-production-observation-of-th.md` vs
`src/engine/halt-pr-rehabilitation.ts:102` (verified: unconditional
`injectIssueRef({keyword: 'Closes', …})`)
**Type:** overlap  **Severity:** blocking

**Description:** rehabilitation ensures a `Closes` ref when flipping a halt-born PR ready.
For a watched fix this silently restores merge-close on exactly the recovery path, after the
post-run step injected `Refs` — the watch would enroll but the issue would still close at merge.

**Resolution (operator-selected, Option 1 — declaration-aware):** both injection call sites
(post-run step, halt-PR rehabilitation) resolve the keyword (`Closes` vs `Refs`) from the same
observation declaration via one shared helper. Watched → `Refs` everywhere; legacy /
`close-on-merge` → `Closes` everywhere, byte-identical to today. New scenarios + a Done-When
item added to the ship-time story. Rejected: skipping ref-ensure in rehab (loses legacy linkage
repair); delegating all ref work to post-run (restructures a shipped flow).

## Conflict 2: Accepted as-built story asserts universal merge-close — RESOLVED

**Stories involved:** new observed-close stories vs `intake-issue-pr-link-autoclose.md`
Story 4 ("its body contains `Closes …`, so merging … auto-closes the issue")
**Type:** contradiction (story-phrasing scope)  **Severity:** degrading

**Resolution (operator-selected):** scope note added to the old Story 4 restricting it to
legacy / `close-on-merge` fixes, pointing at the observed-close stories and ADR. No behavior
change for unwatched fixes.

## Examined and clean (reasoned, not assumed)

- **`sweepBestEffort` contract** (daemon.ts): additive third best-effort call; existing
  wording nowhere enumerates an exclusive sweep list; error-isolation per call preserved.
- **Mergeable-watch registry**: separate file (`mergeable-watch.jsonl` vs
  `observation-watch.jsonl`), no shared entries or labels — no resource contention.
- **#462 wiring gate**: complementary, not overlapping — #462 is the spec-time contract
  ("name the production entry point"), this feature is the runtime proof ("the behavior
  fired"); the no-show flag is explicitly designed as #462's runtime alarm.
- **Evidence gate / shipped-record / finish-record**: untouched; no new story treats issue
  state as completion currency, and no existing gate reads issue open/closed state.
- **Intake dedup**: re-serving is anchored on the `engineer:handled` label + ledger and
  shipped-record/merged-PR checks — none read issue closed-state, so later closes cannot
  cause duplicate serving.
- **Sequencing**: enrollment strictly follows PR existence (no-PR → no entry); no story
  assumes the sweep runs before enrollment; no circular dependency.

## Re-check

After applying both resolutions the pair scan over the affected files was re-run: zero
blocking conflicts remain; no superseding ADR was needed (the APPROVED ADR's decision —
keyword resolved from the declaration — is unchanged; rehabilitation is a second call site
of the same decision).
