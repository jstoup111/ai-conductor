# Conflict Check: Autoheal path-corroboration bounded dirname pass (#707)

**Date:** 2026-07-20
**Stories checked:** `.docs/stories/autoheal-path-corroboration-rejects-valid-build-co.md`
(7 stories, all scoped to the `fileMatchesPlanPath`/`filesOverlappingTaskPaths` matcher).
**Verdict:** PASS — zero blocking conflicts. One bounded/mitigated degrading interaction noted (#445).

## Scope

#707 changes exactly one thing: the path-corroboration matcher gains a bounded dirname branch
(immediate-parent-dir equality) in addition to exact/suffix match. The analysis below checks this
against every adjacent feature touching `autoheal.ts` / `attribution-lane.ts` / the conductor
completion path.

## Pairwise Analysis

### vs #445 — "same as Task N" inherits the plan's declared Files  (HIGH-RISK — examined closely)
**Type:** overlap (same subsystem). **Severity:** degrading (bounded + mitigated). **Confidence 90%.**
- **Verified (autoheal.ts:1170-1332):** #445 operates at **path DECLARATION/RESOLUTION** time — it
  parses `**Files:**` lines and the `same`/`same as Task N` inheritance shorthand into each task's
  resolved `taskPaths` set, and its fix prevents phantom inheritance of another task's files.
- **#707 operates at path MATCHING time** — it compares a commit's file `dirname` against the
  *already-resolved* `taskPaths`. It does not read, alter, or re-resolve the `**Files:**` parser.
  The two live in different phases; #707 does not touch #445's fix.
- **Residual (why "degrading" not "clean"):** if a task's resolved paths were legitimately inherited,
  the dirname branch broadens matching from exact-file to immediate-dir *within those paths* — a
  strictly larger match set than today. **Mitigation:** the match is bounded to the immediate parent
  directory only (never ancestor/repo-root), and the `Task: N` trailer remains a hard precondition,
  so a mis-trailered/unrelated commit is still rejected. Story "Bound the dirname match…" encodes an
  explicit #445-shaped inheritance non-regression test. **Not blocking** — no scenario makes #445's
  fix and #707 simultaneously false.

### vs #570 / PR #700 (MERGED 2026-07-20) — dispatch attribution judge on inherited residue
**Type:** none (duplication risk checked). **Severity:** n/a. **Confidence 95%.**
- #700 modifies the **judge lane** (removed the `!isZeroWork` dispatch guard). #707 leaves the judge
  lane byte-for-byte unchanged (story "Preserve the semantic judge fallback path unchanged" asserts
  the diff touches no judge-lane code). The two are complementary layers: #707 is the deterministic
  first pass, #700 the LLM fallback. No duplication, no contradiction.

### vs #456 — deriveCompletion no-anchor fallback
**Type:** none. **Confidence 90%.** #456 concerns the evidence-range **anchor** resolution (lower
bound of commits scanned); #707 concerns which *files* corroborate within already-selected commits.
Orthogonal — #707 changes no anchor logic.

### vs #531 — concurrent task dispatch misattribution (one global current-task stamp)
**Type:** none. **Confidence 88%.** #531 is about the *commit-time* current-task stamp being global
across concurrent dispatches (wrong `Task:` trailer written). #707 is *read-time* corroboration and
takes the trailer as given. If #531 writes a wrong trailer, #707's trailer precondition still gates
on it — #707 neither worsens nor fixes #531. Independent.

### vs #533 — legacy satisfied-by forged citations
**Type:** none. **Confidence 88%.** #533 concerns `Evidence: satisfied-by` citation validation; #707
concerns the `Task:`-trailer + file-path corroboration branch. Different evidence forms; no overlap.

### vs #672 — doc-only tasks trigger zero_work_product
**Type:** none (mild positive interaction). **Confidence 85%.** #672 is about doc-only commits being
flagged zero-work. #707's dirname pass could credit a doc-only commit if its dir matches a
plan-declared doc path — but that is correct behavior when the task IS a doc task, and the
zero_work_product classification is a separate upstream check #707 does not alter. No conflict.

## Resolution

No blocking conflicts → no story edits required. The single degrading interaction (#445 broadening)
is already bounded by design (immediate-parent-dir + trailer precondition) and covered by a
non-regression story. Accepted as-is.

## Recommendation

Proceed to `/plan`. Carry the #445 non-regression tests as first-class plan tasks (not optional).
