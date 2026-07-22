# Implementation Plan: Build-Auth Token — Check and Classify

**Date:** 2026-07-22
**Design:** .docs/specs/2026-07-22-build-auth-token-check-and-classify.md (Approved)
**Stories:** .docs/stories/build-auth-token-check-and-classify.md (Accepted, FR-1..FR-7)
**ADRs:** adr-2026-07-22-token-liveness-probe-via-cli-invocation,
adr-2026-07-22-auth-failure-classification-observed-401-patterns,
adr-2026-07-22-daemon-level-missing-credential-gate (all APPROVED)
**Conflict check:** Clean as of 2026-07-22 (.docs/conflicts/2026-07-22-build-auth-token-check-and-classify.md)

## Summary

Closes #498 (subsumes #483/#484) in 18 TDD tasks across four seams: the auth-failure
classifier, a new token liveness verifier + CLI status verb + `bin/install --check`
delegate, the shared remediation message, and a non-blocking daemon pre-dispatch
credential gate with auto-resume.

## Technical Approach

- **Classifier (FR-4):** extend the auth-failure recognition in
  `src/conductor/src/execution/claude-provider.ts` with patterns anchored to the
  observed error shape (`failed to authenticate`, `invalid bearer token`,
  `API Error: 401` — never a bare `401`), keeping precedence position. `group-core`
  routes `authFailure` results to park semantics (zero attempt consumption, zero
  escalation); the serial path already parks.
- **Verifier (FR-1):** new `engine/self-host/token-liveness.ts` spawns
  `claude -p` with a trivial prompt, cheapest model, `--output-format json`,
  throwaway `CLAUDE_CONFIG_DIR`, token via env only, tight timeout; verdict mapping
  valid / invalid / unverifiable per the probe ADR (never valid without positive
  signal).
- **CLI + check (FR-1/2/3):** new `build-auth-status` verb (detect/dispatch pair in
  `engine/build-auth-cli.ts`, registered in `index.ts` main chain) prints mode +
  state + remediation and exits 0 only for valid (or api-key mode / all-clear);
  `bin/install --check` gains a thin delegate call that formats the verb's output as
  ok/fail lines (no path/mode derivation in bash — conflict item 5).
- **Message (FR-5):** one `buildAuthRemediationMessage()` builder in
  `engine/self-host/build-auth-message.ts`; consumed by preflight, gate, and CLI so
  the three surfaces cannot drift.
- **Gate (FR-6):** non-blocking skip-picks gate in `engine/daemon.ts` beside
  `checkPaused` (rate-limit-episode pattern, conflict item 4): daemon-token mode +
  credential missing/unreadable ⇒ no picks this cycle, ONE waiting-condition log
  entry on state transition, credential-file watcher arms the existing waker for
  prompt resume; per-feature preflight (`build-auth-preflight.ts`) unchanged as
  fail-closed backstop, upgraded to the shared message.
- **Sequencing:** classifier first (independent, closes the worst live bug), then
  verifier→CLI→bash (dependency chain), then message→preflight/gate, docs last.

## Prerequisites

None — no migrations, no new dependencies (probe reuses the installed `claude` CLI).

## Tasks

### Task 1: Extend auth-failure patterns with observed 401 shapes
**Story:** FR-4 — classifier recognizes rejected-credential output
**Type:** happy-path

**Steps:**
1. Write failing tests: classifier fixtures with verbatim observed outputs
   `Failed to authenticate. API Error: 401 Invalid bearer token` (text mode) and the
   same string embedded in longer output, each with exit≠0 → expect `authFailure: true`.
2. Verify RED.
3. Implement: extend the auth-failure regex/patterns in `claude-provider.ts`
   (anchored: `failed to authenticate`, `invalid bearer token`, `API Error: 401`).
4. Verify GREEN.
5. Commit: "classify observed 401 bearer-token failures as authFailure (#484)"

**Files likely touched:**
- src/conductor/src/execution/claude-provider.ts — pattern extension
- src/conductor/test/execution/claude-provider.test.ts — fixtures

**Wired-into:** none (no new production surface — extends the already-wired classifier)
**Dependencies:** none

### Task 2: Precedence preserved over new patterns
**Story:** FR-4 negative — higher-precedence classifications not shadowed
**Type:** negative-path

**Steps:**
1. Write failing/pinning tests: output matching BOTH session-limit and the new auth
   patterns → session-limit wins; rate-limit + auth → existing precedence order holds;
   exit 0 with auth-shaped text → `authFailure: false`.
2. Verify RED (or pin GREEN if already passing — precedence test is the artifact).
3. Implement any ordering fix needed in the classifier precedence chain.
4. Verify GREEN.
5. Commit: "pin classifier precedence over extended auth patterns"

**Files likely touched:**
- src/conductor/test/execution/claude-provider.test.ts — precedence fixtures
- src/conductor/src/execution/claude-provider.ts — only if ordering fix needed

**Wired-into:** none (no new production surface)
**Dependencies:** 1

### Task 3: Bare-401-in-prose does not classify
**Story:** FR-4 negative — no false park on incidental "401"
**Type:** negative-path

**Steps:**
1. Write failing test: failed build whose output discusses "expects a 401 response"
   (no auth-error shape) → `authFailure: false`.
2. Verify RED/GREEN as appropriate.
3. Tighten patterns if the fixture misclassifies.
4. Verify GREEN.
5. Commit: "reject bare-401 prose from auth classification"

**Files likely touched:**
- src/conductor/test/execution/claude-provider.test.ts — non-match fixture
- src/conductor/src/execution/claude-provider.ts — only if tightening needed

**Wired-into:** none (no new production surface)
**Dependencies:** 1

### Task 4: group-core routes authFailure to park, not the retry ladder
**Story:** FR-4 — concurrent path: zero retry attempts, zero escalations
**Type:** happy-path

**Steps:**
1. Write failing test: group-core retry loop receives an auth-classified failure →
   assert attempt counter not consumed, `escalateAttempt` never invoked for it, and
   the result routes to the park path (not "retries exhausted").
2. Verify RED.
3. Implement: in `group-core.ts`, treat `authFailure` like the non-consuming park
   family (park-and-poll on the daemon credential source per adr-2026-07-04) instead
   of the current bare no-verdict return.
4. Verify GREEN.
5. Commit: "group-core: authFailure parks without consuming retry/escalation budget"

**Files likely touched:**
- src/conductor/src/engine/group-core.ts — authFailure branch
- src/conductor/test/engine/group-core.test.ts — budget/park assertions

**Wired-into:** none (no new production surface — existing wired retry loop)
**Dependencies:** 1

### Task 5: Serial path parks on new patterns
**Story:** FR-4 — serial dispatch park branch engages
**Type:** happy-path
**Verify-only:** yes

**Steps:**
1. Write test: serial conductor auth branch receives a result classified via the NEW
   patterns → park branch taken (existing `authFailure` handling).
2. Expected GREEN once Task 1 lands (the branch keys off the flag, not the pattern).
3. If RED, fix the flag propagation; else complete via evidence trailer.
4. Verify GREEN.
5. Commit (empty ok): "verify serial park branch engages for observed 401 patterns"

**Files likely touched:**
- src/conductor/test/engine/conductor-token-injection.test.ts — or nearest serial-path test home

**Wired-into:** none (no new production surface)
**Dependencies:** 1

### Task 6: Token liveness verifier module
**Story:** FR-1 — live verification; FR-1 negative — unverifiable never claims valid
**Type:** infrastructure

**Steps:**
1. Write failing tests with a stubbed spawner: success envelope → `valid`;
   `api_error_status:401`/`403` envelope → `invalid`; timeout, spawn error,
   unparseable output, unexpected status → `unverifiable` (with sanitized detail);
   token passed via env only.
2. Verify RED.
3. Implement `engine/self-host/token-liveness.ts`: injectable spawner, trivial
   prompt, cheapest model, `--output-format json`, throwaway `CLAUDE_CONFIG_DIR`,
   tight timeout; parse envelope; never return `valid` without a positive signal.
4. Verify GREEN.
5. Commit: "add token liveness verifier (CLI-invocation probe per ADR)"

**Files likely touched:**
- src/conductor/src/engine/self-host/token-liveness.ts — new module
- src/conductor/test/engine/self-host/token-liveness.test.ts — verdict mapping

**Wired-into:** same as Task 8
**Dependencies:** none

### Task 7: Shared remediation-message builder
**Story:** FR-5 — complete message; FR-5 negative — resolved path shown
**Type:** infrastructure

**Steps:**
1. Write failing tests: builder output contains the mint command
   (`DAEMON_BUILD_TOKEN_MINT_COMMAND`), the RESOLVED token path (override honored),
   and the three pitfalls (tty-only mint output, trailing whitespace, permissions);
   contains no token material.
2. Verify RED.
3. Implement `engine/self-host/build-auth-message.ts` exporting
   `buildAuthRemediationMessage(resolvedPath)`.
4. Verify GREEN.
5. Commit: "add shared build-auth remediation message builder"

**Files likely touched:**
- src/conductor/src/engine/self-host/build-auth-message.ts — new module
- src/conductor/test/engine/self-host/build-auth-message.test.ts — content assertions

**Wired-into:** src/conductor/src/engine/self-host/build-auth-preflight.ts#preflightBuildAuthCheck, src/conductor/src/engine/build-auth-cli.ts#dispatchBuildAuthStatus, src/conductor/src/engine/daemon.ts#runDaemon
**Dependencies:** none

### Task 8: `build-auth-status` CLI verb
**Story:** FR-1 — state reporting surface
**Type:** happy-path

**Steps:**
1. Write failing tests: `detectBuildAuthStatusCommand(argv)` matches
   `build-auth-status` (null otherwise); dispatch resolves mode+path via
   `resolveSelfHostConfig`, reads via `readDaemonBuildToken`, probes via Task 6 when
   present, prints one status line (mode + state) plus the remediation message for
   missing/unreadable/invalid.
2. Verify RED.
3. Implement `engine/build-auth-cli.ts` (detect/dispatch pair) and register in the
   `main()` chain in `index.ts`.
4. Verify GREEN.
5. Commit: "add conduct-ts build-auth-status verb"

**Files likely touched:**
- src/conductor/src/engine/build-auth-cli.ts — new detect/dispatch
- src/conductor/src/index.ts — chain registration
- src/conductor/test/engine/build-auth-cli.test.ts — detect + dispatch

**Wired-into:** src/conductor/src/index.ts#main, bin/install#check_installation
**Dependencies:** 6, 7

### Task 9: Mode-aware behavior and exit codes
**Story:** FR-2 (api-key mode), FR-3 (scriptable), FR-2 negative (defaults)
**Type:** happy-path

**Steps:**
1. Write failing tests: api-key mode → mode line, no file read, no probe, exit 0
   even with no token file; daemon-token valid → 0; missing/unreadable/invalid →
   non-zero; unverifiable → non-zero (strict, operator-selected); absent config →
   daemon-token defaults at default path.
2. Verify RED.
3. Implement exit-code mapping in `dispatchBuildAuthStatus`.
4. Verify GREEN.
5. Commit: "build-auth-status: mode-aware checks and strict exit codes"

**Files likely touched:**
- src/conductor/src/engine/build-auth-cli.ts — exit mapping
- src/conductor/test/engine/build-auth-cli.test.ts — per-state exit assertions

**Wired-into:** same as Task 8
**Dependencies:** 8

### Task 10: `bin/install --check` thin delegate
**Story:** FR-1 — token line alongside existing checks; FR-3 — check exit reflects it
**Type:** happy-path

**Steps:**
1. Write failing test (bash): `check_installation` emits a build-auth line sourced
   from `conduct-ts build-auth-status`; failure state increments the existing fail
   counter; conduct-ts absent → warn (not a crash), consistent with the existing
   conduct-ts staleness warning.
2. Verify RED.
3. Implement: single delegate call + ok/fail/warn formatting in `bin/install`;
   NO token path/mode logic in bash; `bash -n` clean.
4. Verify GREEN (`test/test_harness_integrity.sh` passes).
5. Commit: "bin/install --check: delegate build-auth state to conduct-ts"

**Files likely touched:**
- bin/install — check_installation delegate block
- test/test_install_check_build_auth.sh — new bash test (or nearest existing check-suite home)

**Wired-into:** none (bin/install is itself the production entry point)
**Dependencies:** 9

### Task 11: Credential confidentiality sweep
**Story:** FR-7 — token never printed; FR-7 negatives — env-only, sanitized errors
**Type:** negative-path

**Steps:**
1. Write failing tests: with a fixture token, capture outputs of the status verb (all
   five states), remediation message, and verifier error details → assert no token
   substring (≥8 chars) anywhere; assert probe spawner argv contains no token
   material (env only).
2. Verify RED/GREEN as appropriate; fix any leak.
3. Verify GREEN.
4. Commit: "assert build-auth surfaces never leak token material"

**Files likely touched:**
- src/conductor/test/engine/self-host/token-liveness.test.ts — argv/env + sanitize
- src/conductor/test/engine/build-auth-cli.test.ts — output sweep

**Wired-into:** none (no new production surface)
**Dependencies:** 8, 9

### Task 12: Preflight adopts the shared message
**Story:** FR-5 — preflight renders builder output; FR-6 negative — backstop intact
**Type:** happy-path

**Steps:**
1. Write failing tests: `preflightBuildAuthCheck` HALT reason equals the shared
   builder's message (plus existing don't-overwrite marker semantics preserved,
   api-key skip preserved).
2. Verify RED.
3. Implement: replace inline message assembly with `buildAuthRemediationMessage`.
4. Verify GREEN.
5. Commit: "preflight renders shared build-auth remediation message"

**Files likely touched:**
- src/conductor/src/engine/self-host/build-auth-preflight.ts — message swap
- src/conductor/test/engine/self-host/build-auth-preflight.test.ts — content + preserved semantics

**Wired-into:** none (no new production surface — existing wired preflight)
**Dependencies:** 7

### Task 13: Daemon pre-dispatch credential gate (skip-picks)
**Story:** FR-6 — no picks while credential missing
**Type:** happy-path

**Steps:**
1. Write failing test: daemon loop with injectable credential-state dep reporting
   missing (daemon-token mode) → `pickEligible` results discarded / no
   `runFeature` call that cycle; state ok → dispatch proceeds; dep undefined →
   byte-identical legacy behavior (optimization-never-authority pattern); read
   error → treated as missing (fail toward no-dispatch).
2. Verify RED.
3. Implement gate beside `checkPaused` in `engine/daemon.ts`, reading via
   `readDaemonBuildToken` + resolved mode; non-blocking (skip picks, loop continues
   servicing watchers/waker).
4. Verify GREEN.
5. Commit: "daemon: skip-picks gate while build credential missing (#483)"

**Files likely touched:**
- src/conductor/src/engine/daemon.ts — gate beside checkPaused
- src/conductor/test/engine/daemon.test.ts — gate scenarios

**Wired-into:** src/conductor/src/engine/daemon.ts#runDaemon (dispatch loop, beside checkPaused)
**Dependencies:** 7

### Task 14: One waiting condition, zero HALT markers
**Story:** FR-6 — single condition entry, no per-feature cleanup
**Type:** happy-path

**Steps:**
1. Write failing test: missing credential + N≥2 queued features → exactly ONE
   waiting-condition log/status entry (carrying the shared message), transition-only
   (no repeat per tick), zero `.pipeline/HALT` markers written, zero dispatches.
2. Verify RED.
3. Implement transition-edge logging on the gate state.
4. Verify GREEN.
5. Commit: "daemon credential gate logs one waiting condition, writes no HALTs"

**Files likely touched:**
- src/conductor/src/engine/daemon.ts — transition logging
- src/conductor/test/engine/daemon.test.ts — single-entry + zero-marker assertions

**Wired-into:** same as Task 13
**Dependencies:** 13

### Task 15: Auto-resume via credential watcher + waker
**Story:** FR-6 — work resumes unaided; FR-6 negative — whitespace-only stays parked
**Type:** happy-path

**Steps:**
1. Write failing tests: while gated, storing a non-empty token arms the waker and
   the next iteration dispatches (no operator action); a whitespace-only write does
   NOT lift the gate (freshness classifier); watcher disposal on daemon exit (no
   leak, mirrors HALT-watcher lifecycle).
2. Verify RED.
3. Implement: watch the resolved token path (reuse the daemon-token freshness
   classifier from `daemon-build-token.ts`; wire into the existing latched waker);
   poll backstop covers event-hostile filesystems.
4. Verify GREEN.
5. Commit: "daemon credential gate auto-resumes when token lands"

**Files likely touched:**
- src/conductor/src/engine/daemon.ts — watcher wiring
- src/conductor/src/engine/self-host/daemon-build-token.ts — classifier reuse only (no semantic change)
- src/conductor/test/engine/daemon.test.ts — resume + whitespace + disposal

**Wired-into:** same as Task 13
**Dependencies:** 13

### Task 16: Backstop preserved on mid-cycle deletion
**Story:** FR-6 negative — per-feature preflight still fail-closed HALTs
**Type:** negative-path

**Steps:**
1. Write failing test: gate passes at cycle start, credential deleted before a
   feature's preflight → that feature HALTs via `preflightBuildAuthCheck` with the
   shared message; gate re-engages next cycle.
2. Verify RED/GREEN as appropriate (behavior should hold from Tasks 12+13).
3. Fix only if the interaction regressed.
4. Verify GREEN.
5. Commit: "verify per-feature preflight backstop under mid-cycle token deletion"

**Files likely touched:**
- src/conductor/test/engine/daemon.test.ts — race scenario

**Wired-into:** none (no new production surface)
**Dependencies:** 12, 13

### Task 17: Gate composition with PAUSE / operator-park / episode
**Story:** FR-6 negative — gates compose; in-flight untouched
**Type:** negative-path

**Steps:**
1. Write failing tests: credential gate active + PAUSE set → clearing credential
   alone still no dispatch; operator-park predicate still consulted before
   `runFeature`; credential gate going active mid-build never cancels the in-flight
   feature; api-key mode → gate inert.
2. Verify RED/GREEN as appropriate.
3. Implement ordering fixes only if composition breaks.
4. Verify GREEN.
5. Commit: "pin credential-gate composition with pause/park/episode gates"

**Files likely touched:**
- src/conductor/test/engine/daemon.test.ts — composition matrix

**Wired-into:** none (no new production surface)
**Dependencies:** 13

### Task 18: CHANGELOG + docs upkeep
**Story:** repo release gates (CHANGELOG [Unreleased]; docs track features)
**Type:** infrastructure

**Steps:**
1. Add CHANGELOG `[Unreleased]` entries (Added: build-auth-status verb + --check
   token line + credential gate; Fixed: #483 cascade, #484 retry burn). No breaking
   surface expected (additive CLI verb; `bin/conduct` untouched) — if the release
   gate's classifier flags `bin/conduct CLI` anyway, that needs a real look, not an
   automatic waiver.
2. Update README.md and src/conductor/README.md (new verb, --check line, gate
   behavior).
3. Run `test/test_harness_integrity.sh` — must pass.
4. Commit: "docs+changelog for build-auth check-and-classify"

**Files likely touched:**
- CHANGELOG.md — Unreleased entries
- README.md — operator docs
- src/conductor/README.md — CLI docs

**Wired-into:** none (no new production surface)
**Dependencies:** 10, 14, 15

## Task Dependency Graph

```
T1 ──┬── T2
     ├── T3
     ├── T4
     └── T5
T6 ──┬──────────┐
T7 ──┼── T8 ── T9 ── T10 ──┐
     │    └───── T11        │
     ├── T12 ──── T16       ├── T18
     └── T13 ──┬─ T14 ──────┤
               ├─ T15 ──────┘
               ├─ T16
               └─ T17
```
(T16 depends on both T12 and T13; T18 depends on T10, T14, T15.)

## Integration Points

- After Task 5: dispatch-time classification fully closed (#484) — testable via
  classifier + group-core suites.
- After Task 10: end-to-end health check — `bin/install --check` reports real token
  state on a live machine.
- After Task 15: end-to-end #483 scenario — daemon started with no token parks once
  and auto-resumes when the token is stored.

## Coverage

| Story criterion | Task(s) |
|---|---|
| FR-1 five states + probe verdicts | 6, 8, 9 |
| FR-1 negatives (whitespace, unreadable, unverifiable-never-valid) | 6, 9 |
| FR-2 mode-aware (+ defaults negative) | 9 |
| FR-3 exit codes (incl. strict unverifiable) | 9, 10 |
| FR-4 both dispatch paths, zero budget | 1, 4, 5 |
| FR-4 negatives (bare 401, precedence, no escalation while parked) | 2, 3, 4 |
| FR-5 message completeness + shared builder + resolved path | 7, 12 |
| FR-6 one condition / zero HALTs / auto-resume | 13, 14, 15 |
| FR-6 negatives (backstop, whitespace, api-key, composition) | 15, 16, 17 |
| FR-7 secrecy (all surfaces, argv/env) | 11 |
| Repo gates (CHANGELOG, docs, integrity) | 18 |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by explicit tasks (2, 3, 11, 16, 17)
- [x] No task exceeds ~5 minutes of focused work
- [x] Dependencies explicit and acyclic (graph above)
- [x] Every new-surface task carries Wired-into (declared or inherited); test/doc
      tasks carry `none` forms
