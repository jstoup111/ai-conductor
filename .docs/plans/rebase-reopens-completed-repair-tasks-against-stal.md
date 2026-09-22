# Implementation Plan: Rebase reopens completed repair tasks against stale boundaries

**Date:** 2026-09-18
**Stories:** .docs/stories/rebase-reopens-completed-repair-tasks-against-stal.md
**Conflict check:** Clean as of 2026-09-18
**Source:** jstoup111/ai-conductor#2462

## Summary

Rewrite persisted repair-obligation boundaries through the engine's rebase rewrite map at rebase time, resolve dropped boundaries to their surviving successor, record each rewrite on the event spine, and prove the #2544 read path stays a fallback. 9 tasks.

## Technical Approach

- `translateAfterRebase` in `src/conductor/src/engine/rebase-translate.ts` already builds the patch-id map and rewrites `task-evidence.json` and `task-status.json`. This feature adds the repair-obligation section of `.pipeline/engine-state.json` as a third translated store, in the same pass, immediately after `applyMapToStores` and before seal rotation (ADR D6).
- The store write goes through `RepairObligationStore` in `src/conductor/src/engine/repair-obligations.ts`, which wraps the atomic serialized `EngineStateStore.update` seam (adr-2026-09-06 D3). A new `rewriteBaselines(Map<obligationId, newHead>)` method mutates only `baseline.head`. `rebase-translate.ts` imports from `repair-obligations.ts`; never the reverse.
- Translation choice is a pure function over plain data: `selectRepairBoundaryTranslation(boundary, preImageFirstParentOldestFirst, map, reachable)`. Direct hit → `resolveThroughMap`. Residue → first later first-parent pre-image commit that is a map key, if its post-image is reachable from `HEAD` (ADR D7). Anything else → unchanged, so the read path keeps refusing. The pre-image list comes from one `git rev-list --first-parent --reverse onto..origHead` through the injected `GitRunner`.
- Observability is spine-only (ADR D8): a new `repair_boundary_translated` `ConductorEvent` with an `EVENT_SINKS` row, and `ResidueEntry.citingObligationIds` on the existing residue event. No sidecar, no log line.
- `autoheal.ts` is not edited (ADR D9). Task 9 pins that with tests only.
- Pattern basis: `applyMapToStores` (read store, resolve every sha through the map, leave unknown shas unchanged, write atomically, never throw for a missing store). Allowed variation: writes go through `EngineStateStore.update` rather than temp+rename on a private file. Search hints: `applyMapToStores`, `resolveThroughMap`, `markSettled`, `citingTaskIdsFor`, `rebase_citation_residue`.
- Sequencing: store method and pure selector first (independent), then the call site that joins them, then the negative paths and events that hang off the call site. Task 8 (task-progress) and Task 9 (autoheal) are test-owning proofs at the two consumers.

## Prerequisites

- None. All seams (`GitRunner`, `EngineStateStore`, `ConductorEventEmitter`) already exist and are injected into `translateAfterRebase` or reachable from it.

## Tasks

### Task 1: Add a baseline-rewrite method to the repair-obligation store
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing tests in src/conductor/test/engine/repair-obligations.test.ts: `rewriteBaselines(new Map([[id, newHead]]))` on a store with two obligations updates only the named obligation's `baseline.head`; a JSON deep-equal of the whole engine-state before/after differs only at that key; `baseline.tree`, `resolvedTaskIds`, `settlement`, and `tasks` are unchanged; a store whose file does not exist returns ok with zero rewrites and creates no file; an injected `EngineStateStore` fake records exactly one `update` call and no direct writeFile/rename.
2. Verify RED.
3. Implement `rewriteBaselines(translations: ReadonlyMap<string,string>): Promise<RepairResult<{ rewritten: string[] }>>` on `RepairObligationStore` in src/conductor/src/engine/repair-obligations.ts. Follow the existing `markSettled` trait: parse the section inside `store.update`, clone, mutate only `records[id].baseline.head`, return `{...current, repairObligations: section}`. On an empty translations map or a legacy-absent section, return ok without calling `update`. Search hint: `createRepairObligationStore`, `markSettled`, `parseSection`.
4. Verify GREEN. Commit "feat(repair-obligations): rewriteBaselines through the engine-state seam".

**Done when:**
- `RepairObligationStore.rewriteBaselines` changes exactly the `baseline.head` values named in its input map and the before/after deep-equal test on the whole engine-state JSON shows no other difference.
- The fake-store test observes exactly one `EngineStateStore.update` invocation for a non-empty map and zero filesystem writes to `engine-state.json` outside that store.
- With no engine-state file present, `rewriteBaselines` resolves ok with an empty `rewritten` list and the file still does not exist afterwards.
- The untouched-fields test asserts `baseline.tree`, `baseline.resolvedTaskIds`, `settlement`, and every per-task status are deep-equal before and after the rewrite.
- The untouched-fields test also compares the serialized `engine-state.json` text before and after the rewrite and asserts every byte outside the rewritten `baseline.head` values is identical.
- With no engine-state file present, a full translation run completes without error and `engine-state.json` still does not exist afterwards.

**Files likely touched:**
- src/conductor/src/engine/repair-obligations.ts — add `rewriteBaselines` to the store interface and implementation
- src/conductor/test/engine/repair-obligations.test.ts — RED tests above

**Dependencies:** none

### Task 2: Pure successor selection for residue boundaries
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in src/conductor/test/engine/rebase-translate.test.ts for a new exported pure function `selectRepairBoundaryTranslation(boundary, preImageFirstParentOldestFirst: string[], map, reachable: (sha)=>boolean)` returning `{ kind: "direct", to } | { kind: "successor", to } | { kind: "unchanged", reason }`: a map-key boundary returns direct; a residue boundary with a later map-key commit returns successor with the earliest later commit's post-image; a residue boundary whose only map keys are at or before it returns unchanged; a successor whose mapped sha fails `reachable` returns unchanged; a boundary not in the pre-image list returns unchanged.
2. Verify RED.
3. Implement the function in src/conductor/src/engine/rebase-translate.ts next to `resolveThroughMap`. Inputs are plain data so the test needs no git. Use `resolveThroughMap` for the direct hop. Never look at indices before the boundary. Add a helper that lists `onto..origHead` with `git rev-list --first-parent --reverse` through the injected `GitRunner` (oldest first) for Task 3 to call.
4. Verify GREEN. Commit "feat(rebase-translate): successor rule for residue repair boundaries".

**Done when:**
- `selectRepairBoundaryTranslation` returns `successor` with the post-image of the earliest first-parent commit strictly after the boundary, as asserted by the squashed-boundary fixture in rebase-translate.test.ts.
- The same function returns `unchanged` when every map key lies at or before the boundary, when the candidate's mapped sha is not reachable, and when the boundary is outside the pre-image list, each asserted by its own fixture.
- A merge-commit fixture asserts the candidate list comes from `rev-list --first-parent` so a commit reachable only via a second parent is never selected.
- A property assertion on every successor fixture shows the chosen pre-image index is strictly greater than the boundary index, so `newHead..HEAD` is a subset of `oldHead..HEAD`.
- A residue-boundary fixture where every map key lies at or before the boundary asserts `baseline.head` is unchanged and that a following task-progress evaluation returns the existing `repair boundary <sha> is not an ancestor of HEAD` reason.

**Files likely touched:**
- src/conductor/src/engine/rebase-translate.ts — `selectRepairBoundaryTranslation` and first-parent pre-image listing helper
- src/conductor/test/engine/rebase-translate.test.ts — RED tests above

**Dependencies:** none

### Task 3: Translate obligation baselines inside translateAfterRebase
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in src/conductor/test/engine/rebase-translate-acceptance.test.ts using the existing scratch-repo fixture: seed `.pipeline/engine-state.json` with two obligations, one whose `baseline.head` is a pre-image commit that replays with an identical patch-id and one whose head is a sha outside `onto..origHead`; run `translateAfterRebase` through `performRebase` (the real entry) and assert the first head equals the post-image sha and the second is byte-identical.
2. Verify RED.
3. In `translateAfterRebase` (src/conductor/src/engine/rebase-translate.ts), after `applyMapToStores`, read obligations via `createRepairObligationStore(projectRoot, join(projectRoot, ".pipeline", "engine-state.json"))`, list the first-parent pre-image commits once, run `selectRepairBoundaryTranslation` per obligation, and call `rewriteBaselines` with the direct and successor results. Follow the `applyMapToStores` trait: unknown shas unchanged, atomic write, never throw for a missing store. Search hint: `translateAfterRebase`, `applyMapToStores`, `persistRewriteMap`.
4. Verify GREEN. Commit "feat(rebase-translate): rewrite repair-obligation baselines through the rewrite map".

**Done when:**
- After `performRebase` with the default `translateAfterRebase`, the persisted obligation whose head had a patch-id match holds the post-image sha, asserted by reading `engine-state.json` in rebase-translate-acceptance.test.ts.
- An obligation whose head is outside `onto..origHead` is byte-identical after translation in the same test.
- The rewrite is issued through `RepairObligationStore.rewriteBaselines` from `translateAfterRebase`, and the acceptance test asserts task-evidence.json and task-status.json were also rewritten in the same run.

**Files likely touched:**
- src/conductor/src/engine/rebase-translate.ts — call site in `translateAfterRebase`
- src/conductor/test/engine/rebase-translate-acceptance.test.ts — scratch-repo acceptance test

**Dependencies:** Task 1, Task 2

### Task 4: Malformed or absent obligation section does not stop the rest of translation
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write a failing test in src/conductor/test/engine/rebase-translate-acceptance.test.ts: engine-state with `repairObligations: "garbage"`; run translation; assert engine-state bytes are unchanged, `task-evidence.json` and `task-status.json` were rewritten, and the seal-rotation observer (existing `onRebaseline` hook) was still invoked. Add a task-progress assertion that the existing malformed-state reason is reported for the affected task.
2. Verify RED.
3. In the Task 3 call site, treat a non-ok `read()`/`rewriteBaselines()` result as a no-op for the store: do not throw, do not write, continue to seal rotation. Reuse the existing `RepairResult` failure shape; no new error type.
4. Verify GREEN. Commit "fix(rebase-translate): malformed repair state is a translation no-op".

**Done when:**
- With a malformed `repairObligations` section, `translateAfterRebase` leaves `engine-state.json` byte-identical and still rewrites task-evidence.json and task-status.json, asserted in one acceptance test.
- The same test observes the `onRebaseline` observer call, proving seal rotation ran after the no-op.
- The task-progress resolver reports the existing malformed-repair-state reason for that plan afterwards, asserted in the same test.

**Files likely touched:**
- src/conductor/src/engine/rebase-translate.ts — failure handling at the call site
- src/conductor/test/engine/rebase-translate-acceptance.test.ts — malformed fixture

**Dependencies:** Task 3

### Task 5: repair_boundary_translated event type and sink row
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing tests: in src/conductor/test/engine/event-sinks.test.ts assert `EVENT_SINKS.repair_boundary_translated` exists with `persist: true`; add a type-level test that constructs a `ConductorEvent` of that type with fields `obligationId`, `from`, `to`, `rule: "direct" | "successor"`, `projectRoot`.
2. Verify RED (typecheck failure counts).
3. Add the union member to src/conductor/src/types/events.ts and the sink row to src/conductor/src/engine/event-sinks.ts (`render: false, persist: true, audit: false, otel: false`), following the `rebase_citation_residue` row.
4. Verify GREEN and `npm run typecheck`. Commit "feat(events): repair_boundary_translated event".

**Done when:**
- `EVENT_SINKS.repair_boundary_translated` is present with `persist: true`, asserted by event-sinks.test.ts, and the exhaustiveness check in that file still passes.
- `ConductorEvent` accepts `{ type: "repair_boundary_translated", obligationId, from, to, rule }` with `rule` typed as the closed union `"direct" | "successor"`, verified by the typecheck of the type-level test.

**Files likely touched:**
- src/conductor/src/types/events.ts — union member
- src/conductor/src/engine/event-sinks.ts — sink row
- src/conductor/test/engine/event-sinks.test.ts — assertions

**Dependencies:** none

### Task 6: Emit one translation event per rewritten obligation
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in src/conductor/test/engine/rebase-translate-acceptance.test.ts with a capturing `ConductorEventEmitter`: one direct and one successor obligation yield exactly two `repair_boundary_translated` events with matching ids, `from`, `to`, and `rule`; a run where nothing translates yields zero such events; a run with no emitter injected still rewrites the store and does not throw.
2. Verify RED.
3. In the Task 3 call site, emit through the optional `events` parameter already threaded into `translateAfterRebase`, after `rewriteBaselines` returns ok, one event per entry in `rewritten`.
4. Verify GREEN. Commit "feat(rebase-translate): emit repair_boundary_translated".

**Done when:**
- The capturing emitter test sees exactly one `repair_boundary_translated` event per rewritten obligation, with `rule` equal to `direct` for a map-key head and `successor` for a residue head, and correct `from`/`to` shas.
- A translation run with zero rewrites emits zero `repair_boundary_translated` events, asserted on the captured list.
- With `events` undefined, the acceptance test asserts the store was still rewritten and `translateAfterRebase` resolved without throwing.

**Files likely touched:**
- src/conductor/src/engine/rebase-translate.ts — emit at the call site
- src/conductor/test/engine/rebase-translate-acceptance.test.ts — emitter fixtures

**Dependencies:** Task 3, Task 5

### Task 7: Residue entries cite the obligations left unchanged
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write a failing test in src/conductor/test/engine/rebase-translate.test.ts: a residue boundary with no surviving successor produces a `rebase_citation_residue` event whose entry for that sha carries `citingObligationIds: [id]`, and `.pipeline/rebase-residue.json` carries the same field.
2. Verify RED.
3. Extend `ResidueEntry` in src/conductor/src/engine/rebase-translate.ts with `citingObligationIds: string[]` (default `[]`), populate it from the unchanged results of Task 3 before `writeResidue`, following the `citingTaskIdsFor` trait (best-effort, never throws).
4. Verify GREEN. Commit "feat(rebase-translate): residue entries cite unchanged obligations".

**Done when:**
- `ResidueEntry` carries `citingObligationIds`, and the unchanged-boundary fixture asserts the residue event entry and `rebase-residue.json` both list the obligation id for that sha.
- Residue entries with no citing obligation carry an empty `citingObligationIds` array, asserted by the existing residue fixture updated in the same test file.

**Files likely touched:**
- src/conductor/src/engine/rebase-translate.ts — `ResidueEntry` field and population
- src/conductor/test/engine/rebase-translate.test.ts — residue assertions

**Dependencies:** Task 3

### Task 8: Task progress resolves through translated boundaries
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in src/conductor/test/engine/task-progress.test.ts using a scratch repo: after a real `performRebase` with default translation, (a) a direct-translated obligation resolves a task whose `Task:` trailer is on a commit after the new boundary and `unavailableReasons` has no entry for it; (b) a successor-translated obligation resolves the same way; (c) a task whose only trailer is on a commit at or before the new boundary stays unresolved with no `unavailableReasons` entry.
2. Verify RED (today the boundary is refused as non-ancestor).
3. No production change is expected beyond Tasks 1–3; if the resolver needs none, record that in the commit body. Search hint: `resolveTaskIdsWithDiagnostics`, `listCommitsWithTrailersAfterRepairBoundary`.
4. Verify GREEN. Commit "test(task-progress): translated repair boundaries resolve post-rebase".

**Done when:**
- task-progress.test.ts asserts a direct-translated obligation resolves from a post-boundary `Task:` trailer with no `unavailableReasons` entry after a real rebase.
- The same file asserts a successor-translated obligation resolves from a post-boundary trailer after a real rebase.
- The same file asserts a trailer at or before the new boundary leaves the task unresolved while `unavailableReasons` stays empty for it, proving the refusal reason is not the cause.

**Files likely touched:**
- src/conductor/test/engine/task-progress.test.ts — post-rebase resolution fixtures
- src/conductor/src/engine/task-progress.ts — only if a resolver adjustment proves necessary

**Dependencies:** Task 3

### Task 9: Read-path fallback stays a fallback with no successor search
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write tests in src/conductor/test/engine/autoheal.test.ts: (a) an unrewritten store whose head is a direct map key resolves via `rebase-rewrites.json` (existing behavior, keep passing); (b) a residue head with an unrewritten store returns `unavailable` with reason `repair boundary <sha> is not an ancestor of HEAD` and a spy on the git runner records no `rev-list` invocation; (c) no rewrites file and a non-ancestor head returns `unavailable`; (d) a rewrites file mapping to an unreachable sha returns `unavailable`.
2. Verify (b) is RED only if the read path currently issues rev-list; otherwise all four should pass on the current tree, proving D9 without a production change.
3. Make no change to `autoheal.ts` logic. If any test fails for a production reason, stop and file intake rather than adding successor logic to the read path.
4. Commit "test(autoheal): repair boundary fallback issues no successor search".

**Done when:**
- autoheal.test.ts asserts the residue-boundary case returns `unavailable` with the existing non-ancestor reason and the git-runner spy recorded zero `rev-list` calls.
- autoheal.test.ts asserts `unavailable` for a non-ancestor boundary with no `rebase-rewrites.json`, and for a mapping whose target is not reachable from HEAD.
- The existing direct-map fallback test still passes and `git diff` for this task touches no line of `listCommitsWithTrailersAfterRepairBoundary` or `translateRepairBoundary`.
- The no-`rebase-rewrites.json` fixture asserts the `unavailable` result admits zero commits: its admitted commit list is empty.

**Files likely touched:**
- src/conductor/test/engine/autoheal.test.ts — fallback fixtures

**Dependencies:** none

## Task Dependency Graph

```text
Task 1 (store method) ──┐
                        ├──▶ Task 3 (call site) ──▶ Task 4 (malformed no-op)
Task 2 (pure selector) ─┘         │               ├──▶ Task 6 (emit events)  ◀── Task 5 (event type + sink)
                                  │               ├──▶ Task 7 (residue cites obligations)
                                  │               └──▶ Task 8 (task-progress proof)
Task 9 (autoheal fallback tests) — independent
```

## Integration Points

- After Task 3: a real `performRebase` on a scratch repo rewrites obligation baselines end to end; the direct shape from #2462 is closed at the store.
- After Task 8: `resolveTaskIdsWithDiagnostics` resolves post-rebase tasks with no `repair boundary ... is not an ancestor of HEAD` reason, which is the observable symptom from the issue.
- After Task 6: `.pipeline/events.jsonl` carries `repair_boundary_translated` for every rewrite.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an open obligation with `baseline.head` equal to a pre-rebase branch commit whose patch-id matches a post-rebase commit, when the engine rebase completes and translation runs, then the persisted obligation's `baseline.head` equals that post-rebase commit sha. | 3 | "After `performRebase` with the default `translateAfterRebase`, the persisted obligation whose head had a patch-id match holds the post-image sha, asserted by reading `engine-state.json` in rebase-translate-acceptance.test.ts." | diff-local |
| Story 1 happy: Given the same translated obligation, when task progress evaluates its open tasks, then the evidence range is `newHead..HEAD` and a `Task:` trailer in that range resolves the task without any `repair boundary ... is not an ancestor of HEAD` reason. | 8 | "task-progress.test.ts asserts a direct-translated obligation resolves from a post-boundary `Task:` trailer with no `unavailableReasons` entry after a real rebase." | diff-local |
| Story 1 negative: Given an obligation whose `baseline.head` is not a key in the rewrite map and is not in `onto..origHead`, when translation runs, then its `baseline.head` is byte-identical to the pre-translation value. | 3 | "After `performRebase` with the default `translateAfterRebase`, the persisted obligation whose head had a patch-id match holds the post-image sha, asserted by reading `engine-state.json` in rebase-translate-acceptance.test.ts." | diff-local |
| Story 1 negative: Given a translated obligation, when task progress evaluates a task whose only `Task:` trailer is on a commit at or before the new boundary, then the task remains unresolved with the existing no-current-trailer outcome. | 8 | "task-progress.test.ts asserts a direct-translated obligation resolves from a post-boundary `Task:` trailer with no `unavailableReasons` entry after a real rebase." | diff-local |
| Story 2 happy: Given an open obligation whose `baseline.head` is a residue commit (no patch-id match) and at least one later pre-image commit in `onto..origHead` is a rewrite-map key, when translation runs, then `baseline.head` equals the post-image of the earliest such later commit in first-parent order. | 2 | "`selectRepairBoundaryTranslation` returns `successor` with the post-image of the earliest first-parent commit strictly after the boundary, as asserted by the squashed-boundary fixture in rebase-translate.test.ts." | diff-local |
| Story 2 happy: Given that successor-translated obligation, when task progress evaluates a task with a `Task:` trailer on a commit after the new boundary, then the task resolves. | 8 | "task-progress.test.ts asserts a direct-translated obligation resolves from a post-boundary `Task:` trailer with no `unavailableReasons` entry after a real rebase." | diff-local |
| Story 2 negative: Given a residue boundary where the only surviving map keys are commits at or before the boundary in first-parent order, when translation runs, then `baseline.head` is unchanged and a later task-progress check returns the existing `repair boundary <sha> is not an ancestor of HEAD` reason. | 2 | "`selectRepairBoundaryTranslation` returns `successor` with the post-image of the earliest first-parent commit strictly after the boundary, as asserted by the squashed-boundary fixture in rebase-translate.test.ts." | diff-local |
| Story 2 negative: Given a residue boundary whose successor candidate exists in the map but the mapped sha is not reachable from the post-rebase `HEAD`, when translation runs, then `baseline.head` is unchanged. | 2 | "`selectRepairBoundaryTranslation` returns `successor` with the post-image of the earliest first-parent commit strictly after the boundary, as asserted by the squashed-boundary fixture in rebase-translate.test.ts." | diff-local |
| Story 2 negative: Given a pre-image branch containing a merge commit after the residue boundary, when translation runs, then the successor is chosen along the first-parent chain only and never a commit reachable solely through the merge's second parent. | 2 | "`selectRepairBoundaryTranslation` returns `successor` with the post-image of the earliest first-parent commit strictly after the boundary, as asserted by the squashed-boundary fixture in rebase-translate.test.ts." | diff-local |
| Story 3 happy: Given an engine-state file with two obligations, `activePlanPath`, and appended-task bookkeeping, when translation rewrites one obligation, then every other field of the file is byte-identical and the other obligation is unchanged. | 1 | "`RepairObligationStore.rewriteBaselines` changes exactly the `baseline.head` values named in its input map and the before/after deep-equal test on the whole engine-state JSON shows no other difference." | diff-local |
| Story 3 happy: Given an obligation with `baseline.tree`, `baseline.resolvedTaskIds`, `settlement`, and per-task statuses, when its `baseline.head` is translated, then those fields are unchanged. | 1 | "`RepairObligationStore.rewriteBaselines` changes exactly the `baseline.head` values named in its input map and the before/after deep-equal test on the whole engine-state JSON shows no other difference." | diff-local |
| Story 3 negative: Given a malformed `repairObligations` section, when translation runs, then the engine-state file is not written, the rest of `translateAfterRebase` (task-evidence, task-status, seal rotation) still completes, and a later task-progress check reports the existing malformed-state reason. | 4 | "With a malformed `repairObligations` section, `translateAfterRebase` leaves `engine-state.json` byte-identical and still rewrites task-evidence.json and task-status.json, asserted in one acceptance test." | diff-local |
| Story 3 negative: Given the engine-state store's `update` mutator is invoked, when the mutator returns, then no code path in translation has opened `engine-state.json` for direct write outside that store. | 1 | "`RepairObligationStore.rewriteBaselines` changes exactly the `baseline.head` values named in its input map and the before/after deep-equal test on the whole engine-state JSON shows no other difference." | diff-local |
| Story 3 negative: Given an engine-state file that does not exist, when translation runs, then no file is created and translation completes without error. | 1 | "`RepairObligationStore.rewriteBaselines` changes exactly the `baseline.head` values named in its input map and the before/after deep-equal test on the whole engine-state JSON shows no other difference." | diff-local |
| Story 4 happy: Given one obligation translated directly and one by successor, when translation runs, then two `repair_boundary_translated` events are emitted, each carrying the obligation id, old sha, new sha, and `rule` equal to `direct` or `successor` respectively. | 6 | "The capturing emitter test sees exactly one `repair_boundary_translated` event per rewritten obligation, with `rule` equal to `direct` for a map-key head and `successor` for a residue head, and correct `from`/`to` shas." | diff-local |
| Story 4 happy: Given a residue boundary left unchanged, when translation runs, then the `rebase_citation_residue` event's entry for that sha lists the obligation id under `citingObligationIds`. | 7 | "`ResidueEntry` carries `citingObligationIds`, and the unchanged-boundary fixture asserts the residue event entry and `rebase-residue.json` both list the obligation id for that sha." | diff-local |
| Story 4 negative: Given no obligation needed translation, when translation runs, then zero `repair_boundary_translated` events are emitted. | 6 | "The capturing emitter test sees exactly one `repair_boundary_translated` event per rewritten obligation, with `rule` equal to `direct` for a map-key head and `successor` for a residue head, and correct `from`/`to` shas." | diff-local |
| Story 4 negative: Given translation ran without an event emitter injected, when it completes, then the store is still rewritten and no error is thrown. | 6 | "The capturing emitter test sees exactly one `repair_boundary_translated` event per rewritten obligation, with `rule` equal to `direct` for a map-key head and `successor` for a residue head, and correct `from`/`to` shas." | diff-local |
| Story 4 negative: Given the `EVENT_SINKS` table, when `repair_boundary_translated` is looked up, then a row exists with `persist: true`, and the `ConductorEvent` union type-checks the payload fields. | 5 | "`EVENT_SINKS.repair_boundary_translated` is present with `persist: true`, asserted by event-sinks.test.ts, and the exhaustiveness check in that file still passes." | diff-local |
| Story 5 happy: Given an obligation admitted before this change whose `baseline.head` is a direct rewrite-map key but the store was never rewritten, when task progress evaluates it, then the read path follows `.pipeline/rebase-rewrites.json` and resolves the task as today. | 9 | "autoheal.test.ts asserts the residue-boundary case returns `unavailable` with the existing non-ancestor reason and the git-runner spy recorded zero `rev-list` calls." | diff-local |
| Story 5 negative: Given an obligation whose `baseline.head` is residue and the store was not rewritten, when task progress evaluates it, then the read path returns `repair boundary <sha> is not an ancestor of HEAD` and does not attempt any successor search. | 9 | "autoheal.test.ts asserts the residue-boundary case returns `unavailable` with the existing non-ancestor reason and the git-runner spy recorded zero `rev-list` calls." | diff-local |
| Story 5 negative: Given a branch rebased by hand with no `.pipeline/rebase-rewrites.json`, when task progress evaluates an open obligation with a non-ancestor boundary, then the result is `unavailable` with the existing reason and no commits are admitted. | 9 | "autoheal.test.ts asserts the residue-boundary case returns `unavailable` with the existing non-ancestor reason and the git-runner spy recorded zero `rev-list` calls." | diff-local |
| Story 5 negative: Given a `rebase-rewrites.json` that maps the boundary to a sha not reachable from `HEAD`, when task progress evaluates it, then the result is `unavailable`. | 9 | "autoheal.test.ts asserts the residue-boundary case returns `unavailable` with the existing non-ancestor reason and the git-runner spy recorded zero `rev-list` calls." | diff-local |

## Architecture Obligation Coverage

The change set amends `adr-2026-07-12-rebase-evidence-stamp-translation` with D6–D9. All nine citable decisions are accounted for.

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-07-12-rebase-evidence-stamp-translation#D1 | existing | none | `buildRewriteMap` in src/conductor/src/engine/rebase-translate.ts builds the patch-id map from `rev-list onto..origHead` and `onto..head`; unchanged by this feature. |
| adr-2026-07-12-rebase-evidence-stamp-translation#D2 | task | task-3 | The rewrite is issued through `RepairObligationStore.rewriteBaselines` from `translateAfterRebase`, and the acceptance test asserts task-evidence.json and task-status.json were also rewritten in the same run. |
| adr-2026-07-12-rebase-evidence-stamp-translation#D3 | existing | none | Read-time trailer resolution in `listCommitsWithTrailersAfterRepairBoundary` (src/conductor/src/engine/autoheal.ts) is unchanged; Task 9 pins it with tests only. |
| adr-2026-07-12-rebase-evidence-stamp-translation#D4 | task | task-7 | `ResidueEntry` carries `citingObligationIds`, and the unchanged-boundary fixture asserts the residue event entry and `rebase-residue.json` both list the obligation id for that sha. |
| adr-2026-07-12-rebase-evidence-stamp-translation#D5 | task | task-2 | The same function returns `unchanged` when every map key lies at or before the boundary, when the candidate's mapped sha is not reachable, and when the boundary is outside the pre-image list, each asserted by its own fixture. |
| adr-2026-07-12-rebase-evidence-stamp-translation#D6 | task | task-1, task-3 | The fake-store test observes exactly one `EngineStateStore.update` invocation for a non-empty map and zero filesystem writes to `engine-state.json` outside that store. |
| adr-2026-07-12-rebase-evidence-stamp-translation#D7 | task | task-2 | `selectRepairBoundaryTranslation` returns `successor` with the post-image of the earliest first-parent commit strictly after the boundary, as asserted by the squashed-boundary fixture in rebase-translate.test.ts. |
| adr-2026-07-12-rebase-evidence-stamp-translation#D8 | task | task-5, task-6 | The capturing emitter test sees exactly one `repair_boundary_translated` event per rewritten obligation, with `rule` equal to `direct` for a map-key head and `successor` for a residue head, and correct `from`/`to` shas. |
| adr-2026-07-12-rebase-evidence-stamp-translation#D9 | task | task-9 | The existing direct-map fallback test still passes and `git diff` for this task touches no line of `listCommitsWithTrailersAfterRepairBoundary` or `translateRepairBoundary`. |

## Verification
- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
