**Status:** Accepted

# Stories: Rebase reopens completed repair tasks against stale boundaries

**Source:** jstoup111/ai-conductor#2462
**Track:** technical
**Governing decisions:** adr-2026-07-12-rebase-evidence-stamp-translation D6–D9; adr-2026-09-06-reopened-task-resolution D3, D5

## Story 1: A directly rewritten repair boundary follows the rebase

**Requirement:** adr-2026-07-12 D6

As the daemon, I want an open repair obligation whose boundary commit was replayed onto the new base to keep resolving, so that completed repair tasks stay complete after an engine rebase.

### Acceptance Criteria

#### Happy Path
- Given an open obligation with `baseline.head` equal to a pre-rebase branch commit whose patch-id matches a post-rebase commit, when the engine rebase completes and translation runs, then the persisted obligation's `baseline.head` equals that post-rebase commit sha.
- Given the same translated obligation, when task progress evaluates its open tasks, then the evidence range is `newHead..HEAD` and a `Task:` trailer in that range resolves the task without any `repair boundary ... is not an ancestor of HEAD` reason.

#### Negative Paths
- Given an obligation whose `baseline.head` is not a key in the rewrite map and is not in `onto..origHead`, when translation runs, then its `baseline.head` is byte-identical to the pre-translation value.
- Given a translated obligation, when task progress evaluates a task whose only `Task:` trailer is on a commit at or before the new boundary, then the task remains unresolved with the existing no-current-trailer outcome.

### Done When
- [ ] A unit test on `translateAfterRebase` with a two-commit pre-image and a patch-id-identical post-image asserts the stored obligation's `baseline.head` equals the post-image sha.
- [ ] A unit test asserts an obligation whose head is outside `onto..origHead` is unchanged after translation.
- [ ] A task-progress test with the translated store resolves a task from a post-boundary trailer and reports no `unavailableReasons` entry for it.

## Story 2: A dropped or absorbed boundary resolves to its surviving successor

**Requirement:** adr-2026-07-12 D7

As the daemon, I want a boundary commit that vanished in the rebase to be replaced by the first surviving commit after it, so that the repair stays bounded without reopening finished work.

### Acceptance Criteria

#### Happy Path
- Given an open obligation whose `baseline.head` is a residue commit (no patch-id match) and at least one later pre-image commit in `onto..origHead` is a rewrite-map key, when translation runs, then `baseline.head` equals the post-image of the earliest such later commit in first-parent order.
- Given that successor-translated obligation, when task progress evaluates a task with a `Task:` trailer on a commit after the new boundary, then the task resolves.

#### Negative Paths
- Given a residue boundary where the only surviving map keys are commits at or before the boundary in first-parent order, when translation runs, then `baseline.head` is unchanged and a later task-progress check returns the existing `repair boundary <sha> is not an ancestor of HEAD` reason.
- Given a residue boundary whose successor candidate exists in the map but the mapped sha is not reachable from the post-rebase `HEAD`, when translation runs, then `baseline.head` is unchanged.
- Given a pre-image branch containing a merge commit after the residue boundary, when translation runs, then the successor is chosen along the first-parent chain only and never a commit reachable solely through the merge's second parent.

### Done When
- [ ] A unit test squashes the boundary commit into the base so it becomes residue, keeps one later commit, and asserts the stored `baseline.head` equals that later commit's post-image.
- [ ] A unit test with a residue boundary and only pre-boundary survivors asserts `baseline.head` is unchanged.
- [ ] A unit test with a merge commit on the pre-image branch asserts the chosen successor lies on the first-parent chain.
- [ ] A test asserts the translated boundary is later than the old one, so `git log newHead..HEAD` is a subset of `git log oldHead..HEAD` when both are readable.

## Story 3: Translation is atomic, scoped, and preserves unrelated state

**Requirement:** adr-2026-07-12 D6; adr-2026-09-06 D3

As the engine, I want the boundary rewrite to run through the single engine-state writer seam, so that concurrent bookkeeping cannot erase repair state and nothing but `baseline.head` changes.

### Acceptance Criteria

#### Happy Path
- Given an engine-state file with two obligations, `activePlanPath`, and appended-task bookkeeping, when translation rewrites one obligation, then every other field of the file is byte-identical and the other obligation is unchanged.
- Given an obligation with `baseline.tree`, `baseline.resolvedTaskIds`, `settlement`, and per-task statuses, when its `baseline.head` is translated, then those fields are unchanged.

#### Negative Paths
- Given a malformed `repairObligations` section, when translation runs, then the engine-state file is not written, the rest of `translateAfterRebase` (task-evidence, task-status, seal rotation) still completes, and a later task-progress check reports the existing malformed-state reason.
- Given the engine-state store's `update` mutator is invoked, when the mutator returns, then no code path in translation has opened `engine-state.json` for direct write outside that store.
- Given an engine-state file that does not exist, when translation runs, then no file is created and translation completes without error.

### Done When
- [ ] A unit test snapshots the engine-state JSON before and after translation and asserts a deep-equal except the translated `baseline.head` values.
- [ ] A unit test injects an `EngineStateStore` fake and asserts the rewrite is performed through its `update` method and that no `writeFile`/`rename` on the engine-state path occurs outside it.
- [ ] A unit test with a malformed section asserts the file is unchanged and that `applyMapToStores` still ran.
- [ ] A unit test with no engine-state file asserts translation completes and no file is created.

## Story 4: Translation is observable on the event spine only

**Requirement:** adr-2026-07-12 D8

As an operator reading `.pipeline/events.jsonl`, I want each rewritten boundary recorded with its rule, so that a resolved or refused repair after a rebase can be explained without opening the store.

### Acceptance Criteria

#### Happy Path
- Given one obligation translated directly and one by successor, when translation runs, then two `repair_boundary_translated` events are emitted, each carrying the obligation id, old sha, new sha, and `rule` equal to `direct` or `successor` respectively.
- Given a residue boundary left unchanged, when translation runs, then the `rebase_citation_residue` event's entry for that sha lists the obligation id under `citingObligationIds`.

#### Negative Paths
- Given no obligation needed translation, when translation runs, then zero `repair_boundary_translated` events are emitted.
- Given translation ran without an event emitter injected, when it completes, then the store is still rewritten and no error is thrown.
- Given the `EVENT_SINKS` table, when `repair_boundary_translated` is looked up, then a row exists with `persist: true`, and the `ConductorEvent` union type-checks the payload fields.

### Done When
- [ ] A unit test captures emitted events and asserts exactly one event per rewritten obligation with the correct `rule`.
- [ ] A unit test asserts an unchanged residue boundary appears in the residue event with its `citingObligationIds`.
- [ ] A test asserts `EVENT_SINKS['repair_boundary_translated']` exists and persists.
- [ ] The typecheck passes with the new union member and no `any` on the payload.

## Story 5: The read-path fallback stays a fallback and unmapped rebases stay refused

**Requirement:** adr-2026-07-12 D9

As the engine, I want the existing read-time lookup to keep serving obligations the store did not rewrite, and any rebase the engine did not perform to keep refusing, so that no historical evidence ever closes an open repair.

### Acceptance Criteria

#### Happy Path
- Given an obligation admitted before this change whose `baseline.head` is a direct rewrite-map key but the store was never rewritten, when task progress evaluates it, then the read path follows `.pipeline/rebase-rewrites.json` and resolves the task as today.

#### Negative Paths
- Given an obligation whose `baseline.head` is residue and the store was not rewritten, when task progress evaluates it, then the read path returns `repair boundary <sha> is not an ancestor of HEAD` and does not attempt any successor search.
- Given a branch rebased by hand with no `.pipeline/rebase-rewrites.json`, when task progress evaluates an open obligation with a non-ancestor boundary, then the result is `unavailable` with the existing reason and no commits are admitted.
- Given a `rebase-rewrites.json` that maps the boundary to a sha not reachable from `HEAD`, when task progress evaluates it, then the result is `unavailable`.

### Done When
- [ ] The existing `autoheal.ts` fallback tests still pass unchanged.
- [ ] A test with a residue boundary and an unrewritten store asserts the `unavailable` result and that no git `rev-list` over `onto..origHead` is issued by the read path.
- [ ] A test with no rewrites file asserts `unavailable` for a non-ancestor boundary.
- [ ] `git diff` of the feature shows no change to the successor-selection logic living anywhere but `rebase-translate.ts`.
