**Status:** Accepted

# Stories: test-spawned daemons leak — real tmux daemons persist after tests

Technical track (no PRD). Source: issue jstoup111/ai-conductor#257.
Approach A (operator-selected): deep-seam tmux guard + daemon self-termination.
Tier: S — at least one negative path per story.

---

## Story: Deep-seam guard — the real tmux runner refuses to create daemon sessions under the test kill-switch

**Requirement:** TS-1 (issue #257 "Expected" bullet 1 + bullet 3 prior-art gap)

As a harness developer, I want the real tmux runner itself to refuse creating
`cc-daemon-*` sessions whenever the test kill-switch (`AI_CONDUCTOR_NO_REAL_EXEC=1`,
set by the global vitest setup) is active, so that no code path — current or
future — can leak a real build daemon out of a test run, regardless of which
seam it enters through.

### Acceptance Criteria

#### Happy Path
- Given `AI_CONDUCTOR_NO_REAL_EXEC=1`, when `defaultTmuxRunner` is invoked with a
  `new-session` argv whose `-s` session name starts with `cc-daemon-`, then no
  tmux process is spawned and a descriptive error is raised that names the
  kill-switch env var and the refused session name.
- Given `AI_CONDUCTOR_NO_REAL_EXEC=1`, when the engineer handoff path runs
  end-to-end with NO injected launch (real `ensureRunning` → `launchDaemon` →
  `makeTmuxSupervisor()` → `defaultTmuxRunner`), then after the run `tmux ls`
  shows zero new `cc-daemon-*` sessions, the spec handoff still completes
  (fire-and-forget contract: the refusal is surfaced via the existing
  "daemon was not started" warning, never a thrown failure of the handoff).
- Given the kill-switch is NOT set (production/operator use), when any launch
  path creates a daemon session, then `defaultTmuxRunner` executes
  `tmux new-session` exactly as today (byte-identical argv, no behavior change).

#### Negative Paths
- Given `AI_CONDUCTOR_NO_REAL_EXEC=1`, when `defaultTmuxRunner` is invoked with a
  non-creating subcommand (`has-session`, `kill-session`, `capture-pane`,
  `send-keys`, `ls`), then the command executes normally — observation and
  cleanup helpers keep working under the kill-switch (tests that clean up or
  inspect sessions are not broken).
- Given `AI_CONDUCTOR_NO_REAL_EXEC=1`, when `new-session` is invoked for a
  session NOT prefixed `cc-daemon-` (e.g. a test fixture's own scratch
  session), then it executes normally — the guard is scoped to daemon
  sessions only, not a blanket tmux ban.
- Given `AI_CONDUCTOR_NO_REAL_EXEC=1` and an EXPLICITLY injected TmuxRunner
  (unit tests asserting argv via spies), when Supervisor methods run, then the
  injected runner is called unchanged — the guard lives only in
  `defaultTmuxRunner`, so injected-runner delegation contracts are unaffected.

### Done When
- [ ] `defaultTmuxRunner` in `src/conductor/src/engine/daemon-tmux.ts` refuses
      `new-session` for `cc-daemon-*` names under `AI_CONDUCTOR_NO_REAL_EXEC=1`
      with an error message containing both the env var name and the session name.
- [ ] A test proves the full un-injected handoff path (`ensureRunning` with no
      `launch` override) creates zero tmux sessions under the kill-switch, and
      the handoff result still reports success.
- [ ] A test proves `has-session`/`kill-session` and non-`cc-daemon-` `new-session`
      argv still execute under the kill-switch (guard scoping).
- [ ] Full suite (`npx vitest run`) passes with `tmux ls` identical before and
      after the run (no new `cc-daemon-*` sessions).
- [ ] Existing `launchDaemon` kill-switch (`AI_CONDUCTOR_NO_DAEMON_AUTOLAUNCH`)
      is retained unchanged as the operational (non-test) suppressor.

---

## Story: Daemon self-terminates when its repo root no longer exists

**Requirement:** TS-2 (issue #257 "Expected" bullet 2 — defense in depth)

As an operator, I want a running daemon whose repo root has been deleted to
exit cleanly with a logged reason, so that an escaped or orphaned daemon
(e.g. one leaked against a deleted test tmpdir) self-limits instead of
idle-looping forever or resolving identity and burning tokens against a
nonexistent target.

### Acceptance Criteria

#### Happy Path
- Given a daemon loop running against repo root R, when R is deleted and the
  next loop iteration begins, then the loop stops with a new
  `DaemonStopReason` value `repo_root_missing`, logs one clear line naming
  the missing path, dispatches no further work, and the process exits —
  which ends the tmux session's foreground command, closing the session.

#### Negative Paths
- Given a daemon whose repo root exists throughout, when the daemon runs a
  full backlog cycle plus idle polls, then no `repo_root_missing` stop is
  ever triggered (no false positives; termination requires definitive
  absence of the directory, not a transient stat error).
- Given a daemon parked in the fail-closed identity loop ("daemon identity
  unresolved — building NOTHING"), when the repo root is deleted, then the
  daemon STILL self-terminates on the next poll tick — the existence check
  must not be bypassed by the identity early-continue path (this is exactly
  the leaked-daemon state observed in #257).
- Given the repo root vanishes while workers are in flight, when the check
  trips, then the daemon exits without hanging (bounded shutdown: it must
  not block forever awaiting workers whose repo is gone).

### Done When
- [ ] `DaemonStopReason` union includes `repo_root_missing`; `runDaemon`
      returns it when the repo root directory is absent at the top of a loop
      iteration.
- [ ] The check runs on every loop iteration, including idle-poll ticks and
      identity-fail-closed passes (test covers the identity-parked case).
- [ ] A test proves no false-positive termination when the root exists for
      the whole run.
- [ ] Daemon log output contains a single clear `repo root missing` line with
      the absolute path on termination.
- [ ] `src/conductor/README.md` documents the new stop reason.
