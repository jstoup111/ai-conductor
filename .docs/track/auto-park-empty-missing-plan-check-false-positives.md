# Track: auto-park empty/missing-plan check false-positives on a completed build with a present plan

Track: technical

## Rationale

This is an internal correctness fix to a single plan-parsing helper in the daemon's build-completion
gate. `parsePlanTaskPaths` (`src/conductor/src/engine/autoheal.ts:1077`) is the sole source of the
task-id set that both `deriveCompletion` (evidence stamping) and the build completion predicate
(`CUSTOM_COMPLETION_PREDICATES.build` in `src/conductor/src/engine/artifacts.ts`) rely on. Its
task-header regex requires the id to be terminated by a colon (`:`) or end-of-line, but plans are
routinely authored as `### Task N — Title` with an **em-dash** separator and no colon. Those plans
parse to **zero** task ids, so the gate reports `no tasks in plan`, the daemon's `emptyPlan`
derivation (`conductor.ts:2115`) flips true, and a fully-completed 5/5 build is auto-parked as
`empty/missing plan` (jstoup111/ai-conductor#578; the same zero-id parse also empties
`deriveCompletion` → the empty `task-evidence.json` `evidenceStamps` observed in the incident).

There is no user-facing product requirement, no new command, no new config key, and no new
functional surface. It widens one regex to accept the em-dash/en-dash title separator the plan
authoring convention already uses (101/121 plans in the corpus use the colon form the regex
accepts; 7 use the em-dash form it rejects). Acceptance criteria for this behavior belong in
stories, not a PRD. → **technical track** (skip `/prd`).
