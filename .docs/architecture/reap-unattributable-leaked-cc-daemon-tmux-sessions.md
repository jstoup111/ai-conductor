# Components and sequences: Dispatch process-tree teardown and leak status surface

**Last updated:** 2026-10-12
**Scope:** To-be design for jstoup111/ai-conductor#544 (feature
`reap-unattributable-leaked-cc-daemon-tmux-sessions`, Tier M, technical track). Covers how the
daemon attributes every process a provider dispatch spawns, terminates that set on each exit path
the daemon controls, and reports (never reaps) unattributable `cc-daemon-*` tmux sessions and
orphaned worktree processes in `daemon status`. Test-side tmux isolation (#2476) and the
test kill-switch session guard (#257) are out of scope and shown nowhere.

## Component diagram

```mermaid
graph TD
  subgraph providers["Provider adapters (claude, codex, pi)"]
    claude["claude-provider subprocessFactory"]
    codex["codex-provider spawnCodex"]
    pi["pi-provider subprocessFactory"]
  end
  providers -->|"spawn and settle via shared helper"| tracker["trackProviderProcess (execution/child-environment seam)"]
  tracker -->|"stamps AI_CONDUCTOR_PROCESS_TREE_ID=«processTreeId»"| providers
  tracker -->|"reserve id before spawn; bind root pid + start time after; release on settle"| registry["DispatchProcessRegistry (daemon-scoped, in-memory)"]
  callSites["Every provider.invoke call site (step-runners, prelude, model probe)"] -->|"unchanged; onSpawn stays observation-only"| providers
  registry --> teardown["DispatchTreeTeardown (TERM, grace, re-read, KILL)"]
  teardown --> procTable["ProcessTable adapter (injectable)"]
  procTable -->|"Linux"| procfs["/proc: ppid, cwd, environ"]
  procTable -->|"other POSIX"| psCmd["ps -o pid,ppid,command / ps eww"]
  teardown -->|"signal(pid)"| killAdapter["Kill adapter (injectable, ESRCH-tolerant)"]
  daemonCli["daemon-cli exit paths"] -->|"teardownAll()"| teardown
  daemonCli --- sigterm["SIGTERM drain end + force-release backstop"]
  daemonCli --- sighup["SIGHUP handler: persist, teardown, OTel stop, re-raise (stop, restart)"]
  daemonCli --- normal["normal completion, stale-engine and lock-loser exits (teardown before lock release)"]
  teardown -->|"dispatch_tree_reaped"| spine["ConductorEvent spine: event-sinks then .daemon/events.jsonl"]

  statusCli["daemon status (daemon-observe-cli runDaemonStatus)"] --> leakScan["LeakAttribution (read-only)"]
  leakScan --> regRead["Project registry (registered repo paths)"]
  leakScan -->|"list-sessions"| tmuxRun["TmuxRunner listSessions (daemon-tmux)"]
  leakScan --> procTable
  leakScan -. "never" .-> killAdapter
```

## Sequence: `daemon restart` while a build is running

```mermaid
sequenceDiagram
  participant Op as Operator
  participant Sup as daemon restart (supervisor)
  participant Tmux as tmux server
  participant D as Daemon process
  participant Reg as DispatchProcessRegistry
  participant PT as ProcessTable
  participant K as Kill adapter
  participant Ev as Event spine
  Op->>Sup: ai-conductor daemon restart (or stop via kill-session)
  Sup->>Tmux: respawn-pane -k -t =«session»:
  Tmux->>D: SIGHUP
  D->>D: persist conductor state (interruption, not provider failure)
  D->>Reg: open registrations
  Reg-->>D: «processTreeId» with root pid
  D->>PT: members of «processTreeId» (env marker + descendants of root)
  PT-->>D: members incl. vitest workers in their own process groups (session hosts and their subtrees excluded)
  D->>K: SIGTERM each member (pid + start time match)
  D->>D: grace wait, at most 2 s
  D->>PT: re-read survivors
  D->>K: SIGKILL survivors
  D->>Ev: dispatch_tree_reaped (dispatchId, path, terminated, killed, survivors)
  D->>D: flush OTel, re-raise SIGHUP
  Tmux->>Tmux: launch fresh daemon in same pane
```

## Sequence: `daemon status` leak report

```mermaid
sequenceDiagram
  participant Op as Operator
  participant St as daemon status
  participant LA as LeakAttribution
  participant R as Registry
  participant T as TmuxRunner
  participant PT as ProcessTable
  Op->>St: ai-conductor daemon status
  St->>LA: scan
  LA->>R: registered repo paths
  LA->>T: list-sessions (cc-daemon- prefix)
  T-->>LA: session names and created times
  LA->>LA: unattributable = no sessionNameForRepo match
  LA->>PT: processes with ppid 1
  PT-->>LA: pid, cwd, start time, dispatch marker
  LA->>LA: orphaned = ppid 1 and (cwd under a registered «repo»/.worktrees/ or carries a process-tree marker)
  LA-->>St: counts, oldest ages, sample pids and names
  St-->>Op: leak lines (read-only, nothing signalled)
```

## Legend

- **DispatchProcessRegistry**: an in-memory map inside the daemon process from each open dispatch
  id to its provider root pid. It is never persisted, so it is not a second telemetry channel; the
  durable record is the `dispatch_tree_reaped` event.
- **trackProviderProcess**: one helper in `src/execution/child-environment.ts` that all three
  adapters call at spawn. It stamps the marker into the child environment, registers the root, and
  triggers teardown when that subprocess settles. Hooking the adapters (not each `invoke` call
  site) covers every provider path, including those outside the lifecycle supervisor.
- **Dispatch membership**: a process belongs to a dispatch when it carries the inherited
  `AI_CONDUCTOR_PROCESS_TREE_ID` marker or is a descendant of the recorded root. The marker survives
  reparenting to init, which a parent-pid walk alone does not; the walk covers children that scrub
  their environment. A process found only by marker that is a session host (a session
  leader with a session-leader child, e.g. a tmux server), and everything below it, is never
  signalled; status reports a host whose parent is init. A detached leader that hosts no session is
  an ordinary member.
- **ProcessTable / Kill adapter**: the only process boundary. Both are injectable so tests never
  signal real pids (repo Test Process Isolation rule).
- **LeakAttribution**: read-only. It has no edge to the Kill adapter by construction.
- `«x»` marks a variable value.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-12 | Initial generation | DECIDE for #544, Approach B (dispatch-tree teardown + read-only status surface) |
