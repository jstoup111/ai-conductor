**Status:** Accepted

# Existing-task remediation restage survives the Task-trailer completion union (#2196)

Track: technical · Tier: M · Source: jstoup111/ai-conductor#2196
Architecture: `.docs/decisions/architecture-review-2026-09-06-existing-task-remediation-restage-is-undone-by-the.md`

## Context

An existing-task remediation binds a finding to a plan task that was already built. The route
flips that task's `.pipeline/task-status.json` row to `pending`, but the shared task-resolution
fold unions rows with every `Task:` trailer on the branch, so the earlier lap's trailer resolves
the task again, the build completion predicate reports done, and the #647 D1 guard halts
`derived-already-complete`. Every existing-task round on a previously built task dead-ends.

The approved design records, per reopened task id, the number of trailered commits it already
had at restage time (its **watermark**) at `<mainRoot>/.daemon/restage-watermarks/<plan-stem>.json`
— outside the worktree, so it survives worktree recreation — and the fold resolves a watermarked
id from trailers only once that count has grown. Rows keep their meaning.

Scope reconciliation with accepted stories (see `.docs/conflicts/2026-09-06-existing-task-remediation-restage-is-undone-by-the.md`):
the #859 criterion "a trailered id is in the resolved set" (`trailer-union-build-completion.md`
Story 1) and the #773 progress-count identity ("the count of distinct plan task-ids carried by
`Task:`-trailered commits", `demote-task-stamping-to-telemetry.md`) are narrowed for ids an
existing-task remediation explicitly reopened, and only until a new trailered commit lands; every
other id keeps both criteria verbatim. The advisory per-task commit floor
(`per-task-commit-floor.ts`) scans trailers directly and is deliberately not watermarked. Because the watermark lives at the main root, a recreated worktree keeps its reopened tasks
unresolved and `mid-loop-pipeline-wipe-549.md` Story 6 ("the run does not silently converge green
on empty state") holds without a new halt.

## Story 1: A restaged bound task is dispatchable build work

As the remediation route, I want a restaged task to count as open work so that an existing-task
round dispatches a build instead of halting `derived-already-complete`.

### Happy Path

- **Given** a plan task with a `Task:` trailer from an earlier lap and a `completed` or `pending` row, **When** an existing-task remediation binds a finding to it and restages, **Then** the build completion predicate reports that task unresolved and the round routes to `build` with the remediation hint instead of halting.
- **Given** two bound tasks restaged in the same round, one with three prior trailered commits and one with one, **When** the completion predicate runs, **Then** both are unresolved and the completion-miss reason names both ids.

### Negative Paths

- **Given** a bound id that is absent from `task-status.json`, **When** the restage runs, **Then** the route halts `needs-human` naming the absent id and records no watermark for any id in that round.
- **Given** a watermark file for this feature that is present but unparseable, **When** the fold resolves any task id the rows still show as `pending`, **Then** that id is treated as unresolved from trailers, a diagnostic naming the corrupt file is logged, and the corrupt file is never read as "no watermarks".
- **Given** a restage whose main repo root cannot be resolved (no git common dir), **When** the record helper runs, **Then** the route halts `needs-human` naming the unresolvable root and writes neither rows nor watermark.
- **Given** a round whose bound task already sits at `pending` with no trailer at all, **When** the restage runs, **Then** the watermark records a count of zero and the task is unresolved exactly as before — the watermark never makes an unresolved task resolved.

### Done When

- [ ] A unit test over the build completion predicate shows a task with a prior trailer and a recorded watermark equal to its current trailer count is reported unresolved in the `unresolved` reason string.
- [ ] A unit test over the remediation route shows an existing-task round on a previously trailered task returns `kind: 'route', target: 'build'` rather than a `derived-already-complete` halt.
- [ ] A unit test shows a corrupt watermark file yields the unresolved reading plus a logged diagnostic naming the file, and an absent file yields the pre-change resolution.
- [ ] A unit test shows an unresolvable main root makes the restage return `kind: 'failed'` and the route halt `needs-human` with no watermark written.

## Story 2: A restaged task returns to resolved only through post-restage work

As the build loop, I want a reopened task to resolve again only when new work lands so that a
remediation round cannot close on the trailer history it was opened against.

### Happy Path

- **Given** a restaged task whose watermark records two trailered commits, **When** a new commit carrying `Task: <id>` lands on the branch so the count becomes three, **Then** the fold resolves the id and the build completion predicate no longer lists it.
- **Given** a restaged task, **When** the `Done when:` close contract flips its row to `completed`, **Then** the fold resolves the id from the row regardless of its trailer count.
- **Given** a restaged task and a canonical-alias trailer (`Task: T16` for plan id `16`), **When** a new commit carries the alias after the restage, **Then** the alias counts toward the same id and the task resolves.

### Negative Paths

- **Given** a restaged task whose trailer count is unchanged since the watermark, **When** the fold runs on any later evaluation in the same worktree, **Then** the id stays unresolved no matter how many pre-restage trailers exist.
- **Given** a restaged task whose branch was rewritten so its trailer count is now lower than the watermark, **When** the fold runs, **Then** the id stays unresolved until a new trailered commit raises the count above the watermark, and it is never reported resolved because the count merely changed.
- **Given** a worktree removed and recreated from its branch after a restage, so `task-status.json` must be rebuilt from trailers, **When** the reconstruction and then the fold run in the new worktree, **Then** the reopened task is restored as `pending` rather than `completed`, the watermark is read from the main root, and the id is reported unresolved until a new trailered commit lands — the reconstruction never silently converges the reopened task.
- **Given** a task that was never restaged, **When** the fold runs, **Then** no watermark is consulted and its resolution is byte-identical to the pre-change fold.

### Done When

- [ ] A unit test over the fold shows a watermarked id with an unchanged count is excluded, with a count grown by one is included, and with a `completed` row is included regardless of count.
- [ ] A unit test shows a lowered count leaves the id excluded and a later commit that exceeds the watermark includes it.
- [ ] An integration test recreates the worktree from its branch after a restage and shows the reopened id still unresolved on the first evaluation, with the watermark read from the main root.

## Story 3: The #859 fresh-build routing is unchanged

As the build loop, I want a fresh build whose rows were never flipped to still hand off on
trailer evidence so that the false `no_task_progress` stall fixed by #859 does not return.

### Happy Path

- **Given** a plan whose every task carries a `Task:` trailer and whose `task-status.json` rows are all `pending`, with no watermark recorded, **When** the build completion predicate runs, **Then** it reports done and the loop hands off to `build_review`.
- **Given** the same fresh build, **When** the stall circuit breaker samples `countResolvedTasks` before and after a dispatch that added a trailered commit, **Then** the count rises by one and no stall is declared.

### Negative Paths

- **Given** a fresh build with two tasks lacking trailers and no watermark recorded, **When** the build completion predicate runs, **Then** it reports not done naming those two ids, exactly as before this change.
- **Given** a fresh build whose `task-status.json` is missing, **When** the build completion predicate runs, **Then** it reports not done with the existing "missing task-status.json" reason and consults no watermark.

### Done When

- [ ] The existing #859 regression fixture (all tasks trailer-resolved, zero `completed` rows ⇒ done) passes unmodified.
- [ ] The existing genuine-stall fixture (tasks unresolved, count unmoved ⇒ `no_task_progress`) passes unmodified.

## Story 4: The #647 D1 no-op guard still fires on a genuinely empty round

As the remediation route, I want a round that stages nothing new to keep halting
`derived-already-complete` so that the loop never enters a build that cannot produce rework.

### Happy Path

- **Given** a remediation round whose fixes append or upsert only task ids that are already evidence-complete and restage nothing, **When** the D1 guard recomputes build completion, **Then** it halts with the existing `derived-already-complete` kickback outcome and gap ledger.

### Negative Paths

- **Given** a remediation round that restaged at least one bound task, **When** the D1 guard recomputes build completion, **Then** it does not halt and the round routes to `build`.
- **Given** a consolidated manual-test FAIL round that also carries an existing-task gap, **When** the route runs, **Then** the bound ids are restaged and watermarked exactly as in any other round, and only the D1 completion recheck is skipped, because that round's dispatchable work is the FAIL itself.

### Done When

- [ ] The existing D1 no-op guard test (`conductor-remediation-noop-guard`) passes unmodified for the nothing-staged shape.
- [ ] A unit test shows the restaged shape bypasses the halt and returns a `build` route with `kickbackOutcome` absent.

## Story 5: The restage is recorded durably and observable on the event spine

As an operator reading `.pipeline/events.jsonl`, I want to see which task ids a remediation
round reopened and at what trailer count so that a later `derived-already-complete` or stall can
be explained without inspecting engine-state by hand.

### Happy Path

- **Given** an existing-task round that restages ids 16 and 21, **When** the restage completes, **Then** exactly one `kickback` event for that round carries an additive field listing `16` and `21` with their recorded trailer counts, and `<mainRoot>/.daemon/restage-watermarks/<plan-stem>.json` holds the same ids and counts.
- **Given** a recorded watermark for id 16, **When** a later round restages id 19 only, **Then** the watermark file holds both ids and the earlier count for 16 is not overwritten.
- **Given** a recorded watermark, **When** the daemon re-kicks the feature in the same worktree, **Then** the watermark is read back unchanged and the fold applies it on the first evaluation.

### Negative Paths

- **Given** no watermark file exists for the feature's stem, **When** it is read, **Then** the reader returns an empty watermark map, and `.pipeline/engine-state.json` (including `appendedRemediationTaskIds`) is never written by any watermark operation.
- **Given** two features with different plan stems in sibling worktrees of the same main root, **When** each restages, **Then** each writes only its own stem's file and neither read returns the other's ids.
- **Given** a restage that fails before writing task-status, **When** the route halts, **Then** no `kickback` event carries a restage field and engine-state gains no watermark.
- **Given** two consecutive restages of the same id in one round, **When** the record helper runs, **Then** it writes the id once with the count observed at the first restage and emits one event field entry, not two.

### Done When

- [ ] A unit test over the watermark helpers shows record-then-read round-trips `id → count` at `<mainRoot>/.daemon/restage-watermarks/<stem>.json`, leaves `engine-state.json` untouched, tolerates an absent file, and isolates two stems.
- [ ] A test over the remediation route asserts the emitted `kickback` event carries the restaged ids and counts exactly once for the round, and that a failed restage emits none.
- [ ] `src/conductor/src/types/events.ts` gains only an additive optional field on the existing `kickback` member; the sink registry compiles with no new declaration.

## Story 6: No-op baselines and stall counts are captured after the restage

As the build loop, I want the round's resolved-count baselines taken after the watermark is
recorded so that the deliberate drop in resolved tasks is never misread as progress or stall.

### Happy Path

- **Given** a round that restages one task with three prior trailered commits, **When** the #647 no-op baseline is captured, **Then** its `resolvedCount` equals the post-restage count (the restaged id excluded) and a build that adds one trailered commit for that id is classified `did-work`.
- **Given** the same round, **When** the stall circuit breaker samples the count before and after a dispatch that added the trailered commit, **Then** it observes movement of exactly one and declares no stall.

### Negative Paths

- **Given** the same round, **When** a build attempt adds no commit at all, **Then** the breaker observes no movement and applies its existing stall handling — the restage itself is never counted as movement.
- **Given** a round whose baseline was taken before the restage, **When** the post-restage count is compared, **Then** the drop is not reported as `did-work` and the `build-progress-watcher` reports the restaged id as pending, in agreement with the fold.
- **Given** a durable progress sample taken before the restage (`lastResolvedCount` in `task-evidence.json`, or the #280 `noEvidenceAttempts` counter's `resolvedTasksBefore`), **When** the round restages a task, **Then** that sample is refreshed to the post-restage count before the next build attempt is measured, so the deliberate drop is never recorded as zero progress, regression, or re-kick ineligibility.

### Done When

- [ ] A unit test over the remediation route shows `pendingNoOpBaselines` for the round is recorded with the post-restage `countResolvedTasks` value.
- [ ] A unit test over `build-progress-watcher` shows a restaged id is reported pending while a non-restaged trailered id is reported resolved from the same trailer scan.
- [ ] A unit test shows `lastResolvedCount` in `task-evidence.json` equals the post-restage count after a round restages a trailered task, and a following attempt that adds one trailered commit is classified as progress.
