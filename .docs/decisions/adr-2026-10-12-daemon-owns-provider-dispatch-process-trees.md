# ADR: The daemon owns and tears down provider dispatch process trees

**Date:** 2026-10-12
**Status:** APPROVED
**Deciders:** Operator (James Stoup), composer DECIDE for jstoup111/ai-conductor#544

## Context

Every provider dispatch (claude, codex, pi) is spawned by its adapter through `execa` in the
daemon's process group, with no `detached` flag and no process-tree cleanup. When a dispatch ends
through cancellation, `execa` signals only the direct child. Commands the provider runs from its own
tool sandbox (for example `npx vitest run` from Claude Code's Bash tool) live in their own process
groups, so they survive. When the daemon itself exits, no exit path touches provider children at
all: the SIGHUP handler (`installDaemonOtelSighupHandler`, which `daemon restart`'s `respawn-pane -k`
reaches), the SIGTERM drain and its force-release backstop, and normal loop completion all flush
and exit without cleanup.

The observed result (issue #544, 2026-07-13): roughly ten `daemon restart`s stranded vitest workers
reparented to init with a working directory under `.worktrees/*`, one at 47% CPU, driving load
average to 51 and contributing to suite flakiness (#573). The only process-tree kill in the engine
today is `full-suite-executor.ts`'s `detached` spawn plus `process.kill(-pid)`, and it covers only
the engine-owned full suite.

Forces and constraints:

- `adr-2026-07-30-provider-preparation-lifecycle-supervision` decisions 4 and 5 deny output silence
  any termination authority and forbid recovery from consulting `ps`, process names, or other
  external discovery. This decision must add no authority to end a running provider and must not
  feed recovery.
- `InvokeOptions.onSpawn` is documented as observation only, granting no kill authority.
- Provider calls are not funnelled through one call site: `provider.invoke` is called from
  step-runners (several sites), `project-prelude.ts`, `model-availability.ts`, and through
  `executeProviderCandidates`, and only some go through the lifecycle supervisor. The three adapters
  are the only point every spawn passes through, and all three already import
  `src/execution/child-environment.ts`.
- The repository rule on Test Process Isolation requires the process boundary to be injectable so
  a test never signals a real pid.
- Telemetry rides the one `ConductorEvent` spine (event-spine skill).
- Operator scope (Balanced): prevent strands at the source and report leftovers read-only. The
  daemon never autonomously reaps processes or tmux sessions it did not spawn.

## Options Considered

### Option A: Kill the pane's tree from the supervisor command before respawn
- **Pros:** Small; lives in `daemon-tmux.ts` and the restart and stop verbs.
- **Cons:** Covers only CLI restart and stop. Dispatch timeouts and aborts, daemon self-exit and the
  respawn fallback all still strand processes. It must also reconstruct the tree from outside the
  daemon after the daemon has started dying.

### Option B: Daemon-owned dispatch membership with teardown at settle and at daemon exit (chosen)
- **Pros:** Covers every exit path the daemon controls, for every provider and every call site.
  Portable through an adapter. Testable behind an injected process boundary.
- **Cons:** A SIGKILL or OOM kill of the daemon runs no teardown, so the read-only status surface
  is the only signal for that residue. A descendant walk alone loses children that reparent before
  the walk runs, so membership needs a second signal.

### Option C: PID-namespace containment for every dispatch (bwrap `--unshare-pid`)
- **Pros:** Kernel-enforced; covers SIGKILL of the daemon.
- **Cons:** Linux and bwrap only, which adds a sandbox dependency to consumer repositories. Nested
  provider sandboxes are already known to fail on some hosts (`live-containment.ts` probes for
  this). Non-Linux hosts would still need Option B.

### Option D: Spawn each provider `detached` and kill its process group
- **Pros:** Mirrors the existing `full-suite-executor` precedent.
- **Cons:** Misses the actual leak: provider tool commands create their own process groups, so a
  group kill of the provider leaves them alive. It also removes providers from the pane's
  controlling terminal, so a tmux hangup would no longer reach them at all.

## Decision

Adopt Option B.

1. **The adapter spawn site is the ownership seam.** One shared helper in
   `src/execution/child-environment.ts` is called by the claude, codex, and pi adapters for every
   provider subprocess. Before spawn it reserves a per-spawn process-tree id, which the adapter
   stamps into the child environment. Right after spawn it binds that reservation to the root pid
   and its start time in a daemon-scoped in-memory `DispatchProcessRegistry`, so the stamped marker
   and the registered id are the same value by construction. On that subprocess's settlement
   (normal exit, error, or cancellation) runs teardown and releases the registration.
   `InvokeOptions.onSpawn` keeps its observation-only contract unchanged, and no `invoke` call site
   changes. The process-tree id is deliberately distinct from the managed-session `dispatchId`
   (`CONDUCT_MANAGED_DISPATCH`, adr-2026-10-01-daemon-session-command-contracts D3). That id is per
   feature dispatch and is shared by sibling provider subprocesses, such as parallel validation
   members, so using it for membership would let one sibling's settle tear down the others.
2. **Membership has two signals.** A process belongs to a dispatch when it is a live descendant of
   the recorded root, or when its environment carries the `AI_CONDUCTOR_PROCESS_TREE_ID=«processTreeId»`
   marker the helper stamps into the provider's child environment. Only processes owned by the
   daemon's own uid are considered. The marker exists because children reparent to init when the
   root dies, which loses them from a parent-pid walk.
3. **Session hosts and everything under them are never signalled on marker evidence alone.** A
   session host is a session leader (pid equals session id) with at least one child that is
   itself a session leader, for example a tmux server whose pane shells start their own sessions,
   or `screen` or `sshd`. A host matched only by the marker, together with every process in the
   snapshot below it, has deliberately become infrastructure that may host operator sessions.
   Teardown does not signal any of them and counts each one as skipped. The status surface reports
   a skipped host whose parent is init. A marker-only session leader that hosts no session, such as
   a tool shell that detached with `setsid` while running a test command, is an ordinary member,
   so detaching alone never shields a leaked test worker. Any session leader that is a live
   descendant of the root is a member.
4. **Teardown adds no termination authority over a running provider.** It runs only after an
   existing authority has already ended the dispatch (the subprocess settled), or when the daemon
   process itself is exiting. It is not recovery. It never decides liveness, replacement, or
   retry, and nothing it observes feeds the lifecycle supervisor, consistent with
   `adr-2026-07-30-provider-preparation-lifecycle-supervision` decisions 4 and 5.
5. **Every daemon exit path the daemon controls tears down all open registrations before it
   releases the lock.** The paths are:
   - the SIGHUP handler, reached by `daemon stop` (`kill-session`), `daemon restart`
     (`respawn-pane -k`), and the restart fallback;
   - the SIGTERM path, after the drain completes or at the force-release backstop;
   - normal loop completion;
   - the explicit stale-engine and lock-loser exits.

   Teardown is awaited before `releaseBackstop` or any `lock.release`/`releaseSync`, so a successor
   daemon never holds the lock while its predecessor is still signalling. Inside the SIGHUP handler
   the order is fixed: conductor state persistence first, so an interrupted step records the
   interruption and not a provider failure, then teardown with a grace of at most 2 s, then the
   visualizer and OTel stop with whatever remains of `DAEMON_OTEL_SIGHUP_STOP_TIMEOUT_MS`. Restart
   is gated to idle or paused daemons (adr-2026-07-04-respawn-in-place-restart D2), so a gated
   restart normally finds no open pool dispatch. This path is defense in depth for the busy check
   that is not yet wired (`isBusy` defaults to not-busy) and for provider calls outside the
   dispatch pool.
6. **Escalation is identity-checked and fail-closed.** Send SIGTERM, wait a bounded grace period,
   re-read the table, then SIGKILL survivors. A process is signalled only while its pid and start
   time still match the snapshot, which guards against pid reuse. ESRCH counts as already gone. If
   the process table cannot be read, teardown signals nothing beyond the recorded root and reports
   an indeterminate outcome.
7. **The process boundary is two injectable adapters.** A `ProcessTable` reader (Linux `/proc` for
   ppid, session id, start time, cwd and environ; `ps` on other POSIX hosts) and a `Kill` adapter.
   On Windows teardown is unsupported and records that outcome. Tests inject both, and none reaches
   a real `process.kill`.
8. **Outcomes ride the spine.** Each teardown emits one new persisted `ConductorEvent` variant,
   `dispatch_tree_reaped`. It carries the process-tree id, the managed-session `dispatchId` when
   present (for correlation), the provider, trigger (`settle`, `sighup`, `sigterm`,
   `completion`), counts terminated, killed and surviving, skipped session-host processes, and outcome
   (`clean`, `survivors`, `indeterminate`, `unsupported`). It is routed through `event-sinks.ts`.
   No sidecar or bespoke log is added.
9. **The leak report is read-only by construction.** `daemon status` gains a leak section from a
   `LeakAttribution` component. That component depends only on the project registry, a
   `listSessions` helper on the injectable `TmuxRunner`, and `ProcessTable`. It reports `cc-daemon-*`
   sessions whose name matches no registered repo's `sessionNameForRepo`, plus same-uid processes whose
   parent is init and that either have a cwd under a registered repo's `.worktrees/` or carry a
   process-tree marker, each with its count and oldest age. A marker-carrying process whose parent
   is init is by construction a dispatch leftover, which covers a session host skipped under
   decision 3 when its parent is init. It has no dependency on the `Kill` adapter.

### Assumptions

| Assumption | Confidence | Impact if wrong | Confirmation |
|---|---|---|---|
| Provider tool subprocesses (Claude Code Bash, Codex exec and sandbox, pi tools) inherit the provider's environment, so the marker reaches test workers | ~75% (inferred) | Marker misses scrubbed children, and orphans that reparented before teardown escape. The descendant walk still covers live trees, and status still reports leftovers. | First plan task: a probe that runs each provider with a marker and lists matching processes from a tool-run command. A provider that scrubs the marker is recorded as walk-only coverage, and the stories state that limit. |
| `respawn-pane -k` and `kill-session` deliver SIGHUP to the daemon node process under the exit-witness wrapper, so decision 5's SIGHUP hook runs on `daemon restart` and `daemon stop` | ~60% (inferred from the SIGHUP handler's design comment; adr-2026-07-07-single-generation-stale-respawn records that the daemon survived `respawn-pane -k` once, mechanism unverified, and the pane foreground is now the exit-witness wrapper with node as its child) | Restart and stop teardown would not fire, so those strands remain. Settle-time teardown is unaffected. | Plan task: an integration check on a private tmux server (`createPrivateTmux`) running the real exit-witness wrapper, asserting that the daemon's SIGHUP handler runs. If it does not, the plan adds the wrapper forwarding the hangup before teardown tasks rely on it. |

## Consequences

### Positive
- Restart, stop, timeout and abort no longer strand provider tool processes, for every provider and
  call site.
- Operators can see stray `cc-daemon-*` sessions and worktree orphans in `daemon status` without
  eyeballing `tmux ls` or `ps`.
- Every teardown is visible to every spine consumer.

### Negative
- A SIGKILL or OOM kill of the daemon still leaves residue. It is reported, but nothing reclaims it
  automatically.
- A process a dispatch intentionally started to outlive it is now ended at settle, unless it
  detached into its own session. A step that relied on that would break. No such reliance is known.
- Linux `/proc` reads add a small cost at each dispatch settle.

### Follow-up Actions
- [ ] Probe marker inheritance per provider before building teardown (assumption 1).
- [ ] Verify the SIGHUP path under `respawn-pane -k` on a private tmux server (assumption 2).
- [ ] An autonomous reaper for SIGKILL residue is out of scope (operator chose Balanced). It would
      need a separate decision.
