**Status:** Accepted

# Stories: Close the unguarded tmux fixture session that orphans keepalive loops (#1616)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the ordinary suite's one real tmux fixture session that the leak guard cannot see, and the runner-level kill-switch condition that permitted it. The guard's two-signal kill contract and production daemon restart behavior are unchanged.

## Story 1: Every real tmux session the suite creates is owned and reclaimed

As the operator of the machine that runs this suite, I want every real tmux session a test creates to live on a server the test run owns and to be reclaimed even after an interrupted run, so that no run can strand a keepalive loop.

### Acceptance Criteria

#### Happy Path

- Given the restart-wiring test has created its real tmux session on its private fixture server, when that fixture server lists its sessions, then that session's name appears in the listing.
- Given the restart-wiring test completes or fails, when its cleanup has run, then its fixture server is no longer running and the session no longer exists.

#### Negative Paths

- Given a previous run was interrupted and left a restart-wiring fixture server running, when the next run's pre-run sweep executes, then that server is stopped, and a session whose pane working directory is a real repository checkout, present in a listing the leak guard inspects, is left running.

### Done When

- [ ] A real-tmux assertion inside the restart-wiring test observes its own live session on its fixture server, and observes the server stopped after cleanup.
- [ ] An injected-runner regression case proves the leak guard's pre-run sweep kills a restart-wiring-shaped leaked session and spares an operator repository session present in the same listing.

## Story 2: The real-exec kill-switch cannot be evaded by choosing a session name

As a maintainer adding a test that needs tmux, I want the kill-switch to refuse every real session creation regardless of name, so that opting out of the leak guard is a deliberate, visible act rather than a side effect of naming.

### Acceptance Criteria

#### Happy Path

- Given `AI_CONDUCTOR_NO_REAL_EXEC` is set to `1`, when the real tmux runner is asked to create a session or respawn a pane under any session name, then it throws an error naming both the environment variable and the resolved session name before any tmux process is started.
- Given `AI_CONDUCTOR_NO_REAL_EXEC` is unset, when the real tmux runner respawns a pane in an absent session, then the call reaches tmux and returns its non-zero exit code rather than throwing.

#### Negative Paths

- Given `AI_CONDUCTOR_NO_REAL_EXEC` is set to `1` and the argv carries no resolvable session target, when the real tmux runner is asked to create a session or respawn a pane, then it still throws an error naming the environment variable and reporting the target as unresolved.
- Given `AI_CONDUCTOR_NO_REAL_EXEC` is set to `1`, when the real tmux runner is asked to run an observation or cleanup verb such as `has-session`, `capture-pane`, or `kill-session`, then the call reaches tmux unrefused.

### Done When

- [ ] Unit cases prove refusal for a prefixed name, an unprefixed name, and both refused verbs, with the environment variable and the session name present in the thrown message.
- [ ] A unit case proves an argv with no resolvable session target is refused with an explicit unresolved-target report rather than reaching tmux.
- [ ] Unit cases prove observation and cleanup verbs still reach tmux under the kill-switch, and that an unset kill-switch restores pass-through for the refused verbs.

## Negative-category review

Invalid input is covered by the unresolvable-target argv case. Over-broad enforcement — the failure mode that would break every observation helper — is covered by the verb pass-through case, and dependency unavailability is already handled by the runner's existing not-installed error, which this slice leaves untouched. Partial failure and interruption are the central concern and are covered by Story 1's sweep case, which is exactly the interrupted-teardown path; data integrity for the operator's live daemon is covered by the same case's spared-session assertion. Concurrency, authorization, resource exhaustion, cascade deletion, and immutability categories are inapplicable: no shared mutable store, protected resource, quota, dependent entity, or record is introduced, and no queue, datastore, upload, or transaction is added.
