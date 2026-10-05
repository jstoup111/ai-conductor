# Implementation Plan: Isolate real-tmux tests from operator sessions (#2476)

**Date:** 2026-10-03
**Stories:** .docs/stories/isolate-real-tmux-tests-from-operator-sessions.md
**Conflict check:** Clean as of 2026-10-03 (`.docs/conflicts/2026-10-03-isolate-real-tmux-tests-from-operator-sessions.md`)

## Summary

Every tmux client in a Vitest run is confined to a run-owned server by an environment floor, each
real-tmux test gets its own private server through one shared fixture, interrupted runs are
reclaimed by the next run, and a structural audit rejects unsafe tmux access in tests. The plan has
14 tasks; no production module under `src/` changes.

## Technical Approach

- **Verified tmux behavior (probe, tmux 3.6).** With `TMUX` unset and no `-L`/`-S`, a client uses
  `$TMUX_TMPDIR/tmux-«uid»/default`; a set `TMUX` overrides `TMUX_TMPDIR`. The floor therefore sets
  `TMUX_TMPDIR` and deletes `TMUX` and `TMUX_PANE`.
- **Layer 1, run-level floor (Tasks 1–3).** New `src/conductor/test/tmux-isolation.ts` exports
  `installTmuxIsolationFloorSync(env = process.env)`. It creates a run-scoped root with
  `mkdtempSync(externalFixturePrefix('tmux-run', env))` (short path in the real tmpdir, attributed
  to the run id, so it stays under the Unix socket path limit even though the run temp root lives
  in the checkout), sets `TMUX_TMPDIR` to it, deletes `TMUX` and `TMUX_PANE`, and publishes the root
  as `AI_CONDUCTOR_TEST_TMUX_ROOT`. It is idempotent (an existing published root is reused) and
  throws `Error` naming the root path when the root cannot be created. Each of `vitest.config.ts`,
  `vitest.e2e.config.ts`, `vitest.smoke.config.ts` calls it immediately after `ensureRunTmpRootSync()`
  at config load, so `globalSetup` (where the leak guard runs), every forked worker, and every
  spawned child inherit it. `test/setup.ts` re-asserts it per worker. `test/global-setup.ts`
  teardown stops the floor server (`kill-server` with env `TMUX_TMPDIR=«root»`) and removes the root.
  Production `daemon-tmux.ts` is untouched; it simply inherits the environment.
- **Layer 2, private fixture (Tasks 4–6).** New `src/conductor/test/tmux-fixture.ts` exports
  `createPrivateTmux(ctx)`. It skips the test through Vitest's `ctx.skip('tmux not installed on PATH')`
  when `tmuxInstalled()` is false, creates its own root with
  `mkdtemp(externalFixturePrefix('tmux'))`, picks a unique `-L` name, and returns
  `{ run, listSessions, socketPath, dispose }`. `run` satisfies the production `TmuxRunner` type,
  prepends `-L «name»`, spawns with `{ ...process.env, TMUX_TMPDIR: «root», TMUX: undefined,
  TMUX_PANE: undefined }` and the existing `TMUX_COMMAND_TIMEOUT_MS` bound (SIGKILL on timeout →
  non-zero result), and throws `Error` naming the flag when a caller passes `-S` or `-L`. `dispose`
  runs `kill-server` on its own socket, ignores a non-zero result, removes its own root with
  `rm({ recursive: true, force: true })`, and is idempotent; it is registered with Vitest
  `onTestFinished`, which runs after pass, failed assertion, or thrown error.
- **Interrupted-run recovery (Tasks 7–8).** `sweepStaleTmuxRoots(realTmpdir, { ownRunId, isRunLive,
  run, logger })` in `tmux-isolation.ts` enumerates `acx-«runid»-tmux-run-*` and `acx-«runid»-tmux-*`
  entries, skips the current run and any run id that `isRunLive` reports live, and for each stale
  root runs `kill-server` against every socket under `«root»/tmux-«uid»/` (bounded runner, via
  `makeTmuxRunner` from `test/tmux-leak-guard.ts`) and then removes the root. `isRunLive` reuses the
  existing run-root staleness policy (`decideStaleRunRoots` with the owner marker and heartbeat in
  `test/tmpdir-leak-guard.ts`): a run id is live only when its run root exists and is not stale. A
  timed-out or failed `kill-server` logs `tmux-isolation: stale tmux root sweep failed for «path»`
  and retains the root. `global-setup.ts` calls it before the tmux leak guard's
  `sweepStaleDaemonSessions` and baseline snapshot. The sweep never issues a command without an
  explicit stale root's `TMUX_TMPDIR`, so it cannot reach the operator server.
- **Layer 3, structural audit (Tasks 9–10).** New `src/conductor/test/tmux-access-audit.ts` exports
  `auditTmuxAccessSource(path, source)` built on the TypeScript compiler API (`ts.createSourceFile`),
  following `src/engine/github-invocation-audit.ts`. It reports located findings for: a spawn call
  (`spawn`, `spawnSync`, `execFile`, `execFileSync`, `exec`, `execSync`, `execa`, `execaSync`, and
  their imported aliases) whose command is the literal `tmux` or a shell string beginning `tmux `,
  except a `-V` argv; a reference to `defaultTmuxRunner` passed as an argument; any assignment to or
  `delete` of `TMUX`, `TMUX_PANE`, `TMUX_TMPDIR` on `process.env` or in an object literal passed as
  `env`; a `'-S'` string literal in an argv array alongside `tmux`; and a tmux spawn whose `env`
  option is an object literal without a spread of `process.env`. Files are exempt only via
  `TMUX_AUDIT_ALLOWLIST: ReadonlyArray<{ path; reason }>`; the fixture and floor modules are
  allowlisted as the owners of tmux access. `findStaleAllowlistEntries(root)` reports entries whose
  file is missing or whose file now produces zero findings without the exemption.
- **Migration (Tasks 11–14).** `daemon-restart-wiring.test.ts`, `daemon-tmux.smoke.test.ts`,
  `daemon-stale-respawn.e2e.test.ts`, and `daemon-exit-witness-tmux.e2e.test.ts` obtain their runner
  from `createPrivateTmux` and pass it to the production helpers (`newDetachedSession`,
  `respawnPane`, `hasSession`, `killSession`, `setRemainOnExit`, `capturePane`,
  `makeTmuxSupervisor(run)`); listings come from the fixture's own `listSessions`. They no longer
  delete `AI_CONDUCTOR_NO_REAL_EXEC` (injected runners are unguarded by design). Existing real-tmux
  assertions are preserved verbatim except for the runner they use.
- **Local pattern basis.** Floor: mirrors `ensureRunTmpRootSync` (config-load install, idempotent,
  inherited by forks — proven by `tmpdir-redirect-propagation.test.ts`) and the
  `AI_CONDUCTOR_ENGINEER_DIR` redirect in `test/setup.ts`; allowed variation: a short external root.
  Fixture: generalizes `privateTmux` from `daemon-exit-witness-tmux.e2e.test.ts`. Audit: mirrors
  `auditGithubInvocationSource` + `24-exhaustive-direct-transport-detection.test.ts` (pure audit over
  `(path, source)`, synthetic cases, whole-tree zero-findings case); allowed variation: it lives in
  test support and scans `src/conductor/test/**`.
- **Out of plan (documentation boundary).** Architecture condition 7 (CLAUDE.md and
  `docs/contributing/validation.md` wording) is documentation and is delivered outside this plan;
  see the amendment on the architecture review.
- **Sequencing.** Task 1 and Task 9 are independent roots. Floor: 1 → 2 → 3. Fixture: 1 → 4 → {5, 6}.
  Sweep: 4 → 7 → 8. Migrations 11–14 follow 4 and 5. Task 10 (whole tree) follows 9 and 11–14.

## Prerequisites

- None. No ADR is created or amended.

## Slices

| Slice | Title | Tasks |
| --- | --- | --- |
| 1 | Run-level floor | 1, 2, 3 |
| 2 | Private fixture and recovery | 4, 5, 6, 7, 8 |
| 3 | Structural audit | 9 |
| 4 | Migration and whole-tree audit | 11, 12, 13, 14, 10 |

## Tasks

### Task 1: Run-level tmux isolation floor installer
**Story:** Story 1 (negative: socket root cannot be created; negative: concurrent runs)
**Type:** infrastructure

**Steps:**
1. Write failing unit tests in `src/conductor/test/tmux-isolation.test.ts` against `installTmuxIsolationFloorSync(env)` with an injected env object carrying a run root and original tmpdir: (a) it sets `TMUX_TMPDIR` to a new directory whose basename starts `acx-«runid»-tmux-run-`, deletes `TMUX` and `TMUX_PANE`, and sets `AI_CONDUCTOR_TEST_TMUX_ROOT` to the same path; (b) a second call returns the same root and creates nothing new; (c) with the original tmpdir pointing at a non-writable path, it throws an `Error` whose message contains the attempted root path and leaves `TMUX_TMPDIR` unset, with a spy on the `node:child_process` spawn boundary recording zero tmux invocations; (d) two calls with envs carrying different run ids produce different roots.
2. Verify RED.
3. Implement in `src/conductor/test/tmux-isolation.ts` per Technical Approach (`mkdtempSync(externalFixturePrefix('tmux-run', env))`).
4. Verify GREEN. Commit.

**Done when:**
- `installTmuxIsolationFloorSync` sets `TMUX_TMPDIR` and `AI_CONDUCTOR_TEST_TMUX_ROOT` to one new `acx-«runid»-tmux-run-` directory and removes `TMUX` and `TMUX_PANE`, as asserted by test (a).
- A repeated call reuses the published root and creates no second directory, as asserted by test (b).
- When the root cannot be created the installer throws an `Error` naming the root path, does not set `TMUX_TMPDIR`, and a spy on the `node:child_process` spawn boundary records zero tmux invocations, as asserted by test (c).
- Envs with different run ids receive different roots, as asserted by test (d).

**Files likely touched:**
- `src/conductor/test/tmux-isolation.ts` — new floor installer
- `src/conductor/test/tmux-isolation.test.ts` — new unit tests

**Dependencies:** none

### Task 2: Install the floor in all three Vitest tiers and tear it down
**Story:** Story 1 (negative: socket root cannot be created)
**Type:** infrastructure

**Steps:**
1. Write a failing structural test in `src/conductor/test/structural/tmux-floor-wiring.test.ts` that reads `vitest.config.ts`, `vitest.e2e.config.ts`, `vitest.smoke.config.ts` and asserts each calls `installTmuxIsolationFloorSync()` after `ensureRunTmpRootSync()`; and a runtime assertion (inside a default-tier test) that `process.env.TMUX` and `process.env.TMUX_PANE` are undefined and `process.env.TMUX_TMPDIR === process.env.AI_CONDUCTOR_TEST_TMUX_ROOT`.
2. Add a failing unit test for `teardownTmuxIsolationFloor(env, run)` in `tmux-isolation.test.ts`: with an injected runner it issues exactly one `kill-server` whose env has `TMUX_TMPDIR` equal to the published root, then removes the root; with no published root it issues no command.
3. Verify RED.
4. Implement `assertTmuxFloorActive(env)` in `tmux-isolation.ts` (throws unless `TMUX` is unset and `TMUX_TMPDIR === AI_CONDUCTOR_TEST_TMUX_ROOT`) with a unit test, and call it in `global-setup.ts` immediately before the leak guard's baseline and teardown snapshots. Call the installer in the three configs; call it in `test/setup.ts`; call `teardownTmuxIsolationFloor` from `test/global-setup.ts` teardown. A thrown installer error propagates from config load so Vitest exits before any test runs.
5. Verify GREEN. Commit.

**Done when:**
- All three Vitest configs call `installTmuxIsolationFloorSync()` immediately after `ensureRunTmpRootSync()`, as asserted by the structural test.
- Inside a running default-tier test, `TMUX` and `TMUX_PANE` are undefined and `TMUX_TMPDIR` equals `AI_CONDUCTOR_TEST_TMUX_ROOT`, as asserted by the runtime assertion.
- `teardownTmuxIsolationFloor` issues one `kill-server` scoped by `TMUX_TMPDIR=«published root»` and removes that root, and issues no command when no root is published, as asserted by its unit test.
- An installer error thrown at config load propagates out of the config module (no try/catch around the call), so the run fails before any test executes with the root path in the message, as asserted by the structural test reading the configs.
- `global-setup.ts` calls `assertTmuxFloorActive(process.env)` immediately before both the leak guard's baseline and teardown `snapshotDaemonSessions` calls, and `assertTmuxFloorActive` throws unless `TMUX` is unset and `TMUX_TMPDIR` equals `AI_CONDUCTOR_TEST_TMUX_ROOT`, as asserted by the structural ordering check and its unit test.

**Files likely touched:**
- `src/conductor/vitest.config.ts`, `src/conductor/vitest.e2e.config.ts`, `src/conductor/vitest.smoke.config.ts` — install call
- `src/conductor/test/setup.ts` — per-worker re-assertion
- `src/conductor/test/global-setup.ts` — floor teardown
- `src/conductor/test/tmux-isolation.ts` — `teardownTmuxIsolationFloor`
- `src/conductor/test/tmux-isolation.test.ts`, `src/conductor/test/structural/tmux-floor-wiring.test.ts`

**Dependencies:** Task 1

### Task 3: Prove the floor keeps every tmux client off a stand-in operator server, in each tier
**Story:** Story 1 (happy paths 1–3; negative: kill-switch deleted; negative: concurrent runs)
**Type:** happy-path

**Steps:**
1. Write a shared assertion module `src/conductor/test/tmux-floor-proof.ts` that, when tmux is installed: starts a stand-in "operator" server on a test-owned `-S «sentinel socket»` holding session `cc-daemon-operator-probe`; builds an env from `process.env` with `TMUX` set to that sentinel socket and applies `installTmuxIsolationFloorSync` to it (new run id); spawns a child `node --experimental-strip-types` script that imports `defaultTmuxRunner` from `src/engine/daemon-tmux.ts` and, with `AI_CONDUCTOR_NO_REAL_EXEC` deleted, runs `list-sessions` and `kill-session -t =cc-daemon-operator-probe`; spawns a second child that runs `tmux new-session -d -s cc-daemon-floor-child` with the inherited env; calls `snapshotDaemonSessions(realTmuxRunner)` from `test/tmux-leak-guard.ts` in a child with the floored env; repeats the floor for a second run id, creates `cc-daemon-same-name` under both floors, lists each, then stops one floor's server.
2. Assert: the child's listing lacks `cc-daemon-operator-probe`; after the kill attempt `tmux -S «sentinel» has-session -t =cc-daemon-operator-probe` exits 0; `cc-daemon-floor-child` exists under `«floor root»/tmux-«uid»/default` and the sentinel server's session list is unchanged; the leak-guard snapshot lacks `cc-daemon-operator-probe`; each concurrent floor lists exactly its own `cc-daemon-same-name`, and after stopping one, the other still has its session. Clean up every server it started in `onTestFinished`.
3. Call it from `src/conductor/test/tmux-floor.test.ts` (default tier), `src/conductor/test/tmux-floor.e2e.test.ts`, and `src/conductor/test/tmux-floor.smoke.test.ts`.
4. Verify GREEN (behaviour delivered by Tasks 1–2; RED was observed by temporarily skipping the installer). Commit.

**Done when:**
- In each of the three tier files, a `defaultTmuxRunner` `list-sessions` from a child whose env had `TMUX` pointed at the sentinel server returns a listing without `cc-daemon-operator-probe`.
- In each tier, a `defaultTmuxRunner` `kill-session -t =cc-daemon-operator-probe` with `AI_CONDUCTOR_NO_REAL_EXEC` deleted leaves that session running on the sentinel server, as asserted by `has-session` exiting 0.
- In each tier, a child-spawned `tmux new-session -d -s cc-daemon-floor-child` creates the session on the server under the floor root and adds no session to the sentinel server.
- In each tier, `snapshotDaemonSessions` run under the floored env never lists `cc-daemon-operator-probe`.
- Two floors with different run ids each list exactly their own `cc-daemon-same-name`, and stopping one floor's server leaves the other floor's session running.

**Files likely touched:**
- `src/conductor/test/tmux-floor-proof.ts` — shared assertion module
- `src/conductor/test/tmux-floor.test.ts`, `src/conductor/test/tmux-floor.e2e.test.ts`, `src/conductor/test/tmux-floor.smoke.test.ts`

**Dependencies:** Task 2

### Task 4: Shared private-server tmux fixture
**Story:** Story 2 (happy paths 1–3; negative: forbidden flag)
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/tmux-fixture.test.ts`: (a) two `createPrivateTmux(ctx)` fixtures in one test each create `cc-daemon-fixture-x`; each `listSessions()` returns exactly `['cc-daemon-fixture-x']`; `killSession('cc-daemon-fixture-x', a.run)` leaves `b`'s session present; (b) passing `a.run` to `newDetachedSession`, `respawnPane`, `hasSession`, `capturePane`, `killSession` from `src/engine/daemon-tmux.ts` changes only `a`'s server (b's list and a sentinel server's list unchanged); (c) `Buffer.byteLength(a.socketPath) < 104` while `AI_CONDUCTOR_TEST_TMP_ROOT` is a deep checkout path; (d) `a.run(['-S', '/x', 'ls'], { inherit: false })` and `a.run(['-L', 'y', 'ls'], { inherit: false })` throw `Error`s naming `-S` and `-L` respectively, and a spy on the spawn boundary records no call.
2. Verify RED.
3. Implement `src/conductor/test/tmux-fixture.ts` per Technical Approach (pattern: `privateTmux` in `daemon-exit-witness-tmux.e2e.test.ts` — every command carries `-L` plus an owned `TMUX_TMPDIR`; allowed variation: shared module with registered teardown).
4. Verify GREEN. Commit.

**Done when:**
- Two fixtures in one test each list exactly their own `cc-daemon-fixture-x`, and killing it through one fixture's runner leaves the other's session present, as asserted by test (a).
- Each production helper called with a fixture's runner issues every command, as recorded by a spy on the fixture's spawn boundary, with `-L «that fixture's name»` and `TMUX_TMPDIR` equal to that fixture's root, and a second fixture and a sentinel server stay unchanged, as asserted by test (b).
- The fixture socket path is under 104 bytes even when the run temp root is a deep checkout path, as asserted by test (c).
- The fixture runner throws an `Error` naming `-S` or `-L` for a caller-supplied socket flag before any spawn, as asserted by test (d) and its spawn spy recording zero calls.

**Files likely touched:**
- `src/conductor/test/tmux-fixture.ts` — new fixture module
- `src/conductor/test/tmux-fixture.test.ts` — new tests

**Dependencies:** Task 1

### Task 5: Fixture teardown is owned and idempotent
**Story:** Story 3 (happy paths 1–3; negatives 1–3)
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/tmux-fixture-teardown.test.ts`. For pass, failed-assertion, and thrown-error cases, run an inner test through a nested `describe` with `it.fails` / a thrown error, record the fixture's socket root and server, and assert in a following test that the root does not exist and `tmux -L «name»` with the fixture's `TMUX_TMPDIR` reports no server. Then: with a sentinel server and a second fixture both holding a session named like the first fixture's, `dispose()` the first and assert both others still list it; call `dispose()` after `kill-server` already ran and assert it resolves and the root is removed; remove the root first, call `dispose()`, and assert it resolves and a spawn spy records no command carrying any other socket.
2. Verify RED.
3. Implement `dispose` and `onTestFinished` registration in `src/conductor/test/tmux-fixture.ts`.
4. Verify GREEN. Commit.

**Done when:**
- After a passing, an assertion-failing, and a throwing test, the fixture's server reports no server and its socket root does not exist, as asserted by the three follow-up checks.
- `dispose()` leaves a same-named session on a sentinel server and on a second fixture running, as asserted by their listings.
- `dispose()` resolves without error and removes the root when the server already exited.
- `dispose()` resolves without error and issues no command to any other socket when the root was already removed, as asserted by the spawn spy.

**Files likely touched:**
- `src/conductor/test/tmux-fixture.ts` — `dispose`, `onTestFinished` registration
- `src/conductor/test/tmux-fixture-teardown.test.ts` — new tests

**Dependencies:** Task 4

### Task 6: Fixture behaviour without tmux and against a stopped server
**Story:** Story 2 (negatives: tmux not installed; stopped server)
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/tmux-fixture.test.ts`: (a) with `createPrivateTmux(ctx, { command: '/nonexistent/tmux' })`, the test is reported skipped with note `tmux not installed on PATH` (assert via a nested test's recorded result state `skip` and note); (b) after `kill-server` through the fixture, `run(['list-sessions'], { inherit: false })` returns a non-zero code within `TMUX_COMMAND_TIMEOUT_MS`, and a sentinel server's session list is unchanged; (c) with an injected `command` that blocks (a `sleep` script) and `timeoutMs: 200`, `run` returns a non-zero code in under 2 s.
2. Verify RED.
3. Implement the `command`/`timeoutMs` options and the `ctx.skip` path in `src/conductor/test/tmux-fixture.ts`.
4. Verify GREEN. Commit.

**Done when:**
- A fixture whose tmux command is absent marks its test skipped with a note naming tmux, as asserted by test (a), and does not pass or fail it.
- A command against the fixture's stopped server returns non-zero, the spawn spy records it carried only the fixture's `-L` name and `TMUX_TMPDIR` root, and a sentinel server's sessions are unchanged, as asserted by test (b).
- A blocking tmux command returns non-zero within the configured timeout instead of hanging, as asserted by test (c).

**Files likely touched:**
- `src/conductor/test/tmux-fixture.ts`, `src/conductor/test/tmux-fixture.test.ts`

**Dependencies:** Task 4

### Task 7: Sweep stale tmux roots before the leak-guard baseline
**Story:** Story 4 (happy paths 1–2)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/tmux-isolation.test.ts`: plant, under a temp "real tmpdir", a stale run's `acx-«old»-tmux-run-*` root and `acx-«old»-tmux-*` fixture root each hosting a real running server (started with `TMUX_TMPDIR=«root»`); with `isRunLive` returning false for `«old»`, `sweepStaleTmuxRoots` stops both servers (each root's `tmux ls` reports no server) and removes both roots. Add a structural assertion that `global-setup.ts` calls `sweepStaleTmuxRoots` before `sweepStaleDaemonSessions` and `snapshotDaemonSessions`.
2. Verify RED.
3. Implement `sweepStaleTmuxRoots` and a default `isRunLive` built on `decideStaleRunRoots` (owner marker + heartbeat), and wire it into `global-setup.ts` setup.
4. Verify GREEN. Commit.

**Done when:**
- `sweepStaleTmuxRoots` stops the planted stale run-level and fixture servers and removes both roots, as asserted by `tmux ls` reporting no server and the roots being absent.
- `global-setup.ts` invokes `sweepStaleTmuxRoots` before `sweepStaleDaemonSessions` and before the leak guard's baseline `snapshotDaemonSessions`, as asserted by the structural ordering check.

**Files likely touched:**
- `src/conductor/test/tmux-isolation.ts` — `sweepStaleTmuxRoots`, default `isRunLive`
- `src/conductor/test/global-setup.ts` — setup wiring
- `src/conductor/test/tmux-isolation.test.ts`

**Dependencies:** Task 4

### Task 8: Sweep spares live runs and the operator server, and never blocks on a wedged server
**Story:** Story 4 (negatives 1–3)
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/tmux-isolation.test.ts`: (a) a planted root for run id `«live»` with `isRunLive('«live»') === true` keeps its running server and its root; (b) a stale root whose `kill-server` is made to time out (bounded `makeTmuxRunner({ command: «blocking script», timeoutMs: 200 })`) is retained, the sweep resolves, and the logger receives one line beginning `tmux-isolation: stale tmux root sweep failed for ` followed by the root path; (c) with a sentinel "operator" server holding a `cc-daemon-*` session whose pane cwd is under the tmpdir, a full sweep leaves the sentinel's session list unchanged, and a spy runner records that every issued command's env carried a `TMUX_TMPDIR` equal to a planted stale root.
2. Verify RED.
3. Implement the live-run skip, the bounded failure path, and the scoped-env invariant in `sweepStaleTmuxRoots`.
4. Verify GREEN. Commit.

**Done when:**
- A root belonging to a live run keeps its running server and its directory after the sweep, as asserted by test (a).
- A stale root whose server does not answer is retained, the sweep resolves in under 2 s when its bounded runner uses `timeoutMs: 200` against a blocking command, and one failure line naming the root path is logged, as asserted by test (b).
- The sweep leaves a sentinel operator server's sessions unchanged and every command it issues carries `TMUX_TMPDIR` equal to a planted stale root, as asserted by test (c).

**Files likely touched:**
- `src/conductor/test/tmux-isolation.ts`, `src/conductor/test/tmux-isolation.test.ts`

**Dependencies:** Task 7

### Task 9: Tmux-access audit over test sources
**Story:** Story 5 (happy paths 2–4; negatives 1–6)
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/structural/tmux-access-audit.test.ts` with synthetic sources: direct `spawnSync('tmux', …)`, `execFileSync('tmux', …)`, `execa('tmux', …)`, an aliased import, and `execSync('tmux ls')` each yield one finding with the file, line, and message `direct tmux access outside the private-server fixture`; `newDetachedSession(name, defaultTmuxRunner)` yields a finding naming file and line; a table-driven test over each of `TMUX`, `TMUX_PANE`, `TMUX_TMPDIR` × {`process.env.V = x`, `delete process.env.V`, `{ env: { ...process.env, V: x } }`, `const e = { ...process.env }; delete e.V; spawnSync(cmd, args, { env: e })`} (12 cases) each yields a finding naming the variable, file, and line; `['-S', sock, 'ls']` in a tmux spawn yields a finding; `spawnSync('tmux', args, { env: { PATH } })` yields a finding; a source importing `createPrivateTmux` yields none; `spawnSync('tmux', ['-V'])` and `tmuxInstalled()` yield none; an allowlisted path with a reason yields none. `findStaleAllowlistEntries` reports an entry whose file is missing and an entry whose file yields no findings without the exemption, each by path.
2. Verify RED.
3. Implement `src/conductor/test/tmux-access-audit.ts` with the TypeScript compiler API (pattern: `src/engine/github-invocation-audit.ts` — import-alias resolution of child-process/execa bindings, located findings; allowed variation: test-support location, tmux-specific rules). Seed `TMUX_AUDIT_ALLOWLIST` with `test/tmux-fixture.ts`, `test/tmux-isolation.ts`, `test/tmux-floor-proof.ts`, `test/tmux-leak-guard.ts` (owners of tmux access), and the isolation machinery's own tests `test/tmux-isolation.test.ts`, `test/tmux-fixture.test.ts`, `test/tmux-fixture-teardown.test.ts` (they must start sentinel and stale servers outside the machinery under test), each with a written reason.
4. Verify GREEN. Commit.

**Done when:**
- `auditTmuxAccessSource` reports one finding with file, line, and the message `direct tmux access outside the private-server fixture` for each of `spawnSync('tmux', …)`, `execFileSync('tmux', …)`, `execa('tmux', …)`, an aliased-import spawn of `tmux`, and the shell string `execSync('tmux ls')`.
- It reports a finding naming file and line for `defaultTmuxRunner` passed to a helper, for a `-S` argv in a tmux spawn, and for a tmux spawn whose `env` literal lacks a `process.env` spread.
- It reports a finding naming the variable, file, and line for every one of the 12 cases in the table-driven test: each of `TMUX`, `TMUX_PANE`, `TMUX_TMPDIR` × {assigned on `process.env`, deleted from `process.env`, set in a child-process `env` object, deleted from a child-process `env` object}.
- It reports no finding for a source using `createPrivateTmux`, for `tmux -V` / `tmuxInstalled()` probes, or for an allowlisted path, and every allowlist entry carries a non-empty `reason`.
- `findStaleAllowlistEntries` reports, by path, an entry whose file is missing and an entry whose file no longer needs the exemption.

**Files likely touched:**
- `src/conductor/test/tmux-access-audit.ts` — new audit
- `src/conductor/test/structural/tmux-access-audit.test.ts` — new tests

**Dependencies:** none

### Task 10: Whole-tree tmux-access audit in the default tier
**Story:** Story 5 (happy path 1; negative: stale allowlist entry)
**Type:** happy-path

**Steps:**
1. Add a test to `src/conductor/test/structural/tmux-access-audit.test.ts` that walks every `.ts` file under `src/conductor/test/`, runs `auditTmuxAccessSource`, and expects an empty finding list, and runs `findStaleAllowlistEntries` over the real allowlist and expects an empty list. Remove any seeded entry that `findStaleAllowlistEntries` reports (a file that produces no finding without its exemption needs none). Beyond the Task 9 seed, add justified allowlist entries only for files that mock the spawn boundary (for example `test/engine/daemon-tmux.test.ts`, which mocks `node:child_process` with `vi.mock`), each with a reason.
2. Verify RED before the migrations land (findings in the four migrated files), GREEN after.
3. Commit.

**Done when:**
- The whole-tree test runs in the default Vitest tier (its file matches `test/**/*.test.ts` and no tier exclusion) and asserts zero findings across `src/conductor/test/**/*.ts`.
- The whole-tree test asserts `findStaleAllowlistEntries` returns an empty list for the shipped allowlist.
- Every shipped allowlist entry names a file that mocks the spawn boundary, owns fixture/floor/leak-guard tmux access, or tests that isolation machinery, with a non-empty reason.

**Files likely touched:**
- `src/conductor/test/structural/tmux-access-audit.test.ts`, `src/conductor/test/tmux-access-audit.ts`

**Dependencies:** Tasks 9, 11, 12, 13, 14

### Task 11: Migrate the restart-wiring test onto a private fixture
**Story:** Story 6 (happy path 1; happy path 4; negative: not skipped)
**Type:** refactor

**Steps:**
1. In `src/conductor/test/engine/daemon-restart-wiring.test.ts`, replace `defaultTmuxRunner`, `listDaemonSessions()`, and the `delete process.env.AI_CONDUCTOR_NO_REAL_EXEC` block with `createPrivateTmux(ctx)`; pass `fixture.run` to `realHasSession`, `setRemainOnExit`, `realRespawnPane`, `killSession`, and the supervisor used by the queued self-restart; replace `listDaemonSessions()` assertions with `fixture.listSessions()`.
2. Assert the session is listed before the restart, still exists after the queued self-restart fires, and the fixture server reports no server after cleanup.
3. Run the file with tmux installed; confirm it is not skipped. Commit.

**Done when:**
- After a queued self-restart fires, `hasSession` through the fixture runner returns true and `fixture.listSessions()` contains the session name.
- After cleanup, the fixture's server reports no server and the session name is absent.
- The file contains no `defaultTmuxRunner`, `listDaemonSessions`, or `AI_CONDUCTOR_NO_REAL_EXEC` mutation, and with tmux installed the test reports passed, not skipped.

**Files likely touched:**
- `src/conductor/test/engine/daemon-restart-wiring.test.ts`

**Dependencies:** Tasks 4, 5

### Task 12: Migrate the real-tmux smoke test onto a private fixture
**Story:** Story 6 (happy path 2; happy path 4; negatives: not skipped; respawn fallback)
**Type:** refactor

**Steps:**
1. In `src/conductor/test/engine/daemon-tmux.smoke.test.ts`, obtain `fixture.run` from `createPrivateTmux(ctx)` and pass it to `newDetachedSession`, `setRemainOnExit`, `respawnPane`, `hasSession`, `killSession`, and `captureScrollback`; remove `defaultTmuxRunner` and any `AI_CONDUCTOR_NO_REAL_EXEC` mutation; replace the `tmuxInstalled()` early return with the fixture's skip.
2. Keep every existing assertion: exact-`=` targeting with the near-name sibling, scrollback survival, `remain-on-exit`, pid change. In the respawn-failure fallback branch, assert the fixture server lists the recreated session and a sentinel server's sessions are unchanged. The sentinel is a second `createPrivateTmux` fixture, never a direct `tmux -S` server, so this file stays audit-clean.
3. Run with tmux installed; confirm not skipped. Commit.

**Done when:**
- Through the fixture runner, respawn-in-place keeps the session, preserves earlier scrollback, changes the pane pid, and exact-`=` targeting leaves the near-name sibling's capture untouched, as asserted by the existing smoke assertions.
- When respawn falls back to kill-and-recreate, the recreated session is listed on the fixture server and a sentinel server's session list is unchanged.
- The file contains no `defaultTmuxRunner` or `AI_CONDUCTOR_NO_REAL_EXEC` mutation, and with tmux installed the test reports passed, not skipped.

**Files likely touched:**
- `src/conductor/test/engine/daemon-tmux.smoke.test.ts`

**Dependencies:** Tasks 4, 5

### Task 13: Migrate the stale-respawn e2e test onto a private fixture
**Story:** Story 6 (happy path 3; happy path 4; negatives: not skipped; stale-session cleanup)
**Type:** refactor

**Steps:**
1. In `src/conductor/test/engine/daemon-stale-respawn.e2e.test.ts`, replace `defaultTmuxRunner` and the `AI_CONDUCTOR_NO_REAL_EXEC` deletion with `fixture.run` from `createPrivateTmux(ctx)` for every tmux call (create, capture-pane, respawn, kill).
2. Keep the existing respawn assertions; after the stale-session cleanup, assert the planted session is absent from `fixture.listSessions()` and a sentinel server's sessions are unchanged. The sentinel is a second `createPrivateTmux` fixture, never a direct `tmux -S` server, so this file stays audit-clean.
3. Run with tmux installed; confirm not skipped. Commit.

**Done when:**
- The existing stale-respawn assertions pass through the fixture runner unchanged.
- After cleanup the planted stale session is absent from the fixture's listing while a sentinel server's session list is unchanged.
- The file contains no `defaultTmuxRunner` or `AI_CONDUCTOR_NO_REAL_EXEC` mutation, and with tmux installed the test reports passed, not skipped.

**Files likely touched:**
- `src/conductor/test/engine/daemon-stale-respawn.e2e.test.ts`

**Dependencies:** Tasks 4, 5

### Task 14: Move the exit-witness e2e test onto the shared fixture
**Story:** Story 6 (happy path 3; happy path 4; negative: not skipped)
**Type:** refactor

**Steps:**
1. In `src/conductor/test/engine/daemon-exit-witness-tmux.e2e.test.ts`, delete the local `privateTmux` helper, its `sockets` registry, and its `afterEach`; obtain the runner from `createPrivateTmux(ctx)`; keep the launcher's `TMPDIR` handling for the witness script.
2. Keep every existing exit-witness assertion.
3. Run with tmux installed; confirm not skipped. Commit.

**Done when:**
- The existing exit-witness assertions pass with the runner from `createPrivateTmux`.
- The file defines no local tmux runner and spawns no `tmux` directly, and contains no `AI_CONDUCTOR_NO_REAL_EXEC` mutation.
- With tmux installed the test reports passed, not skipped.

**Files likely touched:**
- `src/conductor/test/engine/daemon-exit-witness-tmux.e2e.test.ts`

**Dependencies:** Tasks 4, 5

## Task Dependency Graph

```
1 ──> 2 ──> 3
1 ──> 4 ──> 5 ──> {11, 12, 13, 14} ──> 10
      4 ──> 6
      4 ──> 7 ──> 8
9 ─────────────────────────────────────> 10
```

## Integration Points

- After Task 2: every tier runs under the floor; Task 3 proves it from the production default runner, a spawned child, and the leak guard.
- After Task 5: the fixture is usable by migrated tests.
- After Task 10: the audit enforces the rule on the shipped tree.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an operator tmux server holding a session named `cc-daemon-operator-probe`, and a Vitest run started from a shell whose environment has `TMUX` set to that server's socket, when a test in the default, e2e, or smoke tier runs `tmux list-sessions` through the production default tmux runner with no `-L` or `-S`, then the listing does not contain `cc-daemon-operator-probe`. | 3 | "In each of the three tier files, a `defaultTmuxRunner` `list-sessions` from a child whose env had `TMUX` pointed at the sentinel server returns a listing without `cc-daemon-operator-probe`." | diff-local |
| Story 1 happy: Given the same operator server and run, when a test spawns a child process that inherits the test process environment and the child runs `tmux new-session -d -s cc-daemon-floor-child`, then that session exists on a server whose socket lies under the run's own tmux socket root, and the operator server gains no session. | 3 | "In each tier, a child-spawned `tmux new-session -d -s cc-daemon-floor-child` creates the session on the server under the floor root and adds no session to the sentinel server." | diff-local |
| Story 1 happy: Given the same run, when the suite-level tmux leak guard takes its baseline and teardown snapshots, then both snapshots are taken against the run's own server and never list `cc-daemon-operator-probe`. | 3, 2 | "In each tier, `snapshotDaemonSessions` run under the floored env never lists `cc-daemon-operator-probe`." | diff-local |
| Story 1 negative: Given a test that deletes `AI_CONDUCTOR_NO_REAL_EXEC` and calls `kill-session -t =cc-daemon-operator-probe` through the production default runner, when the call completes, then `cc-daemon-operator-probe` is still running on the operator server. | 3 | "In each tier, a `defaultTmuxRunner` `kill-session -t =cc-daemon-operator-probe` with `AI_CONDUCTOR_NO_REAL_EXEC` deleted leaves that session running on the sentinel server, as asserted by `has-session` exiting 0." | diff-local |
| Story 1 negative: Given the run's tmux socket root cannot be created, when Vitest setup runs, then the run fails before any test executes, with an error naming the socket root path, and no tmux command is issued against the operator server. | 1, 2 | "When the root cannot be created the installer throws an `Error` naming the root path, does not set `TMUX_TMPDIR`, and a spy on the `node:child_process` spawn boundary records zero tmux invocations, as asserted by test (c)." | diff-local |
| Story 1 negative: Given two Vitest runs started concurrently from two worktrees, when each run creates a session with the same name `cc-daemon-same-name`, then each run's listing shows exactly its own session, and ending one run leaves the other run's session running. | 1, 3 | "Two floors with different run ids each list exactly their own `cc-daemon-same-name`, and stopping one floor's server leaves the other floor's session running." | diff-local |
| Story 2 happy: Given two real-tmux fixtures created in the same Vitest worker, when each creates a session named `cc-daemon-fixture-x`, then each fixture's `list-sessions` shows exactly one session, and killing it in one fixture leaves the other fixture's session running. | 4 | "Two fixtures in one test each list exactly their own `cc-daemon-fixture-x`, and killing it through one fixture's runner leaves the other's session present, as asserted by test (a)." | diff-local |
| Story 2 happy: Given a fixture runner, when it is passed to the production tmux helpers (create session, respawn pane, has-session, capture pane, kill session), then each helper's command reaches only that fixture's server. | 4 | "Each production helper called with a fixture's runner issues every command, as recorded by a spy on the fixture's spawn boundary, with `-L «that fixture's name»` and `TMUX_TMPDIR` equal to that fixture's root, and a second fixture and a sentinel server stay unchanged, as asserted by test (b)." | diff-local |
| Story 2 happy: Given a fixture, when the test inspects its socket path, then the path is short enough to bind as a Unix socket even when the run's temporary root lies inside a deep checkout path. | 4 | "The fixture socket path is under 104 bytes even when the run temp root is a deep checkout path, as asserted by test (c)." | diff-local |
| Story 2 negative: Given tmux is not installed on PATH, when a real-tmux test requests a fixture, then the test is reported as skipped with a reason naming tmux, rather than passing or failing. | 6 | "A fixture whose tmux command is absent marks its test skipped with a note naming tmux, as asserted by test (a), and does not pass or fail it." | diff-local |
| Story 2 negative: Given a fixture's server has been stopped out from under it, when the test issues a command through the fixture runner, then the runner returns a non-zero result within the existing tmux command timeout instead of hanging, and the command never reaches any other server. | 6 | "A command against the fixture's stopped server returns non-zero, the spawn spy records it carried only the fixture's `-L` name and `TMUX_TMPDIR` root, and a sentinel server's sessions are unchanged, as asserted by test (b)." | diff-local |
| Story 2 negative: Given a fixture runner, when a caller passes its own `-S` or `-L` argument, then the runner refuses the call with an error naming the forbidden flag before tmux is started. | 4 | "The fixture runner throws an `Error` naming `-S` or `-L` for a caller-supplied socket flag before any spawn, as asserted by test (d) and its spawn spy recording zero calls." | diff-local |
| Story 3 happy: Given a fixture whose test passes, when the test's teardown runs, then the fixture's server is no longer running and its socket root no longer exists. | 5 | "After a passing, an assertion-failing, and a throwing test, the fixture's server reports no server and its socket root does not exist, as asserted by the three follow-up checks." | diff-local |
| Story 3 happy: Given a fixture whose test fails an assertion, when the test's teardown runs, then the fixture's server is no longer running and its socket root no longer exists. | 5 | "After a passing, an assertion-failing, and a throwing test, the fixture's server reports no server and its socket root does not exist, as asserted by the three follow-up checks." | diff-local |
| Story 3 happy: Given a fixture whose test throws before reaching any assertion, when the test's teardown runs, then the fixture's server is no longer running and its socket root no longer exists. | 5 | "After a passing, an assertion-failing, and a throwing test, the fixture's server reports no server and its socket root does not exist, as asserted by the three follow-up checks." | diff-local |
| Story 3 negative: Given a stand-in "operator" server and a second fixture both running sessions named identically to the first fixture's session, when the first fixture's teardown runs, then both other servers and their sessions are still running. | 5 | "`dispose()` leaves a same-named session on a sentinel server and on a second fixture running, as asserted by their listings." | diff-local |
| Story 3 negative: Given a fixture whose server already exited before teardown, when teardown runs, then teardown completes without error and still removes the fixture's socket root. | 5 | "`dispose()` resolves without error and removes the root when the server already exited." | diff-local |
| Story 3 negative: Given a fixture whose socket root was already removed before teardown, when teardown runs, then teardown completes without error and issues no command to any other server. | 5 | "`dispose()` resolves without error and issues no command to any other socket when the root was already removed, as asserted by the spawn spy." | diff-local |
| Story 4 happy: Given a previous run was killed before teardown, leaving its run-level server and a fixture server running with their socket roots present, when the next run's setup sweep executes, then both servers are stopped and both socket roots are removed. | 7 | "`sweepStaleTmuxRoots` stops the planted stale run-level and fixture servers and removes both roots, as asserted by `tmux ls` reporting no server and the roots being absent." | diff-local |
| Story 4 happy: Given the sweep has run, when the next run's leak guard takes its baseline, then the baseline is taken after the sweep. | 7 | "`global-setup.ts` invokes `sweepStaleTmuxRoots` before `sweepStaleDaemonSessions` and before the leak guard's baseline `snapshotDaemonSessions`, as asserted by the structural ordering check." | diff-local |
| Story 4 negative: Given another run is still active (its run root is live, not stale) and owns running tmux servers, when a new run's sweep executes, then the active run's servers and socket roots are left untouched. | 8 | "A root belonging to a live run keeps its running server and its directory after the sweep, as asserted by test (a)." | diff-local |
| Story 4 negative: Given a stale socket root whose server is unresponsive, when the sweep tries to stop it, then the sweep gives up within the existing tmux command timeout, reports the root by path in a failure message, and leaves the root in place rather than blocking the run. | 8 | "A stale root whose server does not answer is retained, the sweep resolves in under 2 s when its bounded runner uses `timeoutMs: 200` against a blocking command, and one failure line naming the root path is logged, as asserted by test (b)." | diff-local |
| Story 4 negative: Given the operator tmux server is running sessions with temporary-directory pane working directories, when the sweep executes, then the operator server and all of its sessions are left untouched. | 8 | "The sweep leaves a sentinel operator server's sessions unchanged and every command it issues carries `TMUX_TMPDIR` equal to a planted stale root, as asserted by test (c)." | diff-local |
| Story 5 happy: Given the repository's test tree after migration, when the default suite runs the tmux-access audit over every test file, then it reports zero findings. | 10 | "The whole-tree test runs in the default Vitest tier (its file matches `test/**/*.test.ts` and no tier exclusion) and asserts zero findings across `src/conductor/test/**/*.ts`." | diff-local |
| Story 5 happy: Given a test source that obtains its tmux server from the shared fixture module, when the audit scans it, then it reports no finding. | 9 | "It reports no finding for a source using `createPrivateTmux`, for `tmux -V` / `tmuxInstalled()` probes, or for an allowlisted path, and every allowlist entry carries a non-empty `reason`." | diff-local |
| Story 5 happy: Given a test source whose only tmux use is an installed-version probe that contacts no server (`tmux -V` or the production `tmuxInstalled` helper), when the audit scans it, then it reports no finding. | 9 | "It reports no finding for a source using `createPrivateTmux`, for `tmux -V` / `tmuxInstalled()` probes, or for an allowlisted path, and every allowlist entry carries a non-empty `reason`." | diff-local |
| Story 5 happy: Given a test source on the audit's justified allowlist, such as a unit test that replaces the process-spawn boundary with a mock before calling the tmux adapter, when the audit scans it, then it reports no finding, and the allowlist entry carries a written reason. | 9, 10 | "It reports no finding for a source using `createPrivateTmux`, for `tmux -V` / `tmuxInstalled()` probes, or for an allowlisted path, and every allowlist entry carries a non-empty `reason`." | diff-local |
| Story 5 negative: Given a test source that spawns `tmux` directly through `spawnSync`, `execFileSync`, `execa`, or a shell string, when the audit scans it, then it reports a finding naming the file, the line, and "direct tmux access outside the private-server fixture". | 9 | "`auditTmuxAccessSource` reports one finding with file, line, and the message `direct tmux access outside the private-server fixture` for each of `spawnSync('tmux', …)`, `execFileSync('tmux', …)`, `execa('tmux', …)`, an aliased-import spawn of `tmux`, and the shell string `execSync('tmux ls')`." | diff-local |
| Story 5 negative: Given a test source that passes the production default tmux runner to a tmux helper, when the audit scans it, then it reports a finding naming the file and line. | 9 | "It reports a finding naming file and line for `defaultTmuxRunner` passed to a helper, for a `-S` argv in a tmux spawn, and for a tmux spawn whose `env` literal lacks a `process.env` spread." | diff-local |
| Story 5 negative: Given a test source that assigns or deletes `TMUX`, `TMUX_PANE`, or `TMUX_TMPDIR` in `process.env` or in an env object it passes to a child process, when the audit scans it, then it reports a finding naming the variable, the file, and the line. | 9 | "It reports a finding naming the variable, file, and line for every one of the 12 cases in the table-driven test: each of `TMUX`, `TMUX_PANE`, `TMUX_TMPDIR` × {assigned on `process.env`, deleted from `process.env`, set in a child-process `env` object, deleted from a child-process `env` object}." | diff-local |
| Story 5 negative: Given a test source that passes `-S` to tmux, when the audit scans it, then it reports a finding naming the file and line. | 9 | "It reports a finding naming file and line for `defaultTmuxRunner` passed to a helper, for a `-S` argv in a tmux spawn, and for a tmux spawn whose `env` literal lacks a `process.env` spread." | diff-local |
| Story 5 negative: Given a test source that spawns a child with an environment built from scratch (not extending the test process environment) and that child runs tmux, when the audit scans it, then it reports a finding naming the file and line. | 9 | "It reports a finding naming file and line for `defaultTmuxRunner` passed to a helper, for a `-S` argv in a tmux spawn, and for a tmux spawn whose `env` literal lacks a `process.env` spread." | diff-local |
| Story 5 negative: Given an allowlist entry whose file no longer exists or no longer needs the exemption, when the audit runs, then it reports the stale entry by path so the allowlist cannot grow silently. | 9, 10 | "`findStaleAllowlistEntries` reports, by path, an entry whose file is missing and an entry whose file no longer needs the exemption." | diff-local |
| Story 6 happy: Given the restart-wiring test on a private fixture server, when a queued self-restart fires against its real session, then it asserts the session still exists after the restart and is gone after cleanup, using a listing taken from the fixture's own server. | 11 | "After a queued self-restart fires, `hasSession` through the fixture runner returns true and `fixture.listSessions()` contains the session name." | diff-local |
| Story 6 happy: Given the real-tmux smoke test on a private fixture server, when it respawns a session in place beside a near-name sibling, then it asserts exact-`=` targeting acts on the intended session only, the session keeps its scrollback, and the pane's process id changes. | 12 | "Through the fixture runner, respawn-in-place keeps the session, preserves earlier scrollback, changes the pane pid, and exact-`=` targeting leaves the near-name sibling's capture untouched, as asserted by the existing smoke assertions." | diff-local |
| Story 6 happy: Given the stale-respawn and exit-witness e2e tests on private fixture servers, when they exercise respawn, exit witnessing, and cleanup, then they assert the same observable outcomes as before migration. | 13, 14 | "The existing stale-respawn assertions pass through the fixture runner unchanged." | diff-local |
| Story 6 happy: Given a test that only probes whether tmux is installed (`tmux -V`, which contacts no server), such as the lifecycle e2e test with its mocked runner, when it runs, then it needs no fixture and the audit accepts the probe. | 9, 10 | "It reports no finding for a source using `createPrivateTmux`, for `tmux -V` / `tmuxInstalled()` probes, or for an allowlisted path, and every allowlist entry carries a non-empty `reason`." | diff-local |
| Story 6 happy: Given any migrated test, when it runs, then it does not delete or modify `AI_CONDUCTOR_NO_REAL_EXEC`. | 11, 12, 13, 14 | "The file contains no `defaultTmuxRunner`, `listDaemonSessions`, or `AI_CONDUCTOR_NO_REAL_EXEC` mutation, and with tmux installed the test reports passed, not skipped." | diff-local |
| Story 6 negative: Given tmux is installed, when a migrated test runs, then it executes its real-tmux assertions and is not reported as skipped. | 11, 12, 13, 14 | "The file contains no `defaultTmuxRunner` or `AI_CONDUCTOR_NO_REAL_EXEC` mutation, and with tmux installed the test reports passed, not skipped." | diff-local |
| Story 6 negative: Given respawn-in-place fails on the private server, when the restart path falls back to kill-and-recreate, then the test asserts the fallback acted on the fixture's server only. | 12 | "When respawn falls back to kill-and-recreate, the recreated session is listed on the fixture server and a sentinel server's session list is unchanged." | diff-local |
| Story 6 negative: Given the stale-respawn e2e test plants a stale session, when cleanup runs, then the test asserts only the fixture server's session was removed. | 13 | "After cleanup the planted stale session is absent from the fixture's listing while a sentinel server's session list is unchanged." | diff-local |

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
