# Implementation Plan: Pi build dispatches run without the destructive-git guard

**Date:** 2026-10-09
**Design:** none (technical track, Tier S — see `.docs/track/pi-build-dispatches-run-without-the-destructive-gi.md`)
**Stories:** .docs/stories/pi-build-dispatches-run-without-the-destructive-gi.md
**Conflict check:** Not required (Tier S)

## Summary

Bring the Pi provider adapter to the engine git-guard contract Claude and Codex already meet
(adr-2026-09-23-engine-git-guard-on-agent-path D2, D3, D10). This delivers jstoup111/ai-conductor#3002
and also covers jstoup111/ai-conductor#2895 and jstoup111/ai-conductor#2854, which describe the same gap.
Six tasks: guarded child `PATH` and result reporting, a real-worktree refusal proof through the
adapter, fail-before-launch on an unrepairable guard, the review exemption, unguarded launch outside
prepared worktrees, and an opt-in Pi live guard smoke.

## Technical Approach

- **Reuse the shared seam; add no Pi-specific mechanism.** `PiProvider.invoke` in
  `src/conductor/src/execution/pi-provider.ts` calls `ensureGitGuardForDispatch(options.cwd)` from
  `src/conductor/src/engine/git-guard.ts` and `withGitGuardPath` from
  `src/conductor/src/execution/child-environment.ts`, exactly as `claude-provider.ts` and
  `codex-provider.ts` do (`guardDir = options.reviewDispatch ? null : await ensureGitGuardForDispatch(options.cwd)`,
  and a thrown error becomes `{ success: false, output: <message>, exitCode: 1 }` with nothing spawned).
  The call goes immediately after the spawn-permit validation, before the HARNESS.md check, argv
  construction and any filesystem preflight, so an unverifiable guard never reaches a spawn.
- **Why `PATH` is sufficient for Pi (verified against the installed Pi package).** Pi's bash tool
  spawns its shell with `getShellEnv()`, which is `{ ...process.env, PATH: <pi agent bin>:<process PATH> }`
  (`@earendil-works/pi-coding-agent` `dist/utils/shell.js` `getShellEnv`, used by `dist/core/tools/bash.js`).
  A guard directory at the front of the Pi process `PATH` is therefore second only to Pi's own agent
  `bin` directory in every Pi shell, and Pi child sessions spawned by `pi-subagents` inherit the same
  environment. A `git` placed in Pi's agent `bin` directory would shadow the guard; that is the
  `PATH`-shadowing limit adr-2026-09-23-engine-git-guard-on-agent-path D10 already records, and the
  Task 6 live smoke is what proves `command -v git` resolves to the guard in a real Pi shell.
- **Materialize the inherited `PATH` before prepending.** Pi passes execa an overlay env (self-host
  overlay, daemon marker, tmux scrub, optional managed-session composition) that normally has no
  `PATH`, and execa's default `extendEnv` merges `process.env` underneath it. Prepending onto an
  absent `PATH` would leave the child with only the guard directory. When `guardDir` is non-null, the
  adapter therefore applies `withGitGuardPath` to the final env with
  `PATH: env.PATH ?? this.environment.env.PATH` — the same materialization `codex-provider.ts`
  performs with `invocationEnv.PATH ?? process.env.PATH`, using Pi's injected `PiEnvironment.env`
  (default `process.env`) so tests control it. The guard is prepended **after** the managed-session
  composition, matching `claude-provider.ts` (`withGitGuardPath(this.buildEnv(options), guardDir)`),
  so the guard precedes the managed `gh` wrapper directory. When `guardDir` is null, the env passed
  to the subprocess factory stays exactly what it is today.
- **Review exemption keys on `reviewDispatch`, like Claude and Codex.** Every engine build-review
  dispatch sets `reviewDispatch: true` (`src/conductor/src/engine/step-runners.ts`), including the
  read-only-review ones, so Pi reviews are exempt by the same flag and Pi's read-only `--tools`
  argv is untouched.
- **Report the fact on every post-spawn result.** Every `InvokeResult` the adapter returns after the
  guard decision and spawn (abort, missing binary, parse failure, error stop, success, failure)
  carries `gitGuardInstalled: guardDir !== null`. The self-host dispatch path already passes
  `result.gitGuardInstalled === true` into `auditEnvironmentBlockerClaims` for every provider
  (`src/conductor/src/engine/conductor.ts`), so no conductor change is needed.
- **Test pattern.** Mocked-guard adapter cells follow `src/conductor/test/execution/codex-provider.test.ts`
  (`vi.hoisted` `mockEnsureGitGuardForDispatch` plus `vi.mock('../../src/engine/git-guard.js', ...)`)
  in a new `src/conductor/test/execution/pi-provider-git-guard.test.ts`, so the existing
  `pi-provider.test.ts` stays unmocked and unchanged. Real-worktree cells use the fixtures
  `initTestRepo` (`src/conductor/test/fixtures/git-repo.ts`) and `prepareWorktree`
  (`src/conductor/src/engine/worktree-prepare.ts`) in a new
  `src/conductor/test/execution/pi-provider-git-guard.integration.test.ts`, with the Pi process
  replaced through `PiProvider`'s `subprocessFactory` constructor seam and HARNESS.md supplied
  through a fake `PiEnvironment` (see `fakePiEnvironment` in `pi-provider.test.ts`). The live smoke
  copies `src/conductor/test/smoke/git-guard-codex.smoke.test.ts`.
- **Test process isolation (CLAUDE.md).** No test runs a destructive git command outside a
  temporary fixture repository. The integration fake runs `command -v git` first and runs
  `git clean -f` only when that path is inside the fixture's `.pipeline/bin`; otherwise it returns
  the observed path without running the destructive command, so the test fails safely against
  pre-change code.
- No change to the guard script, its refusal matrix, `ensureGitGuardForDispatch`, the Claude or
  Codex adapters, Pi's read-only review tool set, or the environment-claim audit (scope boundary).

## Prerequisites

- None. #1354 (guard seam) and #1886 (Pi child-environment construction) have shipped.

## Tasks

### Task 1: Pi writable dispatches in a prepared worktree get the guard first on PATH and report it
**Story:** 1
**Type:** happy-path

**Steps:**
1. Create `src/conductor/test/execution/pi-provider-git-guard.test.ts`, mocking `../../src/engine/git-guard.js` with a hoisted `mockEnsureGitGuardForDispatch` as `codex-provider.test.ts` does. Construct `new PiProvider('pi', factory, fakeEnvironment)` where `factory` is a `vi.fn` returning a completed JSONL run (reuse the terminal-assistant fixture style from `pi-provider.test.ts`) and `fakeEnvironment.env.PATH` is `/usr/local/bin:/usr/bin`, with HARNESS.md present.
2. Write failing tests: (a) with the mock resolving `/prepared/.pipeline/bin` and `cwd: '/prepared'`, for both a non-self-host dispatch and a self-host dispatch whose `selfHost.env` overlay sets an empty `HOME` (the ADR D10 provider-by-run-mode cells, as in `codex-provider.test.ts`'s empty-HOME case), the factory's `options.env.PATH` equals `/prepared/.pipeline/bin:/usr/local/bin:/usr/bin`, `mockEnsureGitGuardForDispatch` was called with `'/prepared'`, and the result has `gitGuardInstalled: true`; (b) with a managed-session context prepared as in `src/conductor/test/execution/managed-session-adapters.test.ts`, the first `PATH` entry is `/prepared/.pipeline/bin` and the managed `gh` wrapper directory is the second entry; (c) an aborted run and an exit-127 run in that guarded dispatch both return `gitGuardInstalled: true`.
3. In `src/conductor/test/engine/environment-claim-audit.test.ts`, add: for provider `pi` with `gitGuardInstalled: true`, `auditEnvironmentBlockerClaims('The sandbox blocks git push --force.', ...)` returns `message: null`, and the same output with `gitGuardInstalled: false` returns a non-null message.
4. Verify RED (the audit case may already pass; it pins the Pi fact the adapter now supplies).
5. Implement in `pi-provider.ts`: import `ensureGitGuardForDispatch` and `withGitGuardPath`; resolve `guardDir` after spawn-permit validation; when `guardDir` is non-null, pass `withGitGuardPath({ ...finalEnv, PATH: finalEnv.PATH ?? this.environment.env.PATH }, guardDir)` to the factory, where `finalEnv` is the env after managed-session composition; add `gitGuardInstalled: guardDir !== null` to every result returned after the spawn.
6. Verify GREEN; commit "feat(pi-provider): put the engine git guard first on PATH for prepared worktrees".

**Done when:**
- [test] `pi-provider-git-guard.test.ts` asserts that for a non-review dispatch with `cwd: '/prepared'`, in both a non-self-host run and a self-host run with an empty `HOME`, the factory receives `env.PATH` exactly `/prepared/.pipeline/bin:/usr/local/bin:/usr/bin`, `ensureGitGuardForDispatch` was called with `/prepared`, and the result carries `gitGuardInstalled: true`.
- [test] `pi-provider-git-guard.test.ts` asserts that with a prepared managed-session context the first `PATH` entry is `/prepared/.pipeline/bin` and the managed `gh` wrapper directory is the second entry.
- [test] `pi-provider-git-guard.test.ts` asserts the aborted and exit-127 results of a guarded dispatch both carry `gitGuardInstalled: true`.
- [test] `environment-claim-audit.test.ts` asserts that for provider `pi` with `gitGuardInstalled: true` the output `The sandbox blocks git push --force.` is not refuted (`message` is null), while with `gitGuardInstalled: false` it is refuted.
- The existing `pi-provider.test.ts` cases pass unchanged, including the exact self-host env assertions for unguarded dispatches.

**Files likely touched:**
- `src/conductor/src/execution/pi-provider.ts` — guard resolution, guarded env, `gitGuardInstalled` on results
- `src/conductor/test/execution/pi-provider-git-guard.test.ts` — mocked-guard adapter cells
- `src/conductor/test/engine/environment-claim-audit.test.ts` — Pi guarded force-push claim case

**Dependencies:** none

### Task 2: A real prepared worktree refuses destructive git through the Pi adapter's environment
**Story:** 1
**Type:** happy-path

**Steps:**
1. Create `src/conductor/test/execution/pi-provider-git-guard.integration.test.ts` (no `git-guard.js` mock). In a `mkdtemp` directory run `initTestRepo` then `prepareWorktree`, and write an untracked file `untracked.txt`.
2. Inject a `subprocessFactory` fake that does not start Pi: it runs `sh -c 'command -v git'` with execa using the `env` and `cwd` the adapter passed; only when the printed path equals `<fixture>/.pipeline/bin/git` does it then run `sh -c 'git clean -f'` with the same `env` and `cwd`; it records each command's exit code, stdout and stderr separately for the test to inspect, and returns a Pi JSONL stream whose terminal assistant message text is `command -v git`'s stdout.
3. Write the failing test: invoke `new PiProvider('pi', fake, fakeEnvironment)` with `cwd` set to the fixture, a non-review dispatch, and `fakeEnvironment.env.PATH` set to the test process `PATH`. Assert the output's first line is `<fixture>/.pipeline/bin/git`, the recorded `git clean -f` exit code is non-zero and its recorded stderr contains `ai-conductor git guard: refused`, `untracked.txt` still exists, and the result carries `gitGuardInstalled: true`.
4. Verify RED if this runs before Task 1 lands (the fake records the unguarded path and skips the destructive command). If Task 1 has already landed the test passes immediately and this task commits only the test; build_review's counterfactual proves it fails against pre-change code. Commit "test(pi-provider): prove the guard refuses forced clean through the Pi child env".

**Done when:**
- [test] `pi-provider-git-guard.integration.test.ts` asserts that `PiProvider.invoke` on a real prepared fixture worktree yields an environment in which `command -v git` prints `<fixture>/.pipeline/bin/git`.
- [test] The same test asserts `git clean -f` run with that environment exits non-zero with stderr containing `ai-conductor git guard: refused`, the fixture's `untracked.txt` still exists afterwards, and the result carries `gitGuardInstalled: true`.
- The fake runs `git clean -f` only after observing the guard path inside the fixture's `.pipeline/bin`, so no destructive command runs unguarded or outside the fixture.

**Files likely touched:**
- `src/conductor/test/execution/pi-provider-git-guard.integration.test.ts` — real-worktree refusal proof

**Dependencies:** Task 1

### Task 3: An unverifiable guard fails the Pi dispatch before launch
**Story:** 1
**Type:** negative-path

**Steps:**
1. In `pi-provider-git-guard.test.ts`, write the failing test: the mock rejects with `new Error('git guard repair failed: /prepared/.pipeline/bin/git: guard is not a regular executable file')` for a non-review dispatch with `cwd: '/prepared'`.
2. Assert the result equals `{ success: false, output: 'git guard repair failed: /prepared/.pipeline/bin/git: guard is not a regular executable file', exitCode: 1 }` and the subprocess factory was never called.
3. Verify RED if Task 1 did not already convert the rejection; otherwise this task commits the test only. Ensure the `catch` in `pi-provider.ts` returns that shape before any spawn.
4. Verify GREEN; commit "test(pi-provider): refuse to launch when the git guard cannot be verified".

**Done when:**
- [test] `pi-provider-git-guard.test.ts` asserts a rejected `ensureGitGuardForDispatch` yields exactly `{ success: false, output: <rejection message naming /prepared/.pipeline/bin/git>, exitCode: 1 }`.
- [test] The same test asserts the Pi subprocess factory was called zero times for that dispatch.

**Files likely touched:**
- `src/conductor/test/execution/pi-provider-git-guard.test.ts` — unverifiable-guard case
- `src/conductor/src/execution/pi-provider.ts` — guard-failure return before spawn (if not already exact)

**Dependencies:** Task 1

### Task 4: Pi review dispatches skip the guard
**Story:** 2
**Type:** happy-path

**Steps:**
1. In `pi-provider-git-guard.test.ts`, write failing tests: (a) `reviewDispatch: true` with `cwd: '/prepared'` and the mock resolving `/prepared/.pipeline/bin`: `mockEnsureGitGuardForDispatch` is never called, the factory's `env` carries no `PATH` entry containing `.pipeline/bin`, and the result carries `gitGuardInstalled: false`; (b) `reviewDispatch: true, readOnlyReview: true` with the mock set to reject: the factory is called once and its argv contains `--tools` followed by `read,grep,find,ls,git_read`.
2. Verify RED if Task 1 has not landed (pre-change results lack `gitGuardInstalled: false`); otherwise the test passes immediately and this task commits only the test. Implement nothing beyond Task 1 unless the review branch still consults the guard.
3. Verify GREEN; commit "test(pi-provider): keep build-review dispatches exempt from the git guard".

**Done when:**
- [test] `pi-provider-git-guard.test.ts` asserts a `reviewDispatch` Pi invocation never calls `ensureGitGuardForDispatch`, spawns with no `.pipeline/bin` `PATH` entry, and returns `gitGuardInstalled: false`.
- [test] `pi-provider-git-guard.test.ts` asserts a read-only review dispatch whose guard check would reject still spawns once with the `--tools` value `read,grep,find,ls,git_read`.

**Files likely touched:**
- `src/conductor/test/execution/pi-provider-git-guard.test.ts` — review-exemption cases

**Dependencies:** Task 1

### Task 5: Pi dispatches outside a prepared worktree launch unguarded
**Story:** 3
**Type:** negative-path

**Steps:**
1. In `pi-provider-git-guard.integration.test.ts`, with a recording `subprocessFactory` fake that returns a completed Pi JSONL run and captures `env`, write failing tests over real directories: (a) `cwd` is a `mkdtemp` directory that is not a git repository; (b) `cwd` is an `initTestRepo` repository never passed to `prepareWorktree`; (c) `cwd` is a linked worktree created with `git worktree add` from an `initTestRepo` repository whose `extensions.worktreeConfig` is unset.
2. For each, assert the factory was called once, its `env.PATH` (if set) contains no `.pipeline/bin` entry, `<cwd>/.pipeline/bin/git` does not exist, and the result carries `gitGuardInstalled: false` with no guard-verification failure.
3. The test passes immediately once Task 1 has landed (pre-change results lack `gitGuardInstalled: false`, which the counterfactual proves), so this task commits only the test. Commit "test(pi-provider): launch unguarded outside engine-prepared worktrees".

**Done when:**
- [test] `pi-provider-git-guard.integration.test.ts` asserts that for a non-repository `cwd` and for an unprepared repository `cwd` Pi is spawned once with no `.pipeline/bin` `PATH` entry, no `<cwd>/.pipeline/bin/git` is written, and the result carries `gitGuardInstalled: false`.
- [test] The same file asserts that for a linked worktree without `extensions.worktreeConfig` Pi is spawned once, the result is not a guard-verification failure, and it carries `gitGuardInstalled: false`.

**Files likely touched:**
- `src/conductor/test/execution/pi-provider-git-guard.integration.test.ts` — unprepared-cwd cases

**Dependencies:** Task 2

### Task 6: Opt-in Pi git guard live smoke
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Create `src/conductor/test/smoke/git-guard-pi.smoke.test.ts` by copying `git-guard-codex.smoke.test.ts`: `const smokeCapability = 'credentialed:pi';`, provider looked up as `LIVE_E2E_PROVIDERS.find(({ id }) => id === 'pi')` from `src/engine/live-e2e-providers.js`, `describe.skipIf(!available)` where `available` requires `which pi` and a non-empty credential env var, and a test that runs `initTestRepo` plus `prepareWorktree` on a `mkdtemp` worktree, invokes `new PiProvider().invoke({ cwd: worktree, sessionId: 'git-guard-pi-smoke', resume: false, prompt })` with the same prompt text the Codex guard smoke uses (run `command -v git`, then `git clean -f`, reply with the output in order and no commentary), and asserts the first output line is `<worktree>/.pipeline/bin/git` and the output contains `ai-conductor git guard: refused`.
2. Register the file in `src/conductor/test/structural/smoke-entry-point.test.ts`: add `'test/smoke/git-guard-pi.smoke.test.ts': 'credentialed:pi'` to `smokeCapabilities`, and add the path to the expected discovered-smoke list after `git-guard-codex.smoke.test.ts`.
3. Run the structural test RED before registration and GREEN after; commit "test(smoke): live Pi git guard smoke".

**Done when:**
- [test] `smoke-entry-point.test.ts` asserts `test/smoke/git-guard-pi.smoke.test.ts` is a discovered smoke file declaring capability `credentialed:pi`.
- `git-guard-pi.smoke.test.ts` asserts, from a live `PiProvider` dispatch in a freshly prepared worktree, that the first output line is `<worktree>/.pipeline/bin/git` and the output contains `ai-conductor git guard: refused`.
- `git-guard-pi.smoke.test.ts` is skipped via `describe.skipIf` when `pi` is not on `PATH` or the Pi credential env var is empty, and sits under `test/smoke/`, which `vitest.config.ts` excludes from the default test command `npm test`, the same command the CI aggregate suite runs in `.github/workflows/ci.yml`.

**Files likely touched:**
- `src/conductor/test/smoke/git-guard-pi.smoke.test.ts` — new live smoke
- `src/conductor/test/structural/smoke-entry-point.test.ts` — smoke registration

**Dependencies:** Task 1

## Task Dependency Graph

```
Task 1 ──┬──▶ Task 2 ──▶ Task 5
         ├──▶ Task 3
         ├──▶ Task 4
         └──▶ Task 6
```

## Integration Points

- After Task 1: `PiProvider.invoke`, the production adapter boundary every Pi dispatch shape ends at, puts the worktree guard first on the Pi child `PATH` and reports `gitGuardInstalled`, which the existing self-host environment-claim audit consumes.
- After Task 2: the guard's refusal is observed through the environment `PiProvider.invoke` actually hands to the Pi process in a real prepared worktree.
- After Task 6: the live smoke observes the same through a real Pi shell tool.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a Pi dispatch that is not a review dispatch and whose working directory is an engine-prepared worktree, when the Pi adapter spawns Pi, then the child environment's `PATH` starts with that worktree's `.pipeline/bin` directory followed by the inherited `PATH` unchanged, and the dispatch result reports `gitGuardInstalled` as true. | 1 | "the factory receives `env.PATH` exactly `/prepared/.pipeline/bin:/usr/local/bin:/usr/bin`, `ensureGitGuardForDispatch` was called with `/prepared`, and the result carries `gitGuardInstalled: true`" | diff-local |
| Story 1 happy: Given the child environment the Pi adapter built for that guarded dispatch, when a shell started with that environment in the worktree runs `command -v git` and then `git clean -f`, then `command -v git` prints `<worktree>/.pipeline/bin/git`, `git clean -f` exits non-zero with stderr containing `ai-conductor git guard: refused`, and the worktree's untracked file still exists. | 2 | "`git clean -f` run with that environment exits non-zero with stderr containing `ai-conductor git guard: refused`, the fixture's `untracked.txt` still exists afterwards" | diff-local |
| Story 1 happy: Given a guarded Pi dispatch that also carries a managed-session context, when the Pi adapter spawns Pi, then the worktree's `.pipeline/bin` directory is the first `PATH` entry, ahead of the managed-session `gh` wrapper directory, which is still present. | 1 | "the first `PATH` entry is `/prepared/.pipeline/bin` and the managed `gh` wrapper directory is the second entry" | diff-local |
| Story 1 happy: Given a Pi dispatch result that reports `gitGuardInstalled` as true and whose output says the git guard refused a bare force push, when the environment-claim audit checks it for provider `pi`, then that force-push claim is not refuted. | 1 | "for provider `pi` with `gitGuardInstalled: true` the output `The sandbox blocks git push --force.` is not refuted" | diff-local |
| Story 1 negative: Given a Pi dispatch that is not a review dispatch, in a prepared worktree whose guard is missing and cannot be rewritten because its `.pipeline/bin` directory is not writable, when the Pi adapter is invoked, then Pi is never spawned and the result is a failure with exit code 1 whose output names the guard path. | 3 | "yields exactly `{ success: false, output: <rejection message naming /prepared/.pipeline/bin/git>, exitCode: 1 }`" | diff-local |
| Story 2 happy: Given a Pi dispatch marked by the engine as a review dispatch whose working directory is an engine-prepared worktree, when the Pi adapter spawns Pi, then no `.pipeline/bin` entry is added to the child `PATH`, the guard is neither verified nor repaired, and the dispatch result reports `gitGuardInstalled` as false. | 4 | "never calls `ensureGitGuardForDispatch`, spawns with no `.pipeline/bin` `PATH` entry, and returns `gitGuardInstalled: false`" | diff-local |
| Story 2 negative: Given a Pi review dispatch with a read-only review profile whose working directory is a prepared worktree whose guard is missing and cannot be rewritten, when the Pi adapter is invoked, then Pi is still spawned with no guard failure and its argv keeps the read-only tool restriction `read,grep,find,ls,git_read`. | 4 | "still spawns once with the `--tools` value `read,grep,find,ls,git_read`" | diff-local |
| Story 3 happy: Given a Pi dispatch whose working directory is not a git repository, when the Pi adapter is invoked, then Pi is spawned with no `.pipeline/bin` entry on the child `PATH` and the result reports `gitGuardInstalled` as false. | 5 | "for a non-repository `cwd` and for an unprepared repository `cwd` Pi is spawned once with no `.pipeline/bin` `PATH` entry" | diff-local |
| Story 3 happy: Given a Pi dispatch whose working directory is a git repository that the engine never prepared, so its worktree-scoped `core.hooksPath` is not that directory's `.pipeline/git-hooks`, when the Pi adapter is invoked, then Pi is spawned with no `.pipeline/bin` entry on the child `PATH`, no guard file is written into that directory, and the result reports `gitGuardInstalled` as false. | 5 | "no `<cwd>/.pipeline/bin/git` is written, and the result carries `gitGuardInstalled: false`" | diff-local |
| Story 3 negative: Given a Pi dispatch whose working directory is a linked worktree the engine never prepared, so the repository does not enable worktree-scoped config, when the Pi adapter is invoked, then Pi is spawned without a guard verification failure and the result reports `gitGuardInstalled` as false. | 5 | "for a linked worktree without `extensions.worktreeConfig` Pi is spawned once, the result is not a guard-verification failure, and it carries `gitGuardInstalled: false`" | diff-local |
| Story 4 happy: Given `pi` is installed and the `credentialed:pi` smoke capability is available, when the Pi git guard live smoke dispatches Pi in a freshly prepared fixture worktree asking it to run `command -v git` and then `git clean -f`, then the first output line is `<worktree>/.pipeline/bin/git` and the output contains `ai-conductor git guard: refused`. | 6 | "that the first output line is `<worktree>/.pipeline/bin/git` and the output contains `ai-conductor git guard: refused`" | diff-local |
| Story 4 negative: Given the default test command or the CI aggregate suite, when it runs, then the Pi git guard live smoke is not executed, and when the smoke file is run without `pi` installed or without its credential, then its suite is skipped rather than failed. | 6 | "is skipped via `describe.skipIf` when `pi` is not on `PATH` or the Pi credential env var is empty, and sits under `test/smoke/`, which `vitest.config.ts` excludes from the default test command `npm test`, the same command the CI aggregate suite runs in `.github/workflows/ci.yml`" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic

### Task rem-as-built-R1: docs/reference/settings-and-hooks.md: in the 'Engine git guard' intro, replace 'Pi dispatches are not guarded yet; Pi enforcement is tracked by #2895' with wording that the guard is put first on the child PATH of every Claude, Codex and Pi dispatch into an engine-prepared worktree. In 'What the guard does NOT cover', replace the 'Pi provider dispatches, which run unguarded until #2895 ships' bullet with the remaining Pi limits: Pi build_review dispatches are exempt, and Pi dispatches whose cwd is not an engine-prepared worktree launch unguarded. Keep the absolute-path, shell-startup-file and alias/function PATH-shadowing bullets unchanged. Check the edited section's links and keep the instructions consistent; no behavioral tests are needed for this prose-only change.
**Gate:** as-built
**Rationale:** Verified (100%, read docs/reference/settings-and-hooks.md): the Engine git guard section still says 'Pi dispatches are not guarded yet; Pi enforcement is tracked by #2895' (lines ~249-250) and the NOT-cover list still has 'Pi provider dispatches, which run unguarded until #2895 ships' (line ~297), while this feature (plan Tasks 1-5) ships Pi guarding. ADR D10 is approved and authoritative; no architectural or product decision is needed. This is conforming documentation drift, which belongs in BUILD. No approved plan task covers this reference doc, so the repair is a new, narrowly scoped documentation task. Completed behavior is preserved: the limits documented for build_review exemption, non-prepared/inline worktrees, and PATH-shadowing (absolute path, shell startup files, aliases/functions) stay, and Pi review dispatches and Pi dispatches outside a prepared worktree are named as unguarded, matching Tasks 4-5. Siblings checked: no other site in this doc mentions Pi; nothing else is in scope.
**Governing clause:** adr-2026-09-23-engine-git-guard-on-agent-path decision 10
**Done when:**
- adr-2026-09-23-engine-git-guard-on-agent-path decision 10 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-R1 is complete.
