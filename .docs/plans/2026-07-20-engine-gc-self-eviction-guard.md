# Implementation Plan: Engine-GC self-eviction guard

**Date:** 2026-07-20
**Design:** technical track (no PRD) — `.docs/track/engine-gc-self-eviction-guard.md`
**Stories:** `.docs/stories/engine-gc-self-eviction-guard.md`
**Complexity:** Small — `.docs/complexity/engine-gc-self-eviction-guard.md`
**Conflict check:** Skipped (Small tier)
**Intake:** `jstoup111/ai-conductor#673` (outcome 3 only)

## Summary

Make the engine-version GC incapable of deleting the `dist-versions/<id>` directory a live
daemon/engine is executing from. Seven TDD tasks: a new explicit protect-set on `gcVersions`, a
daemon→subprocess hand-down of the running version, a fail-closed skip when the running version is
unresolvable, and a startup-ordering backstop.

## Technical Approach

The self-eviction happens because `gcVersions` (`src/conductor/src/engine/engine-store.ts:364`) runs
inside the `publish-engine.mjs` **subprocess** (`scripts/publish-engine.mjs:294`, invoked via
`ensureFresh → ensureInstallFresh → bin/install → npm run build`). That subprocess does not execute
from the daemon's version dir, and `dist` has already been flipped to the *new* version by GC time —
so it cannot identify the long-lived daemon's running version (`V_run`) on its own. `V_run` is
therefore protected today only by the fleet-pidfile `liveReferenced` check (condition 2), and only
if the daemon's pidfile is written and enrolled in the registry the subprocess happens to read.
Verified gap: at daemon startup `ensureFresh()` runs at `daemon-cli.ts:441` *before* `holdLock()` at
`:523`, so during startup no pidfile advertises `V_run` — and any per-worktree/cross-context publish
where the subprocess reads a different registry has the same blind spot (the likely mid-pipeline
case in #673).

**Primary fix — explicit hand-down (deterministic, context-independent).** Only the daemon *process*
knows its own dir: `OWN_ENGINE_DIR = dirname(fileURLToPath(import.meta.url))` (`daemon-lock.ts:156`),
from which the existing `versionIdFromEngineDir()` (`engine-store.ts:293`) extracts `V_run`. Before
invoking `ensureFresh()`, the daemon stamps two env vars that propagate to the publish subprocess:
`CONDUCT_ENGINE_SELF_GUARD=1` (intent: "a live engine is asking to be protected") and
`CONDUCT_ENGINE_SELF_VERSION=<V_run>` (empty if unresolvable). `publish-engine.mjs` reads them and
passes `protectVersionIds: [V_run]` into a new `gcVersions` option; `gcVersions` skips any version
in that set. This protects `V_run` regardless of pidfile timing, registry path, or worktree context.

**Fail-closed.** If `CONDUCT_ENGINE_SELF_GUARD=1` but `CONDUCT_ENGINE_SELF_VERSION` is empty
(daemon could not resolve its own version), `publish-engine.mjs` skips the GC pass entirely rather
than delete blind — consistent with `gcVersions`' existing "erroring read ⇒ zero deletions" stance.
A dev (`src/engine`) run has no `dist-versions/<id>` id and nothing at risk, so it does not set the
guard and behaves exactly as today.

**Backstop — startup ordering.** Move `ensureFresh()` to after `holdLock()` in `runDaemonMode` so
the pidfile's `engineDir` also enrolls `V_run` in `liveReferenced` before the first GC pass — an
independent second guard. The stale-install refusal that `ensureFresh` provides is preserved (it
still runs and still throws non-interactively; the lock's `process.once('exit')` release backstop
already covers throwing while holding the lock).

Key modules: `src/conductor/src/engine/engine-store.ts` (GC policy + protect-set),
`src/conductor/scripts/publish-engine.mjs` (env → protect-set, fail-closed skip),
`src/conductor/src/daemon-cli.ts` (stamp env, reorder), reusing `versionIdFromEngineDir` /
`OWN_ENGINE_DIR`.

## Prerequisites

- None. All touched files exist; no new dependencies, schema, CLI, or hook surfaces.

## Tasks

### Task 1: Add `protectVersionIds` skip condition to `gcVersions`
**Story:** Story "GC never deletes the running engine's own dist" — happy + negative
**Type:** happy-path

**Steps:**
1. Write failing test: `gcVersions` with `protectVersionIds: [V]`, where `V` satisfies all four legacy delete conditions (≠ currentVersionId, not live-referenced, older than minAge, outside keepLastK), asserts `V` is NOT in `result.deleted` and its dir still exists.
2. Verify test fails (RED).
3. Implement: add `protectVersionIds?: EngineVersionId[]` to `GcVersionsOpts`; build `const protectedSelf = new Set(opts.protectVersionIds ?? [])`; add `if (protectedSelf.has(versionId)) continue;` as the first skip in the deletion loop (condition 0, before the currentVersionId check).
4. Verify test passes (GREEN).
5. Commit: "feat(engine-store): add protectVersionIds self-guard to gcVersions"

**Files likely touched:**
- `src/conductor/src/engine/engine-store.ts` — new option + skip condition

**Wired-into:** none (inert until `src/conductor/scripts/publish-engine.mjs`)
**Dependencies:** none

### Task 2: `gcVersions` retention regression + single-version protection tests
**Story:** Story "Genuinely-old versions are still collected" — happy + negative
**Type:** negative-path

**Steps:**
1. Write failing test A: N old/unreferenced versions + one `protectVersionIds` version → exactly the protected version retained, all N others deleted (asserts no widening of the guard to siblings).
2. Write failing test B: with `protectVersionIds` empty/absent, the four legacy conditions behave exactly as before (regression over currentVersionId / keepLastK / minAge / live-referenced).
3. Verify tests fail if the guard is implemented wrong (RED against a deliberately over-broad guard).
4. Implement: no new production code beyond Task 1 — this task hardens coverage; adjust only if a test exposes an over/under-retention bug.
5. Verify tests pass (GREEN).
6. Commit: "test(engine-store): gcVersions retention + single-version protection coverage"

**Files likely touched:**
- `src/conductor/src/engine/engine-store.test.ts` — new cases (create if absent; else append)

**Wired-into:** none (no new production surface)
**Dependencies:** Task 1

### Task 3: `publish-engine.mjs` reads self-guard env → `protectVersionIds`, fail-closed skip
**Story:** Story "GC never deletes the running engine's own dist" + Story "Fail closed when the running dir cannot be resolved"
**Type:** happy-path

**Steps:**
1. Write failing test: invoke the publish GC step with `CONDUCT_ENGINE_SELF_GUARD=1` and `CONDUCT_ENGINE_SELF_VERSION=<V>` → `gcVersions` receives `protectVersionIds: [V]`; with `CONDUCT_ENGINE_SELF_GUARD=1` and empty `CONDUCT_ENGINE_SELF_VERSION` → GC is skipped entirely (zero deletions) and a "gc: skipped (self-guard, unresolved self version)" line is logged.
2. Verify test fails (RED).
3. Implement: in `publish-engine.mjs`, before the `gcVersions` call at ~:294, read `env.CONDUCT_ENGINE_SELF_GUARD` / `env.CONDUCT_ENGINE_SELF_VERSION`; if guard set and version non-empty, pass `protectVersionIds: [version]`; if guard set and version empty, skip the GC block with a logged reason; otherwise call GC unchanged (backward compatible).
4. Verify test passes (GREEN).
5. Commit: "feat(publish-engine): honor self-guard env, fail closed when self version unresolved"

**Files likely touched:**
- `src/conductor/scripts/publish-engine.mjs` — env read, conditional protectVersionIds / GC skip

**Wired-into:** `src/conductor/scripts/publish-engine.mjs#publish` (calls `gcVersions` with the new option)
**Dependencies:** Task 1

### Task 4: Daemon stamps self-guard env before `ensureFresh`
**Story:** Story "No unprotected window during daemon startup" — happy + negative
**Type:** happy-path

**Steps:**
1. Write failing test: a helper `selfGuardEnv()` returns `{ CONDUCT_ENGINE_SELF_GUARD: '1', CONDUCT_ENGINE_SELF_VERSION: <id> }` when `OWN_ENGINE_DIR` embeds a version id, and `CONDUCT_ENGINE_SELF_VERSION: ''` (guard still `'1'`) when it does not; assert `runDaemonMode` sets these on `process.env` before `ensureFresh` is called (via injected `ensureFresh` spy reading the env).
2. Verify test fails (RED).
3. Implement: export `versionIdFromEngineDir` from `engine-store.ts` (currently module-local); add a small `selfGuardEnv()` helper (in `daemon-lock.ts`, next to `OWN_ENGINE_DIR`) using it; in `runDaemonMode`, apply the vars to `process.env` immediately before `await ensureFresh()`.
4. Verify test passes (GREEN).
5. Commit: "feat(daemon): stamp engine self-guard env before publish/GC"

**Files likely touched:**
- `src/conductor/src/engine/engine-store.ts` — export `versionIdFromEngineDir`
- `src/conductor/src/engine/daemon-lock.ts` — `selfGuardEnv()` helper
- `src/conductor/src/daemon-cli.ts` — set env before `ensureFresh()`

**Wired-into:** `src/conductor/src/daemon-cli.ts#runDaemonMode` (calls `selfGuardEnv()` before `ensureFresh`)
**Dependencies:** Task 3

### Task 5: Reorder `ensureFresh()` after `holdLock()` (pidfile backstop)
**Story:** Story "No unprotected window during daemon startup" — negative path
**Type:** refactor

**Steps:**
1. Write failing test: assert in `runDaemonMode` that `holdLock` resolves before `ensureFresh` is invoked (ordering spy), and that a stale-install `ensureFresh` throw still propagates (refusal semantics preserved) with the lock released via the exit backstop.
2. Verify test fails (RED) against the current 441-before-523 order.
3. Implement: move the `await ensureFresh()` call to immediately after the successful `holdLock` acquisition; keep the self-guard env stamp (Task 4) directly before it; leave the log-sink open point unchanged.
4. Verify test passes (GREEN).
5. Commit: "fix(daemon): run publish/GC after holdLock so pidfile protects the running version"

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — move `ensureFresh()` below `holdLock()`

**Wired-into:** none (no new production surface; reorders existing wired calls)
**Dependencies:** Task 4

### Task 6: Integration test — long-lived daemon, startup window, version retained
**Story:** Story "GC never deletes the running engine's own dist" + Story "No unprotected window during daemon startup" — happy
**Type:** happy-path

**Steps:**
1. Write failing test: seed `dist-versions/` with `V_run` (old, outside keepLastK) plus newer versions and NO live pidfile referencing `V_run` (simulates the pre-`holdLock` window / cross-context registry); run the publish GC path with the self-guard env pointing at `V_run`; assert `V_run` survives and a later `require`/`import` from its dir resolves (no ENOENT).
2. Verify test fails (RED) with the guard disabled.
3. Implement: no new production code — exercises Tasks 1/3/4 end-to-end; add fixtures/harness only.
4. Verify test passes (GREEN).
5. Commit: "test(engine): self-guard protects long-lived daemon version through publish+GC"

**Files likely touched:**
- `src/conductor/src/engine/engine-store.test.ts` — end-to-end GC-with-self-guard case (or a dedicated `publish-engine` test file)

**Wired-into:** none (no new production surface)
**Dependencies:** Task 3, Task 4

### Task 7: Fail-closed test — unresolved self version skips GC
**Story:** Story "Fail closed when the running dir cannot be resolved" — negative path
**Type:** negative-path

**Steps:**
1. Write failing test: `CONDUCT_ENGINE_SELF_GUARD=1` with empty `CONDUCT_ENGINE_SELF_VERSION` → the publish GC step performs zero deletions even when eligible-for-deletion versions exist, and logs the fail-closed reason.
2. Verify test fails (RED).
3. Implement: covered by Task 3's skip branch; add only the assertion/fixture. Adjust the Task 3 branch if the test exposes a gap.
4. Verify test passes (GREEN).
5. Commit: "test(publish-engine): fail closed (skip GC) when self version unresolved"

**Files likely touched:**
- `src/conductor/scripts/publish-engine.test.mjs` — fail-closed case (create if absent)

**Wired-into:** none (no new production surface)
**Dependencies:** Task 3

## Task Dependency Graph

```
Task 1 (gcVersions protect-set)
 ├── Task 2 (retention/protection tests)
 └── Task 3 (publish-engine env → protect-set + fail-closed)
      ├── Task 4 (daemon stamps env)
      │    └── Task 5 (reorder ensureFresh after holdLock)
      ├── Task 6 (integration: long-lived daemon retained)  [also needs Task 4]
      └── Task 7 (fail-closed skip test)
```

## Integration Points

- **After Task 3:** the publish subprocess honors the self-guard end-to-end when the env is present — testable in isolation without the daemon.
- **After Task 4:** a real daemon start stamps the env, so an actual publish+GC during startup protects `V_run`.
- **After Task 5:** both guards (explicit hand-down + pidfile `liveReferenced`) are active and independent — either alone protects the running version.

## Verification

- [ ] All happy-path criteria covered: Story 1 → Tasks 1/3/6; Story 2 → Tasks 3/4/5/6
- [ ] All negative-path criteria covered: Story 1 negative → Task 1; Story 3 → Task 2; Story 4 → Tasks 3/7; Story 2 negative → Task 5
- [ ] Negative paths are explicit tasks (2, 5, 7), not catch-alls
- [ ] Tasks are 2-5 minute granularity
- [ ] Dependencies are explicit and acyclic (see graph)
- [ ] Every task touching new production surface carries a `Wired-into:` line
- [ ] No new user-facing CLI/hook/schema surface (Small technical fix; no migration block required)
- [ ] Plan saved to `.docs/plans/`
