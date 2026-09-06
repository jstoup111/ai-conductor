# Implementation Plan: Existing-task remediation restage survives the Task-trailer union (#2196)

**Date:** 2026-09-06
**Design:** .docs/architecture/existing-task-remediation-restage-is-undone-by-the.md
**Stories:** .docs/stories/existing-task-remediation-restage-is-undone-by-the.md
**Conflict check:** Clean as of 2026-09-06
**Source issue:** jstoup111/ai-conductor#2196
**Track:** technical · **Tier:** M

## Summary

Record a per-task trailer-count watermark when an existing-task remediation reopens a plan task,
store it at the main repo root so it survives worktree recreation, and make the shared
task-resolution fold honor it so the reopened task is dispatchable build work until new work
lands. 15 tasks.

## Technical Approach

- **New module `src/conductor/src/engine/restage-watermark.ts`.** Owns the watermark file
  `<mainRoot>/.daemon/restage-watermarks/<plan-stem>.json` (`{ version: 1, tasks: { "<id>": <count> } }`).
  Path resolution reuses `resolveMainRepoRoot` from `park-marker.ts` (the park-marker carrier for
  per-feature state that must outlive a worktree). Reads are tolerant and three-valued: `absent`
  (no file → empty counts), `ok`, `corrupt` (present but unparseable/wrong shape). Writes are
  atomic temp+`rename`, merging with the existing file so a later round adds ids without
  overwriting an earlier id's count. Local pattern to replicate: `park-marker.ts` (main-root
  resolution, per-stem file under `.daemon/`, atomic write, absent-is-empty read) and the
  `recordAppendedRemediationTaskIds` / `readAppendedRemediationTaskIds` pair in `artifacts.ts`
  (string-id filtering, merge-on-record). Allowed variation: value shape is `id → count`; the
  corrupt rung abstains loudly instead of failing open. Search hints: `resolveMainRepoRoot`,
  `recordAppendedRemediationTaskIds`.
- **Fold change in `task-progress.ts`.** `distinctTaskTrailerIds` becomes a per-id commit count
  (`Map<planId, number>`: number of distinct commits whose `Task` trailers canonical-match the plan
  id — a commit counts once per id however many trailers it carries). `resolveTaskIds` resolves the
  feature stem from `.pipeline/engine-state.json` `activePlanPath` (same read `getActivePlanPath`
  performs; no path → no watermarks), reads the watermark file, and includes a watermarked id from
  trailers only when `count > watermark`. Rows (`completed`/`skipped`) resolve exactly as today.
  A `corrupt` read excludes every plan id the rows leave unresolved from trailer resolution and
  logs one `[task-progress]` diagnostic per stem per process. No sha is stored or compared
  (adr-2026-07-23 Decision 4 is preserved by construction).
- **Restage seam in `conductor.ts`.** `restageExistingRemediationTaskStatuses` computes the
  per-id counts, records the watermark (failing closed before any row write when the main root
  cannot be resolved), then flips rows and re-seeds as today. It returns the recorded
  `{ id, trailerCount }` list; `planRemediation`'s `route` result carries it as `restaged`, and
  both kickback emit sites forward it as an additive optional `restaged` field on the existing
  `kickback` event (no new event member, no sink declaration).
- **Reconstruction honors the watermark.** A recreated worktree's `seedTaskStatus` reconstruction
  restores trailer-proven tasks as `completed` rows; for a watermarked id whose count has not
  grown it restores `pending` instead, so the row branch of the fold cannot re-close a reopened
  task that the worktree loss would otherwise have silently converged. Ordinary re-seeds are
  untouched.
- **Baselines after the restage.** The #647 no-op baseline (`pendingNoOpBaselines`) is captured
  after the watermark is recorded so its `resolvedCount` is the post-restage count; the durable
  `lastResolvedCount` in `task-evidence.json` is rewritten to the same value. The build loop's
  `resolvedTasksBefore` is already sampled at build-step entry (after the rewind), so the stall
  breaker needs no change — Task 13 proves it.
- **Sequencing.** Store module first (Tasks 1–3), fold second (4–7), restage seam and route
  third (8–12), then watcher/breaker proof (13), preserved-fixture verification (14), and the
  worktree-recreation integration proof (15). Tasks 1–3 and 4 are independent of each other.

## Prerequisites

- None. No migrations, config keys, or new packages.

## Tasks

### Task 1: Watermark store — record and read round-trip at the main root
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing test in `src/conductor/test/engine/restage-watermark.test.ts`: in a temp git repo with a linked worktree, `recordRestageWatermarks(worktreeRoot, 'stem-a', [{ id: '16', trailerCount: 3 }, { id: '21', trailerCount: 1 }])` then `readRestageWatermarks(worktreeRoot, 'stem-a')` returns `{ kind: 'ok', tasks: { '16': 3, '21': 1 } }`, and the file exists at `<mainRoot>/.daemon/restage-watermarks/stem-a.json` (main root, not the worktree).
2. Verify test fails (RED).
3. Implement `src/conductor/src/engine/restage-watermark.ts`: `restageWatermarkPath(mainRoot, stem)`, `readRestageWatermarks(projectRoot, stem)` returning `{ kind: 'absent' } | { kind: 'ok', tasks } | { kind: 'corrupt', detail }`, `recordRestageWatermarks(projectRoot, stem, entries)` resolving the main root via `resolveMainRepoRoot` (park-marker pattern: per-stem file under `.daemon/`, `mkdir -p`, temp+`rename` write). File shape `{ version: 1, tasks: Record<string, number> }`.
4. Verify test passes (GREEN).
5. Commit: "feat(engine): restage watermark store at the main repo root".

**Done when:**
- `restage-watermark.test.ts` "record then read round-trips id → count at the main root" passes, asserting the file path starts with the main root and not the worktree path.
- `readRestageWatermarks` on a stem with no file returns `{ kind: 'absent' }` (asserted in the same test file).
- The module imports `resolveMainRepoRoot` from `./park-marker.js` and performs no `git` call of its own.

**Files likely touched:**
- `src/conductor/src/engine/restage-watermark.ts` — new module
- `src/conductor/test/engine/restage-watermark.test.ts` — new test

**Dependencies:** none

### Task 2: Watermark store — merge without overwrite, stem isolation, engine-state untouched
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests in `restage-watermark.test.ts`: (a) record `16 → 3`, then record `19 → 2` for the same stem: read returns both and `16` is still `3`; recording `16 → 5` afterwards leaves `16` at `3` (first restage wins). (b) Two stems `stem-a` and `stem-b` under one main root: each read returns only its own ids. (c) `.pipeline/engine-state.json` in the worktree, seeded with `appendedRemediationTaskIds: ['rem-1']`, is byte-identical before and after any record/read.
2. Verify tests fail (RED).
3. Implement merge-on-record (existing id keeps its count; new ids are added) and per-stem file naming; the module never opens `.pipeline/engine-state.json`.
4. Verify tests pass (GREEN).
5. Commit: "feat(engine): watermark record merges per stem and never touches engine-state".

**Done when:**
- Test "a later round adds ids without overwriting an earlier count" passes: after recording `16→3`, `19→2`, `16→5`, the read is `{ '16': 3, '19': 2 }`.
- Test "two stems under one main root are isolated" passes with disjoint reads.
- Test "engine-state.json is byte-identical across record and read" passes.

**Files likely touched:**
- `src/conductor/src/engine/restage-watermark.ts` — merge and isolation
- `src/conductor/test/engine/restage-watermark.test.ts` — tests

**Dependencies:** 1

### Task 3: Watermark store — corrupt file abstains, unresolvable root fails the record
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `restage-watermark.test.ts`: (a) a file containing `{ not json` reads as `{ kind: 'corrupt', detail }` with `detail` naming the file path; (b) a file with `{ "version": 1, "tasks": "nope" }` reads as `corrupt`; (c) `recordRestageWatermarks` with a `resolveMainRepoRoot` injection that throws returns `{ kind: 'failed', detail }` and creates no file.
2. Verify tests fail (RED).
3. Implement shape validation (version `1`, `tasks` object of non-negative integers keyed by strings matching the shared task-id grammar) and the injectable root resolver (`deps?: { resolveMainRepoRoot }`) so a resolution error is returned, not thrown.
4. Verify tests pass (GREEN).
5. Commit: "feat(engine): watermark reads distinguish corrupt from absent; record fails closed on an unresolvable root".

**Done when:**
- Tests "malformed JSON reads as corrupt" and "wrong shape reads as corrupt" pass, each asserting `detail` contains the file path.
- Test "record returns failed and writes nothing when the main root cannot be resolved" passes: the result is `{ kind: 'failed' }` and `.daemon/restage-watermarks/` does not exist afterwards.
- `readRestageWatermarks` never returns `ok` with an empty `tasks` for a present-but-invalid file.

**Files likely touched:**
- `src/conductor/src/engine/restage-watermark.ts` — validation and injected resolver
- `src/conductor/test/engine/restage-watermark.test.ts` — tests

**Dependencies:** 1

### Task 4: Fold — per-id trailer commit counts replace the flattened id set
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing test in `src/conductor/test/engine/task-progress.test.ts`: export `countTaskTrailerCommits(projectRoot, planIds)`; in a temp repo with commits carrying `Task: 16`, `Task: 16`, `Task: T16` (alias), one commit carrying both `Task: 16` and `Task: 21` trailers, expect `{ '16': 4, '21': 1 }`.
2. Verify test fails (RED).
3. Implement in `src/conductor/src/engine/task-progress.ts`: iterate `listCommitsWithTrailers` records once; for each commit, canonical-match each `Task` trailer value against `planIds` (existing `canonicalTaskId` alias rule) and increment each matched plan id at most once per commit. Rewrite `resolveTaskIds`'s trailer branch to use `count > 0` from this map, keeping every existing `resolveTaskIds`/`countResolvedTasks` test green unchanged. Fail-soft on git error → empty map.
4. Verify tests pass (GREEN), including the existing `describe('resolveTaskIds')` and parity block.
5. Commit: "refactor(engine): count Task trailer commits per plan id in the shared fold".

**Done when:**
- Test "counts distinct commits per plan id, alias-matched, once per commit" passes with `{ '16': 4, '21': 1 }`.
- Every pre-existing test in `task-progress.test.ts` passes without modification.
- `distinctTaskTrailerIds` no longer exists; `resolveTaskIds` derives trailer resolution from the count map.

**Files likely touched:**
- `src/conductor/src/engine/task-progress.ts` — count map
- `src/conductor/test/engine/task-progress.test.ts` — tests

**Dependencies:** none

### Task 5: Fold — a watermarked id resolves from trailers only when its count has grown
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `task-progress.test.ts` (temp linked worktree with `.pipeline/engine-state.json` `activePlanPath` naming a plan whose stem is `stem-a`): (a) id `16` has two trailered commits and watermark `16 → 2`, row `pending` → `resolveTaskIds` excludes `16`; (b) add a third commit `Task: 16` → includes `16`; (c) watermark `16 → 2`, count still 2, but row `completed` → includes `16`; (d) alias: third commit carries `Task: T16` → includes `16`.
2. Verify tests fail (RED).
3. Implement: `resolveTaskIds` reads `activePlanPath` from `.pipeline/engine-state.json` (tolerant: missing file/field → no watermark lookup), derives `planStem`, calls `readRestageWatermarks`; for an `ok` read, a plan id present in `tasks` is trailer-resolved only when `count > tasks[id]`. Row resolution is computed first and never filtered.
4. Verify tests pass (GREEN).
5. Commit: "feat(engine): resolveTaskIds honors restage watermarks by trailer-count growth".

**Done when:**
- Tests "unchanged count keeps a watermarked id unresolved", "one new trailered commit resolves it", "a completed row resolves regardless of count", and "an alias trailer after the restage resolves it" all pass.
- The watermark lookup is skipped (no file read attempted) when `engine-state.json` has no `activePlanPath`, asserted via a spy on `readRestageWatermarks`.

**Files likely touched:**
- `src/conductor/src/engine/task-progress.ts` — watermark-aware trailer branch
- `src/conductor/test/engine/task-progress.test.ts` — tests

**Dependencies:** 3, 4

### Task 6: Fold — lowered counts stay unresolved; never-restaged ids and missing status are unchanged
**Story:** 2
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `task-progress.test.ts`: (a) watermark `16 → 3` but only one trailered commit remains (rewritten branch) → `16` excluded; two more commits (count 3) → still excluded; a fourth (count 4) → included. (b) Plan ids `1,2` with trailers and no watermark file: `resolveTaskIds` result equals the result computed with the watermark read stubbed to `absent` (byte-identical set). (c) `checkStepCompletion('build')` (via `artifacts.test.ts` existing helper) with `task-status.json` missing returns not done with the existing "missing .pipeline/task-status.json" reason and `readRestageWatermarks` is never called.
2. Verify tests fail (RED).
3. Implement: strict `count > watermark` (no `!=`); ensure the missing-status early return in the build predicate precedes any fold call (already true — assert it).
4. Verify tests pass (GREEN).
5. Commit: "test(engine): watermark never resolves on a lowered count; untouched paths stay identical".

**Done when:**
- Test "a lowered trailer count stays unresolved until it exceeds the watermark" passes for counts 1, 3 (excluded) and 4 (included).
- Test "never-restaged ids resolve identically with and without a watermark file" passes.
- Test "missing task-status.json returns the existing reason without consulting watermarks" passes with the spy uncalled.

**Files likely touched:**
- `src/conductor/src/engine/task-progress.ts` — strict comparison
- `src/conductor/test/engine/task-progress.test.ts` — tests
- `src/conductor/test/engine/artifacts.test.ts` — missing-status assertion

**Dependencies:** 5

### Task 7: Fold — a corrupt watermark file abstains loudly, once per stem
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing test in `task-progress.test.ts`: watermark file for the active stem contains `{ not json`; plan ids `16` (row `pending`, two trailers) and `21` (row `completed`, no trailers); `resolveTaskIds` returns `{ '21' }` only; `console.warn` (spied) is called exactly once across three consecutive `resolveTaskIds` calls with a message containing `[task-progress]`, the file path, and `corrupt`.
2. Verify test fails (RED).
3. Implement: on `kind: 'corrupt'`, exclude every plan id from trailer resolution (rows still resolve), and emit the diagnostic through a module-level once-per-stem set (`resetRestageWatermarkDiagnostics()` exported for tests).
4. Verify test passes (GREEN).
5. Commit: "feat(engine): corrupt restage watermark abstains from trailer resolution with a warn-once diagnostic".

**Done when:**
- Test "corrupt watermark file excludes trailer resolution and warns once" passes: resolved set is `{ '21' }`, `console.warn` call count is 1 after three evaluations.
- The diagnostic text contains the watermark file path and the word `corrupt`.
- An `absent` read produces no diagnostic (asserted in the same test with a fresh stem).

**Files likely touched:**
- `src/conductor/src/engine/task-progress.ts` — corrupt handling and warn-once
- `src/conductor/test/engine/task-progress.test.ts` — tests

**Dependencies:** 5

### Task 8: Restage seam records the watermark before touching rows
**Story:** 1
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/engine/conductor-restage-watermark.test.ts` (reuse the on-disk fixture style of `conductor-remediation-noop-guard.test.ts`: temp git repo, plan file, `task-status.json`, `engine-state.json` with `activePlanPath`): (d) a bound id absent from `task-status.json` returns `{ kind: 'failed' }` naming it and no watermark file is written; (e) a bound id with a `pending` row and no trailer is recorded at count `0` and stays unresolved afterwards; (a) restaging ids `16` (two trailered commits) and `21` (one) writes `<mainRoot>/.daemon/restage-watermarks/<stem>.json` with `{ '16': 2, '21': 1 }`, flips both rows to `pending`, and returns `{ kind: 'restaged', watermarks: [{ id: '16', trailerCount: 2 }, { id: '21', trailerCount: 1 }] }`; (b) restaging `16` twice in one round records `16` once at the first count and returns one entry; (c) with the main-root resolver injected to throw, the result is `{ kind: 'failed', detail }` naming the root, `task-status.json` is byte-identical, and no watermark file exists.
2. Verify tests fail (RED).
3. Implement in `restageExistingRemediationTaskStatuses`: compute counts with `countTaskTrailerCommits` for the bound ids, call `recordRestageWatermarks(projectRoot, planStem(planPath), entries)`; on `failed` return `{ kind: 'failed' }` before any row write; otherwise flip rows and `seedTaskStatus` as today and return the recorded entries. The caller already maps `failed` to a `needs-human` halt.
4. Verify tests pass (GREEN).
5. Commit: "feat(engine): existing-task restage records a trailer-count watermark at the main root".

**Done when:**
- Test "restage records watermarks and flips rows" passes with the exact file contents `{ '16': 2, '21': 1 }` and both rows `pending`.
- Test "a repeated id in one round is recorded once" passes.
- Test "unresolvable main root fails the restage before any row write" passes: result `kind: 'failed'`, `task-status.json` unchanged, no `.daemon/restage-watermarks/` directory.
- Test "an absent bound id fails the restage and writes no watermark" passes with the id named in `detail`.
- Test "a bound id with no trailer is recorded at count 0 and stays unresolved" passes.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — `restageExistingRemediationTaskStatuses`
- `src/conductor/test/engine/conductor-restage-watermark.test.ts` — new test

**Dependencies:** 2, 3, 4

### Task 9: Remediation route dispatches a build for a restaged task; the no-op guard still fires otherwise
**Story:** 1
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `conductor-remediation-noop-guard.test.ts` (existing fixture): (a) plan task `16` with a trailered commit and a `completed` row; an existing-task gap bound to `16` → `planRemediation` returns `kind: 'route', target: 'build'` with `kickbackOutcome` absent and the hint naming the gap; (b) two bound tasks `16` and `19` → route, and the completion-miss reason recorded in evidence names both ids; (c) the existing "idempotent-upsert … already evidence-complete → halt" and "empty-tasks … → halt" cases still halt with `kickbackOutcome: 'derived-already-complete'` (unmodified); (d) a consolidated manual-test FAIL round carrying an existing-task gap: rows restaged, watermark file written, D1 recheck skipped, route to `build`.
2. Verify the new tests fail (RED).
3. Implement nothing beyond Tasks 5 and 8 unless RED reveals ordering: the guard's `checkStepCompletion('build')` after the restage now sees the watermarked ids unresolved.
4. Verify tests pass (GREEN).
5. Commit: "test(engine): existing-task rounds route to build; the D1 no-op guard is preserved".

**Done when:**
- Test "existing-task round on a trailered task routes to build" passes: `kind: 'route'`, `target: 'build'`, no `kickbackOutcome`.
- Test "two bound ids both unresolved after restage" passes with both ids in the evidence string.
- The four pre-existing `planRemediation D1` and `D3` tests in `conductor-remediation-noop-guard.test.ts` pass without modification.
- Test "consolidated FAIL round restages and watermarks with the D1 recheck skipped" passes: watermark file present, route target `build`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — only if RED reveals an ordering defect
- `src/conductor/test/engine/conductor-remediation-noop-guard.test.ts` — tests

**Dependencies:** 8

### Task 10: The kickback event carries the restaged ids and counts exactly once
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing test in `conductor-restage-watermark.test.ts`: drive the remediation route through the daemon-mode loop fixture used by `conductor-remediation-noop-guard.test.ts` (or the smallest in-process harness that emits events) with an existing-task gap bound to `16`; assert exactly one emitted `kickback` event has `restaged: [{ id: '16', trailerCount: 2 }]`, and a run whose restage fails emits no `kickback` with a `restaged` field. Type-level test: `events.test.ts` (or the existing sink-registry test) compiles with no new `EVENT_SINKS` declaration.
2. Verify tests fail (RED).
3. Implement: add optional `restaged?: ReadonlyArray<{ id: string; trailerCount: number }>` to the `kickback` member in `src/conductor/src/types/events.ts`; `planRemediation`'s `route` result carries `restaged` from the restage return; both kickback emit sites in the validation-group and remediation consumers forward it.
4. Verify tests pass (GREEN).
5. Commit: "feat(events): kickback carries the restaged task ids and trailer counts".

**Done when:**
- Test "one kickback event per round carries restaged ids and counts" passes with exactly one matching event.
- Test "a failed restage emits no restaged field" passes.
- `src/conductor/src/types/events.ts` diff adds only an optional field to the existing `kickback` member; `EVENT_SINKS` is unchanged and the project type-checks.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — additive optional field
- `src/conductor/src/engine/conductor.ts` — route result and both emit sites
- `src/conductor/test/engine/conductor-restage-watermark.test.ts` — tests

**Dependencies:** 8

### Task 11: The #647 no-op baseline is captured after the restage
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing test in `conductor-restage-watermark.test.ts`: plan tasks `1,2,16` all trailered (count 3 resolved); an existing-task round restages `16`; assert the `pendingNoOpBaselines` entry for the source gate (exposed through the ledger written by `captureKickbackToBuildContext`, i.e. `resolvedBefore` in `.pipeline/kickback-ledger` for that gate) equals `2`, not `3`; then a commit `Task: 16` makes `classifyBuildProgress` report `did-work` (resolved +1).
2. Verify test fails (RED).
3. Implement: in `planRemediation`, move the `pendingNoOpBaselines` capture (`treeHash`, `resolvedCount: countResolvedTasks`) to after `restageExistingRemediationTaskStatuses` succeeds; on restage failure clear the baselines as today.
4. Verify test passes (GREEN).
5. Commit: "fix(engine): capture the kickback-to-build baseline after the existing-task restage".

**Done when:**
- Test "no-op baseline resolvedBefore equals the post-restage count" passes with `resolvedBefore === 2`.
- Test "a post-restage trailered commit classifies as did-work" passes.
- The pre-existing `planRemediation D3` discriminator test passes unmodified.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — baseline capture order
- `src/conductor/test/engine/conductor-restage-watermark.test.ts` — tests

**Dependencies:** 8

### Task 12: Durable lastResolvedCount is refreshed to the post-restage count
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing test in `conductor-restage-watermark.test.ts`: `task-evidence.json` seeded with `lastResolvedCount: 3`; restage `16` (post-restage count 2); assert `readLastResolvedCount(projectRoot)` (existing tolerant reader in `task-evidence.ts`) returns `2`; then one commit `Task: 16` and `countResolvedTasks` returns `3`, which the daemon's progress comparison (`current > lastResolvedCount`) reports as progress.
2. Verify test fails (RED).
3. Implement: after a successful restage in `planRemediation`, `createTaskEvidence` → set `lastResolvedCount = await countResolvedTasks(projectRoot)` → `write()`.
4. Verify test passes (GREEN).
5. Commit: "fix(engine): refresh lastResolvedCount after an existing-task restage".

**Done when:**
- Test "lastResolvedCount equals the post-restage count" passes with `2`.
- Test "one post-restage trailered commit exceeds the refreshed lastResolvedCount" passes (`3 > 2`).
- `task-evidence.json` retains every other field it held before the restage (asserted by deep-equal on the remaining keys).

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — evidence refresh after restage
- `src/conductor/test/engine/conductor-restage-watermark.test.ts` — tests

**Dependencies:** 8

### Task 13: Watcher and stall breaker read the watermarked fold
**Story:** 6
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests: (a) new `src/conductor/test/engine/build-progress-watcher-watermark.test.ts` — plan ids `16` (restaged, watermark equal to count) and `21` (trailered, not restaged), both rows `pending`: `readSnapshot(projectRoot)` reports `21` resolved and `16` pending, agreeing with `resolveTaskIds`. (b) In `task-progress.test.ts`: `countResolvedTasks` before/after one commit `Task: 16` on a watermarked `16` rises by exactly one; with no commit it is unchanged; on a fresh build (no watermark file) adding one trailered commit also rises by one.
2. Verify tests fail (RED).
3. Implement nothing new: both consumers already call the shared fold; the tests pin the contract.
4. Verify tests pass (GREEN).
5. Commit: "test(engine): watcher and stall-count consumers agree with the watermarked fold".

**Done when:**
- Test "watcher reports a restaged id pending and a non-restaged trailered id resolved" passes.
- Test "countResolvedTasks moves by exactly one per post-restage trailered commit and by zero without one" passes.
- Test "fresh build with no watermark file gains one per trailered commit" passes.

**Files likely touched:**
- `src/conductor/test/engine/build-progress-watcher-watermark.test.ts` — new test
- `src/conductor/test/engine/task-progress.test.ts` — tests

**Dependencies:** 5

### Task 14: #859 and genuine-stall fixtures pass unmodified
**Story:** 3
**Type:** verification
**Verify-only:** yes

**Steps:**
1. Run `src/conductor/test/acceptance/builds-stall-when-work-lands-without-task-trailer-.acceptance.test.ts` and the build-predicate cases in `src/conductor/test/engine/artifacts.test.ts` (all-trailered / zero-completed-rows ⇒ done; unresolved ids ⇒ not done naming them).
2. Confirm `git diff --stat main -- src/conductor/test/acceptance/builds-stall-when-work-lands-without-task-trailer-.acceptance.test.ts` is empty on this branch.
3. Record the result with an empty commit carrying `Task: 14` and `Evidence: skipped fixtures pass unmodified`.

**Done when:**
- The acceptance test file named in step 1 passes and shows zero changed lines against the merge base.
- `artifacts.test.ts` build-predicate cases "all tasks trailer-resolved ⇒ done" and "unresolved ids named in reason" pass unmodified.
- The genuine-stall path (`no_task_progress` when tasks are unresolved and the count is unmoved) passes in the same acceptance file.

**Files likely touched:**
- none

**Dependencies:** 5

### Task 15: A recreated worktree still sees the reopened task as unresolved
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing integration test in `conductor-restage-watermark.test.ts`: main repo with a feature branch checked out in a linked worktree; task `16` trailered and restaged (watermark recorded at the main root); remove the worktree's `.pipeline/` and `git worktree remove` it; re-create the worktree from the branch, write `engine-state.json` with the same `activePlanPath`, and run `seedTaskStatus` (reconstruction); assert the restored row for `16` is `pending` (not `completed`), `checkStepCompletion('build')` reports `16` unresolved, and after one commit `Task: 16` a re-seed plus the predicate report done. A non-restaged trailered task `21` is restored as `completed` as today.
2. Verify test fails (RED) — it fails today because reconstruction restores `16` as `completed` from its trailer.
3. Implement in `src/conductor/src/engine/task-seed.ts`: in the reconstruction branch only (`reconstructing === true`), read the watermarks for the plan stem (`readRestageWatermarks`) and the per-id trailer counts (`countTaskTrailerCommits`); a trailer-proven completion for a watermarked id whose count does not exceed its watermark is restored as `pending` instead of `completed`. Ordinary re-seeds (`reconstructing === false`) read nothing new. A `corrupt` watermark read restores every watermarked-candidate id as `pending` and logs the same `[task-progress]`-style diagnostic once.
4. Verify test passes (GREEN), and every existing `task-seed` reconstruction test passes unmodified.
5. Commit: "fix(engine): worktree reconstruction honors the restage watermark".

**Done when:**
- Test "recreated worktree keeps the reopened task unresolved until new work lands" passes: row `pending` and predicate not done before the new commit; done after it; `21` restored `completed`.
- Existing `task-seed` tests pass unmodified, and an ordinary (non-reconstructing) re-seed performs no watermark read (spy uncalled).
- `git diff` for `task-seed.ts` touches only the `reconstructing` branch of `seedTaskStatus`.

**Files likely touched:**
- `src/conductor/src/engine/task-seed.ts` — reconstruction consults watermarks
- `src/conductor/test/engine/conductor-restage-watermark.test.ts` — integration test
- `src/conductor/test/engine/task-seed.test.ts` — non-reconstructing re-seed assertion

**Dependencies:** 5, 8

## Task Dependency Graph

```
1 ──► 2 ──┐
1 ──► 3 ──┼──► 8 ──► 9
4 ────────┤     8 ──► 10
3,4 ─► 5 ─┤     8 ──► 11
      5 ─► 6    8 ──► 12
      5 ─► 7    5,8 ─► 15
      5 ─► 13
      5 ─► 14
```

Independent starts: 1 and 4. Ready after 1: 2, 3. Ready after 3 and 4: 5. Ready after 5: 6, 7, 13, 14. Ready after 8: 9, 10, 11, 12, 15.

## Integration Points

- After Task 8: an existing-task round writes the watermark file at the main root and flips rows — inspectable on disk.
- After Task 9: the remediation route dispatches a build for a previously built task (the issue's headline outcome) through `planRemediation`, the production entry point.
- After Task 10: `.pipeline/events.jsonl` shows the restaged ids on the `kickback` event.
- After Task 15: worktree recreation cannot silently converge a reopened task.

## Coverage Check

Every criterion is diff-local: each is decided by this feature's own engine code and tests inside its worktree; no commit outside the diff changes whether it holds.

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: **Given** a plan task with a `Task:` trailer from an earlier lap and a `completed` or `pending` row, **When** an existing-task remediation binds a finding to it and restages, **Then** the build completion predicate reports that task unresolved and the round routes to `build` with the remediation hint instead of halting. | 9 | "existing-task round on a trailered task routes to build" | diff-local |
| Story 1 happy: **Given** two bound tasks restaged in the same round, one with three prior trailered commits and one with one, **When** the completion predicate runs, **Then** both are unresolved and the completion-miss reason names both ids. | 9 | "two bound ids both unresolved after restage" | diff-local |
| Story 1 negative: **Given** a bound id that is absent from `task-status.json`, **When** the restage runs, **Then** the route halts `needs-human` naming the absent id and records no watermark for any id in that round. | 8 | "an absent bound id fails the restage and writes no watermark" | diff-local |
| Story 1 negative: **Given** a watermark file for this feature that is present but unparseable, **When** the fold resolves any task id the rows still show as `pending`, **Then** that id is treated as unresolved from trailers, a diagnostic naming the corrupt file is logged, and the corrupt file is never read as "no watermarks". | 7 | "corrupt watermark file excludes trailer resolution and warns once" | diff-local |
| Story 1 negative: **Given** a restage whose main repo root cannot be resolved (no git common dir), **When** the record helper runs, **Then** the route halts `needs-human` naming the unresolvable root and writes neither rows nor watermark. | 8 | "unresolvable main root fails the restage before any row write" | diff-local |
| Story 1 negative: **Given** a round whose bound task already sits at `pending` with no trailer at all, **When** the restage runs, **Then** the watermark records a count of zero and the task is unresolved exactly as before — the watermark never makes an unresolved task resolved. | 8 | "a bound id with no trailer is recorded at count 0 and stays unresolved" | diff-local |
| Story 2 happy: **Given** a restaged task whose watermark records two trailered commits, **When** a new commit carrying `Task: <id>` lands on the branch so the count becomes three, **Then** the fold resolves the id and the build completion predicate no longer lists it. | 5 | "one new trailered commit resolves it" | diff-local |
| Story 2 happy: **Given** a restaged task, **When** the `Done when:` close contract flips its row to `completed`, **Then** the fold resolves the id from the row regardless of its trailer count. | 5 | "a completed row resolves regardless of count" | diff-local |
| Story 2 happy: **Given** a restaged task and a canonical-alias trailer (`Task: T16` for plan id `16`), **When** a new commit carries the alias after the restage, **Then** the alias counts toward the same id and the task resolves. | 5 | "an alias trailer after the restage resolves it" | diff-local |
| Story 2 negative: **Given** a restaged task whose trailer count is unchanged since the watermark, **When** the fold runs on any later evaluation in the same worktree, **Then** the id stays unresolved no matter how many pre-restage trailers exist. | 5 | "unchanged count keeps a watermarked id unresolved" | diff-local |
| Story 2 negative: **Given** a restaged task whose branch was rewritten so its trailer count is now lower than the watermark, **When** the fold runs, **Then** the id stays unresolved until a new trailered commit raises the count above the watermark, and it is never reported resolved because the count merely changed. | 6 | "a lowered trailer count stays unresolved until it exceeds the watermark" | diff-local |
| Story 2 negative: **Given** a worktree removed and recreated from its branch after a restage, so `task-status.json` must be rebuilt from trailers, **When** the reconstruction and then the fold run in the new worktree, **Then** the reopened task is restored as `pending` rather than `completed`, the watermark is read from the main root, and the id is reported unresolved until a new trailered commit lands — the reconstruction never silently converges the reopened task. | 15 | "recreated worktree keeps the reopened task unresolved until new work lands" | diff-local |
| Story 2 negative: **Given** a task that was never restaged, **When** the fold runs, **Then** no watermark is consulted and its resolution is byte-identical to the pre-change fold. | 6 | "never-restaged ids resolve identically with and without a watermark file" | diff-local |
| Story 3 happy: **Given** a plan whose every task carries a `Task:` trailer and whose `task-status.json` rows are all `pending`, with no watermark recorded, **When** the build completion predicate runs, **Then** it reports done and the loop hands off to `build_review`. | 14 | "all tasks trailer-resolved ⇒ done" | diff-local |
| Story 3 happy: **Given** the same fresh build, **When** the stall circuit breaker samples `countResolvedTasks` before and after a dispatch that added a trailered commit, **Then** the count rises by one and no stall is declared. | 13 | "fresh build with no watermark file gains one per trailered commit" | diff-local |
| Story 3 negative: **Given** a fresh build with two tasks lacking trailers and no watermark recorded, **When** the build completion predicate runs, **Then** it reports not done naming those two ids, exactly as before this change. | 14 | "unresolved ids named in reason" | diff-local |
| Story 3 negative: **Given** a fresh build whose `task-status.json` is missing, **When** the build completion predicate runs, **Then** it reports not done with the existing "missing task-status.json" reason and consults no watermark. | 6 | "missing task-status.json returns the existing reason without consulting watermarks" | diff-local |
| Story 4 happy: **Given** a remediation round whose fixes append or upsert only task ids that are already evidence-complete and restage nothing, **When** the D1 guard recomputes build completion, **Then** it halts with the existing `derived-already-complete` kickback outcome and gap ledger. | 9 | "pre-existing `planRemediation D1` and `D3` tests" | diff-local |
| Story 4 negative: **Given** a remediation round that restaged at least one bound task, **When** the D1 guard recomputes build completion, **Then** it does not halt and the round routes to `build`. | 9 | "existing-task round on a trailered task routes to build" | diff-local |
| Story 4 negative: **Given** a consolidated manual-test FAIL round that also carries an existing-task gap, **When** the route runs, **Then** the bound ids are restaged and watermarked exactly as in any other round, and only the D1 completion recheck is skipped, because that round's dispatchable work is the FAIL itself. | 9 | "consolidated FAIL round restages and watermarks with the D1 recheck skipped" | diff-local |
| Story 5 happy: **Given** an existing-task round that restages ids 16 and 21, **When** the restage completes, **Then** exactly one `kickback` event for that round carries an additive field listing `16` and `21` with their recorded trailer counts, and `<mainRoot>/.daemon/restage-watermarks/<plan-stem>.json` holds the same ids and counts. | 10 | "one kickback event per round carries restaged ids and counts" | diff-local |
| Story 5 happy: **Given** a recorded watermark for id 16, **When** a later round restages id 19 only, **Then** the watermark file holds both ids and the earlier count for 16 is not overwritten. | 2 | "a later round adds ids without overwriting an earlier count" | diff-local |
| Story 5 happy: **Given** a recorded watermark, **When** the daemon re-kicks the feature in the same worktree, **Then** the watermark is read back unchanged and the fold applies it on the first evaluation. | 1 | "record then read round-trips id → count at the main root" | diff-local |
| Story 5 negative: **Given** no watermark file exists for the feature's stem, **When** it is read, **Then** the reader returns an empty watermark map, and `.pipeline/engine-state.json` (including `appendedRemediationTaskIds`) is never written by any watermark operation. | 2 | "engine-state.json is byte-identical across record and read" | diff-local |
| Story 5 negative: **Given** two features with different plan stems in sibling worktrees of the same main root, **When** each restages, **Then** each writes only its own stem's file and neither read returns the other's ids. | 2 | "two stems under one main root are isolated" | diff-local |
| Story 5 negative: **Given** a restage that fails before writing task-status, **When** the route halts, **Then** no `kickback` event carries a restage field and engine-state gains no watermark. | 10 | "a failed restage emits no restaged field" | diff-local |
| Story 5 negative: **Given** two consecutive restages of the same id in one round, **When** the record helper runs, **Then** it writes the id once with the count observed at the first restage and emits one event field entry, not two. | 8 | "a repeated id in one round is recorded once" | diff-local |
| Story 6 happy: **Given** a round that restages one task with three prior trailered commits, **When** the #647 no-op baseline is captured, **Then** its `resolvedCount` equals the post-restage count (the restaged id excluded) and a build that adds one trailered commit for that id is classified `did-work`. | 11 | "no-op baseline resolvedBefore equals the post-restage count" | diff-local |
| Story 6 happy: **Given** the same round, **When** the stall circuit breaker samples the count before and after a dispatch that added the trailered commit, **Then** it observes movement of exactly one and declares no stall. | 13 | "countResolvedTasks moves by exactly one per post-restage trailered commit and by zero without one" | diff-local |
| Story 6 negative: **Given** the same round, **When** a build attempt adds no commit at all, **Then** the breaker observes no movement and applies its existing stall handling — the restage itself is never counted as movement. | 13 | "countResolvedTasks moves by exactly one per post-restage trailered commit and by zero without one" | diff-local |
| Story 6 negative: **Given** a round whose baseline was taken before the restage, **When** the post-restage count is compared, **Then** the drop is not reported as `did-work` and the `build-progress-watcher` reports the restaged id as pending, in agreement with the fold. | 13 | "watcher reports a restaged id pending and a non-restaged trailered id resolved" | diff-local |
| Story 6 negative: **Given** a durable progress sample taken before the restage (`lastResolvedCount` in `task-evidence.json`, or the #280 `noEvidenceAttempts` counter's `resolvedTasksBefore`), **When** the round restages a task, **Then** that sample is refreshed to the post-restage count before the next build attempt is measured, so the deliberate drop is never recorded as zero progress, regression, or re-kick ineligibility. | 12 | "lastResolvedCount equals the post-restage count" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task (13/13 in Coverage Check)
- [ ] All negative path criteria covered by at least one task (19/19 in Coverage Check)
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; "fails closed" is closed each time by its named mechanism (record returns `failed` before any row write; corrupt read excludes trailer resolution)
- [ ] Dependencies are explicit and acyclic (graph above)
- [ ] No terminal catch-all validation task
