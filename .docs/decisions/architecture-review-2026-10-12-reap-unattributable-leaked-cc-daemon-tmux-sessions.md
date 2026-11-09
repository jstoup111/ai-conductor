# Architecture Review: Dispatch process-tree teardown and leak status surface

**Date:** 2026-10-12
**Stories reviewed:** none yet (pre-stories, technical track). Inputs were the track marker
`.docs/track/reap-unattributable-leaked-cc-daemon-tmux-sessions.md`, the approved diagram
`.docs/architecture/reap-unattributable-leaked-cc-daemon-tmux-sessions.md`, and issue #544.
**Mode:** Lightweight (Tier M), covering §2 Feasibility and §4 Alignment.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack compatibility.** No new packages. `execa` (already used) exposes `subprocess.pid` at each
  adapter spawn site: claude `runClaude`, codex `spawnCodex`, pi's subprocess factory (verified).
  Linux `/proc` and POSIX `ps` are OS facilities, not dependencies.
- **Prerequisites.** None external. Two assumptions are probed first (see ADR assumptions).
- **Integration surface.** Four areas: the provider adapters plus `child-environment.ts`
  (execution), daemon exit paths in `daemon-cli.ts`, `daemon status` in `daemon-observe-cli.ts`
  with `daemon-tmux.ts`, and the event union with its sinks. This is the boundary-attention band
  for Medium, not a split trigger. Each touch is additive.
- **Data implications.** No schema migration. One new persisted event variant is additive. The
  registry is in-memory and dies with the daemon by design; its durable record is the event.
- **Performance risk.** One process-table read per dispatch settle, plus one at exit, which is
  negligible against dispatch duration. The status scan reads the table once per invocation.
- **Worktree isolation.** No ports, databases or shared files. Teardown is scoped to the daemon's
  uid and its own registered dispatches, so two worktrees' daemons, which are keyed by repo,
  cannot tear down each other's dispatches because membership requires their own dispatch id or
  descent from their own root.

## Alignment

- **Existing ADR governance.** No APPROVED ADR governs ownership of provider-spawned processes, so
  this is an uncovered structural decision (cross-module ownership plus an integration seam). A new
  ADR is drafted: `adr-2026-10-12-daemon-owns-provider-dispatch-process-trees`.
- **`adr-2026-07-30-provider-preparation-lifecycle-supervision`.** That ADR's decisions 4 and 5
  deny output silence termination authority and forbid recovery from consulting `ps` or external
  discovery. Teardown runs only after a dispatch has already ended, or while the daemon exits. It
  makes no liveness, retry or replacement decision and feeds nothing to the supervisor. The new
  ADR's decision 4 records this boundary, so there is no conflict.
- **Seam correction found in review.** The diagram first placed membership on an `onSpawn(pid)`
  extension driven by step-runner dispatch scopes. That conflicts with `onSpawn`'s documented
  observation-only contract, and it misses provider calls that bypass the lifecycle supervisor:
  `project-prelude.ts`, `model-availability.ts`, and several direct `provider.invoke` sites in
  step-runners. The design now hooks the three adapters through one helper in
  `child-environment.ts`, which every adapter already imports. The diagram was revised in place to
  match.
- **Event spine.** `dispatch_tree_reaped` is a new `ConductorEvent` variant routed through
  `event-sinks.ts`. The status leak scan is a point-in-time query of current state that infers no
  occurrence, so it is not a watcher or poller under the event-spine skill. No sidecar is added.
- **Pattern precedent.** The local precedent for process-tree signalling is
  `full-suite-executor.ts`, with its `terminateProcessTree` / `signalPosixProcessTree` helpers,
  injectable cleanup dependencies and ESRCH tolerance.
  - **Preserve:** injectable cleanup dependencies, ESRCH treated as already gone, and a separate
    Windows branch.
  - **Allowed variation:** membership is computed by descendant walk plus marker, not by process
    group, because provider tool commands create their own groups (the ADR's Option D explains
    why a group kill misses them).
- **Test Process Isolation (CLAUDE.md).** `ProcessTable` and `Kill` are injected adapters. Tests
  must prove the production adapter reaches the mock before exercising destructive arguments, and
  must use `createPrivateTmux` for any real-tmux assertion (#2476 fixture).
- **State.** Teardown outcome is an explicit enum (`clean | survivors | indeterminate |
  unsupported`) and trigger is an enum (`settle | sighup | sigterm | completion`). There are no
  boolean flags.
- **Security boundary.** Only processes owned by the daemon's uid are read or signalled. Reading
  `/proc/«pid»/environ` is limited to same-uid processes by the kernel.
- **Production DI defaults.** The registry is deliberately in-memory: it describes live children of
  this process, which do not survive a restart. That is ephemeral process state, not stateful data,
  so it is not a production-default violation.

## Wiring Surface

| New production surface | Production caller (design-time commitment) |
|---|---|
| `trackProviderProcess` helper in `src/execution/child-environment.ts` | Called at spawn by `claude-provider` `runClaude`, `codex-provider` `spawnCodex`, and `pi-provider`'s subprocess factory call |
| `DispatchProcessRegistry` (daemon-scoped) | Constructed in `daemon-cli.ts` daemon boot and injected into the provider construction path, with the helper's default instance used outside the daemon |
| `DispatchTreeTeardown` / `teardownAll` | Per dispatch from the helper's settle hook. Daemon-wide from `installDaemonOtelSighupHandler` (after state persistence, before the OTel stop and re-raise), the SIGTERM drain end and `onForceRelease`, normal completion, and the stale-engine and lock-loser exits in `daemon-cli.ts`, always awaited before lock release |
| `ProcessTable` and `Kill` adapters | Default instances used by teardown and `LeakAttribution` |
| `listSessions` on `TmuxRunner` (`daemon-tmux.ts`) | `LeakAttribution` |
| `LeakAttribution` plus leak lines in status | `runDaemonStatus` in `daemon-observe-cli.ts` (`ai-conductor daemon status`) |
| `dispatch_tree_reaped` event variant | Emitted by teardown; routed in `event-sinks.ts`; emitted on the daemon emitter held by the daemon-scoped registry and persisted to `.daemon/events.jsonl` for every trigger |
| `AI_CONDUCTOR_PROCESS_TREE_ID` env marker | Stamped by the helper into each provider child environment, and read by `ProcessTable` membership |

**Early overlap scan (advisory):** `ai-conductor overlap-scan` reports that unmerged
`origin/spec/self-host-phase6-wiring` also touches `src/conductor/src/daemon-cli.ts`. This is
advisory only; `/plan` should keep the exit-path hooks in small, separable edits.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A provider sandbox scrubs the env marker, so orphans that reparent before teardown escape | Technical | Medium | Medium | Probe per provider first; the descendant walk still covers live trees; status reports leftovers; stories state the per-provider limit |
| Pid reuse between snapshot and signal kills an unrelated process | Data | Low | High | Signal only on pid plus start-time match; same uid only |
| Teardown kills a process started to outlive its dispatch, such as a tmux server hosting operator sessions | Technical | Low | High | Marker-only session hosts and their whole subtree are never signalled (ADR decision 3); a host whose parent is init is reported |
| Exit-path teardown crowds out the OTel flush inside the SIGHUP handler's 5 s budget | Performance | Low | Medium | Fixed order of persistence, then teardown with a grace of at most 2 s, then the OTel stop (ADR decision 5) |
| `respawn-pane -k` or `kill-session` does not deliver SIGHUP to the node daemon under the exit-witness wrapper | Integration | Medium | High | Integration check on a private tmux server before the hook is relied on (ADR assumption 2) |
| A test reaches real `process.kill` | Security | Low | High | Injected `Kill` adapter; tests prove the production adapter reaches the mock (CLAUDE.md Test Process Isolation) |

## ADRs Created

- `adr-2026-10-12-daemon-owns-provider-dispatch-process-trees`: APPROVED by the operator on 2026-10-12.

## Conditions

1. The plan's first tasks probe both ADR assumptions: marker inheritance per provider, and SIGHUP
   delivery under `respawn-pane -k` on a private tmux server. If a probe is falsified, the plan
   records the reduced coverage before teardown tasks build on it.
2. No test reaches a real `process.kill` or the default tmux socket.
3. `LeakAttribution` has no import path to the `Kill` adapter. The status surface stays read-only.
