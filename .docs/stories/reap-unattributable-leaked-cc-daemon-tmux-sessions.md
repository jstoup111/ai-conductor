**Status:** Accepted

# Stories: Dispatch process-tree teardown and leak status surface

**Source:** jstoup111/ai-conductor#544 (operator-scoped to the two gaps not covered by #257 and #2476)
**Track:** technical (no PRD). Tier M.
**Governing ADR:** adr-2026-10-12-daemon-owns-provider-dispatch-process-trees (APPROVED)
**Scope boundary:** Balanced. The daemon tears down what its own dispatches spawned and reports leftovers read-only. It never reaps a process or tmux session it did not spawn.

## Story 1: A settled dispatch leaves no tool processes behind

**Requirement:** ADR D1, D2, D4, D6

As an operator running the daemon, I want every process a provider dispatch spawned to end when that dispatch ends so that test workers stop accumulating and loading the machine.

### Acceptance Criteria

#### Happy Path
- Given a claude, codex, or pi dispatch whose provider started a test command in its own process group, when the provider subprocess exits normally, then every remaining process in that dispatch's tree receives SIGTERM and none is left running once the grace period ends.
- Given a dispatch whose provider subprocess is cancelled by its existing abort signal (step deadline, build-attempt abort, or operator stop), when the subprocess settles, then the dispatch's remaining tool processes are torn down the same way as on a normal exit.
- Given a dispatch member that ignores SIGTERM, when the grace period elapses and the member still runs with the same pid and start time, then it receives SIGKILL and is gone.
- Given a provider call made outside the lifecycle supervisor (for example the project prelude or a model availability probe), when that provider subprocess settles, then its leftover tool processes are torn down exactly as for a step dispatch.

#### Negative Paths
- Given a running dispatch whose provider has been silent for longer than any heartbeat threshold, when no existing authority has ended it, then no process in its tree is signalled.
- Given a tool process whose pid exited and was reused by an unrelated same-uid process before teardown signals it, when teardown compares the snapshot start time with the current one, then the unrelated process is not signalled.
- Given a dispatch member that exits between the snapshot and the signal, when teardown sends SIGTERM and receives ESRCH, then the member is counted as already gone and teardown continues with the remaining members.
- Given a process owned by a different uid that descends from nothing the daemon spawned, when any teardown runs, then that process is never read for membership and never signalled.
- Given a provider subprocess that settles with no surviving descendants, when teardown runs, then no signal is sent and the outcome is clean.

### Done When
- [ ] A test with injected process-table and kill adapters shows each of claude, codex, and pi registering its spawned root and tearing down a seeded descendant that sits in its own process group on settle.
- [ ] A test shows TERM, then grace, then KILL ordering for a SIGTERM-ignoring member, and no KILL for a member whose start time changed.
- [ ] A test shows a silent but unended dispatch receives no signal.
- [ ] No test reaches a real process kill; each destructive test proves the production adapter reaches the injected mock first.

## Story 2: Processes that outlived their parent are still attributed to their dispatch

**Requirement:** ADR D2, ADR assumption 1

As an operator, I want a test worker that was reparented to init to still be ended with its dispatch so that a dying provider cannot strand its children.

### Acceptance Criteria

#### Happy Path
- Given a dispatch whose provider subprocess has already exited and whose tool process has been reparented to init but still carries that dispatch's marker, when the dispatch settles, then that tool process is torn down.
- Given each supported provider (claude, codex, pi), when a probe dispatch runs a tool command that lists its own environment, then the result records whether that provider passes the dispatch marker to tool processes.

#### Negative Paths
- Given a provider whose tool sandbox strips the marker, when a reparented tool process from that provider survives teardown, then it is not signalled and the next daemon status reports it as an orphaned worktree process.
- Given a reparented process carrying a different dispatch's marker, when this dispatch settles, then that process is not signalled.
- Given a process whose environment cannot be read, when teardown evaluates membership, then it is treated as a member only if it is a live descendant of the recorded root.

### Done When
- [ ] A test seeds an injected process table with a reparented marker-carrying process and shows it terminated on settle, while a process with another dispatch's marker is untouched.
- [ ] The probe outcome for each provider is recorded in the plan's evidence, and any provider without marker inheritance is named in that provider's coverage note.

## Story 3: Daemon restart, stop, and exit end every open dispatch's tree

**Requirement:** ADR D5, ADR assumption 2

As an operator restarting or stopping the daemon, I want the dispatches it was running to leave nothing behind so that repeated restarts do not pile up orphaned test workers.

### Acceptance Criteria

#### Happy Path
- Given a daemon with an open registration whose provider has started test workers, when the daemon receives SIGHUP (from `ai-conductor daemon stop`, from `ai-conductor daemon restart` respawning the pane, or from the restart fallback), then conductor state is persisted first, every member of that registration is then torn down, and no member is left with parent pid 1 before the old daemon exits.
- Given a daemon with open registrations, when it receives SIGTERM and the drain completes, then every open registration is torn down before the lock is released and the process exits.
- Given a daemon whose SIGTERM drain hits the force-release backstop, when the backstop fires, then every open registration is torn down before the lock is force-released and the process exits with code 1.
- Given a daemon that finishes its loop normally, or exits through the stale-engine or lock-loser path, with open registrations, when it reaches that exit, then every remaining registration is torn down before the lock is released.

#### Negative Paths
- Given exit-path teardown on the SIGHUP path whose members are still alive after a grace of at most 2 seconds, when the grace expires, then the survivors are sent SIGKILL, the outcome records them, and the OTel stop still runs and SIGHUP is re-raised within the existing handler budget.
- Given two provider subprocesses running concurrently under one feature dispatch (for example parallel validation members), when one of them settles, then only that subprocess's own tree is torn down and its sibling keeps running.
- Given a daemon with no open dispatches, when it receives SIGHUP or SIGTERM, then no process is signalled and the exit timing is unchanged.
- Given two daemons for two different registered repos on one machine, when one daemon restarts, then no process belonging to the other daemon's dispatches is signalled.

### Done When
- [ ] A test with injected adapters shows every listed exit path awaiting teardown before its lock release.
- [ ] An integration check on a private tmux server (`createPrivateTmux`) running the real exit-witness wrapper shows that both `respawn-pane -k` and `kill-session` reach the daemon's SIGHUP handler.
- [ ] A test shows the SIGHUP path orders persistence, then teardown, then the OTel stop, and re-raises within the existing budget when members survive.

## Story 4: Session hosts started from a dispatch survive teardown with everything under them

**Requirement:** ADR D3

As an operator, I want a tmux server or other session host started from a dispatch, and everything running under it, to survive teardown so that operator sessions hosted by it are never destroyed, while a merely detached tool shell is still cleaned up.

### Acceptance Criteria

#### Happy Path
- Given a process that carries a dispatch's marker, is a session leader with at least one child that is itself a session leader, and is not a live descendant of that dispatch's root, when the dispatch is torn down, then neither it nor any process below it is signalled and the outcome counts each of them as skipped.
- Given a marker-carrying session leader that has no session-leader child and is not a live descendant of the dispatch root, when the dispatch is torn down, then it and its children are torn down like any other member.
- Given a session-leader process that is a live descendant of the dispatch root, when the dispatch is torn down, then it is torn down like any other member.

#### Negative Paths
- Given a tmux server started from a dispatch that now hosts an operator's session, when that dispatch settles or the daemon restarts, then the tmux server, its pane shells, and every process running in those panes are still running.
- Given a skipped session host whose parent is init, when the operator next runs daemon status, then that process is listed among the reported leftovers and not signalled.

### Done When
- [ ] A test seeds a marker-only session host with a pane shell and a pane child and shows all three skipped and counted on both settle and `teardownAll`, while a marker-only leader with no session-leader child and a descendant session leader are terminated.
- [ ] A test shows a skipped host whose parent is init appears in the status leak report.

## Story 5: Teardown fails closed when process facts are unavailable

**Requirement:** ADR D6, D7

As an operator, I want teardown to signal nothing it cannot positively attribute so that a broken process-table read can never kill an unrelated process.

### Acceptance Criteria

#### Happy Path
- Given a Linux host, when teardown reads the process table, then membership uses parent pid, session id, start time, working directory, and environment from the kernel's process files.
- Given a non-Linux POSIX host, when teardown reads the process table, then membership uses the system `ps` listing with the same fields.

#### Negative Paths
- Given a process-table read that fails or returns unparseable output, when teardown runs, then only the recorded root (if still alive with its recorded start time) is signalled and the outcome is indeterminate.
- Given a Windows host, when a dispatch settles or the daemon exits, then no process is signalled by teardown and the outcome is unsupported.
- Given a recorded root whose start time no longer matches its pid, when the table read failed, then nothing at all is signalled.

### Done When
- [ ] A test with a failing injected process table shows only the matching root is signalled and the outcome is indeterminate.
- [ ] A test with platform set to Windows shows zero kill calls and the outcome unsupported.
- [ ] Parser tests cover the `/proc` and `ps` readers against recorded fixture output.

## Story 6: Every teardown is visible on the event spine

**Requirement:** ADR D8

As an operator investigating a restart or a stalled build, I want each teardown recorded as an event so that the daemon log, UI, and telemetry all show what was ended and what survived.

### Acceptance Criteria

#### Happy Path
- Given any teardown, when it completes, then exactly one `dispatch_tree_reaped` event is emitted carrying the process-tree id, the managed dispatch id when present, the provider, the trigger (settle, sighup, sigterm, or completion), counts of terminated, killed, surviving, and skipped detached members, and the outcome (clean, survivors, indeterminate, or unsupported).
- Given any teardown performed by a running daemon, whether triggered by a dispatch settling or by a daemon exit path, when the event is emitted, then it is persisted to the daemon's `.daemon/events.jsonl`.

#### Negative Paths
- Given event persistence that throws while recording a teardown, when the teardown has already signalled its members, then the signals stand, the failure is logged, and the dispatch result is unchanged.
- Given a teardown with no members, when it completes, then its event still records the outcome clean with all counts zero.

### Done When
- [ ] The new variant exists in the `ConductorEvent` union with a routing entry in `event-sinks.ts`.
- [ ] Tests assert one event per teardown with every field populated for each outcome.
- [ ] No sidecar file or bespoke log is written by the feature.

## Story 7: Daemon status reports unattributable sessions and orphaned worktree processes without touching them

**Requirement:** ADR D9

As an operator triaging an incident, I want `daemon status` to tell me how many stray `cc-daemon-*` sessions and orphaned worktree processes exist and how old the oldest is so that I can tell leaks from real daemon sessions without reading `tmux ls` and `ps` by eye.

### Acceptance Criteria

#### Happy Path
- Given a `cc-daemon-*` tmux session whose name matches no registered project's session name, when the operator runs `ai-conductor daemon status`, then the output reports the count of unattributable sessions, the oldest one's age, and up to a bounded sample of names.
- Given a same-uid process whose parent pid is 1 and whose working directory is under a registered project's `.worktrees/`, when the operator runs daemon status, then the output reports the count of orphaned worktree processes, the oldest one's age, and a bounded sample of pids with their commands.
- Given a same-uid process whose parent pid is 1 and that carries a process-tree marker, when the operator runs daemon status, then it is reported among the orphaned processes whatever its working directory.
- Given no stray sessions and no orphaned worktree processes, when the operator runs daemon status, then the leak section states that none were found.

#### Negative Paths
- Given the production daemon session for a registered project, when daemon status runs, then that session is never reported as unattributable, even if its pane is dead or it is older than every other session.
- Given a stray session or orphaned process listed in the report, when daemon status completes, then no session was killed and no process was signalled.
- Given tmux is not installed or its server is not running, when daemon status runs, then the session line reports that session attribution is unavailable and the rest of status renders normally.
- Given the process table cannot be read, when daemon status runs, then the process line reports that orphan detection is unavailable and the rest of status renders normally.
- Given a process with parent pid 1 whose working directory is outside every registered project's `.worktrees/` and that carries no process-tree marker, when daemon status runs, then it is not reported.

### Done When
- [ ] A test with an injected tmux runner and process table seeds one stray session, one production session, and orphans inside and outside `.worktrees/`, and asserts exactly the stray session and the inside orphan are reported with counts and oldest ages.
- [ ] A test shows status renders with each source unavailable.
- [ ] The leak attribution component has no import path to the kill adapter.
