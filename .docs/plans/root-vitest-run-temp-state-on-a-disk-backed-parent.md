# Implementation Plan: Root the vitest run temp state on a disk-backed parent

**Date:** 2026-09-06
**Stories:** .docs/stories/root-vitest-run-temp-state-on-a-disk-backed-parent.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent preserves the existing redirect contract exactly — one run-scoped root per run, `TMPDIR` and the run-root variable pointed at it, the git ceiling installed on it, the ignored-prefix list and stray/ignored verdict untouched, and the teardown reap unchanged. Only the directory the root is created in moves.

## Summary

Four bounded tasks deliver #2224. A new parent resolver in the leak-guard module returns a disk-backed, user-scoped directory (overridable by one environment variable), a companion accessor keeps the operator's real tmpdir observable once the run root leaves it, and the four existing run-root creation sites are routed through both. Stale-root accumulation under the new parent, per-worktree partitioning, tmpfs quotas, and worker counts are outside this slice.

## Technical Approach

Add `resolveRunTmpRootParent(realTmpdir, env = process.env)` to the leak-guard module. It records `realTmpdir` under a new `AI_CONDUCTOR_TEST_REAL_TMPDIR` key in `env` (first writer wins, so a config reload cannot overwrite the value the package runner recorded), then decides the parent. When `AI_CONDUCTOR_TEST_TMP_PARENT` is set and non-blank, that value is the only candidate and it is created with `mkdirSync(..., { recursive: true })`; a creation failure throws an error naming the variable and the value, because an operator or CI job that named a location must never be silently returned to the RAM-backed tmpdir. Otherwise the candidate is `<cacheHome>/ai-conductor/vitest-tmp`, where `cacheHome` is an absolute `XDG_CACHE_HOME` from `env` or `join(homedir(), '.cache')`; a creation failure here emits one `console.error` diagnostic naming the rejected candidate and the underlying error, then returns `realTmpdir` unchanged, so a machine with an unwritable home still runs. The resolved parent is passed through `realpathSync` for the same reason `ensureRunTmpRootSync` already canonicalizes the root: the git ceiling installed downstream must match git's canonical traversal path.

The user-scoped cache parent is chosen over a repository-ignored build directory deliberately. A parent inside the checkout would place hundreds of megabytes of fixture churn under the tree the self-host live boundary fingerprints, and any unexcluded path there halts a running self-host build; the cache parent sits outside every checkout and needs no exclusion entry.

`createRunTmpRoot` and `ensureRunTmpRootSync` keep their existing signatures and their existing meaning — "create the root inside the parent I am given". That is the seam the issue points at, their unit tests assert exactly that property against a fake parent, and moving the policy inside them would both break those tests and hide the decision from the call sites. The resolver is therefore applied at the call sites, not inside the creators.

Relocating the root breaks one existing derivation: global setup computes the real tmpdir as `dirname(runTmpRoot)`, which is correct only while the root lives directly inside the real tmpdir. Three behaviors depend on that value — the stray-entry snapshot and diff that catch a `mkdtemp` escaping the redirect, the real-tmpdir window opened around the tmux sweep so `isTmpdirRooted` still matches a pane cwd anywhere under the real tmpdir, and the teardown restore of `TMPDIR`. Add `resolveRealTmpdir(runTmpRoot, env = process.env)` returning the recorded value when present and `dirname(runTmpRoot)` otherwise, and have global setup use it. The teardown that deletes the run-root key deletes the recording alongside it, so a subsequent programmatic run re-records rather than inheriting a stale value.

Four call sites create or install a run root and all four are routed through the resolver: the package test runner, which must install the root before Vitest is loaded because Vitest allocates its project tmpDir before the config module is evaluated; the ordinary vitest config; the smoke vitest config; and global setup's fallback creator. The package runner is plain ESM run by `node`, and Node strips types from a directly imported `.ts` specifier, so it imports the resolver from the leak-guard module by its `.ts` path rather than duplicating the policy. That import was verified to work against the current module under the repository's Node version.

Tests follow the repository's test-authoring skill. The resolver and the real-tmpdir accessor are pure enough to test directly at the exported seam with an injected `env` object and a `mkdtemp` fake parent, alongside the existing leak-guard unit cases; an injected logger captures the fail-open diagnostic instead of writing to the console. Entry-point wiring is the one cross-boundary behavior here, so it gets one integration owner: a test that spawns each entry point in a child process with the override pointed at a temporary directory. The package runner's child is a stub `vitest` executable written into a temporary directory placed first on `PATH`, which prints the environment it received — a faithful fake at the only third-party boundary that entry point has. No real LLM, network, or package-manager call is involved anywhere.

## Preconditions and claim ledger

- Operator-delegate approved Small scope, the technical track, the user-scoped cache parent over a repository-ignored build directory, and all three stories on 2026-09-06 (delegated).
- Verified: `createRunTmpRoot` calls `mkdtemp(join(realTmpdir, RUN_TMP_ROOT_PREFIX))` and `ensureRunTmpRootSync` calls `mkdtempSync(join(realTmpdir, RUN_TMP_ROOT_PREFIX))`; neither calls `os.tmpdir()`, and the module header states that the parent is taken as an argument on purpose.
- Verified: `ensureRunTmpRootSync` canonicalizes the created root with `realpathSync`, then sets the run-root key, `TMPDIR`, and appends the root to `GIT_CEILING_DIRECTORIES` exactly once.
- Verified: the ordinary vitest config and the smoke vitest config each call `ensureRunTmpRootSync(tmpdir())` in module scope.
- Verified: the package test runner creates its root with `mkdtempSync(join(tmpdir(), 'ai-conductor-vitest-run-'))`, spawns `vitest` from `PATH` with the run-root key and `TMPDIR` set, and removes the root in a `finally`.
- Verified: global setup recovers the root from the run-root key or falls back to `createRunTmpRoot(tmpdir())`, then sets `realTmpdir` to `dirname(runTmpRoot)`; that value feeds the stray-entry snapshot and diff, the tmux-sweep window, and the teardown `TMPDIR` restore, and teardown deletes the run-root key.
- Verified: the existing leak-guard unit tests assert that both creators place the root inside the fake parent they are handed, which is why the resolver is applied at the call sites rather than inside them.
- Verified: the smoke runner deletes the run-root key and sets its own `TMPDIR` for its child, so a smoke child re-resolves the parent through the smoke config rather than nesting inside its parent's root.
- Verified: a plain `node` process on this repository's Node version imports the leak-guard module by its `.ts` path and reads its exports, so the package runner can share the resolver instead of duplicating it.
- Verified: on the operator's machine `df` reports `/tmp` as a 15G tmpfs and `/` as a 935G disk filesystem, which is the condition the issue reports.
- Verified: the structural test-execution policy forbids spawning provider CLIs, `gh` network operations, `curl`, `wget`, and package-manager installs; spawning `node` and a locally written stub executable is not forbidden.
- Overlap, verified: the in-flight companion for #2223 (branch `feat/daemon-sweep-stale-vitest-run-temp-roots-at-global-setup-`) adds a stale-run-root sweep to the same two files, and its sweep enumerates run roots in the value global setup calls `realTmpdir`. Whichever change lands second must point that sweep at the resolved run-root parent and leave the guards' real tmpdir as the recorded value; this plan changes no sweep behavior itself.
- Scope check: harness-repo-only (this repository's own suite, guards, and package runner); no skill addition; provider-agnostic. Event spine: no event, metric, span, or report is added or changed — the fail-open diagnostic is an existing-style `console.error` line from the same guard, not a new channel.
- Verify-claims verdict: CLEAR. No load-bearing assumption remains unconfirmed.

## Tasks

### Task 1: Resolve the run root's parent to a disk-backed location
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/test/tmpdir-leak-guard.ts, src/conductor/test/tmpdir-leak-guard.test.ts
**Dependencies:** none

**Steps:**
1. Write failing unit tests for a new exported `resolveRunTmpRootParent(realTmpdir, env)` against an injected `env` object: with an empty `env` and a stubbed home cache base it returns the `ai-conductor/vitest-tmp` directory under that base and the directory exists; with an absolute cache-home key set it returns the same suffix under that value; with the parent-override key set to a `mkdtemp` directory it returns exactly that directory.
2. Add a case asserting the returned parent is usable as a creator argument: hand it to the existing sync creator with the same `env` and assert the created root sits inside the returned parent and that the redirect keys and `TMPDIR` still name the created root.
3. Verify the cases fail (RED).
4. Implement the resolver: read the trimmed override key first, otherwise build the candidate from an absolute cache-home key or the home cache directory, create the chosen candidate with a recursive make-directory call, and return its canonical real path.
5. Verify the cases pass (GREEN), run the repository's typecheck target that covers test files, and commit the focused change.

**Done when:**
1. `resolveRunTmpRootParent` is exported from the leak-guard module and takes the process tmpdir plus an injectable environment object.
2. A unit case with no cache-home and no override returns the `ai-conductor/vitest-tmp` path under the home cache directory and that directory exists after the call.
3. A unit case with an absolute cache-home returns the same suffix under that cache home rather than under the home cache directory.
4. A unit case with the parent-override key set returns exactly that directory, and a root created in it through the existing sync creator sits inside it with the redirect keys and `TMPDIR` naming that root.

### Task 2: Fail open on an unusable default parent and fail closed on an unusable override
**Story:** Story 1 (negative path)
**Type:** negative-path
**Files:** src/conductor/test/tmpdir-leak-guard.ts, src/conductor/test/tmpdir-leak-guard.test.ts
**Dependencies:** 1

**Steps:**
1. Write a failing unit case where the default candidate cannot be created — point the cache-home key at a path whose parent is a regular file created by the test — and assert the resolver returns the process tmpdir it was given.
2. Extend the resolver signature with an injectable logger defaulting to `console.error`, and assert that failing case records exactly one message containing the rejected candidate path and the underlying error text.
3. Write a failing unit case where the parent-override key points at a path whose parent is a regular file, and assert the resolver throws an error whose message contains the override key name and the rejected value, and that the injected logger records nothing.
4. Verify both cases fail (RED), then implement: wrap the override branch so a creation failure rethrows with the naming message, and wrap the default branch so a creation failure logs once and returns the given process tmpdir.
5. Verify the cases pass (GREEN) and commit the focused change.

**Done when:**
1. A unit case with an uncreatable default candidate returns the process tmpdir argument unchanged rather than throwing.
2. That same case records exactly one logger message containing the rejected candidate path and the underlying error text.
3. A unit case with an uncreatable override throws an error whose message contains the override key name and the rejected value, and the injected logger records nothing for it.

### Task 3: Keep the real tmpdir observable to the guards defined against it
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/test/tmpdir-leak-guard.ts, src/conductor/test/global-setup.ts, src/conductor/test/tmpdir-leak-guard.test.ts
**Dependencies:** 1

**Steps:**
1. Write failing unit tests for a new exported `resolveRealTmpdir(runTmpRoot, env)`: with the real-tmpdir key recorded and a run root under a different parent it returns the recorded value; with the key absent it returns the parent directory of the run root and does not throw.
2. Write a failing unit case asserting `resolveRunTmpRootParent` records its process-tmpdir argument under the real-tmpdir key, and that a second call with a different argument leaves the first recording in place.
3. Verify the cases fail (RED), then implement both behaviors in the leak-guard module.
4. Replace global setup's `dirname(runTmpRoot)` derivation with the new accessor, route its fallback creator through the resolver, and delete the real-tmpdir key in the same teardown branch that deletes the run-root key.
5. Verify the cases pass (GREEN), run the repository's typecheck target that covers test files, and commit the focused change.

**Done when:**
1. A unit case with a recorded real tmpdir and a run root under a different parent returns the recorded value, not the run root's parent directory.
2. A unit case with the recording absent returns the run root's parent directory and does not throw.
3. A unit case proves the recording is written by the parent resolver and is not overwritten by a later call carrying a different process tmpdir.
4. Global setup derives its real tmpdir through the accessor rather than `dirname`, and its teardown deletes the real-tmpdir key alongside the run-root key.

### Task 4: Route every run-root entry point through the resolved parent
**Story:** Story 3
**Type:** happy-path
**Files:** src/conductor/vitest.config.ts, src/conductor/vitest.smoke.config.ts, src/conductor/scripts/run-vitest.mjs, src/conductor/test/structural/run-root-parent-entry-points.test.ts
**Dependencies:** 2, 3

**Steps:**
1. Write a failing entry-point test that creates a temporary override directory and a temporary bin directory holding a stub `vitest` executable which writes its received environment to a file and exits zero, then spawns the package test runner with that bin directory first on `PATH`, the override key pointing at the temporary parent, and the run-root key unset.
2. Assert from the captured environment that the run root is inside the temporary parent, that `TMPDIR` equals the run root, and that the real-tmpdir key carries the process tmpdir the runner observed.
3. Add failing cases that evaluate each vitest config module in a child `node` process with the same override and no installed run root, printing the installed run-root key, and assert the installed root is inside the temporary parent; add one case that presets the run-root key and asserts the printed root is unchanged and the temporary parent gains no entry.
4. Verify the cases fail (RED), then change both config modules to pass the resolved parent to the sync creator, and change the package runner to import the resolver, resolve the parent from its own environment copy, create the root there, and pass the run-root key, `TMPDIR`, and the recorded real-tmpdir key to the child.
5. Verify the cases pass (GREEN), run the repository's typecheck target that covers test files and its lint command, and commit the focused change.

**Done when:**
1. The package-runner case observes a child environment whose run root is inside the overridden parent, whose `TMPDIR` equals that run root, and whose real-tmpdir key is present and is not the overridden parent.
2. Each vitest config module evaluated in a child process with the override set installs a run root inside the overridden parent.
3. A config module evaluated with a run root already installed prints that same root and adds no entry under the overridden parent.
4. Neither config module nor the package runner passes the process tmpdir directly to a run-root creator any more.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given no cache-home and no parent-override variable are set in the environment, when the suite resolves the run root's parent, then the resolved parent is the `ai-conductor/vitest-tmp` directory under the home cache directory, it exists after resolution, and the created run root is inside it. | 1 | "A unit case with no cache-home and no override returns the `ai-conductor/vitest-tmp` path under the home cache directory and that directory exists after the call." | diff-local |
| Story 1 happy: Given the environment sets an absolute cache-home directory, when the suite resolves the run root's parent, then the resolved parent is the `ai-conductor/vitest-tmp` directory under that cache home rather than under the home cache directory. | 1 | "A unit case with an absolute cache-home returns the same suffix under that cache home rather than under the home cache directory." | diff-local |
| Story 1 happy: Given the environment sets the parent-override variable to a writable absolute directory, when the suite resolves the run root's parent, then the resolved parent is exactly that directory, the run root is created inside it, and the redirect still points `TMPDIR` and the run-root variable at the created run root. | 1 | "A unit case with the parent-override key set returns exactly that directory, and a root created in it through the existing sync creator sits inside it with the redirect keys and `TMPDIR` naming that root." | diff-local |
| Story 1 negative: Given no parent-override is set and the default cache parent cannot be created, when the suite resolves the run root's parent, then it returns the process tmpdir it was given, emits one diagnostic naming the rejected default parent and the underlying reason, and the run proceeds. | 2 | "That same case records exactly one logger message containing the rejected candidate path and the underlying error text." | diff-local |
| Story 1 negative: Given the parent-override variable is set to a path that cannot be created, when the suite resolves the run root's parent, then it throws an error naming the override variable and its value, and never silently falls back to the process tmpdir. | 2 | "A unit case with an uncreatable override throws an error whose message contains the override key name and the rejected value, and the injected logger records nothing for it." | diff-local |
| Story 2 happy: Given the run root was created under a parent that is not the process tmpdir, when the suite resolves the real tmpdir for its guards, then it returns the tmpdir recorded at parent resolution rather than the run root's parent directory. | 3 | "A unit case with a recorded real tmpdir and a run root under a different parent returns the recorded value, not the run root's parent directory." | diff-local |
| Story 2 negative: Given no recorded real tmpdir is present in the environment, when the suite resolves the real tmpdir for its guards, then it returns the run root's parent directory and does not throw. | 3 | "A unit case with the recording absent returns the run root's parent directory and does not throw." | diff-local |
| Story 3 happy: Given the parent-override variable names a writable directory and no run root is installed, when the package test runner starts and spawns its child, then the run root it created is inside that directory and the child environment carries the run root, a `TMPDIR` equal to it, and the recorded real tmpdir. | 4 | "The package-runner case observes a child environment whose run root is inside the overridden parent, whose `TMPDIR` equals that run root, and whose real-tmpdir key is present and is not the overridden parent." | diff-local |
| Story 3 happy: Given the parent-override variable names a writable directory and no run root is installed, when either vitest config module is evaluated, then the installed run root is inside that directory. | 4 | "Each vitest config module evaluated in a child process with the override set installs a run root inside the overridden parent." | diff-local |
| Story 3 negative: Given a run root is already installed in the environment, when a vitest config module is evaluated, then it reuses the installed run root and creates no second directory under the resolved parent. | 4 | "A config module evaluated with a run root already installed prints that same root and adds no entry under the overridden parent." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local: every one is decided by code in this diff plus fixtures the tests create, and no commit outside the feature can change whether they hold. Tasks 1 through 3 own unit coverage at the exported resolver and accessor seams, with the environment, the logger, and the parent directory all injected — no process environment is mutated and no real cache directory is touched. Task 4 is the sole cross-boundary integration owner: run-root installation crosses from the guard module into the package test runner and both vitest config modules, and a unit test of the resolver cannot prove those entry points reach it, so Task 4 observes each entry point in a child process through its own environment. The stub `vitest` executable is the faithful fake at that entry point's only third-party boundary; nothing spawns a provider CLI, a package manager, or a network client. Existing leak-guard, redirect-propagation, and global-setup coverage supplies the unchanged redirect, ignored-prefix, stray-verdict, and reap permutations; none of it is duplicated here, and no aggregate or smoke test is added.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 4
Task 1 -> Task 3 -> Task 4
