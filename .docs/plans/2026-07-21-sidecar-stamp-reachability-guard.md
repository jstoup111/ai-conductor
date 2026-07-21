# Implementation Plan: sidecar-stamp-reachability-guard (#766)

**Date:** 2026-07-21
**Track:** technical (no PRD)
**Stories:** .docs/stories/sidecar-stamp-reachability-guard.md
**Complexity:** S (.docs/complexity/2026-07-21-sidecar-stamp-reachability-guard.md)
**Conflict check:** skipped (Small tier)

## Summary
Reachability-gate the sidecar evidence-stamp pin in `deriveCompletionInternal`
(`src/conductor/src/engine/autoheal.ts`) so a stamp whose cited commit is absent
from history — without a sanctioned rebase to explain it — is demoted loudly
(task re-runs) instead of pinning the build into an uncreditable-undemotable
state. 6 tasks.

## Technical Approach
The bug is at `autoheal.ts:773-788`: the `matchingCommits.length === 0` branch
pins `completed=true` on the mere *existence* of a sidecar stamp, without checking
that the stamp's cited sha is reachable. The `satisfied-by` path a few lines up
(`autoheal.ts:697-723`) already does the correct check: `resolveThroughMap` (from
`rebase-translate.ts`, already imported and used at line 697-698) followed by
`git rev-parse --verify <sha>^{commit}` and `git merge-base --is-ancestor <sha>
HEAD`.

Design:
1. **Extract** that reachable-ancestor check into a small helper
   `stampShaReachable(projectRoot, sha, rewriteMap)` in `autoheal.ts` (resolve
   through the map, then `rev-parse --verify` + `merge-base --is-ancestor`),
   returning the resolved sha when reachable and `null` otherwise.
2. **Gate the pin branch** with it. Reachable → keep the pin exactly as today,
   crediting the resolved sha. Unreachable (and not rewrite-translated) → do NOT
   pin: set `completed=false`, append an audit entry naming the unreachable sha,
   and `warnOnce` a demotion line distinct from the current pin log. The task then
   re-runs on the next build cycle, breaking the wedge.
3. **No-regression on #535:** because resolution runs through the rewrite map
   FIRST, a commit moved by a sanctioned rebase resolves to its reachable new sha
   and stays pinned (crediting the new sha, not the stale one). A sha that was
   never a rewrite-map key resolves to itself and is judged on its own reachability,
   so the map can never launder an off-branch citation.

Resolution order in the pin branch mirrors the satisfied-by path — the reachability
gate is applied uniformly to every stamp form (including `semantic-verified`): a
commit that is gone is gone regardless of who verified it, so the stamp form does
not exempt a task from re-running.

## Prerequisites
- none (all machinery — `resolveThroughMap`, `loadRewriteMap`, `warnOnce`,
  `execa` git calls — already exists in or is imported by `autoheal.ts`).

## Tasks

### Task 1: Extract `stampShaReachable` helper
**Story:** Reachable stamp keeps the task pinned completed (happy path); shared by all stories
**Type:** infrastructure

**Steps:**
1. Write failing test: in a new `src/conductor/test/engine/autoheal-stamp-reachability.test.ts`,
   build a temp git repo with commits `A<-B<-HEAD`; assert `stampShaReachable(root, <B>, {})`
   returns `<B>` (reachable ancestor), `stampShaReachable(root, <deadbeef>, {})` returns
   `null` (absent), and `stampShaReachable(root, <off-branch sha>, {})` returns `null`
   (exists but not ancestor).
2. Verify test fails (RED) — helper does not exist yet.
3. Implement: add `async function stampShaReachable(projectRoot, sha, rewriteMap)` that
   `resolveThroughMap(sha, rewriteMap)`, then `git rev-parse --verify ${resolved}^{commit}`
   (reject:false) and `git merge-base --is-ancestor ${resolved} HEAD` (reject:false),
   returning the resolved sha on success or `null` otherwise. Factor the exact logic
   currently inline at autoheal.ts:700-723.
4. Verify test passes (GREEN).
5. Commit: "feat(autoheal): extract stampShaReachable reachable-ancestor helper"

**Files likely touched:**
- src/conductor/src/engine/autoheal.ts — new `stampShaReachable` helper
- src/conductor/test/engine/autoheal-stamp-reachability.test.ts — helper unit tests

**Wired-into:** src/conductor/src/engine/autoheal.ts#deriveCompletionInternal (called from the pin branch in Task 2; also the satisfied-by path in Task 6)
**Dependencies:** none

### Task 2: Gate the pin branch — demote unreachable stamps
**Story:** Unreachable stamp demotes loudly so the task re-runs (happy path)
**Type:** happy-path

**Steps:**
1. Write failing test: in autoheal-stamp-reachability.test.ts, run `deriveCompletion`
   with a plan task `T`, a commits list carrying NO `Task: T` trailer, and a sidecar
   stamp for `T` citing a sha absent from HEAD; assert `result[T].completed === false`,
   `result[T].status !== 'completed'`, and `result[T].auditEntry` is a non-empty string
   naming the unreachable sha.
2. Verify test fails (RED) — current code pins `completed=true`.
3. Implement: at autoheal.ts:773-788, replace the unconditional pin. When
   `evidence.evidenceStamps.has(taskId)`, call `stampShaReachable(projectRoot,
   stamp.sha, rewriteMap)`. If it returns a sha → pin as today (`completed=true`,
   `status='completed'`, `evidencedBy=<resolved sha>`, keep the existing warnOnce pin
   line). If it returns `null` → set `completed=false`, append
   `Task ${taskId}: sidecar stamp cites unreachable commit ${stamp.sha.slice(0,7)}
   (no rebase translation); demoted` to `auditEntry`, and `warnOnce` a distinct
   demotion line. Load `rewriteMap` once (reuse the `loadRewriteMap` result already
   fetched at line 697 by hoisting it, or fetch within the branch).
4. Verify test passes (GREEN).
5. Commit: "fix(autoheal): demote sidecar stamp citing unreachable commit (#766)"

**Files likely touched:**
- src/conductor/src/engine/autoheal.ts — reachability-gate the pin branch (773-788)
- src/conductor/test/engine/autoheal-stamp-reachability.test.ts — demotion test

**Wired-into:** none (no new production surface — modifies the already-wired pin branch in deriveCompletionInternal)
**Dependencies:** 1

### Task 3: Reachable stamp keeps the pin (happy-path coverage)
**Story:** Reachable stamp keeps the task pinned completed (happy path)
**Type:** happy-path

**Steps:**
1. Write failing test: run `deriveCompletion` with task `T`, no `Task: T` trailer in
   the commits list, and a sidecar stamp citing a sha that IS an ancestor of HEAD;
   assert `result[T].completed === true`, `result[T].status === 'completed'`, and
   `result[T].evidencedBy` equals the resolved sha.
2. Verify test fails/passes appropriately (RED against a broken gate; GREEN once Task 2
   correctly keeps the reachable pin).
3. Implement: no new code beyond Task 2 — this task proves the reachable branch of the
   gate holds the pin. If the assertion fails, correct Task 2's reachable path.
4. Verify test passes (GREEN).
5. Commit: "test(autoheal): reachable sidecar stamp keeps task pinned completed"

**Files likely touched:**
- src/conductor/test/engine/autoheal-stamp-reachability.test.ts — reachable-pin test

**Wired-into:** none (no new production surface — test only)
**Dependencies:** 2

### Task 4: #535 no-regression — rebase-translated stamp stays pinned
**Story:** Rebase-translated stamp stays pinned (#535 no-regression)
**Type:** negative-path

**Steps:**
1. Write failing test: seed a persisted rewrite-map mapping pre-rebase sha `X -> X'`
   where `X'` is an ancestor of HEAD and `X` is not; with a sidecar stamp for `T`
   citing `X` and no `Task: T` trailer, assert `result[T].completed === true` and
   `result[T].evidencedBy === X'` (resolved new sha, not stale `X`). Add a second case:
   a sha never in the rewrite-map that is unreachable → `result[T].completed === false`.
2. Verify test fails (RED) if resolution order is wrong; passes once the map is applied
   before the reachability check.
3. Implement: confirm Task 2 calls `resolveThroughMap` (inside `stampShaReachable`)
   BEFORE the rev-parse/ancestor check. No new code expected if Task 1/2 are correct.
4. Verify test passes (GREEN).
5. Commit: "test(autoheal): rebase-translated stamp stays pinned (#535 no-regression)"

**Files likely touched:**
- src/conductor/test/engine/autoheal-stamp-reachability.test.ts — rewrite-map tests

**Wired-into:** none (no new production surface — test only)
**Dependencies:** 2

### Task 5: `semantic-verified` unreachable stamp still demotes
**Story:** Unreachable stamp demotes loudly (negative path — stamp form is not an exemption)
**Type:** negative-path

**Steps:**
1. Write failing test: sidecar stamp for `T` with `form: 'semantic-verified'` citing a
   sha absent from HEAD, no `Task: T` trailer; assert `result[T].completed === false`
   and an audit entry is present — proving the reachability gate applies to every stamp
   form in the empty-matchingCommits branch.
2. Verify test fails (RED) if the gate special-cases semantic-verified; passes when the
   gate is form-agnostic in this branch.
3. Implement: ensure Task 2's gate does not exempt any stamp form (no `form ===
   'semantic-verified'` bypass in the empty-matchingCommits branch). Note: the existing
   semantic-verified credit at autoheal.ts:858-864 is in the NON-empty branch and is
   left unchanged.
4. Verify test passes (GREEN).
5. Commit: "test(autoheal): semantic-verified stamp citing unreachable commit demotes"

**Files likely touched:**
- src/conductor/src/engine/autoheal.ts — (only if a bypass must be removed)
- src/conductor/test/engine/autoheal-stamp-reachability.test.ts — semantic-verified demotion test

**Wired-into:** same as Task 2
**Dependencies:** 2

### Task 6: Route satisfied-by path through the shared helper + CHANGELOG
**Story:** Reachable stamp keeps the task pinned completed (dedup of the reachable-ancestor check)
**Type:** refactor

**Steps:**
1. Write failing test: none new required — the existing autoheal satisfied-by tests
   (`autoheal.test.ts`) are the regression guard for this refactor.
2. Verify existing satisfied-by tests pass before the refactor (baseline GREEN).
3. Implement: replace the inline reachable-ancestor check at autoheal.ts:700-723 with a
   call to `stampShaReachable`, preserving the existing dangling-sha fall-through
   behavior (audit entry + fall through to trailer derivation). Add a `## [Unreleased]`
   → `### Fixed` entry to CHANGELOG.md describing the #766 fix (internal engine change,
   PATCH — no CLI/hook/schema/skill-symlink surface, so no migration block).
4. Verify existing satisfied-by tests still pass (GREEN) — no behavior change.
5. Commit: "refactor(autoheal): route satisfied-by reachability through shared helper; changelog"

**Files likely touched:**
- src/conductor/src/engine/autoheal.ts — satisfied-by path uses `stampShaReachable`
- CHANGELOG.md — `[Unreleased] / Fixed` entry for #766

**Wired-into:** none (no new production surface — refactor of existing wired code + docs)
**Dependencies:** 1, 2

## Task Dependency Graph
```
Task 1 (helper)
  ├─> Task 2 (gate pin branch)
  │     ├─> Task 3 (reachable-pin test)
  │     ├─> Task 4 (#535 no-regression test)
  │     └─> Task 5 (semantic-verified demotion test)
  └─> Task 6 (satisfied-by refactor + CHANGELOG)  [also depends on Task 2]
```

## Integration Points
- After Task 2: the wedge is resolved end-to-end — a build with a stamp citing a
  vanished commit demotes the task and re-runs it instead of parking.
- After Task 6: the reachable-ancestor check has a single source of truth used by
  both the satisfied-by and the pin branches.

## Verification
- [ ] All happy path criteria covered (Task 2 = demote; Task 3 = reachable pin)
- [ ] All negative path criteria covered (Task 4 = #535/map-launder; Task 5 = semantic-verified)
- [ ] No task exceeds ~5 minutes of work
- [ ] Dependencies explicit and acyclic
- [ ] CHANGELOG `[Unreleased]` entry added (Task 6); internal-only change → PATCH, no migration block
