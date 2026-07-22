# Conflict Report: Demote task-stamping from gate to telemetry (#773)
**Date:** 2026-07-21
**Stories scanned:** all 13 in .docs/stories/demote-task-stamping-to-telemetry.md
**Result:** PASS (0 blocking; 1 degrading, resolved)

## Pairwise summary
All 5 conflict types (contradiction / overlap / state / resource / sequencing) checked across the
13 stories and against existing conductor behavior. The stories are facets of one coherent change;
the tension points the operator flagged were examined directly:

- **New build_completeness gate vs deleted evidence gate** — complementary, not contradictory: one
  gate replaces the other. No story asserts stamps still gate. CLEAN (confidence ~95%).
- **Sequencing story vs deletion story** — the sequencing story is a CONSTRAINT on the deletion
  ("new gate enforcing before stamp-predicate removed"), correctly captured as a task-dependency
  ordering, not a circular/contradictory dependency. CLEAN.
- **Separate same-named gates untouched vs deletion scope** — the one real coupling
  (parsePlanTaskPaths/TASK_ID_PATTERN in autoheal.ts) is owned by its own preservation story. CLEAN.
- **attribution-enforcement demotion vs commit-msg evidence-rejection deletion** — two distinct
  commit gates, both demoted; overlapping but consistent (same direction of change). CLEAN.
- **Grader verify-only handling vs deletion of parsePlanTaskVerifyOnly** — consistent PROVIDED the
  grader infers verify-only from plan intent, not the deleted marker parser. Noted in story 3; CLEAN.

## Conflict: Progress telemetry (#757) depends on deleted derivation
**Stories involved:** "Stamps survive as telemetry" vs "Per-task evidence-ledger GATING is deleted"
**Type:** state-conflict / resource-contention (shared task-status.json resolved-count)
**Severity:** degrading (resolved)

**Description:** `countResolvedTasks` counts `task-status.json` rows marked `completed`. Those rows
are flipped to `completed` today by `applyDerivedCompletion`/`reconcileStatusFromStamps` — which the
deletion story removes. As written, "progress counts still update (#757)" would be false: with the
derivation gone, no code marks a row resolved and progress would freeze at 0. The telemetry story
did not name a surviving mechanism (confidence this is a real regression if unaddressed ~85%).

**Resolution Options:**
1. Source the resolved-count from `Task:`-trailered commits (count distinct plan task-ids with a
   trailered commit) — pure telemetry off surviving stamps, no corroboration/reachability. (least
   disruptive)
2. Have `conduct task done` flip the row to completed (now allowed since completion is no longer gate
   authority).
3. Re-open architecture to redesign progress accounting entirely. (most disruptive — unwarranted)

**Recommendation:** Option 1 (with Option 2 permitted as a complement). It keeps #757 working using
only surviving telemetry and reintroduces none of the wedge-prone derivation.

**Resolution applied:** The "Stamps survive as telemetry" story was amended to require the
resolved-count come from `Task:`-trailered commits (and/or `conduct task done`), explicitly
independent of the deleted derivation, with a Done-When test. Recorded as a follow-up on
adr-2026-07-21-demote-task-stamping-to-telemetry. No ADR superseded (the "keep telemetry" decision
stands; only its mechanism is named).

## Re-check
After the amendment: 0 blocking, 0 unresolved degrading. PASS.
