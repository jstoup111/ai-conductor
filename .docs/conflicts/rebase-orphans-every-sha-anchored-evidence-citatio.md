# Conflict-check: rebase-orphans-every-sha-anchored-evidence-citatio

**Source:** jstoup111/ai-conductor#535 · **Track:** technical · **Tier:** L
**Result:** PASS (with sequencing notes)

This feature adds a post-rebase translation step and two read-time resolution hooks on the
attribution/rebase hot path — the same functions an active cluster is editing. All conflicts are
structural (shared functions) or sequencing; none are contradictory.

## Internal consistency (this spec's stories)

No contradictions. Story 2/3/4 partition by store; Story 5 is read-time-only and never rewrites
trailers; Story 7 (residue) and Story 8 (no-laundering) partition on whether a SHA is a map key;
Story 9 makes the whole step conditional on a `changed` outcome + injected capability. State
transitions are monotonic — a store value only moves old→new via an authoritative git map; never
invented.

## Cross-feature conflicts

| # | Overlapping work | Surface | Nature | Resolution |
|---|---|---|---|---|
| C1 | **#532** verdict-aware resume (PR #543, `spec/rekick-resume-runs-finish-while-the-build-gate-ver`) | `daemon-rekick.ts` `resumeRebaseFirst` + `selector.ts` | Adjacent: #532 clamps the resume start index; this adds translation after `performRebase` in the same rekick path. | No behavioral conflict — orthogonal (start-index vs post-rebase store translation). Sequencing: rebase on latest main; re-assert the `resumeRebaseFirst` / `performRebase` anchors (`daemon-rekick.ts:361`) after #532 merges. Cite `.docs/conflicts/2026-07-11-verdict-aware-resume-entry.md`. |
| C2 | **#520 / #581** judged-attribution memo + sidecar | `attribution-lane.ts:85-88,480`, `task-evidence.ts:181` (`writeJudgedStamps`) | Structural: this translates `attribution-memo.json` and the sidecar `verdictAnchor` those own. | Extends, does not change, their contracts. Consume the existing memo key shape and `EvidenceStamp` fields; add translation only. Re-verify the memo key format (`attribution-lane.ts:85`) is unchanged after #520/#581 land before applying the re-key edit. |
| C3 | **#576** wrong `Task:` trailers | `deriveCompletionInternal` path-corroboration (`autoheal.ts:709`) | Semantic: #576 fixes trailer *content*; this fixes trailer *target-sha resolution*. | Complementary, independent axes. Do not remove #576's corroboration; add map-resolution ahead of the ancestry check only. |
| C4 | **#530 / #529** finish-step machinery | `conductor.ts` finish/gate flow near `runRebaseStep` (3789-3908) | Structural: edits near the same rebase-step block. | Sequencing only. This feature's insertion is inside `performRebase` (`rebase.ts`), not in `runRebaseStep`'s body, so the conductor-side surface is minimal. Rebase on latest; re-assert the `performRebase` call site (`conductor.ts:3832`) after #530/#529. |
| C5 | **adr-2026-07-08** post-rebase gate-first reverify | `applyRebaseVerdicts` / `preVerify('build')` | Boundary: both act post-rebase. | No conflict — this runs **before** verdict application (translation makes the sha-anchored inputs valid so the mechanical pre-verify sees translated stamps). Ordering: translate → then `applyRebaseVerdicts`. Assert translation precedes the pre-verify. |
| C6 | **adr-2026-07-03** force-with-lease refresh | post-rebase force-push | Boundary: must not add a second rewrite. | Explicit non-goal — trailers are resolved at read time, never rewritten, so no new commit rewrite and no new push. Assert no force-push is introduced. |

## Resource / state contention

- **`.pipeline/task-evidence.json`** — written by `writeJudgedStamps` + `deriveCompletion`; this
  adds an in-place rewrite during the single-threaded post-rebase step (no concurrent writer in the
  gate loop). Reuse the atomic temp+rename discipline.
- **`.pipeline/task-status.json`** — reconciled by `reconcileStatusFromStamps`; the translation
  writes `commit` fields directly, then normal reconcile proceeds. Order: translate stores →
  `applyRebaseVerdicts` (which re-derives) → reconcile. No torn read beyond existing atomic writes.
- **New stores** `.pipeline/rebase-rewrites.json` and `.pipeline/rebase-residue.json` — sole writer
  is the translation step; gitignored `.pipeline`.

## Sequencing recommendation

Safe to build independently. If #532/#520/#581/#530/#529 merge first, rebase and re-verify the four
named anchors (`daemon-rekick.ts:361`, `attribution-lane.ts:85`, `conductor.ts:3832`,
`autoheal.ts:602-645`) are still at the plan's line references before applying edits. No blocking
conflict; the changes are additive and ordering-safe.
