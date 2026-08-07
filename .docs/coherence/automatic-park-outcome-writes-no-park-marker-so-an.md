# Coherence: Honest park termination boundary (#1328)

**Date:** 2026-08-06
**Tier:** M
**Track:** technical — the `fr` row class is omitted (no PRD; the requirement layer is the five
desired-outcome bullets carried on the intake, and the stories cite them as `O-N`).
**Outcome source:** the Desired-outcome bullets of jstoup111/ai-conductor#1328, carried into the
spec by the `.docs/intake/automatic-park-outcome-writes-no-park-marker-so-an.md` marker landed on
this branch.

| Row class | Cited id | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1 | covered | "After an error triage resolves to park, a park marker for that slug exists on disk, and the next backlog scan does not list the slug as dispatchable." Story 1 asserts both halves — the `auto-parked:` marker under the main repository root, and the eligibility exclusion that follows from it. |
| outcome | outcome-2 | story-2 | covered | "Whenever a HALT body claims the feature is parked for human inspection, that claim is true of the state on disk at that moment." Story 2 pins the note as derived from the marker write and asserts the observed write ordering, which is what makes the false claim unrepresentable rather than merely unlikely. |
| outcome | outcome-2 | story-3 | covered | Same outcome, failure half: Story 3 covers the case where the marker write fails, requiring the note to state the park failed and to omit the parked claim entirely. Without this row outcome-2 would hold only on the success path. |
| outcome | outcome-3 | story-5 | covered | "The reconciliation line reports the park that was just performed instead of parked=0." Story 5 asserts the sweep counts the auto-parked slug, and its amendment narrows the assertion to the open-issue case with the closed-issue `orphan` classification covered as a negative path. |
| outcome | outcome-4 | story-4 | covered | "A feature that errors but is not meant to be parked still dispatches normally on the next scan." Story 4 covers all three non-park termination sites independently and pins that the partition is driven by explicit caller intent rather than inferred from the returned status. |
| outcome | outcome-5 | story-6 | covered | "No feature can consume more than one automatic fix-session for the same unresolved setup failure without operator action." Story 6 asserts the fix-session invocation count stays at one across scans, a daemon restart, and worktree recreation. |
| story | story-1 | task-1 | covered | Characterization pins that no site writes a marker today, which is the baseline Task 7 flips for the triage-park site only. |
| story | story-1 | task-4 | covered | Marker write on park intent, including main-repository-root resolution from inside a worktree. |
| story | story-1 | task-7 | covered | Triage-park site wired to park intent; idempotent repeat park and concurrent distinct slugs; non-park triage kinds write nothing. |
| story | story-2 | task-5 | covered | Note derived from the write result, the ordering assertion on observed write sequence, and the `EEXIST` already-parked case rendering the ordinary parked line. |
| story | story-2 | task-3 | covered | Preserves `HALT.class = needs-human`, the resume procedure, and the triage-evidence block that Story 2's happy path also asserts. |
| story | story-3 | task-6 | covered | Park-write failure renders the failure line naming the error and the manual remedy, omits the parked claim, logs distinguishably, and does not throw. |
| story | story-4 | task-2 | covered | The non-park branch of the primitive: re-dispatch wording and no marker. |
| story | story-4 | task-8 | covered | All three non-park sites wired, `writeErrorHalt` removed, false-ship escalation and status preserved, operator-placed marker left untouched. |
| story | story-5 | task-9 | covered | Consumer-level assertions: eligibility exclusion, sweep count, provenance classification, re-kick skip without clearing HALT, and unpark recovery. |
| story | story-5 | task-10 | covered | The two reconciliation edge cases the conflict check surfaced — the zero-commit branch refusing with `record-missing` rather than deleting the park, and the closed-issue `orphan` classification. |
| story | story-6 | task-11 | covered | Fix-session call count across scans, restart durability, worktree-recreation durability, and re-park with a new reason. |
| task | task-1 | story-4 | covered | Characterizes all four termination sites' current outputs and the absence of any marker; the three non-park assertions must keep passing permanently. |
| task | task-2 | story-4 | covered | Introduces the primitive with the `park: false` branch only, leaving call sites unchanged. |
| task | task-3 | story-4 | covered | Preserves HALT class, resume procedure, and evidence rendering on the non-park path. |
| task | task-4 | story-1 | covered | Writes the durable marker on park intent and resolves the main repository root from a worktree path. |
| task | task-5 | story-2 | covered | Derives the note's first line from the write outcome and pins the marker-before-note ordering. |
| task | task-6 | story-3 | covered | Implements the loud park-write failure and keeps it out of the existing HALT-verification swallow. |
| task | task-7 | story-1 | covered | Wires the triage-park site, the only site whose behavior changes. |
| task | task-8 | story-4 | covered | Wires the three non-park sites and removes the old writer so the parked claim exists in one place reachable only behind a successful write. |
| task | task-9 | story-5 | covered | Asserts the existing consumers honor the new producer; test-only, no consumer code changes. |
| task | task-10 | story-5 | covered | Pins the guards that stop reconciliation from deleting a setup-failure park; test-only. |
| task | task-11 | story-6 | covered | Durability and fix-session accounting, plus the runbook update and the integrity suite run. |

## Coverage accounting

- **Outcomes:** 5 of 5 cited. `outcome-2` carries two rows because its success and failure halves
  live in different stories; every other outcome maps to exactly one story.
- **Stories:** 6 of 6 cited, each by at least one task. Both path types are declared for every
  story — the happy paths through Tasks 2, 4, 5, 6, 8, 9 and 11, and the negative paths through
  Tasks 1, 3, 7, 10 and the negative-path citations recorded in the plan's coverage note for
  Stories 2, 3 and 6.
- **Tasks:** 11 of 11 cited, each resolving to exactly one story. No task exists without a story,
  and no story is left without an implementing task.

## Notes on deliberate non-coverage

Two items are recorded as out of scope in the plan and are intentionally absent from this mapping,
so their absence is a decision rather than a gap:

- The unresolved question of why `.pipeline/HALT` was missing in the reported incident. It is an
  ADR follow-up action routed to a separate intake; no outcome on #1328 depends on it, because the
  marker this spec writes lives outside every worktree.
- Any change to `park-reconciliation.ts`'s counter chain or cleanup authority. The conflict check
  accepted two degrading behaviors there rather than widening into a subsystem that unmerged spec
  work is already reworking; Task 10 pins the existing guards instead of altering them.
