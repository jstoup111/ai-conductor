# Implementation Plan: Sandbox auth-expiry park-and-poll

**Date:** 2026-07-04
**Design:** .docs/decisions/adr-2026-07-04-auth-failure-park-and-poll.md (APPROVED); review: .docs/decisions/architecture-review-2026-07-04-sandbox-auth-expiry-park.md
**Stories:** .docs/stories/sandbox-auth-expiry-park.md (TR-1…TR-5)
**Conflict check:** Clean as of 2026-07-04
**Complexity:** Tier M (.docs/complexity/sandbox-auth-expiry-park.md)
**Source:** jstoup111/ai-conductor#210

## Summary

Classify headless-CLI auth failures and pre-flight credential expiry as a
park-and-poll condition (wait for the operator credentials file to refresh,
re-copy into the reused sandbox, resume with retry budget intact; timeout →
credentials-specific HALT). 17 tasks.

## Technical Approach

- **New module** `src/conductor/src/engine/self-host/operator-credentials.ts` —
  the identity seam: resolves the credentials path via the existing
  `globalConfigDir` rule (`$CLAUDE_CONFIG_DIR` → `~/.claude`), reads
  `claudeAiOauth.expiresAt`, and returns `fresh | expired | unknown` (unknown =
  fail-open). Also hosts the park-and-poll wait (`waitForCredentialsChange`)
  with injected clock/sleep so tests use fake timers.
- **Provider classification** — add `AUTH_FAILURE_RE` beside the existing
  signature regexes in `src/conductor/src/execution/claude-provider.ts`
  (matched only on non-zero exit), surfacing `authFailure` on the invoke
  result; thread it through `StepRunResult` in
  `src/conductor/src/engine/step-runners.ts`. Auth check ordering: evaluated
  before model-unavailable handling so the ladder never sees an auth failure.
- **Conductor wiring** in `src/conductor/src/engine/conductor.ts`: (a)
  pre-flight check at the top of the self-host build dispatch
  (`runSelfBuildDispatch` call site) — expired → park before provisioning;
  (b) `authFailure` result branch in the per-step retry loop, modeled on the
  existing `rateLimited`/`sessionExpired` no-budget-burn branches
  (`attempt--` contract); (c) on park resume, mandatory credentials re-copy
  into the existing sandbox via a new `refreshSandboxCredentials` export from
  `sandbox-build-env.ts` (plain copy — TR-6); (d) park timeout →
  `writeHaltMarker` with a reason naming the credentials path + observed
  `expiresAt`.
- **Config** — `auth_park_timeout_minutes` in `resolved-config.ts` (default
  60; `0`/negative = immediate-HALT opt-out; non-numeric = loud startup
  failure), following the existing validation precedent.
- **Sequencing rationale:** seam + config first (everything depends on them),
  then classification, then the park primitive, then conductor wiring, then
  the end-to-end acceptance spec, then docs.

## Prerequisites

None — all changes are internal to `src/conductor`; no migrations, no new
dependencies.

## Tasks

### Task 1: Operator-credentials reader — fresh/expired classification
**Story:** TR-2 (happy: expired → park precondition; fresh → dispatch)
**Type:** infrastructure

**Steps:**
1. Write failing test: `operator-credentials.test.ts` — a temp config dir with
   `.credentials.json` whose `claudeAiOauth.expiresAt` is past → `expired`;
   future beyond margin → `fresh`; within imminent-expiry margin → `expired`.
2. Verify RED.
3. Implement `readOperatorCredentialsState(globalConfigDir, now)` in new
   `src/conductor/src/engine/self-host/operator-credentials.ts`.
4. Verify GREEN.
5. Commit: "feat(self-host): operator credentials expiry reader"

**Files likely touched:**
- src/conductor/src/engine/self-host/operator-credentials.ts — new module
- src/conductor/test/engine/self-host/operator-credentials.test.ts — new tests

**Dependencies:** none

### Task 2: Reader fail-open shapes (negative)
**Story:** TR-2 (negative: missing file / malformed JSON / no claudeAiOauth / config-dir resolution)
**Type:** negative-path

**Steps:**
1. Write failing tests: missing file → `unknown`; malformed JSON → `unknown`
   (logged, not thrown); JSON without `claudeAiOauth` → `unknown`; with
   `CLAUDE_CONFIG_DIR` pointed at a temp dir the reader reads that dir (never
   the real home path).
2. Verify RED. 3. Implement the fail-open branches. 4. Verify GREEN.
5. Commit: "test(self-host): credentials reader fails open on missing/malformed input"

**Files likely touched:**
- src/conductor/src/engine/self-host/operator-credentials.ts
- src/conductor/test/engine/self-host/operator-credentials.test.ts

**Dependencies:** Task 1

### Task 3: Config knob `auth_park_timeout_minutes`
**Story:** TR-5 (happy: override + default)
**Type:** infrastructure

**Steps:**
1. Write failing test in `resolved-config` tests: unset → 60; explicit 15 → 15.
2. Verify RED. 3. Implement field + resolution in
   `src/conductor/src/engine/resolved-config.ts` (existing validation
   precedent ~225-231). 4. Verify GREEN.
5. Commit: "feat(config): auth_park_timeout_minutes (default 60)"

**Files likely touched:**
- src/conductor/src/engine/resolved-config.ts — new field
- src/conductor/test/engine/resolved-config.test.ts (or existing config test file) — cases

**Dependencies:** none

### Task 4: Config knob invalid/opt-out values (negative)
**Story:** TR-5 (negative: 0/negative → opt-out; non-numeric → loud failure)
**Type:** negative-path

**Steps:**
1. Write failing tests: `0` and `-5` resolve to opt-out semantics (value
   preserved, flagged as immediate-HALT mode); `"soon"` → resolution throws a
   clear error at startup.
2. Verify RED. 3. Implement validation. 4. Verify GREEN.
5. Commit: "test(config): auth park timeout opt-out + invalid values"

**Files likely touched:**
- src/conductor/src/engine/resolved-config.ts
- src/conductor/test/engine/resolved-config.test.ts

**Dependencies:** Task 3

### Task 5: `AUTH_FAILURE_RE` classification in claude-provider
**Story:** TR-1 (happy: failed invocation with login-error output → authFailure)
**Type:** happy-path

**Steps:**
1. Write failing tests in `claude-provider.test.ts`: non-zero exit with
   "Not logged in", "Please run /login", "Invalid API key" variants →
   result `authFailure: true`, `success: false`.
2. Verify RED. 3. Implement `AUTH_FAILURE_RE` beside `MODEL_UNAVAILABLE_RE`
   (~line 24) and set the flag in the classification block (~91-105), gated on
   `exitCode !== 0`. 4. Verify GREEN.
5. Commit: "feat(provider): classify Not-logged-in as authFailure"

**Files likely touched:**
- src/conductor/src/execution/claude-provider.ts — regex + flag
- src/conductor/test/execution/claude-provider.test.ts — cases

**Dependencies:** none

### Task 6: Classification non-matches (negative)
**Story:** TR-1 (negative: success output mentioning the string; model-unavailable; rate-limit)
**Type:** negative-path

**Steps:**
1. Write failing tests: exit 0 with output quoting "Not logged in" →
   `authFailure` false, treated as success; model-unavailable output →
   `modelUnavailable` set, `authFailure` false; rate-limit output →
   `rateLimited` set, `authFailure` false.
2. Verify RED (as needed). 3. Adjust gating. 4. Verify GREEN.
5. Commit: "test(provider): authFailure never fires on success or other signatures"

**Files likely touched:**
- src/conductor/src/execution/claude-provider.ts
- src/conductor/test/execution/claude-provider.test.ts

**Dependencies:** Task 5

### Task 7: Real-binary smoke expectation for the auth signature
**Story:** TR-1 (Done When: signature anchored to the CLI's actual error shape)
**Type:** infrastructure

**Steps:**
1. Extend `claude-provider.smoke.test.ts` (env-gated real-binary suite) with an
   assertion that the committed `AUTH_FAILURE_RE` matches the login-error text
   the installed CLI actually emits (captured fixture; skip cleanly when the
   binary/env kill-switch is absent — never spawn un-gated).
2. Run the smoke suite once locally to capture/verify the fixture.
3. Commit: "test(provider): real-binary smoke for auth-failure signature"

**Files likely touched:**
- src/conductor/test/execution/claude-provider.smoke.test.ts — new case/fixture

**Dependencies:** Task 5

### Task 8: Thread `authFailure` through StepRunResult
**Story:** TR-1 (happy: flag propagates to the conductor step loop)
**Type:** happy-path

**Steps:**
1. Write failing test in `step-runners.test.ts`: an invoke result carrying
   `authFailure: true` yields a `StepRunResult` with `authFailure: true`.
2. Verify RED. 3. Add the field to `StepRunResult` and the translation in
   `runAutonomous` (~431-459 block). 4. Verify GREEN.
5. Commit: "feat(engine): authFailure flag on StepRunResult"

**Files likely touched:**
- src/conductor/src/engine/step-runners.ts — field + translation
- src/conductor/test/engine/step-runners.test.ts — case

**Dependencies:** Task 5

### Task 9: Ladder isolation on auth failure (negative)
**Story:** TR-1 (negative/Done When: ladder dead-model set byte-identical)
**Type:** negative-path

**Steps:**
1. Write failing test in `model-availability.test.ts` (or step-runners tests):
   an auth-classified failure passes through `invokeWithLadder` without
   marking the current model unavailable and without advancing the ladder.
2. Verify RED. 3. Order the auth check before model-unavailable handling.
4. Verify GREEN.
5. Commit: "fix(engine): auth failures never poison the model ladder"

**Files likely touched:**
- src/conductor/src/engine/model-availability.ts and/or step-runners.ts — ordering
- src/conductor/test/engine/model-availability.test.ts — case

**Dependencies:** Tasks 5, 8

### Task 10: `refreshSandboxCredentials` re-copy primitive
**Story:** TR-3 (happy: re-copy into existing sandbox; Done When: copy, never symlink)
**Type:** infrastructure

**Steps:**
1. Write failing test in `sandbox-build-env.test.ts`: after provisioning,
   mutate the source `.credentials.json`, call `refreshSandboxCredentials`,
   assert the sandbox copy now matches the new content and
   `lstat` shows a regular file (not a symlink).
2. Verify RED. 3. Export the helper from `sandbox-build-env.ts` reusing
   `copyIfPresent`. 4. Verify GREEN.
5. Commit: "feat(self-host): refreshSandboxCredentials re-copy"

**Files likely touched:**
- src/conductor/src/engine/self-host/sandbox-build-env.ts — new export
- src/conductor/test/engine/self-host/sandbox-build-env.test.ts — case

**Dependencies:** none

### Task 11: `waitForCredentialsChange` park-and-poll primitive
**Story:** TR-3 (happy: mtime advance + unexpired → resume signal) and TR-3/TR-4 negatives (still-expired refresh keeps parking; deleted file keeps parking; timeout result)
**Type:** happy-path + negative-path (one primitive, four scenarios — each scenario is its own test)

**Steps:**
1. Write failing tests (fake timers + temp files, injected sleep/clock — no
   real waits): (a) mtime advances with unexpired `expiresAt` → resolves
   `refreshed` with observed state; (b) mtime advances but content still
   expired → keeps polling; (c) file deleted mid-park → keeps polling toward
   timeout, no throw; (d) timeout elapses → resolves `timeout` carrying the
   credentials path + last observed `expiresAt`.
2. Verify RED. 3. Implement in `operator-credentials.ts` using the reader from
   Task 1. 4. Verify GREEN.
5. Commit: "feat(self-host): waitForCredentialsChange park-and-poll"

**Files likely touched:**
- src/conductor/src/engine/self-host/operator-credentials.ts — wait primitive
- src/conductor/test/engine/self-host/operator-credentials.test.ts — 4 scenarios

**Dependencies:** Tasks 1, 2

### Task 12: Conductor branch — authFailure parks, resumes with refresh, budget intact
**Story:** TR-3 (happy: park→refresh→re-copy→resume, attempt counter unchanged; negative: resume-without-refresh forbidden; re-auth-failure re-parks)
**Type:** happy-path + negative-path

**Steps:**
1. Write failing conductor tests (injected step runner + fake credentials
   files): (a) a step result with `authFailure` enters the park wait instead
   of consuming a retry (`attempt` equality asserted across the cycle); (b) on
   `refreshed`, `refreshSandboxCredentials` is invoked on the active sandbox
   BEFORE the re-attempt (spy ordering); (c) a resumed attempt that fails with
   `authFailure` again re-enters the park without budget burn.
2. Verify RED. 3. Implement the branch in the per-step retry loop
   (`conductor.ts` ~1026, modeled on the rateLimited `attempt--` block).
4. Verify GREEN.
5. Commit: "feat(conductor): park-and-poll on authFailure, refresh sandbox on resume"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — retry-loop branch
- src/conductor/test/engine/conductor.test.ts — scenarios

**Dependencies:** Tasks 8, 10, 11, 3

### Task 13: Conductor pre-flight — expired credentials park before provisioning
**Story:** TR-2 (happy: expired → no provision, no spawn, budget intact; negative: fail-open shapes dispatch normally)
**Type:** happy-path + negative-path

**Steps:**
1. Write failing conductor tests: (a) with expired operator credentials, a
   self-host build attempt performs no sandbox provisioning and spawns nothing,
   entering the same park wait; (b) with `unknown` reader state (missing/
   malformed/env-key), dispatch proceeds exactly as today; (c) non-self-host
   dispatch path never invokes the pre-flight.
2. Verify RED. 3. Wire the pre-flight at the self-host dispatch entry
   (`runSelfBuildDispatch` call path, before the `activeSandbox` provision
   guard). 4. Verify GREEN.
5. Commit: "feat(conductor): pre-flight credential expiry check before self-host dispatch"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — pre-flight wiring
- src/conductor/test/engine/conductor.test.ts — scenarios

**Dependencies:** Tasks 11, 12

### Task 14: Park timeout → credentials-specific HALT
**Story:** TR-4 (happy: HALT reason names path + expiresAt; standard REKICK remediation unchanged)
**Type:** happy-path

**Steps:**
1. Write failing test: park wait resolving `timeout` → `writeHaltMarker`
   called with a reason containing the resolved credentials path and the
   observed `expiresAt` (or "unparseable"); feature parks through the
   existing HALT flow.
2. Verify RED. 3. Implement the timeout branch. 4. Verify GREEN.
5. Commit: "feat(conductor): auth-park timeout HALTs with credentials reason"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — timeout branch
- src/conductor/test/engine/conductor.test.ts — case

**Dependencies:** Task 12

### Task 15: Auth HALT is not "retries exhausted" (negative)
**Story:** TR-4 (negative: reason ≠ generic exhaustion; escalation PR body carries auth reason)
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) the auth-timeout HALT reason does NOT contain
   "retries exhausted" and the retry budget shows zero consumption from the
   parked period; (b) the needs-remediation escalation body composed for this
   halt carries the auth-window reason.
2. Verify RED. 3. Adjust reason plumbing (halt reason + escalation body
   source). 4. Verify GREEN.
5. Commit: "test(conductor): auth HALT distinguishable from build-defect HALT"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts / build-failure-escalation.ts — reason plumbing
- src/conductor/test/engine/conductor-build-escalation.test.ts — cases

**Dependencies:** Task 14

### Task 16: Opt-out (timeout ≤ 0) HALTs immediately (negative)
**Story:** TR-5 (negative: 0/negative → no poll loop, immediate auth-reason HALT)
**Type:** negative-path

**Steps:**
1. Write failing test: with `auth_park_timeout_minutes: 0`, an auth failure
   (or expired pre-flight) skips the poll loop entirely and HALTs immediately
   with the credentials-specific reason.
2. Verify RED. 3. Implement the opt-out short-circuit. 4. Verify GREEN.
5. Commit: "feat(conductor): auth park opt-out via zero timeout"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — short-circuit
- src/conductor/test/engine/conductor.test.ts — case

**Dependencies:** Tasks 4, 12, 14

### Task 17: Docs + CHANGELOG
**Story:** TR-5 (Done When: README/conductor README/CHANGELOG)
**Type:** infrastructure

**Steps:**
1. Document the behavior + `auth_park_timeout_minutes` in `README.md` and
   `src/conductor/README.md` (self-host section): what parks, refresh
   detection, timeout default, opt-out, HALT reason shape, unchanged
   REKICK remediation.
2. Add `CHANGELOG.md` `[Unreleased]` → Fixed entry referencing issue #210.
3. Commit: "docs: sandbox auth-expiry park-and-poll"

**Files likely touched:**
- README.md, src/conductor/README.md, CHANGELOG.md

**Dependencies:** Tasks 12–16 (documents final behavior)

## Task Dependency Graph

```
T1 → T2 → T11 ─┐
T3 → T4 ───────┼→ T12 → T13
T5 → T6        │   T12 → T14 → T15
T5 → T7        │   T4 + T12 + T14 → T16
T5 → T8 → T9 ──┘
T10 ───────────┘
T12–T16 → T17
```
(T12 depends on T3, T8, T10, T11; acyclic.)

## Integration Points

- After Task 9: provider + step-runner classification testable end-to-end
  (invoke result → StepRunResult flag, ladder untouched).
- After Task 13: full park path exercisable in conductor tests (both entry
  points share one wait).
- After Task 16: acceptance-level flow complete — expired → park → refresh →
  resume → success with budget intact, and timeout → auth HALT.

## Verification

- [ ] All happy path criteria covered by at least one task (TR-1: T5/T8; TR-2: T1/T13; TR-3: T10/T11/T12; TR-4: T14; TR-5: T3/T17)
- [ ] All negative path criteria covered by explicit tasks (TR-1: T6/T9; TR-2: T2/T13b; TR-3: T11b-c/T12b-c; TR-4: T15; TR-5: T4/T16)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
