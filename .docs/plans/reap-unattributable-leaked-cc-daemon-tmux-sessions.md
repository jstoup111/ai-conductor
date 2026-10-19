# Implementation Plan: Dispatch process-tree teardown and leak status surface

**Date:** 2026-10-12
**Source:** jstoup111/ai-conductor#544
**Track:** technical (no PRD). Tier M.
**Stories:** .docs/stories/reap-unattributable-leaked-cc-daemon-tmux-sessions.md
**Conflict check:** Clean as of 2026-10-12 (`.docs/conflicts/2026-10-12-reap-unattributable-leaked-cc-daemon-tmux-sessions.md`)
**Governing ADR:** adr-2026-10-12-daemon-owns-provider-dispatch-process-trees

## Summary

The daemon records every provider subprocess at the adapter spawn site, stamps a per-spawn
process-tree marker into its environment, and terminates the subprocess's surviving descendants and
marker carriers when it settles or the daemon exits. Every teardown emits one persisted event.
`daemon status` gains a read-only leak section. 18 tasks.

## Technical Approach

- **Process boundary (Tasks 3–4).** New `src/conductor/src/execution/process-table.ts` exports a
  `ProcessTable` interface with `snapshot(): Promise<ProcessEntry[] | null>` (`null` means the table
  could not be read) and `startTimeOf(pid): Promise<string | null>` (a single-process read used when
  the full snapshot fails). It also exports `ProcessEntry`:
  - `pid`, `ppid`, `sid`, `startTime` (an opaque identity string), `startedAt` (wall-clock epoch ms,
    used for ages), `uid`
  - `cwd: string | null`
  - `marker: string | null | undefined`: `undefined` means the environment was unreadable, `null`
    means no marker
  - `command`

  Readers:
  - `createProcfsProcessTable({ root })` reads `/proc/«pid»/stat` (ppid, session and starttime
    fields, parsed after the last `)` so a `comm` containing spaces or parentheses cannot shift
    fields), `status` (`Uid:`), `cwd` (readlink) and `environ` (NUL-split).
  - `createPsProcessTable({ run })` parses `ps -axo pid=,ppid=,sess=,uid=,lstart=,command=`, reads
    the marker from `ps eww`, and reads cwd from `lsof -a -d cwd -Fn`.
  - `defaultProcessTable(platform)` returns procfs on `linux`, ps on other POSIX, and `null` on
    `win32`.
  The procfs reader derives `startedAt` from `/proc/stat` `btime` plus starttime divided by an
  injected clock-tick rate (default `getconf CLK_TCK`, falling back to 100). The ps reader derives it
  from `lstart`. Both put the full command line in `command`.
- **Membership (Task 5).** A pure function in new `src/conductor/src/execution/process-tree-teardown.ts`:
  `computeMembers(entries, registration, selfUid)`. Members are same-uid entries that are a
  transitive descendant of the registered root (matched by pid and start time) or that carry
  `marker === registration.processTreeId`. A session host is a marker-only entry with `pid === sid`
  where some snapshot entry with `ppid === pid` is itself a session leader. The host and every entry
  below it (reached by walking `ppid` within the snapshot), whatever their marker state, are
  skipped, counted in `skippedDetached`, and never members, unless they are live descendants of the
  root. An entry with `marker === undefined` is a member only by descent.
- **Escalation (Task 6).** `teardownProcessTree(registration, trigger, deps)` in the same module:
  1. Snapshot the table and compute members.
  2. SIGTERM each member through the injected `kill(pid, signal)`.
  3. Wait `graceMs` through the injected `sleep`.
  4. Re-snapshot and SIGKILL only members whose pid and start time still match. If the re-snapshot
     is `null`, SIGKILL only the root under the `startTimeOf` rule and report `indeterminate`.
  5. Treat ESRCH as gone.
  6. Return `{ terminated, killed, survivors, skippedDetached, outcome }`.

  `outcome` is one of:
  - `clean`: no survivors;
  - `survivors`;
  - `indeterminate`: the full table was unreadable. Only the recorded root is signalled, and only
    when `ProcessTable.startTimeOf(rootPid)` still returns the start time recorded at registration;
  - `unsupported`: `win32`.
- **Ownership seam (Task 8).** New `src/conductor/src/execution/dispatch-process-registry.ts` holds
  the daemon-scoped registry:
  - `installDispatchProcessRegistry(deps)` returns an uninstall function. It is installed only by the
    daemon.
  - The default is inert: `reserve` returns a reservation whose `processTreeId` is `null`, it
    registers nothing and it signals nothing, so interactive runs gain neither the marker nor any
    teardown.
  - `reserve({ provider, dispatchId })` is called before spawn. It returns `{ processTreeId, bind(pid)
    }`, where `processTreeId` is a fresh `randomUUID()` per spawn, so siblings under one managed
    dispatch get distinct ids.
  - `bind(pid)` is called right after spawn. It records the root pid and its start time through
    `ProcessTable.startTimeOf(pid)` under that same id and returns `{ settle() }`.
  - `teardownAll(trigger, { graceMs })` tears down every open registration and awaits in-flight
    settle teardowns. It first cuts any in-flight settle grace down to its own `graceMs`: the sleep
    is abortable, so the in-flight teardown proceeds to its re-read and SIGKILL no later than
    `graceMs` after `teardownAll` starts.
  - Each registration is torn down at most once. A settle that arrives after `teardownAll` claimed
    it is a no-op, which gives exactly one event per teardown.
  - The registry emits `dispatch_tree_reaped` through its injected `emit`. An emit rejection is
    logged and swallowed.

  `src/conductor/src/execution/child-environment.ts` gains:
  - `withProcessTreeMarker(env, reservation)`, which sets `AI_CONDUCTOR_PROCESS_TREE_ID` to the
    reservation's `processTreeId` and returns `env` unchanged when that id is `null`;
  - `trackProviderProcess(subprocess, reservation)`, which binds `subprocess.pid` to the reservation
    and attaches settle to the subprocess promise's fulfilment and rejection, including
    cancellation.
- **Adapters (Tasks 9–11).** Claude (`runClaude` and its environment builder near the
  `composeManagedSessionEnvironment` call), codex (`spawnCodex` and its environment builder) and pi
  (its subprocess factory call) each do three things: call `reserve({ provider, dispatchId })` before spawn,
  with the managed `dispatchId` when present; stamp `withProcessTreeMarker(env, reservation)` into
  the child env; and call `trackProviderProcess(subprocess, reservation)` right after spawn.
  `InvokeOptions.onSpawn` is not changed. Because the hook is at the adapter, every `invoke` call
  site is covered, including the project prelude and the model-availability probe.
- **Event (Task 7).** A new `dispatch_tree_reaped` variant in `src/conductor/src/types/events.ts`
  with fields `processTreeId`, `dispatchId?`, `provider`, `trigger` (`settle`, `sighup`, `sigterm`,
  `completion`), `terminated`, `killed`, `survivors`, `skippedDetached`, `outcome` and `ts`. Its
  `event-sinks.ts` routing is `persist: true`, `render: false`, `audit: false`, `otel: false`.
- **Daemon wiring (Tasks 12–15).** In `src/conductor/src/daemon-cli.ts`:
  - After `startDaemonEventPersistence` (that is, after lock acquisition), install the registry with
    the daemon `events` emitter, so every teardown persists to `.daemon/events.jsonl`. The lock-loser
    exit happens before installation, so its registry is empty by construction.
  - `installDaemonOtelSighupHandler` gains an optional `teardownProcessTrees` and runs, in order:
    `runSighupPersistence()`, then `teardownProcessTrees('sighup', { graceMs: 2000 })`, then the
    visualizers and OTel, all inside the existing `DAEMON_OTEL_SIGHUP_STOP_TIMEOUT_MS` race.
  - The SIGTERM drain-completion path and `onForceRelease` each await
    `teardownAll('sigterm', { graceMs: 2000 })` before `releaseBackstop`/`lock.release`.
  - Normal completion awaits `teardownAll('completion', …)` before `lock.release()`.
  - `createRestartRequester` gains `deps.teardownAll`, which it awaits before each
    `lock.releaseSync()`.
  - Settle grace is `PROCESS_TREE_SETTLE_GRACE_MS = 5000`.
- **Status (Tasks 16–18).**
  - `daemon-tmux.ts` gains `listSessions(run)`, which returns `{ name, createdAt }` from
    `list-sessions -F '#{session_name} #{session_created}'`, or `null` when tmux is missing or no
    server is running.
  - New `src/conductor/src/engine/leak-attribution.ts` computes the report from the registry
    records, session list, process table, `selfUid` and `now`. It imports nothing from
    `process-tree-teardown.ts` or any kill adapter.
  - `runDaemonStatus` renders one global leak section after the per-project rows. Its injectable
    `tmuxRunner` and `processTable` deps follow the existing `hasSessionProbe` pattern.
- **Probes first (Tasks 1–2).** These are architecture-review condition 1.
  - Task 1 is a smoke-tier live probe of marker inheritance per provider CLI.
  - Task 2 is a real-tmux integration check on a private server, using `createPrivateTmux` from
    #2476, which must be merged first. It checks that the real exit-witness wrapper lets
    `respawn-pane -k` and `kill-session` reach a node SIGHUP handler.
- **Local pattern: process-tree signalling.** The precedent is `full-suite-executor.ts`
  (`terminateProcessTree`, `signalPosixProcessTree`, and the `FullSuiteProcessTreeCleanupDependencies`
  type).
  - Preserve its injectable cleanup dependencies, ESRCH treated as gone, and the separate `win32`
    branch.
  - Allowed variation: membership comes from descent plus marker, never from a process-group kill.
    Provider tool commands create their own groups, so a group kill misses them (ADR Option D).
- **Test isolation (CLAUDE.md, architecture-review condition 2).**
  - No test calls the real `process.kill` with a real target. Tests inject `kill` and `ProcessTable`.
  - Each destructive-path test first proves the production code path reaches the injected mock: a
    spy records the call.
  - Real-tmux tests use only `createPrivateTmux`.

## Prerequisites

- jstoup111/ai-conductor#2476 (`createPrivateTmux` in `src/conductor/test/tmux-fixture.ts`) is
  merged. Task 2 depends on it.

## Tasks

### Task 1: Probe marker inheritance through each provider's tool subprocesses
**Story:** Story 2 happy path 2
**Type:** infrastructure

**Steps:**
1. Add `src/conductor/test/execution/process-tree-marker-inheritance.smoke.test.ts`.
   - For each of claude, codex and pi, spawn the real CLI with `AI_CONDUCTOR_PROCESS_TREE_ID=«uuid»`
     in its environment.
   - Prompt it to run the shell command `printenv AI_CONDUCTOR_PROCESS_TREE_ID` through its own tool
     and reply with only the output.
   - Assert the reply contains the uuid.
   - A provider whose CLI is not on PATH or not authenticated is skipped through `ctx.skip`, with a
     reason naming the provider and the missing prerequisite.
2. Run the smoke file for the providers available in the build session.
   - Each assertion that fails proves that provider strips the marker. Change that provider's case to
     assert the absence instead, titled `«provider» strips the process-tree marker (walk-only
     coverage)`.

**Done when:**
- [test] The smoke file holds one case per provider (claude, codex, pi), and each case asserts the printed `AI_CONDUCTOR_PROCESS_TREE_ID` value equals the uuid it set, or is titled `«provider» strips the process-tree marker (walk-only coverage)` and asserts absence.
- [test] A provider CLI that is unavailable is skipped with a reason naming the provider and the missing prerequisite, never passed.
- The claude case executed in the build session, and its pass or walk-only result is the recorded outcome for claude.

**Files likely touched:**
- `src/conductor/test/execution/process-tree-marker-inheritance.smoke.test.ts` — new probe

**Dependencies:** none

### Task 2: Prove SIGHUP reaches the daemon process under the real exit-witness wrapper
**Story:** Story 3 happy path 1
**Type:** infrastructure

**Steps:**
1. Add `src/conductor/test/engine/daemon-sighup-delivery.test.ts` using `createPrivateTmux(ctx)`.
   - Start a session whose command is `buildDaemonExitWitnessCommand(«node script», «temp repo»)`.
     The script installs a SIGHUP handler that writes a marker file into the temp repo and exits.
   - Case (a) uses `respawnPane` with the fixture runner. Case (b) uses `killSession` with the
     fixture runner.
   - Each case polls up to 5 s for the marker file.
2. If either case is RED, make the wrapper forward the hangup. Change the wrapper string in
   `buildDaemonExitWitnessCommand` to install `trap 'kill -HUP "$pid"; wait "$pid"' HUP` before its
   `wait`, so the child receives SIGHUP and the witness still records the child's own exit status.
   Assert that status in a unit case.
3. GREEN. Commit.

**Done when:**
- [test] With the real `buildDaemonExitWitnessCommand` wrapper on a `createPrivateTmux` server, `respawnPane` causes the child node process's SIGHUP handler to write its marker file within 5 s.
- [test] With the same wrapper, `killSession` (the call `daemon stop` and the restart fallback both use) causes the child's SIGHUP handler to write its marker file within 5 s.
- [test] If the wrapper was changed, a unit test asserts the wrapper string contains the HUP-forwarding trap and that the witness still receives the child's own exit status.
- The test spawns tmux only through the fixture runner, and the default-tier tmux-access audit passes for the new file.

**Files likely touched:**
- `src/conductor/test/engine/daemon-sighup-delivery.test.ts` — new integration check
- `src/conductor/src/engine/daemon-tmux.ts` — wrapper HUP forwarding, only if the probe is RED

**Dependencies:** none

### Task 3: Linux procfs process-table reader
**Story:** Story 5 happy path 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/execution/process-table.test.ts` against
   `createProcfsProcessTable({ root })`, using a fixture directory tree that mimics `/proc`:
   - (a) pid, ppid, sid, starttime and uid parse correctly, including a `comm` of `(a ) b)`, and
     `command` comes from the NUL-separated `cmdline` and `startedAt` from `btime` plus starttime
     divided by the injected tick rate;
   - (b) `cwd` resolves from a symlink;
   - (c) the marker is read from a NUL-separated `environ`;
   - (d) an unreadable `environ` yields `marker: undefined`, and a missing variable yields `null`;
   - (e) a pid directory that vanishes mid-read is omitted;
   - (f) an unreadable root yields `null`;
   - (g) `startTimeOf(pid)` returns the starttime field for an existing pid and `null` for a missing
     one;
   - (h) constructed with `selfUid`, the reader never opens `environ` or `cwd` for an entry whose
     `status` uid differs. A spy on the injected file reader records no such path, and the entry
     carries `marker: undefined` and `cwd: null`.
2. RED, implement `process-table.ts` (interface plus the procfs reader), GREEN, commit.

**Done when:**
- [test] `createProcfsProcessTable` returns entries whose pid, ppid, sid, startTime, uid, cwd and marker match the fixture, including a `comm` containing spaces and a closing parenthesis, and whose `command` equals the fixture `cmdline` and `startedAt` equals `btime` plus starttime divided by the injected tick rate, in epoch milliseconds.
- [test] An unreadable `environ` yields `marker: undefined`, an absent variable yields `marker: null`, and a vanished pid directory is omitted rather than throwing.
- [test] An unreadable table root makes `snapshot()` resolve `null`, and `startTimeOf(pid)` returns the fixture starttime for a present pid and `null` for an absent one.
- [test] For an entry whose uid differs from `selfUid`, a spy on the file reader records no read of its `environ` or `cwd`, and the entry carries `marker: undefined` and `cwd: null`.

**Files likely touched:**
- `src/conductor/src/execution/process-table.ts` — new interface and procfs reader
- `src/conductor/test/execution/process-table.test.ts` — new tests

**Dependencies:** none

### Task 4: POSIX ps process-table reader and platform default
**Story:** Story 5 happy path 2, negative path 2
**Type:** infrastructure

**Steps:**
1. Write failing tests against `createPsProcessTable({ run })` with an injected runner returning
   recorded `ps`/`lsof` fixture output:
   - (a) entries carry the same fields as procfs;
   - (b) a non-zero exit or unparseable line set yields `null`.
2. Write a failing test that `defaultProcessTable('linux')` is procfs; `defaultProcessTable` for
   `darwin`, `freebsd`, `openbsd`, `sunos` and `aix` is ps; and `defaultProcessTable('win32')` is
   `null`. The environment and cwd queries (`ps eww`, `lsof`) are restricted to `selfUid` (`-U
   «uid»`).
3. RED, implement, GREEN, commit.

**Done when:**
- [test] `createPsProcessTable` parses the recorded `ps -axo pid=,ppid=,sess=,uid=,lstart=,command=`, `ps eww` and `lsof -a -d cwd -Fn` fixtures into entries with pid, ppid, sid, startTime, uid, cwd and marker, plus `command` from `command=` and `startedAt` as the `lstart` wall-clock time in epoch milliseconds.
- [test] A non-zero runner exit or unparseable output makes `snapshot()` resolve `null`.
- [test] `defaultProcessTable` returns the procfs reader on `linux`, the ps reader on every non-Linux POSIX platform (`darwin`, `freebsd`, `openbsd`, `sunos`, `aix`), and `null` on `win32`.
- [test] The runner receives `ps eww` and `lsof` invocations restricted to `selfUid`, so no environment or cwd of another uid is read.

**Files likely touched:**
- `src/conductor/src/execution/process-table.ts` — ps reader and platform default
- `src/conductor/test/execution/process-table.test.ts` — ps and platform tests

**Dependencies:** Task 3

### Task 5: Dispatch membership from descent and marker
**Story:** Story 1 negative path 4; Story 2 happy path 1, negative paths 1–3; Story 3 negative path 4; Story 4 all paths
**Type:** happy-path

**Steps:**
1. Write failing table-driven tests in `src/conductor/test/execution/process-tree-teardown.test.ts`
   for `computeMembers(entries, registration, selfUid)`. Each case seeds entries and asserts
   members, and skipped session-host entries where relevant:
   - (a) transitive descendants of the root, matched on pid and start time, sitting in a different
     process group;
   - (b) a ppid-1 entry carrying this registration's marker;
   - (c) a ppid-1 entry carrying another registration's marker, or another daemon's;
   - (d) a different-uid descendant or marker carrier;
   - (e) a marker-only session host (a tmux server whose pane shell is a session leader) plus that
     pane shell and the pane shell's non-leader child, all three skipped;
   - (e1) a marker-less (`null`) and an environment-unreadable (`undefined`) process below that host,
     both skipped and counted;
   - (e2) a marker-only session leader with no session-leader child (a `setsid` tool shell) plus its
     vitest child, both members;
   - (f) a descendant with `pid === sid`, which is a member;
   - (g) an entry with `marker: undefined` that is a descendant, and one that is not.
2. RED, implement `computeMembers`, GREEN, commit.

**Done when:**
- [test] `computeMembers` returns every same-uid transitive descendant of the root (pid and start time match) plus every same-uid entry whose marker equals the registration's processTreeId, including ppid-1 entries, except a marker-only session host and the entries below it.
- [test] Entries carrying a different processTreeId and entries owned by another uid are never members.
- [test] A marker-only session host (pid equal to sid with a session-leader child) and every entry below it, whatever its marker state, are returned in `skippedDetached` and not in members, while a marker-only session leader with no session-leader child, its children, and any session leader that is a live descendant of the root are members.
- [test] An entry whose marker is `undefined` (environment unreadable) is a member only when it is a live descendant of the root.

**Files likely touched:**
- `src/conductor/src/execution/process-tree-teardown.ts` — new `computeMembers`
- `src/conductor/test/execution/process-tree-teardown.test.ts` — new tests

**Dependencies:** Task 3

### Task 6: Identity-checked TERM, grace, KILL escalation with fail-closed outcomes
**Story:** Story 1 happy paths 1 and 3, negative paths 2, 3 and 5; Story 4 happy path 1; Story 5 negative paths 1–3
**Type:** negative-path

**Steps:**
1. Write failing tests for `teardownProcessTree(registration, trigger, deps)` with injected
   `table`, `kill`, `sleep`, `graceMs` and `platform`.
   - First, a spy proves the production code path calls the injected `kill`. A `vi.spyOn(process,
     'kill')` records zero calls throughout.
   - (a) members receive SIGTERM, then after `sleep(graceMs)` the re-read survivors with a matching
     start time receive SIGKILL;
   - (b) a survivor whose start time changed is not killed;
   - (c) ESRCH on SIGTERM counts as gone and teardown continues;
   - (d) no members produces no signal and outcome `clean` with zero counts;
   - (e) members still alive after KILL produce outcome `survivors`;
   - (f) when `snapshot()` resolves `null` and `startTimeOf(rootPid)` returns the start time
     recorded at registration, only the root receives SIGTERM (then SIGKILL after grace if
     `startTimeOf` still matches), and the outcome is `indeterminate`;
   - (g) when `snapshot()` resolves `null` and `startTimeOf(rootPid)` returns `null` or a different
     start time, nothing is signalled and the outcome is `indeterminate`; when the first snapshot
     succeeds but the re-snapshot resolves `null`, only the root (under the same `startTimeOf` rule)
     receives SIGKILL and the outcome is `indeterminate`;
   - (h) `platform: 'win32'` signals nothing and returns outcome `unsupported`.
2. RED, implement, GREEN, commit.

**Done when:**
- [test] `teardownProcessTree` sends SIGTERM to every member, waits `graceMs` through the injected sleep, re-reads the table, and sends SIGKILL only to members whose pid and start time still match, so none is left running; ESRCH from the kill adapter counts the member as terminated and teardown continues; a member whose start time changed between snapshots receives no signal.
- [test] With no members it sends no signal and returns outcome `clean` with every count zero; with live members after SIGKILL it returns `survivors` with the survivor count.
- [test] When `snapshot()` resolves `null` it signals only the recorded root and only while `startTimeOf(rootPid)` equals the registered start time, sends nothing when that start time is absent or different, and returns `indeterminate` either way; when only the post-grace re-snapshot resolves `null`, SIGKILL goes at most to the root under the same rule and the outcome is `indeterminate`.
- [test] On `win32` it sends no signal and returns `unsupported`, and a `process.kill` spy records zero calls across the whole test file.
- [test] With a seeded table, teardown sends no signal to an other-uid process, a process carrying another processTreeId, a ppid-1 entry with no marker that is not a descendant, or a marker-only session host with its pane shell and pane child (returning `skippedDetached` 3), while a session leader that descends from the root and a marker-only leader hosting no session each receive SIGTERM like any other member.

**Files likely touched:**
- `src/conductor/src/execution/process-tree-teardown.ts` — `teardownProcessTree`
- `src/conductor/test/execution/process-tree-teardown.test.ts` — escalation tests

**Dependencies:** Task 5

### Task 7: `dispatch_tree_reaped` event variant and routing
**Story:** Story 6 happy path 1
**Type:** infrastructure

**Steps:**
1. Write a failing test in `src/conductor/test/engine/event-sinks.test.ts` (or its existing
   routing-table test) asserting `dispatch_tree_reaped` routes `persist: true, render: false, audit:
   false, otel: false`.
2. Add a type-level test that the variant requires `processTreeId`, `provider`, `trigger`,
   `terminated`, `killed`, `survivors`, `skippedDetached`, `outcome` and `ts`, with `dispatchId`
   optional. `trigger` is the closed set `settle`, `sighup`, `sigterm`, `completion`; `outcome` is
   the closed set `clean`, `survivors`, `indeterminate`, `unsupported`.
3. RED, add the variant to `src/conductor/src/types/events.ts` beside `daemon_exited` and the
   routing row to `event-sinks.ts`, GREEN, commit.

**Done when:**
- [test] The `ConductorEvent` union accepts a `dispatch_tree_reaped` event carrying processTreeId, optional dispatchId, provider, trigger, terminated, killed, survivors, skippedDetached, outcome and ts, and rejects an unknown trigger or outcome at type level.
- [test] The `event-sinks.ts` routing entry for `dispatch_tree_reaped` is persist true, render false, audit false, otel false.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — new variant
- `src/conductor/src/engine/event-sinks.ts` — routing row
- `src/conductor/test/engine/event-sinks.test.ts` — routing test

**Dependencies:** none

### Task 8: Daemon-scoped registry, marker stamping and settle teardown
**Story:** Story 1 happy path 2, negative path 1; Story 2 happy path 1; Story 3 negative path 2; Story 6 all paths
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/dispatch-process-registry.test.ts` with
   injected `table`, `kill`, `sleep`, `emit` and `log`:
   - (a) while not installed, `reserve` returns an inert reservation whose settle signals nothing and
     emits nothing;
   - (a2) after installation, the `processTreeId` returned by `reserve` before spawn is the id
     `bind(pid)` registers, and a seeded ppid-1 entry carrying that id is torn down on settle;
   - (b) after installation, two `reserve` calls under one `dispatchId` receive distinct
     `processTreeId`s, and settling one tears down only its own members while the sibling's members
     receive no signal;
   - (c) settle after a subprocess rejection, such as an abort, tears down like settle after
     fulfilment;
   - (d) an open registration receives no signal from the passage of time alone: no timer or
     heartbeat path exists, and only settle or `teardownAll` signal;
   - (e) `teardownAll('sighup', { graceMs })` tears down every open registration, awaits in-flight
     settle teardowns, and a later settle of a claimed registration emits nothing. With a settle
     already mid-grace at 5000 ms, `teardownAll` with `graceMs: 2000` makes that in-flight teardown
     send its SIGKILL within 2000 ms of `teardownAll` starting, as shown with a fake clock;
   - (f) every teardown emits exactly one `dispatch_tree_reaped` with all fields, including outcome
     `clean` and zero counts when there are no members;
   - (g) an `emit` that rejects is logged through `log`, signals already sent stand, and settle
     resolves normally.
2. Write failing tests in `src/conductor/test/execution/child-environment.test.ts`:
   - `withProcessTreeMarker(env, reservation)` sets `AI_CONDUCTOR_PROCESS_TREE_ID` to the
     reservation's id and leaves the other keys unchanged, and returns `env` unchanged for an inert
     (`null`) reservation;
   - `trackProviderProcess(subprocess, reservation)` binds `subprocess.pid` and settles on both fulfilment
     and rejection, returning the subprocess's own result or rethrowing its own error unchanged.
3. RED, implement `dispatch-process-registry.ts` and the two helpers, GREEN, commit.

**Done when:**
- [test] Before `installDispatchProcessRegistry` is called, `reserve` yields a `null` processTreeId so `withProcessTreeMarker` leaves the env unchanged, and settling sends no signal and emits no event; after installation the processTreeId `reserve` returns before spawn is exactly the id `bind(pid)` registers, so a ppid-1 entry carrying it is torn down on settle.
- [test] After installation, registrations under one managed dispatchId receive distinct processTreeIds, and settling one sends signals only to its own members while the sibling's members receive none; `teardownAll` on one registry sends no signal to seeded entries carrying another registry's processTreeIds or descending from its roots.
- [test] Settle after subprocess fulfilment or rejection (including abort) runs teardown once; an open registration with no settle and no `teardownAll` receives no signal however much time passes.
- [test] `teardownAll` tears down every open registration with the same membership rules (a seeded session host and its subtree receive no signal) and awaits in-flight settle teardowns after cutting their remaining grace to its own `graceMs` (fake clock: an in-flight 5000 ms settle sends SIGKILL within 2000 ms of `teardownAll('sighup', { graceMs: 2000 })`), every teardown emits exactly one `dispatch_tree_reaped` with all fields (zero counts and outcome `clean` when memberless), and a settle after the claim emits nothing.
- [test] When `emit` rejects, the failure is passed to `log`, the signals already sent are not undone, and `trackProviderProcess` returns the subprocess's own result unchanged.

**Files likely touched:**
- `src/conductor/src/execution/dispatch-process-registry.ts` — new registry
- `src/conductor/src/execution/child-environment.ts` — `withProcessTreeMarker`, `trackProviderProcess`
- `src/conductor/test/execution/dispatch-process-registry.test.ts` — new tests
- `src/conductor/test/execution/child-environment.test.ts` — helper tests

**Dependencies:** Tasks 6, 7

### Task 9: Claude adapter registers and tears down every spawn
**Story:** Story 1 happy paths 1, 2 and 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/claude-provider-process-tree.test.ts`. Use an
   injected `subprocessFactory` that records its env and returns a controllable subprocess, and an
   installed registry with injected `table`, `kill` and `emit`.
   - (a) `invoke` passes an env containing `AI_CONDUCTOR_PROCESS_TREE_ID` equal to the
     registration's processTreeId;
   - (b) when the fake subprocess resolves, a seeded descendant in its own process group receives
     SIGTERM;
   - (c) when the invocation's `abortSignal` aborts, the same teardown runs;
   - (d) an invocation with no `spawnPermit` and no lifecycle supervisor, the shape the project
     prelude and model-availability probe use, registers and tears down identically;
   - (e) the emitted event carries the managed `dispatchId` when `managedSessionContext` is set.
2. RED. In `runClaude` and the claude environment builder, stamp the marker before spawn and call
   `reserve` before spawn, stamp `withProcessTreeMarker`, and call `trackProviderProcess` right after
   `subprocessFactory`. Leave `onSpawn` unchanged. GREEN, commit.

**Done when:**
- [test] A claude `invoke` spawns with `AI_CONDUCTOR_PROCESS_TREE_ID` in the subprocess env equal to the registered processTreeId, and settling the subprocess sends SIGTERM to a seeded descendant in its own process group.
- [test] An aborted claude invocation runs the same teardown as a normal exit.
- [test] A claude invocation with no spawnPermit and no lifecycle supervisor registers and tears down exactly as a supervised one does.
- [test] The resulting `dispatch_tree_reaped` carries provider `claude` and the managedSessionContext dispatchId when one is set.

**Files likely touched:**
- `src/conductor/src/execution/claude-provider.ts` — marker and tracking at spawn
- `src/conductor/test/execution/claude-provider-process-tree.test.ts` — new tests

**Dependencies:** Task 8

### Task 10: Codex adapter registers and tears down every spawn
**Story:** Story 1 happy paths 1 and 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/codex-provider-process-tree.test.ts`,
   mirroring Task 9's cases (a) to (e) against `spawnCodex` and the codex environment builder, using
   an injected `subprocessFactory` and an installed registry with injected adapters.
2. RED, implement the same two edits in `codex-provider.ts`, GREEN, commit.

**Done when:**
- [test] A codex `invoke` spawns with `AI_CONDUCTOR_PROCESS_TREE_ID` in the subprocess env equal to the registered processTreeId, and settling the subprocess sends SIGTERM to a seeded descendant in its own process group.
- [test] An aborted codex invocation (cancelSignal) runs the same teardown as a normal exit.
- [test] The resulting `dispatch_tree_reaped` carries provider `codex` and the managedSessionContext dispatchId when one is set.

**Files likely touched:**
- `src/conductor/src/execution/codex-provider.ts` — marker and tracking at spawn
- `src/conductor/test/execution/codex-provider-process-tree.test.ts` — new tests

**Dependencies:** Task 8

### Task 11: Pi adapter registers and tears down every spawn
**Story:** Story 1 happy paths 1 and 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-provider-process-tree.test.ts`, mirroring
   Task 9's cases (a) to (e) against pi's subprocess factory call. The marker is applied to
   `childEnvironment` after `scrubTmuxEnvironment` and the git guard.
2. RED, implement in `pi-provider.ts`, GREEN, commit.

**Done when:**
- [test] A pi `invoke` spawns with `AI_CONDUCTOR_PROCESS_TREE_ID` in `childEnvironment` equal to the registered processTreeId, and settling the subprocess sends SIGTERM to a seeded descendant in its own process group.
- [test] An aborted pi invocation runs the same teardown as a normal exit.
- [test] The resulting `dispatch_tree_reaped` carries provider `pi` and the managedSessionContext dispatchId when one is set.

**Files likely touched:**
- `src/conductor/src/execution/pi-provider.ts` — marker and tracking at spawn
- `src/conductor/test/execution/pi-provider-process-tree.test.ts` — new tests

**Dependencies:** Task 8

### Task 12: Daemon boot installs the registry on the daemon event spine
**Story:** Story 6 happy path 2; Story 3 happy path 4
**Type:** happy-path

**Steps:**
1. Write a failing wiring test in `src/conductor/test/engine/daemon-cli-process-tree-wiring.test.ts`,
   following the existing `daemon-cli-*-wiring.test.ts` pattern (search hint: files named
   `daemon-cli-*-wiring.test.ts`).
   - Boot `runDaemonCli` with injected registry deps.
   - Assert the registry is installed only after the lock is acquired and event persistence has
     started.
   - Assert a settle teardown driven through an installed registration appends one
     `dispatch_tree_reaped` line to `«projectRoot»/.daemon/events.jsonl`.
2. RED. Install in `daemon-cli.ts` immediately after `startDaemonEventPersistence`, using the daemon
   `events` emitter, `defaultProcessTable(process.platform)`, a `process.kill` adapter and
   `PROCESS_TREE_SETTLE_GRACE_MS`, and `process.platform`. Uninstall only after the completion
   teardown (Task 14) resolves. Each teardown awaits its `emit`, so the record is appended before any
   exit or re-raise. GREEN, commit.

**Done when:**
- [test] After daemon boot, a teardown triggered by settle, by the SIGHUP handler, by the SIGTERM path, or by completion (including the stale-engine restart exit) appends exactly one `dispatch_tree_reaped` record with that trigger to the daemon's `.daemon/events.jsonl` before the daemon exits or re-raises.
- [test] The registry is installed after lock acquisition and event-persistence start, so a lock-loser exit (`LOCK_HELD_EXIT_CODE`) happens with no registry installed.
- The production install passes `defaultProcessTable(process.platform)`, `process.platform` and a kill adapter that delegates to `process.kill`, tests replace all three, and the registry is uninstalled only after completion teardown resolves.

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — registry install and uninstall
- `src/conductor/test/engine/daemon-cli-process-tree-wiring.test.ts` — new wiring test

**Dependencies:** Tasks 8, 9, 10, 11

### Task 13: SIGHUP handler orders persistence, teardown, then OTel
**Story:** Story 3 happy path 1, negative paths 1 and 3
**Type:** happy-path

**Steps:**
1. Write failing tests against `installDaemonOtelSighupHandler` with the injected `processAdapter`,
   `awaitStop` and a new `teardownProcessTrees` option. Record call order through spies.
   - (a) on SIGHUP the order is `runSighupPersistence`, then `teardownProcessTrees('sighup', { graceMs:
     2000 })`, then visualizer stop, then `daemonOtel.stop`, then re-raise;
   - (b) a teardown reporting survivors still lets the OTel stop run and SIGHUP be re-raised inside
     `DAEMON_OTEL_SIGHUP_STOP_TIMEOUT_MS`;
   - (c) with no open registrations, teardown resolves without any sleep, so the measured handler
     duration with a fake clock equals the pre-change duration.
2. RED, implement, and wire `teardownProcessTrees` to the installed registry's `teardownAll` in
   `daemon-cli.ts`. GREEN, commit.

**Done when:**
- [test] On SIGHUP the handler calls `runSighupPersistence`, then `teardownProcessTrees('sighup', { graceMs: 2000 })`, then the visualizer and `daemonOtel.stop`, and then re-raises SIGHUP, in that order.
- [test] When teardown reports survivors after SIGKILL, the OTel stop still runs and SIGHUP is re-raised within `DAEMON_OTEL_SIGHUP_STOP_TIMEOUT_MS`.
- [test] With no open registrations the teardown call performs no sleep and sends no signal, and the handler's fake-clock duration is unchanged from the pre-change handler.
- [test] With the installed registry's `teardownAll` wired as `teardownProcessTrees` and seeded members in an injected table, teardown resolves before SIGHUP is re-raised and every seeded member has been signalled, leaving none alive in the table with ppid 1.

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — handler ordering and wiring
- `src/conductor/test/engine/daemon-sighup-handler.test.ts` — ordering tests (or the existing SIGHUP handler test file)

**Dependencies:** Task 12

### Task 14: SIGTERM drain end, force-release backstop and normal completion tear down before lock release
**Story:** Story 3 happy paths 2–4, negative path 3
**Type:** happy-path

**Steps:**
1. Write failing tests in the existing drain-teardown test area (search hint: tests referencing
   `createScaledDaemonTeardown` or `onForceRelease`). Record order through spies on `teardownAll`,
   `releaseBackstop`/`lock.releaseSync`, `lock.release` and `exitProcess`.
   - (a) after a SIGTERM-requested drain completes, `teardownAll('sigterm', …)` resolves before
     `lock.release()`;
   - (b) when `onForceRelease` fires, `teardownAll('sigterm', …)` resolves before `releaseBackstop`
     and `exitProcess(1)`;
   - (c) on non-signal normal completion, `teardownAll('completion', …)` resolves before
     `lock.release()`;
   - (d) with no open registrations, each path sends no signal.
2. RED. Make `onForceRelease` run `void (async () => { await teardownAll(…); releaseBackstop();
   exitProcess(1); })()`, and await `teardownAll` before `lock.release()` on completion. GREEN,
   commit.

**Done when:**
- [test] After a SIGTERM drain completes, `teardownAll('sigterm')` resolves before `lock.release()` is called.
- [test] When the force-release backstop fires, `teardownAll('sigterm')` resolves before `releaseBackstop` and `exitProcess(1)` are called.
- [test] On normal completion, `teardownAll('completion')` resolves before `lock.release()` is called.
- [test] With no open registrations, none of these paths sends a signal or performs a sleep, and each path's fake-clock duration is unchanged from the pre-change behaviour.

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — drain, backstop and completion ordering
- `src/conductor/test/engine/daemon-cli-process-tree-wiring.test.ts` — exit-path ordering tests

**Dependencies:** Task 12

### Task 15: Stale-engine restart exits tear down before releasing the lock
**Story:** Story 3 happy path 4
**Type:** happy-path

**Steps:**
1. Write failing tests for `createRestartRequester` with injected `deps.teardownAll`, `lock` and
   `process` spies. On each of the four `lock.releaseSync()` exits (relink failure headless, marker
   failure headless, session-hosted success, headless success), `teardownAll('completion', …)`
   resolves before `lock.releaseSync()`. The stay-alive branches call neither.
2. RED, implement, and pass the registry's `teardownAll` where `daemon-cli.ts` constructs the
   requester. GREEN, commit.

**Done when:**
- [test] On every stale-engine restart exit (each `createRestartRequester` branch that calls `lock.releaseSync()`), the injected `teardownAll` resolves first.
- [test] The stay-alive branches (session-hosted relink failure, trigger failure) call neither `teardownAll` nor `lock.releaseSync()`.
- `daemon-cli.ts` constructs the requester with the installed registry's `teardownAll`.

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — requester teardown ordering and wiring
- `src/conductor/test/engine/daemon-restart-requester.test.ts` — ordering tests (or the existing requester test file)

**Dependencies:** Task 12

### Task 16: `listSessions` on the injectable tmux runner
**Story:** Story 7 happy path 1, negative path 3
**Type:** infrastructure

**Steps:**
1. Write failing tests in the existing `daemon-tmux` unit test file with an injected `TmuxRunner`:
   - (a) parses `list-sessions -F '#{session_name} #{session_created}'` output into `{ name, createdAt
     }`;
   - (b) a non-zero exit ("no server running") returns `null`;
   - (c) a `TmuxNotInstalledError` from the runner returns `null`.
2. RED, implement `listSessions(run = defaultTmuxRunner)` in `daemon-tmux.ts`, GREEN, commit.

**Done when:**
- [test] `listSessions` returns every session's name and creation time parsed from the runner's `list-sessions` output.
- [test] `listSessions` returns `null` when the runner exits non-zero or throws `TmuxNotInstalledError`.

**Files likely touched:**
- `src/conductor/src/engine/daemon-tmux.ts` — `listSessions`
- `src/conductor/test/engine/daemon-tmux.test.ts` — tests

**Dependencies:** none

### Task 17: Leak attribution for stray sessions and orphaned processes
**Story:** Story 7 happy paths 1–3, negative paths 1 and 5; Story 2 negative path 1; Story 4 negative path 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/leak-attribution.test.ts` for
   `computeLeakReport({ records, sessions, entries, selfUid, now })`:
   - (a) a `cc-daemon-*` session matching no record's `sessionNameForRepo` is unattributable, with
     its age;
   - (b) a session equal to a record's `sessionNameForRepo` is never unattributable, even when it is
     the oldest or its pane is dead;
   - (c) a same-uid ppid-1 entry whose cwd is under `«record.path»/.worktrees/` is an orphan;
   - (d) a same-uid ppid-1 entry carrying any process-tree marker is an orphan whatever its cwd,
     which covers a skipped session host whose parent is init;
   - (e) a ppid-1 entry outside every `.worktrees/` with no marker, or owned by another uid, is not
     reported;
   - (f) samples are bounded to 5 per category, each orphan sample carries the entry's `command`,
     and the oldest age is `now` minus the earliest `startedAt` (process) or `createdAt` (session);
   - (g) `sessions: null` and `entries: null` each yield an `unavailable` category result.
2. RED, implement `src/conductor/src/engine/leak-attribution.ts`, GREEN, commit.

**Done when:**
- [test] `computeLeakReport` reports each `cc-daemon-*` session whose name matches no registered project's `sessionNameForRepo` with count, oldest age and at most 5 sample names, and never reports a registered project's own session, whatever its age or pane state, because attribution is by name.
- [test] `computeLeakReport` reports same-uid ppid-1 entries whose cwd is under a registered project's `.worktrees/` or that carry a process-tree marker (including a marker-carrying session host), with count, oldest age and at most 5 sample pids and commands.
- [test] A ppid-1 entry outside every `.worktrees/` that carries no marker, or that is owned by another uid, is not reported.
- [test] A `null` session list or a `null` process table yields an `unavailable` result for that category only.

**Files likely touched:**
- `src/conductor/src/engine/leak-attribution.ts` — new pure report
- `src/conductor/test/engine/leak-attribution.test.ts` — new tests

**Dependencies:** Tasks 3, 16

### Task 18: `daemon status` renders the read-only leak section
**Story:** Story 7 all paths
**Type:** happy-path

**Steps:**
1. Write failing tests calling `runDaemonStatus` with injected `out`, `registryPath`, `tmuxRunner`
   (new `DaemonStatusDeps` field) and `processTable` (new field):
   - (a) one stray session and one worktree orphan render a leak section naming both counts, oldest
     ages and samples;
   - (b) none found renders `leaks: none found`;
   - (c) a missing tmux renders a session line stating session attribution is unavailable, and the
     per-project rows still render;
   - (d) a `null` table renders a process line stating orphan detection is unavailable, and the
     rows still render;
   - (e) a `process.kill` spy and the tmux runner spy record no kill call and no `kill-session`
     during status;
   - (f) a registered project's own session (dead pane, oldest), a marker-carrying ppid-1 entry
     outside `.worktrees/`, a marker-less ppid-1 entry outside `.worktrees/`, and a tmux runner
     whose `list-sessions` exits non-zero, each rendered through `runDaemonStatus`.
2. Add a structural test, `src/conductor/test/structural/leak-attribution-read-only.test.ts`. It
   resolves the static import graph of `leak-attribution.ts` and of the status leak renderer, and
   asserts neither reaches `process-tree-teardown.ts`, `dispatch-process-registry.ts` or a kill
   adapter.
3. RED, implement the renderer in `daemon-observe-cli.ts` after the per-project loop, GREEN, commit.

**Done when:**
- [test] `ai-conductor daemon status` (via `runDaemonStatus`) prints a leak section with the unattributable-session count, oldest age and sample names, and the orphaned-process count, oldest age and sample pids each printed with its command, from injected tmux and process-table data.
- [test] With nothing found the leak section prints `leaks: none found`; with tmux missing it prints that session attribution is unavailable, and with an unreadable table that orphan detection is unavailable, while every per-project row still renders.
- [test] During status, a `process.kill` spy records zero calls and the injected tmux runner receives no `kill-session`.
- [test] With injected data holding a registered project's own session (dead pane, oldest), a marker-carrying ppid-1 entry outside every `.worktrees/`, and a marker-less ppid-1 entry outside every `.worktrees/`, `runDaemonStatus` prints the marker-carrying pid with its command among the orphaned processes and neither prints nor counts the registered session or the marker-less pid; with a tmux runner whose `list-sessions` exits non-zero (no server), or that throws `TmuxNotInstalledError`, its output equals the tmux-available output for the same registry and process table except that the session line states session attribution is unavailable, so every per-project row and the orphaned-process line render unchanged.
- [test] The structural import-graph test proves `leak-attribution.ts` and the status leak renderer reach no import of `process-tree-teardown.ts`, `dispatch-process-registry.ts` or any kill adapter.

**Files likely touched:**
- `src/conductor/src/engine/daemon-observe-cli.ts` — leak section and new deps
- `src/conductor/test/engine/daemon-observe-cli-leaks.test.ts` — new status tests
- `src/conductor/test/structural/leak-attribution-read-only.test.ts` — new structural test

**Dependencies:** Task 17

## Task Dependency Graph

```
Task 1  (probe: marker inheritance)          — independent
Task 2  (probe: SIGHUP delivery; needs #2476) — independent
Task 3 ──► Task 4
Task 3 ──► Task 5 ──► Task 6 ──┐
Task 7 ────────────────────────┴─► Task 8 ──► Tasks 9, 10, 11 ──► Task 12 ──► Tasks 13, 14, 15
Task 16 ──┐
Task 3  ──┴─► Task 17 ──► Task 18
```

## Integration Points

- After Task 8: the registry tears down seeded trees end-to-end through injected adapters.
- After Task 12: a real daemon boot persists teardown events to `.daemon/events.jsonl`.
- After Tasks 13–15: every daemon exit path tears down before lock release.
- After Task 18: `ai-conductor daemon status` shows the leak section.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a claude, codex, or pi dispatch whose provider started a test command in its own process group, when the provider subprocess exits normally, then every remaining process in that dispatch's tree receives SIGTERM and none is left running once the grace period ends. | 6, 9, 10, 11 | "sends SIGKILL only to members whose pid and start time still match, so none is left running" | diff-local |
| Story 1 happy: Given a dispatch whose provider subprocess is cancelled by its existing abort signal (step deadline, build-attempt abort, or operator stop), when the subprocess settles, then the dispatch's remaining tool processes are torn down the same way as on a normal exit. | 8, 9, 10, 11 | "Settle after subprocess fulfilment or rejection (including abort) runs teardown once" | diff-local |
| Story 1 happy: Given a dispatch member that ignores SIGTERM, when the grace period elapses and the member still runs with the same pid and start time, then it receives SIGKILL and is gone. | 6 | "sends SIGKILL only to members whose pid and start time still match" | diff-local |
| Story 1 happy: Given a provider call made outside the lifecycle supervisor (for example the project prelude or a model availability probe), when that provider subprocess settles, then its leftover tool processes are torn down exactly as for a step dispatch. | 9 | "A claude invocation with no spawnPermit and no lifecycle supervisor registers and tears down exactly as a supervised one does" | diff-local |
| Story 1 negative: Given a running dispatch whose provider has been silent for longer than any heartbeat threshold, when no existing authority has ended it, then no process in its tree is signalled. | 8 | "an open registration with no settle and no `teardownAll` receives no signal however much time passes" | diff-local |
| Story 1 negative: Given a tool process whose pid exited and was reused by an unrelated same-uid process before teardown signals it, when teardown compares the snapshot start time with the current one, then the unrelated process is not signalled. | 6 | "a member whose start time changed between snapshots receives no signal" | diff-local |
| Story 1 negative: Given a dispatch member that exits between the snapshot and the signal, when teardown sends SIGTERM and receives ESRCH, then the member is counted as already gone and teardown continues with the remaining members. | 6 | "ESRCH from the kill adapter counts the member as terminated and teardown continues" | diff-local |
| Story 1 negative: Given a process owned by a different uid that descends from nothing the daemon spawned, when any teardown runs, then that process is never read for membership and never signalled. | 3, 4, 5, 6 | "Entries carrying a different processTreeId and entries owned by another uid are never members" | diff-local |
| Story 1 negative: Given a provider subprocess that settles with no surviving descendants, when teardown runs, then no signal is sent and the outcome is clean. | 6 | "With no members it sends no signal and returns outcome `clean` with every count zero" | diff-local |
| Story 2 happy: Given a dispatch whose provider subprocess has already exited and whose tool process has been reparented to init but still carries that dispatch's marker, when the dispatch settles, then that tool process is torn down. | 5, 8 | "plus every same-uid entry whose marker equals the registration's processTreeId, including ppid-1 entries" | diff-local |
| Story 2 happy: Given each supported provider (claude, codex, pi), when a probe dispatch runs a tool command that lists its own environment, then the result records whether that provider passes the dispatch marker to tool processes. | 1 | "The smoke file holds one case per provider (claude, codex, pi)" | diff-local |
| Story 2 negative: Given a provider whose tool sandbox strips the marker, when a reparented tool process from that provider survives teardown, then it is not signalled and the next daemon status reports it as an orphaned worktree process. | 5, 6, 17, 18 | "reports same-uid ppid-1 entries whose cwd is under a registered project's `.worktrees/`" | diff-local |
| Story 2 negative: Given a reparented process carrying a different dispatch's marker, when this dispatch settles, then that process is not signalled. | 5, 6 | "Entries carrying a different processTreeId and entries owned by another uid are never members" | diff-local |
| Story 2 negative: Given a process whose environment cannot be read, when teardown evaluates membership, then it is treated as a member only if it is a live descendant of the recorded root. | 5 | "An entry whose marker is `undefined` (environment unreadable) is a member only when it is a live descendant of the root" | diff-local |
| Story 3 happy: Given a daemon with an open registration whose provider has started test workers, when the daemon receives SIGHUP (from `ai-conductor daemon stop`, from `ai-conductor daemon restart` respawning the pane, or from the restart fallback), then conductor state is persisted first, every member of that registration is then torn down, and no member is left with parent pid 1 before the old daemon exits. | 2, 13 | "On SIGHUP the handler calls `runSighupPersistence`, then `teardownProcessTrees('sighup', { graceMs: 2000 })`" | diff-local |
| Story 3 happy: Given a daemon with open registrations, when it receives SIGTERM and the drain completes, then every open registration is torn down before the lock is released and the process exits. | 14 | "After a SIGTERM drain completes, `teardownAll('sigterm')` resolves before `lock.release()` is called" | diff-local |
| Story 3 happy: Given a daemon whose SIGTERM drain hits the force-release backstop, when the backstop fires, then every open registration is torn down before the lock is force-released and the process exits with code 1. | 14 | "When the force-release backstop fires, `teardownAll('sigterm')` resolves before `releaseBackstop` and `exitProcess(1)` are called" | diff-local |
| Story 3 happy: Given a daemon that finishes its loop normally, or exits through the stale-engine or lock-loser path, with open registrations, when it reaches that exit, then every remaining registration is torn down before the lock is released. | 12, 14, 15 | "On every stale-engine restart exit (each `createRestartRequester` branch that calls `lock.releaseSync()`), the injected `teardownAll` resolves first" | diff-local |
| Story 3 negative: Given exit-path teardown on the SIGHUP path whose members are still alive after a grace of at most 2 seconds, when the grace expires, then the survivors are sent SIGKILL, the outcome records them, and the OTel stop still runs and SIGHUP is re-raised within the existing handler budget. | 6, 13 | "When teardown reports survivors after SIGKILL, the OTel stop still runs and SIGHUP is re-raised within `DAEMON_OTEL_SIGHUP_STOP_TIMEOUT_MS`" | diff-local |
| Story 3 negative: Given two provider subprocesses running concurrently under one feature dispatch (for example parallel validation members), when one of them settles, then only that subprocess's own tree is torn down and its sibling keeps running. | 8 | "settling one sends signals only to its own members while the sibling's members receive none" | diff-local |
| Story 3 negative: Given a daemon with no open dispatches, when it receives SIGHUP or SIGTERM, then no process is signalled and the exit timing is unchanged. | 13, 14 | "With no open registrations the teardown call performs no sleep and sends no signal" | diff-local |
| Story 3 negative: Given two daemons for two different registered repos on one machine, when one daemon restarts, then no process belonging to the other daemon's dispatches is signalled. | 5, 8 | "Entries carrying a different processTreeId and entries owned by another uid are never members" | diff-local |
| Story 4 happy: Given a process that carries a dispatch's marker, is a session leader with at least one child that is itself a session leader, and is not a live descendant of that dispatch's root, when the dispatch is torn down, then neither it nor any process below it is signalled and the outcome counts each of them as skipped. | 5, 6, 8 | "A marker-only session host (pid equal to sid with a session-leader child) and every entry below it, whatever its marker state, are returned in `skippedDetached` and not in members" | diff-local |
| Story 4 happy: Given a marker-carrying session leader that has no session-leader child and is not a live descendant of the dispatch root, when the dispatch is torn down, then it and its children are torn down like any other member. | 5, 6 | "a marker-only session leader with no session-leader child, its children, and any session leader that is a live descendant of the root are members" | diff-local |
| Story 4 happy: Given a session-leader process that is a live descendant of the dispatch root, when the dispatch is torn down, then it is torn down like any other member. | 5, 6 | "any session leader that is a live descendant of the root are members" | diff-local |
| Story 4 negative: Given a tmux server started from a dispatch that now hosts an operator's session, when that dispatch settles or the daemon restarts, then the tmux server, its pane shells, and every process running in those panes are still running. | 5, 6, 8 | "a marker-only session host with its pane shell and pane child (returning `skippedDetached` 3)" | diff-local |
| Story 4 negative: Given a skipped session host whose parent is init, when the operator next runs daemon status, then that process is listed among the reported leftovers and not signalled. | 17, 18 | "(including a marker-carrying session host)" | diff-local |
| Story 5 happy: Given a Linux host, when teardown reads the process table, then membership uses parent pid, session id, start time, working directory, and environment from the kernel's process files. | 3, 4, 12 | "`createProcfsProcessTable` returns entries whose pid, ppid, sid, startTime, uid, cwd and marker match the fixture" | diff-local |
| Story 5 happy: Given a non-Linux POSIX host, when teardown reads the process table, then membership uses the system `ps` listing with the same fields. | 4 | "`createPsProcessTable` parses the recorded" | diff-local |
| Story 5 negative: Given a process-table read that fails or returns unparseable output, when teardown runs, then only the recorded root (if still alive with its recorded start time) is signalled and the outcome is indeterminate. | 4, 6 | "When `snapshot()` resolves `null` it signals only the recorded root and only while `startTimeOf(rootPid)` equals the registered start time" | diff-local |
| Story 5 negative: Given a Windows host, when a dispatch settles or the daemon exits, then no process is signalled by teardown and the outcome is unsupported. | 4, 6 | "On `win32` it sends no signal and returns `unsupported`" | diff-local |
| Story 5 negative: Given a recorded root whose start time no longer matches its pid, when the table read failed, then nothing at all is signalled. | 6 | "sends nothing when that start time is absent or different" | diff-local |
| Story 6 happy: Given any teardown, when it completes, then exactly one `dispatch_tree_reaped` event is emitted carrying the process-tree id, the managed dispatch id when present, the provider, the trigger (settle, sighup, sigterm, or completion), counts of terminated, killed, surviving, and skipped detached members, and the outcome (clean, survivors, indeterminate, or unsupported). | 7, 8 | "every teardown emits exactly one `dispatch_tree_reaped` with all fields" | diff-local |
| Story 6 happy: Given any teardown performed by a running daemon, whether triggered by a dispatch settling or by a daemon exit path, when the event is emitted, then it is persisted to the daemon's `.daemon/events.jsonl`. | 12 | "appends exactly one `dispatch_tree_reaped` record with that trigger to the daemon's `.daemon/events.jsonl` before the daemon exits or re-raises" | diff-local |
| Story 6 negative: Given event persistence that throws while recording a teardown, when the teardown has already signalled its members, then the signals stand, the failure is logged, and the dispatch result is unchanged. | 8 | "When `emit` rejects, the failure is passed to `log`, the signals already sent are not undone" | diff-local |
| Story 6 negative: Given a teardown with no members, when it completes, then its event still records the outcome clean with all counts zero. | 8 | "(zero counts and outcome `clean` when memberless)" | diff-local |
| Story 7 happy: Given a `cc-daemon-*` tmux session whose name matches no registered project's session name, when the operator runs `ai-conductor daemon status`, then the output reports the count of unattributable sessions, the oldest one's age, and up to a bounded sample of names. | 16, 17, 18 | "reports each `cc-daemon-*` session whose name matches no registered project's `sessionNameForRepo` with count, oldest age and at most 5 sample names" | diff-local |
| Story 7 happy: Given a same-uid process whose parent pid is 1 and whose working directory is under a registered project's `.worktrees/`, when the operator runs daemon status, then the output reports the count of orphaned worktree processes, the oldest one's age, and a bounded sample of pids with their commands. | 17, 18 | "reports same-uid ppid-1 entries whose cwd is under a registered project's `.worktrees/`" | diff-local |
| Story 7 happy: Given a same-uid process whose parent pid is 1 and that carries a process-tree marker, when the operator runs daemon status, then it is reported among the orphaned processes whatever its working directory. | 17, 18 | "or that carry a process-tree marker" | diff-local |
| Story 7 happy: Given no stray sessions and no orphaned worktree processes, when the operator runs daemon status, then the leak section states that none were found. | 18 | "With nothing found the leak section prints `leaks: none found`" | diff-local |
| Story 7 negative: Given the production daemon session for a registered project, when daemon status runs, then that session is never reported as unattributable, even if its pane is dead or it is older than every other session. | 17, 18 | "never reports a registered project's own session, whatever its age or pane state, because attribution is by name" | diff-local |
| Story 7 negative: Given a stray session or orphaned process listed in the report, when daemon status completes, then no session was killed and no process was signalled. | 18 | "During status, a `process.kill` spy records zero calls and the injected tmux runner receives no `kill-session`" | diff-local |
| Story 7 negative: Given tmux is not installed or its server is not running, when daemon status runs, then the session line reports that session attribution is unavailable and the rest of status renders normally. | 16, 18 | "its output equals the tmux-available output for the same registry and process table except that the session line states session attribution is unavailable" | diff-local |
| Story 7 negative: Given the process table cannot be read, when daemon status runs, then the process line reports that orphan detection is unavailable and the rest of status renders normally. | 18 | "with an unreadable table that orphan detection is unavailable" | diff-local |
| Story 7 negative: Given a process with parent pid 1 whose working directory is outside every registered project's `.worktrees/` and that carries no process-tree marker, when daemon status runs, then it is not reported. | 17, 18 | "A ppid-1 entry outside every `.worktrees/` that carries no marker, or that is owned by another uid, is not reported" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-12-daemon-owns-provider-dispatch-process-trees#D1 | task | task-8, task-9, task-10, task-11 | registrations under one managed dispatchId receive distinct processTreeIds |
| adr-2026-10-12-daemon-owns-provider-dispatch-process-trees#D2 | task | task-5 | plus every same-uid entry whose marker equals the registration's processTreeId, including ppid-1 entries |
| adr-2026-10-12-daemon-owns-provider-dispatch-process-trees#D3 | task | task-5 | and every entry below it, whatever its marker state, are returned in `skippedDetached` and not in members |
| adr-2026-10-12-daemon-owns-provider-dispatch-process-trees#D4 | task | task-8 | an open registration with no settle and no `teardownAll` receives no signal however much time passes |
| adr-2026-10-12-daemon-owns-provider-dispatch-process-trees#D5 | task | task-12, task-13, task-14, task-15 | After a SIGTERM drain completes, `teardownAll('sigterm')` resolves before `lock.release()` is called |
| adr-2026-10-12-daemon-owns-provider-dispatch-process-trees#D6 | task | task-6 | sends SIGKILL only to members whose pid and start time still match |
| adr-2026-10-12-daemon-owns-provider-dispatch-process-trees#D7 | task | task-3, task-4, task-6 | `defaultProcessTable` returns the procfs reader on `linux`, the ps reader on every non-Linux POSIX platform |
| adr-2026-10-12-daemon-owns-provider-dispatch-process-trees#D8 | task | task-7, task-12 | The `event-sinks.ts` routing entry for `dispatch_tree_reaped` is persist true, render false, audit false, otel false |
| adr-2026-10-12-daemon-owns-provider-dispatch-process-trees#D9 | task | task-17, task-18 | The structural import-graph test proves `leak-attribution.ts` and the status leak renderer reach no import of `process-tree-teardown.ts`, `dispatch-process-registry.ts` or any kill adapter |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of 2–5 falsifiable checks naming its mechanism
- [x] Dependencies are explicit and acyclic
- [x] Tasks do not invalidate each other's fixtures or assertions (swept again by `/coherence-check`)
