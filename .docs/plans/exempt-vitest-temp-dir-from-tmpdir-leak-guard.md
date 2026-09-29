# Implementation Plan: Exempt Vitest's own temp dir from the tmpdir leak guard

**Date:** 2026-09-28
**Stories:** .docs/stories/exempt-vitest-temp-dir-from-tmpdir-leak-guard.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the change is confined to the conductor test harness's tmpdir leak guard and package runner, and no in-flight PR touches those files.

## Summary

Three bounded tasks deliver #2759. The tmpdir leak guard learns the Vitest project's own temp directory from the project Vitest already passes to globalSetup and exempts exactly that one name, and the package runner launches the package-local Vitest binary so a direct `node scripts/run-vitest.mjs` works without `node_modules/.bin` on PATH. The repository's scoped test command, run-root allocation, ignored-prefix list, and any fail-fast refusal of unredirected runs are out of scope.

## Technical Approach

Vitest 4 computes its instance temp directory from `os.tmpdir()` as a class field, before `vitest.config.ts` installs the run-scoped `TMPDIR` redirect, hands it to the root `TestProject` as the public readonly `tmpDir`, and calls every globalSetup `setup` with that project. On a bare `npx vitest run` launch that directory is a direct child of the real tmpdir and still exists when the globalSetup teardown re-snapshots, so `diffTmpdirEntries` reports it as stray. Under the package runner the same directory lives inside the run root and never appears in the real tmpdir.

Add a pure exported helper `vitestOwnTmpdirEntries(projectTmpDirs, realTmpdir)` to `src/conductor/test/tmpdir-leak-guard.ts`: it returns the basename of each supplied path whose resolved parent equals the resolved real tmpdir, and ignores undefined, empty, or non-child paths. Extend `diffTmpdirEntries` with a fourth optional parameter `exemptEntries: readonly string[] = []`; an after-entry whose name is exactly in that list is omitted from both `stray` and `ignored`. Exact string equality is the mechanism that keeps the exemption from widening: a look-alike name sharing the prefix is not equal and stays stray. `IGNORED_TMPDIR_PREFIXES` is not changed, because the Vitest name is a random nanoid with no stable prefix.

In `src/conductor/test/global-setup.ts`, give `setup` an optional first parameter typed structurally as `{ readonly tmpDir?: string }` (Vitest's `TestProject` satisfies it, and existing callers that pass nothing keep working). Compute the exemption once from `project?.tmpDir` and `originalTmpdir`, and pass it as the fourth argument in the existing teardown call to `diffTmpdirEntries`. No other guard changes.

In `src/conductor/scripts/run-vitest.mjs`, derive the package directory from `import.meta.url` (the same `dirname(dirname(fileURLToPath(import.meta.url)))` pattern `scripts/vitest-temp.mjs` uses) and spawn `<package>/node_modules/.bin/vitest` when that file exists, otherwise the bare `vitest` command as today. Feature worktrees symlink `src/conductor/node_modules` to the root checkout's, so the package-local path resolves there. Spawn errors keep today's handling: the promise rejects, `finally` removes the owned root, and the process exits nonzero.

Test patterns: `src/conductor/test/tmpdir-leak-guard.test.ts` already unit-tests `diffTmpdirEntries` with a `snap([...])` builder; extend it. `src/conductor/test/vitest-temp-lifecycle.test.ts` already imports `setup` from `global-setup.ts` with `vi.doMock` fakes for the pipeline, park, tmux, signals, and engine-dist guards; the new integration case follows it but leaves `tmpdir-leak-guard.js` unmocked so the real snapshot and diff run over a fixture-owned original tmpdir. `src/conductor/test/vitest-startup.test.ts` already copies the runner into a fixture root and launches it with node against a fake Vitest binary; the new cases place the fake under the fixture's own node_modules bin directory and control PATH explicitly.

## Preconditions and claim ledger

- Operator approved Small scope, technical track, the exact-name exemption approach, and both stories on 2026-09-28 (delegated).
- Verified: `src/conductor/test/global-setup.ts` declares `export default async function setup()` with no parameter and calls `applyTmpdirTeardownDecision(diffTmpdirEntries(tmpdirBefore, tmpdirAfter), originalTmpdir)` in its teardown guards.
- Verified: `src/conductor/test/tmpdir-leak-guard.ts` exports `diffTmpdirEntries(before, after, ignoredPrefixes = IGNORED_TMPDIR_PREFIXES)`, `snapshotTmpdirEntries`, `IGNORED_TMPDIR_PREFIXES`, and the `TmpdirDiff` interface with `stray` and `ignored`.
- Verified: Vitest 4.1.11 `cli-api.CnMVyzaz.js` sets `_tmpDir = join(tmpdir(), nanoid())` as a class field, constructs the root project with it, assigns it to the public `tmpDir`, and invokes `globalSetupFile.setup?.(this)` with the project; the public typing declares `readonly tmpDir: string`.
- Verified: `src/conductor/vitest.config.ts` calls `ensureRunTmpRootSync()` at module scope, which runs after the Vitest instance is constructed.
- Verified: `src/conductor/scripts/run-vitest.mjs` calls `spawn('vitest', process.argv.slice(2), ...)` and removes an owned root in `finally`.
- Verified: `src/conductor/scripts/vitest-temp.mjs` derives its package directory as `dirname(dirname(fileURLToPath(import.meta.url)))`.
- Verified: `src/conductor/test/vitest-startup.test.ts` launches a copied runner with a fake `vitest` on a prepended PATH directory; `src/conductor/test/vitest-temp-lifecycle.test.ts` imports `setup` with mocked guards; `docs/contributing/testing.md` documents `npm test -- <selectors>` and the run-scoped TMPDIR.
- Verified: feature worktrees carry `src/conductor/node_modules` as a symlink to the root checkout's package directory.
- Scope check: repository-only test harness; no skill addition; provider-agnostic. Event-spine: not applicable, no new channel.
- Verify-claims verdict: CLEAR.

## Tasks

### Task 1: Exempt an exact Vitest temp entry in the tmpdir diff
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/test/tmpdir-leak-guard.ts, src/conductor/test/tmpdir-leak-guard.test.ts
**Dependencies:** none

**Steps:**
1. In the existing diffTmpdirEntries unit block, add RED cases: an exact exempt name absent from both stray and ignored; a look-alike name that starts with the exempt name still stray; other new entries unchanged; and the default call with no fourth argument unchanged.
2. Add a unit block for vitestOwnTmpdirEntries: a direct child of the real tmpdir yields its basename; a path nested deeper, a path under another parent, an empty string, and undefined yield nothing.
3. Implement the fourth diffTmpdirEntries parameter and the exported vitestOwnTmpdirEntries helper as described in Technical Approach, using exact string equality and resolved-parent comparison; do not touch IGNORED_TMPDIR_PREFIXES.
4. Run the file through the scoped runner and commit.

**Done when:**
1. The diffTmpdirEntries unit test proves an exempt name listed in the fourth argument appears in neither stray nor ignored while a look-alike name sharing its prefix is returned in stray.
2. The vitestOwnTmpdirEntries unit test proves only a direct child of the real tmpdir yields its basename, and nested, foreign-parent, empty, and undefined inputs yield an empty list.
3. Existing diffTmpdirEntries unit cases pass unchanged with the default fourth argument.

### Task 2: Feed the Vitest project temp dir into the teardown guard
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/test/global-setup.ts, src/conductor/test/vitest-temp-lifecycle.test.ts
**Dependencies:** 1

**Steps:**
1. In the lifecycle test file, add an integration case that mocks the pipeline, park, tmux, signals, and engine-dist guards exactly as the existing cases do but leaves the tmpdir leak guard real. Point the original tmpdir at a fixture-owned directory, call setup with a project whose tmpDir is a direct child of that directory, then create that child before teardown.
2. Assert RED for three runs: only the Vitest child present, where teardown resolves; the Vitest child plus a separate new entry, where teardown rejects naming the separate entry and not the Vitest child; and setup called with no project, where the Vitest-named child is reported as stray.
3. Add the optional structural project parameter to setup, compute the exemption from its tmpDir and the original tmpdir with vitestOwnTmpdirEntries, and pass it to the teardown diffTmpdirEntries call.
4. Run the lifecycle file through the scoped runner and commit.

**Done when:**
1. The lifecycle integration test proves teardown resolves when the only new original-tmpdir entry is the passed project's tmpDir basename.
2. The lifecycle integration test proves teardown rejects with a message naming a separately created entry and not containing the project's tmpDir basename.
3. The lifecycle integration test proves setup called with no project reports the same Vitest-named child as stray.
4. A lifecycle case whose project tmpDir lies inside the run root, not the original tmpdir, still rejects on a separately created original-tmpdir entry exactly as before.

### Task 3: Launch the package-local Vitest binary from the runner
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/scripts/run-vitest.mjs, src/conductor/test/vitest-startup.test.ts, docs/contributing/testing.md
**Dependencies:** none

**Steps:**
1. In the launcher test file, add RED cases using the existing fixture that copies the runner and its temp module. Case A writes the fake Vitest binary under the fixture's own node_modules bin directory and launches with a PATH containing only the directory of the running node executable. Case B keeps today's PATH-only fake. Case C provides no binary in either place, with the same minimal PATH.
2. Implement the package-local lookup in the runner as described in Technical Approach, keeping the PATH fallback, argument forwarding, environment, signal forwarding, and finally-block root removal unchanged.
3. Add one sentence to the run-scoped TMPDIR section of the contributing testing guide stating that the runner launches the package-local Vitest binary, so invoking it directly with node needs no PATH changes.
4. Run the launcher file through the scoped runner and commit.

**Done when:**
1. Launcher case A observes the package-local fake ran with the forwarded run arguments and TMPDIR equal to the run root while PATH held no vitest command.
2. Launcher case B observes the PATH fake ran when no package-local binary exists, and every existing launcher case passes unchanged.
3. Launcher case C exits nonzero, writes no observation file, and leaves no run-root directory under the fixture's storage parent.
4. The contributing testing guide's run-scoped TMPDIR section names the package-local Vitest binary lookup.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a run whose Vitest project temp directory is a direct child of the real tmpdir, when that directory is present at teardown and nothing else appeared, then the tmpdir leak guard passes without naming it as stray. | 1, 2 | "The lifecycle integration test proves teardown resolves when the only new original-tmpdir entry is the passed project's tmpDir basename." | diff-local |
| Story 1 happy: Given a run launched through the package runner, whose Vitest project temp directory lies inside the run root, when teardown runs, then the guard's verdict is unchanged from today. | 2 | "A lifecycle case whose project tmpDir lies inside the run root, not the original tmpdir, still rejects on a separately created original-tmpdir entry exactly as before." | diff-local |
| Story 1 negative: Given a run whose Vitest project temp directory is exempt, when a test also created a different new entry directly in the real tmpdir, then teardown fails naming that entry and not the Vitest directory. | 2 | "The lifecycle integration test proves teardown rejects with a message naming a separately created entry and not containing the project's tmpDir basename." | diff-local |
| Story 1 negative: Given a new real-tmpdir entry whose name merely starts with the Vitest directory's name, or a Vitest project temp directory that is not a direct child of the real tmpdir, when teardown runs, then that entry is still classified as stray. | 1 | "The diffTmpdirEntries unit test proves an exempt name listed in the fourth argument appears in neither stray nor ignored while a look-alike name sharing its prefix is returned in stray." | diff-local |
| Story 1 negative: Given globalSetup is invoked without a project or with a project lacking a temp directory, when teardown runs, then no entry is exempted and every new unmatched entry is stray. | 1, 2 | "The lifecycle integration test proves setup called with no project reports the same Vitest-named child as stray." | diff-local |
| Story 2 happy: Given the conductor package has a Vitest binary under its own node_modules bin directory and that directory is not on PATH, when the package runner is invoked directly with node, then it launches that binary with the forwarded arguments and the run-scoped TMPDIR. | 3 | "Launcher case A observes the package-local fake ran with the forwarded run arguments and TMPDIR equal to the run root while PATH held no vitest command." | diff-local |
| Story 2 negative: Given no package-local Vitest binary exists, when the package runner is invoked, then it falls back to the vitest command on PATH exactly as today. | 3 | "Launcher case B observes the PATH fake ran when no package-local binary exists, and every existing launcher case passes unchanged." | diff-local |
| Story 2 negative: Given no Vitest binary exists either package-locally or on PATH, when the package runner is invoked, then it exits nonzero and removes the run root it allocated. | 3 | "Launcher case C exits nonzero, writes no observation file, and leaves no run-root directory under the fixture's storage parent." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against fixture-owned directories. Task 1 owns the pure unit cases for the exact-name exemption, look-alike names, non-child paths, and absent project data. Task 2 owns the integration proof through the real globalSetup entry point: setup and its returned teardown run with the real tmpdir leak guard over a fixture-owned original tmpdir, with only the unrelated guards faked, as the existing lifecycle cases do. Task 3 owns the launcher integration proof by running the copied runner script with node against fake Vitest binaries, as the existing launcher cases do. No test spawns the real Vitest, touches the operator's real tmpdir, or calls a network service. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 3

Small tier: architecture and coherence artifacts are skipped. No ADR or amendment is required.
