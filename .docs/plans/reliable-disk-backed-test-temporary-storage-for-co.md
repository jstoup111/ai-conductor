# Implementation Plan: Reliable Vitest temporary storage

**Date:** 2026-09-11
**Source:** jstoup111/ai-conductor#2224
**Stories:** .docs/stories/reliable-disk-backed-test-temporary-storage-for-co.md
**Track:** technical
**Tier:** S
**Conflict check:** Not required by composer for Tier S; the existing stale-root sweep policy is preserved.

## Summary

Eight scoped tasks relocate this repository's Vitest temporary storage, add an explicit override with startup errors, and preserve startup ordering, nested-run ownership, cleanup, and original-directory leak detection. This is a spec-only delivery; BUILD implements the tasks after the operator merges the spec PR.

## Technical Approach

Keep all policy and execution in this repository's `src/conductor/scripts/`, Vitest configs, and `src/conductor/test/`. Do not change `src/conductor/src/`, shared installed skills, HARNESS.md, generic conductor commands, or consumer settings. The only root configuration change is an ignore entry for `/src/conductor/.vitest-tmp/`. No new dependency, mount probe, capacity check, quota, scheduling mechanism, or event channel is needed.

Add a repository-local, built-in-only ESM module `src/conductor/scripts/vitest-temp.mjs`. It is shared by the plain-Node ordinary launcher, the local smoke entry, and the test-support redirect adapter. The default parent is `src/conductor/.vitest-tmp/` beside this package, resolved from the helper's module location rather than the caller's cwd. `AI_CONDUCTOR_TEST_TMP_BASE` selects an absolute alternative parent. An explicitly set blank, relative, or NUL-containing value is invalid. Create missing directories recursively; allocation, permission, disk/inode exhaustion, and canonicalization errors stop startup with the selected path and original error. Never silently try os.tmpdir(). A path can reside on any filesystem selected by the operator; disk-backing certification is outside scope.

The helper returns explicit ownership/context values and installs the existing `AI_CONDUCTOR_TEST_TMP_ROOT`, TMPDIR, and canonical Git ceiling. Preserve the pre-redirect temporary directory independently as `AI_CONDUCTOR_TEST_ORIGINAL_TMPDIR`. Carry an enclosing disposable scope as `AI_CONDUCTOR_TEST_TMP_SCOPE`, allowing nested smoke discovery/child directories to remain inside their owning outer scope when the existing shared smoke runner clears only `AI_CONDUCTOR_TEST_TMP_ROOT`. These are inherited execution state, not events or a new telemetry ledger. Keep the existing run-root prefix and owner-marker/staleness schema.

Provide distinct fresh-scope and idempotent-install operations: a launcher owns a fresh scope even when invoked from another test run; a config reuses an already-installed run root. If a config has no installed root but its current temporary directory is canonically within a declared enclosing scope, allocate beneath that current directory, so existing smoke discovery/child cleanup still reclaims it. Otherwise allocate beneath the selected top-level parent. Root reuse must validate its associated original-directory context rather than infer the original directory from dirname(root) after relocation. Resolve containment with path separators and canonical paths; reject malformed context before mutation. Preserve caller Git ceilings and append the canonical root only once.

The ordinary launcher installs before spawning Vitest. The smoke script creates its own disposable scope before dynamically importing the existing shared smoke command, clears the installed-run-root value for nested discovery/children, and restores all touched environment values in finally. It calls the shared command unchanged. Each lifecycle removes only roots it created; inherited roots belong to their caller. Config calls remain idempotent and side-effect-free on module re-import beyond reasserting the same redirect.

Global setup distinguishes original temp, current run root, and selected storage. Sweep the existing policy over the original temp and selected storage, deduplicating equal paths; include the immediate containing directory for a nested run when distinct. Preserve the current heartbeat, staleness windows, reporting, and retention rules. Snapshot/diff the original temporary directory for bypass leaks. Tmux cleanup receives explicit corroborated roots: the original temporary directory, this run's root, and exact stale run paths selected by the existing sweep. Never pass a checkout or storage parent as a blanket fixture root. Keep the current successful-baseline and unknown-path refusal rules for teardown.

Use the existing tmpdir guard's injected environment and fixture-owned directory pattern for filesystem behavior. Use the existing TmuxRunner seam for session behavior. The fake-Vitest script fixture already demonstrates npm argument forwarding without running an aggregate suite; extend that local pattern to record startup environment. Update its copied helper dependency when the runner gains the new local import. Do not read source text to prove wiring. No test may call a real LLM, GitHub, or operator tmux socket. Before exercising destructive arguments, prove the mocked process boundary receives a harmless call; all new global-setup tests must import after their boundary mocks so cached imports cannot retain real execution.

## Prerequisites and verified context

- The operator accepted the three stories and required strict project-local placement on 2026-09-11. Tier S requires no PRD, ADR, architecture diagram, conflict artifact, or coherence artifact.
- Verified: ordinary startup lives in scripts/run-vitest.mjs; npm test/test:changed/test:watch invoke that launcher. Both Vitest configs call ensureRunTmpRootSync. The helper currently installs the Git ceiling.
- Verified: scripts/smoke.ts statically imports the shared smoke command. The shared smoke runner creates disposable discovery/child directories, clears the existing run-root environment for each, and restores its caller environment. Preserve that implementation; adapt only the local entry and local config behavior.
- Verified: global-setup.ts derives realTmpdir from dirname(runTmpRoot), and its tmux cleanup relies on os.tmpdir(). These are the exact wiring assumptions that relocation changes.
- Verified: test/park-leak-guard.test.ts mocks the tmpdir/global-setup adapter and must track the new setup interface; the script-forwarding acceptance fixture copies run-vitest.mjs into an isolated package.
- Verified: this machine's checkout is ext4 and /tmp is tmpfs. The contract selects a filesystem location rather than promising a filesystem type everywhere.
- Implementation follows semantic local patterns, not exact-copy replication. No Pattern-source/Rename-map contract applies.
- Event-spine verdict: no new occurrence channel; inherited directory context is execution state. Existing cleanup diagnostics remain the reporting mechanism.
- Verify-claims: CLEAR for the accepted behavior and observed wiring. Proposed helper names and environment keys below are design choices for review, not claims about existing APIs.

## Tasks

### Task 1: Implement checkout-local parent selection and owned scopes
**Story:** Story 1 happy; Story 2 happy
**Type:** infrastructure
**Dependencies:** none
**Files:** .gitignore, src/conductor/scripts/vitest-temp.mjs, src/conductor/test/vitest-temp.test.ts
**Files likely touched:** .gitignore, src/conductor/scripts/vitest-temp.mjs, src/conductor/test/vitest-temp.test.ts

**Steps:**
1. RED: use separate fixture-owned original and package directories plus a fresh environment object; assert default parent is package-relative, an absolute override wins, root names are unique, and installed context preserves the original directory. Inject package location/filesystem operations instead of touching the real default storage.
2. GREEN: implement parent selection and the fresh-scope/idempotent-install operations described above in the built-in-only ESM helper. Install canonical root, original directory, scope, TMPDIR, and a non-duplicated Git ceiling only after allocation succeeds. Return ownership and an exact environment snapshot for restoration.
3. Add the single repository-root ignore entry for /src/conductor/.vitest-tmp/. Keep any lower-level explicit-parent fixture allocator available; it is not an alternate production default.
4. Verify scoped GREEN through ai-conductor scoped-run and commit this behavior.

**Done when:**
1. vitest-temp.mjs selects package-local .vitest-tmp by default and an absolute AI_CONDUCTOR_TEST_TMP_BASE when supplied, as asserted with separate fake package and original directories in vitest-temp.test.ts.
2. The owned-scope allocator returns distinct canonical roots, preserves original-directory context and existing Git ceilings, and marks the selected default directory ignored without changing shared engine or skill files.

### Task 2: Reject invalid storage configuration and inherited context
**Story:** Story 2 negative: invalid selection
**Type:** negative-path
**Dependencies:** 1
**Files:** src/conductor/scripts/vitest-temp.mjs, src/conductor/test/vitest-temp.test.ts
**Files likely touched:** src/conductor/scripts/vitest-temp.mjs, src/conductor/test/vitest-temp.test.ts

**Steps:**
1. RED: cover explicitly blank, relative, and NUL-containing base values and an installed-root environment missing its original-directory context. Assert zero filesystem allocation calls and unchanged input environment.
2. GREEN: validate before allocation or reuse. A missing override means default; a present invalid override is an error. Errors identify the rejected setting/path without inventing a fallback.
3. Verify the focused cases through ai-conductor scoped-run and commit.

**Done when:**
1. vitest-temp.mjs rejects blank, relative, NUL-containing overrides and incomplete inherited-root context before allocation, with the invalid setting identified in vitest-temp.test.ts.
2. Rejection leaves environment values unchanged and invokes neither a fallback allocator nor a test runner.

### Task 3: Bound allocation failures and partial-root cleanup
**Story:** Story 2 negative: unavailable storage
**Type:** negative-path
**Dependencies:** 1, 2
**Files:** src/conductor/scripts/vitest-temp.mjs, src/conductor/test/vitest-temp.test.ts
**Files likely touched:** src/conductor/scripts/vitest-temp.mjs, src/conductor/test/vitest-temp.test.ts

**Steps:**
1. RED: inject parent mkdir permission failure, mkdtemp ENOSPC/EDQUOT, a non-directory parent, and root realpath failure. Never fill a real filesystem or rely on chmod behavior under privileged execution.
2. GREEN: surface the selected location and original cause; do not mutate environment or attempt alternate storage. If this call created a root before a later failure, attempt removal of only that exact root, preserving the original startup failure if removal also fails.
3. Verify the focused failure union through ai-conductor scoped-run and commit.

**Done when:**
1. vitest-temp.mjs surfaces selected-location errors for injected permission, non-directory, ENOSPC/EDQUOT, and canonicalization failures without a system-temp fallback, as asserted in vitest-temp.test.ts.
2. Allocation failure preserves caller environment and removes only its own partially created root when possible; cleanup failure does not replace the original startup error.

### Task 4: Wire ordinary startup and idempotent config installation
**Story:** Story 1 happy; Story 2 happy and both negatives
**Type:** happy-path
**Dependencies:** 1, 2, 3
**Files:** src/conductor/scripts/run-vitest.mjs, src/conductor/test/tmpdir-leak-guard.ts, src/conductor/test/tmpdir-leak-guard.test.ts, src/conductor/vitest.config.ts, src/conductor/vitest.smoke.config.ts, src/conductor/test/vitest-startup.test.ts, src/conductor/test/acceptance/build-review-repeats-aggregate-verification-despit.acceptance.test.ts
**Files likely touched:** src/conductor/scripts/run-vitest.mjs, src/conductor/test/tmpdir-leak-guard.ts, src/conductor/test/tmpdir-leak-guard.test.ts, src/conductor/vitest.config.ts, src/conductor/vitest.smoke.config.ts, src/conductor/test/vitest-startup.test.ts, src/conductor/test/acceptance/build-review-repeats-aggregate-verification-despit.acceptance.test.ts

**Steps:**
1. RED: run the actual ordinary launcher against a fixture-owned fake Vitest executable, following the existing script-forwarding acceptance fixture. Record environment at child entry and simulate success/nonzero completion; keep aggregate Vitest out of the fixture. Cover both default and explicit parent plus invalid/unavailable selection before spawn.
2. GREEN: have run-vitest.mjs use the local scope helper before spawn and clean only its owned root on its existing completion paths. Preserve argv, exit status, signal forwarding, and success-sentinel behavior. Update the isolated script-copy fixture to copy vitest-temp.mjs too.
3. Adapt ensureRunTmpRootSync and both configs to the common installer. Existing explicit-parent unit fixtures supply an explicit fixture storage override. Execute config reloads with Vitest's configuration boundary mocked, proving root reuse and canonical ceiling installation without starting workers.
4. Keep existing worker propagation tests as the real ordinary-worker/Git-ceiling proof; no duplicate aggregate fixture. Verify affected scoped tests and commit.

**Done when:**
1. The real run-vitest.mjs entry launches its fake Vitest child only after default or overridden storage and original-directory context are installed; invalid/unavailable storage launches no child, as asserted in vitest-startup.test.ts.
2. Both executed config modules reuse the installed canonical root and Git ceiling on reload through ensureRunTmpRootSync, with no second allocation; tmpdir-redirect-propagation.test.ts remains the worker propagation proof.
3. Ordinary launcher completion reclaims its own root and preserves argv and child exit status, with script-copy acceptance fixtures exercising the new local dependency.

### Task 5: Contain local smoke startup and nested runs
**Story:** Story 1 happy and negative; Story 2 happy and negatives; Story 3 happy: owned cleanup
**Type:** happy-path
**Dependencies:** 4
**Files:** src/conductor/scripts/smoke.ts, src/conductor/scripts/vitest-temp.mjs, src/conductor/test/vitest-temp.test.ts, src/conductor/test/vitest-startup.test.ts, src/conductor/test/structural/smoke-entry-point.test.ts
**Files likely touched:** src/conductor/scripts/smoke.ts, src/conductor/scripts/vitest-temp.mjs, src/conductor/test/vitest-temp.test.ts, src/conductor/test/vitest-startup.test.ts, src/conductor/test/structural/smoke-entry-point.test.ts

**Steps:**
1. RED: invoke runSmokeEntryPoint with an injected command loader and observe the environment when loading and executing. Test default/override storage and invalid/unavailable selection; no real smoke suite or external capability call is allowed.
2. GREEN: replace the local script's eager runtime import with a dynamic import after a fresh scope is installed. Preserve its existing argument-forwarding seam using a type-only import if needed. Clear only the installed run-root value before handing control to shared discovery, preserve enclosing scope/original-directory state, and restore every touched caller value in finally. Remove only the scope this invocation owns.
3. RED/GREEN: simulate shared discovery/child behavior at the injected boundary: create a disposable child TMPDIR, clear AI_CONDUCTOR_TEST_TMP_ROOT, then execute the local installer. Canonical containment under the enclosing scope must keep the child root under that disposable directory. Verify child cleanup and a failing nested smoke invocation preserve the outer sentinel; a second independent run gets a distinct root.
4. Ensure the existing hermetic smoke fixture still exercises the local redirect adapter with its real internal discovery/child flow. Keep shared smoke-runner.ts unchanged. Verify scoped GREEN and commit.

**Done when:**
1. runSmokeEntryPoint installs default or overridden storage before its injected loader imports the shared command, and invalid/unavailable storage invokes no loader or runner, as asserted in vitest-startup.test.ts.
2. The local nested-scope installer puts discovery/child roots beneath their enclosing disposable directories; concurrent and nested success/failure fixtures retain the other run's sentinel and never remove an inherited root.
3. The smoke entry restores its caller environment and reclaims only its owned scope in finally while forwarding the existing arguments unchanged; no shared smoke engine implementation is edited.

### Task 6: Separate lifecycle storage from original-directory state
**Story:** Story 3 happy paths
**Type:** infrastructure
**Dependencies:** 4, 5
**Files:** src/conductor/test/global-setup.ts, src/conductor/test/vitest-temp-lifecycle.test.ts, src/conductor/test/park-leak-guard.test.ts
**Files likely touched:** src/conductor/test/global-setup.ts, src/conductor/test/vitest-temp-lifecycle.test.ts, src/conductor/test/park-leak-guard.test.ts

**Steps:**
1. RED: invoke the actual global setup with separate fixture-owned original, selected, and nested directories. Mock engine-dist and operator-state/process boundaries before importing setup. Prove a benign mocked call reaches the boundary before any destructive case. Use fake timers for heartbeat and injected signal handling.
2. GREEN: recover original temp from installed context, never dirname(root); use the common installer for setup's missing-root fallback. Sweep original temp, selected parent, and any distinct nested containing directory once each using existing sweep policy and reporting. Retain exact reaped paths for the corroborated tmux-root set handled in Task 7.
3. Keep owned-root cleanup in finally for successful and failing guard outcomes, and route supported SIGINT/SIGTERM cleanup through the same explicit lifecycle context. Stop heartbeat and remove registered handlers. Restore the original temporary-directory environment at teardown; entry wrappers restore their exact caller snapshots.
4. Update the existing park-leak-guard setup mocks to supply the new context seam without calling real allocation or tmux. Verify scoped GREEN and commit.

**Done when:**
1. Actual global setup applies the existing stale-root sweep to deduplicated original, selected, and nested-parent paths, as asserted by vitest-temp-lifecycle.test.ts using the existing staleness policy.
2. Global teardown and supported interrupt handlers stop the heartbeat, reclaim only the owned run root on success or guard failure, preserve its parent, and restore temporary-directory state in vitest-temp-lifecycle.test.ts.

### Task 7: Preserve retention and restrict relocated tmux cleanup
**Story:** Story 3 negative: live, ambiguous, and unrelated paths
**Type:** negative-path
**Dependencies:** 6
**Files:** src/conductor/test/tmux-leak-guard.ts, src/conductor/test/global-setup.ts, src/conductor/test/engine/tmux-leak-guard.test.ts, src/conductor/test/vitest-temp-lifecycle.test.ts
**Files likely touched:** src/conductor/test/tmux-leak-guard.ts, src/conductor/test/global-setup.ts, src/conductor/test/engine/tmux-leak-guard.test.ts, src/conductor/test/vitest-temp-lifecycle.test.ts

**Steps:**
1. RED: exercise relocated sweep with live, own, unreadable-marker, and symlink roots. Reuse existing pure sweep tests for threshold permutations; this task tests their wiring to the new locations. Assert retention and exclusion from the relocated stale tmux-root set.
2. RED: inject TmuxRunner and prove harmless listing reaches it before testing kills. Cover explicit own/reaped fixture roots, checkout and storage parents, prefix lookalikes, unknown cwd, and failed baseline. No ambient tmux calls or real sessions.
3. GREEN: extend the test-local tmux predicate/reap/sweep APIs with an explicit root-list input, defaulting to existing os.tmpdir behavior for unchanged callers. Global setup passes original temp plus exact own/reaped paths; never the selected parent. Preserve separator-aware matching even after a stale directory was removed and preserve existing teardown baseline requirements. Supply the same bounded context to interrupt cleanup.
4. Verify scoped GREEN and commit the retention/corroboration behavior.

**Done when:**
1. Global-setup sweep integration retains live, own, unreadable-marker, and symlink roots under relocated storage, as asserted in vitest-temp-lifecycle.test.ts with exact candidate paths.
2. The test-local tmux guard reaches only its injected runner and allows relocated cleanup only under explicit own/reaped roots; checkout/storage parents, prefix lookalikes, unknown paths, and failed-baseline teardown produce zero kill calls in tmux-leak-guard.test.ts.

### Task 8: Keep bypass-leak detection on the original directory
**Story:** Story 3 negative: escaped temporary entry
**Type:** negative-path
**Dependencies:** 6, 7
**Files:** src/conductor/test/global-setup.ts, src/conductor/test/vitest-temp-lifecycle.test.ts
**Files likely touched:** src/conductor/test/global-setup.ts, src/conductor/test/vitest-temp-lifecycle.test.ts

**Steps:**
1. RED: run actual global setup against isolated original/selected directories, plant an unignored file in the original directory between setup and teardown, and capture the named leak failure. The plant stays inside a fixture, never the operator's real /tmp.
2. GREEN: bind snapshot and diff to the saved original directory independently of sweep parents and relocated roots. Preserve existing ignore classification and ensure owned-root cleanup still runs when leak detection throws.
3. Verify the scoped planted-leak and clean-run cases and commit this wiring. This task implements original-directory monitoring; it is not a terminal whole-feature verification task.

**Done when:**
1. The actual global-setup snapshot/diff path reports and fails an unignored planted entry in the saved original temporary directory after relocation, as asserted in vitest-temp-lifecycle.test.ts.
2. A clean original directory passes that guard, and its failure path still reclaims the owned relocated root without deleting the planted original-directory entry or widening ignore rules.

## Task Dependency Graph

1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8

Task 3 also consumes Task 1; Task 6 also consumes Task 4. Shared files and lifecycle interfaces make this sequence intentional.

## Integration ownership and coverage disposition

Task 4 owns ordinary startup/config integration and the rejection-before-spawn proof. Task 5 owns smoke-entry and nested-scope integration. Task 6 owns lifecycle/dual-location sweep integration. Task 7 owns relocated session-corroboration and retention integration. Task 8 owns original-directory bypass detection. Tasks 1–3 use lower-layer filesystem/policy proof with those entry-point owners establishing reachability.

Every criterion is diff-local: it concerns scoped inputs and outputs of this repository's changed Vitest support. None asserts global free capacity, absence of other processes, a filesystem type on arbitrary hosts, or the eventual behavior of unrelated code. Existing pure stale-root tests and worker/Git-ceiling tests remain sufficient for unchanged policy permutations; new lower-layer and entry-point tests cover relocation. No new aggregate acceptance run is required; BUILD-entry acceptance authoring should use these lower-layer dispositions rather than duplicate them.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given no storage override and a writable checkout, when an ordinary or smoke test invocation starts, then its temporary root and early Vitest temporary allocations are contained in ignored checkout-local storage before tests execute. | 1, 4, 5 | The real run-vitest.mjs entry launches its fake Vitest child only after default or overridden storage and original-directory context are installed; invalid/unavailable storage launches no child, as asserted in vitest-startup.test.ts. | diff-local |
| Story 1 happy: Given an initialized test run, when configuration reloads or workers start, then they reuse that run's temporary root and preserve the Git discovery ceiling. | 4 | Both executed config modules reuse the installed canonical root and Git ceiling on reload through ensureRunTmpRootSync, with no second allocation; tmpdir-redirect-propagation.test.ts remains the worker propagation proof. | diff-local |
| Story 1 negative: Given concurrent invocations or nested smoke execution, when another run starts and finishes, then its disposable root is distinct and its cleanup leaves the other run's root and files intact. | 1, 5 | The local nested-scope installer puts discovery/child roots beneath their enclosing disposable directories; concurrent and nested success/failure fixtures retain the other run's sentinel and never remove an inherited root. | diff-local |
| Story 2 happy: Given an explicit valid writable storage path, when an ordinary or smoke invocation starts, then its disposable temporary files use that selected storage instead of the default checkout-local location. | 1, 4, 5 | runSmokeEntryPoint installs default or overridden storage before its injected loader imports the shared command, and invalid/unavailable storage invokes no loader or runner, as asserted in vitest-startup.test.ts. | diff-local |
| Story 2 negative: Given an invalid configured storage path, when startup validates the selection, then it reports the invalid path and stops before starting Vitest without allocating a fallback root. | 2, 4, 5 | vitest-temp.mjs rejects blank, relative, NUL-containing overrides and incomplete inherited-root context before allocation, with the invalid setting identified in vitest-temp.test.ts. | diff-local |
| Story 2 negative: Given a selected storage location that cannot be created, written, or resolved, when startup attempts to allocate its root, then it reports the location and underlying failure and stops before starting Vitest without falling back to the system temporary directory. | 3, 4, 5 | vitest-temp.mjs surfaces selected-location errors for injected permission, non-directory, ENOSPC/EDQUOT, and canonicalization failures without a system-temp fallback, as asserted in vitest-temp.test.ts. | diff-local |
| Story 3 happy: Given relocated test state, when a run ends successfully, fails, or receives a supported interrupt, then its owned temporary files are reclaimed and its caller's temporary-directory environment is restored without removing the storage parent. | 4, 5, 6 | Global teardown and supported interrupt handlers stop the heartbeat, reclaim only the owned run root on success or guard failure, preserve its parent, and restore temporary-directory state in vitest-temp-lifecycle.test.ts. | diff-local |
| Story 3 happy: Given abandoned eligible run roots in the selected storage or original temporary directory, when startup performs stale-root cleanup, then it applies the existing staleness policy at both locations. | 6 | Actual global setup applies the existing stale-root sweep to deduplicated original, selected, and nested-parent paths, as asserted by vitest-temp-lifecycle.test.ts using the existing staleness policy. | diff-local |
| Story 3 negative: Given live or ambiguous sibling roots or unrelated paths, when cleanup runs, then it retains those paths and does not broaden daemon-session cleanup to the checkout or storage parent. | 7 | The test-local tmux guard reaches only its injected runner and allows relocated cleanup only under explicit own/reaped roots; checkout/storage parents, prefix lookalikes, unknown paths, and failed-baseline teardown produce zero kill calls in tmux-leak-guard.test.ts. | diff-local |
| Story 3 negative: Given a fixture bypasses redirection and creates an unignored entry in the original temporary directory, when teardown runs, then the existing leak guard still reports that entry and fails the run. | 8 | The actual global-setup snapshot/diff path reports and fails an unignored planted entry in the saved original temporary directory after relocation, as asserted in vitest-temp-lifecycle.test.ts. | diff-local |

## Verification ownership

Each task carries its affected RED/GREEN tests through ai-conductor scoped-run. The existing test_suite gate owns aggregate proof; existing test typecheck and lint requirements apply. No new test invokes the aggregate suite, runs real smoke services, or exercises the operator's tmux server. Composer validates only its authored spec with the repository integrity suite and authoring checks; it does not implement or run BUILD.

All ten accepted criteria are mapped above, with explicit task dependencies and bounded negative cases. No accepted artifact from another feature is assigned for BUILD mutation. No release artifact or migration of shared consumer configuration is part of this implementation.
