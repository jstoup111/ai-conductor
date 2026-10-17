# Architecture Review: Engine updates reach dispatched features without a full daemon drain
**Date:** 2026-10-15
**Stories reviewed:** none yet. This is the pre-stories full pass (Tier L, technical track). The
input is the #2392 desired outcomes plus the explore decision (Approach A).
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | Node `child_process.fork` with a built-in IPC channel. No new packages (ADR A1). |
| Prerequisites | The immutable `dist-versions/«id»` store and atomic `dist` flip already exist (adr-2026-07-04-versioned-engine-store-atomic-flip). So do the WorkOrder seam (adr-2026-08-27 D1/D2) and serializable `FeatureTerminalEffects`. No migrations or external setup. |
| Integration surface | Wide, but internal: dispatcher claim loop, executor adapter, WorkOrder, rate-limit episode, provider availability, live-boundary coordinator, worktree lifecycle queue, event forwarding, engine-store GC, maintenance job, observe CLI. It crosses well over three module boundaries; the consequence is captured as the Tier L rating and the split decision below. |
| Data implications | New durable state `.daemon/executors/«slug».json` and `.pipeline/work-order.json`. One new event variant, plus one additive optional field on `feature_dispatch_started`. No backfill: older ledgers simply lack the field. |
| Performance risk | One Node module load per dispatch, against builds measured in minutes. More engine versions are retained while old executors stay alive; GC still bounds the count once those pins release. |
| Worktree isolation | Children write only their own worktree, and only after it exists; the WorkOrder arrives over IPC (ADR D3). Root `.daemon/` writes stay supervisor-side, as adr-2026-08-27 D1 requires. The `CLAUDE_CONFIG_DIR` mutation is confined to the legacy no-`providerExecution` branch, already refused at concurrency above 1. |

## Complexity

High. There are about ten coordination concerns across the process boundary, plus a versioned
protocol under engine-version skew. The estimate is about 33 plan tasks, above the 30-task land
ceiling.

A split into three sequential specs behind a default-off flag was proposed (§3a). The operator
declined it on 2026-10-15, so the plan needs a `**Scope-exception:**` that cites ADR D10.

## Alignment

- **adr-2026-08-27-daemon-dispatcher-executor-seam.** Ownership in D1 is unchanged: brokered
  services stay dispatcher-owned. Three decisions are amended in place:
  - D1: executor topology;
  - D2: the WorkOrder now carries engine identity;
  - D5: the stale-engine drain policy.
  D4's pinned base, D6's live-boundary serialization and D8's slug attribution are reused through
  the proxy feature bus.
- **adr-2026-07-07-single-generation-stale-respawn.** D1 keeps unconditional predecessor
  termination. Its 2026-08-27 drained-boundary amendment is amended again: the host boundary for a
  stale restart is now a natural idle, with the age-cap drain as fallback. Outcome 5 holds.
- **adr-2026-07-03-daemon-auto-restart-stale-engine.** D2's mid-build invariant ("no build is
  running when the engine is swapped") is now met by per-dispatch pinning rather than by draining.
  It is amended to say so.
- **adr-2026-07-04-versioned-engine-store-atomic-flip.** Not falsified. "GC never deletes a version
  a live pidfile references" still holds, and ADR D6 adds executor records to the protected set
  under the same fail-closed rule. No amendment.
- **adr-2026-10-14-dispatch-first-daemon-maintenance.** The cadence rebuild joins its single-flight
  background job (ADR D8). Its D3 forbade rebuilds in the job and is amended: rebuilds are allowed
  under the stale-engine gates, restarts stay out, and a pending restart stops new job runs. Its
  feature was not yet in `shipped/` when this review was written, so it is a soft prerequisite for
  the cadence work; see Conditions.
- **adr-2026-07-22-origin-refresh-before-engine-rebuild.** Its "rebuild half remains
  drained-boundary-only" is amended. The interval rate limit and fail-closed degradation stay.
- **adr-2026-07-03-harness-daemon-profile.** Its "not swapped mid-build" wording is amended: a
  running build is still never swapped, and new code reaches the next dispatch.
- **Stale-engine gates.** The background rebuild and the supervisor restart policy apply only
  where today's gates are armed: continuous mode, self-host, and `auto_restart_on_stale_engine`.
  Consumer daemons adopt rebuilds only through per-dispatch pinning.
- **Superseded story criteria.** These criteria, in features already shipped, are replaced in place
  and BUILD flips their tests:
  - `daemon-stale-engine-origin-advance`: no rebuild while in flight;
  - `enable-single-repo-daemon-concurrency-un-clamp-the` Stories 2 and 7.
- **Event spine.** Occurrences ride the spine. The child is the single writer of its feature
  ledger (exceptions A and B), and events are forwarded in the unchanged `ConductorEvent` schema
  to a proxy bus. The coordination channel is request/response ownership traffic, which the spine
  cannot carry. ADR D4 records the concern, the exception analysis, the single consumer and the
  absence of overlap, as the event-spine skill §5 requires. Executor records are durable state
  (exception C).
- **Local pattern basis.**
  - The single-writer sibling-ledger approach follows
    adr-2026-08-08-pipeline-owned-closeout-timestamps: a separate process writes the same union,
    and the reader re-emits it onto the live bus. Preserve the same schema, one writer per file,
    and re-emission onto the live bus.
  - The pidfile-reference GC protection follows `readLiveReferencedVersionIds`
    (`engine/engine-store.ts`). Preserve fail-closed on unreadable records and the registry-wide
    read.
  - Variation allowed: per-slug files instead of one pidfile field.

## Domain Integrity

- `engineVersionId` is a semantic type parsed by the existing `versionIdFromEngineDir`. It is not a
  free string, and an unparseable id fails resolution, which falls back to the supervisor's own
  engine (ADR D2).
- `executor_isolation` is an enum, `child | in-process`, not a boolean.
- Protocol compatibility is a single integer equality. Mismatch is an explicit branch: terminate,
  relaunch on the supervisor's engine, request a restart. It is never a default.
- IPC message kinds form a closed discriminated union with exhaustive handling. An unknown
  `ConductorEvent` variant inside an `event` message is forwarded opaquely by design (ADR D4),
  because newer executors may emit variants an older supervisor does not know.
- The supervisor restart trigger (ADR D7) has explicit states: natural-idle, age-cap drain and
  protocol-mismatch drain. These are not boolean flags.

## Wiring Surface

| New production surface | Production caller (design-time) |
|---|---|
| Child-executor adapter (`createChildProcessFeatureExecutor`) | Selected in `daemon-cli.ts`, where `createInProcessFeatureExecutor` is wired today, by `executor_isolation`; invoked by the claim loop's `executor.execute(...)` in `engine/daemon.ts` |
| Executor child entrypoint (a hidden CLI subcommand in the engine bundle) | Forked by the child adapter from `dist-versions/«id»`; it runs the existing `makeRunFeature` → `runConductorInWorktree` path |
| Executor IPC protocol and supervisor broker | Broker is constructed by the child adapter, backed by the existing `rateLimitEpisode`, `providerAvailability`, `liveBoundaryCoordinator` and `worktreeLifecycle` instances in `daemon-cli.ts`; child-side proxies are passed where those instances are passed today |
| Engine pin resolver plus `WorkOrder.engineVersionId` and `schemaVersion` | Called from `createWorkOrder` / `buildWorkOrder` (`daemon-cli.ts`, `engine/work-order.ts`) at claim |
| `.pipeline/work-order.json` writer and reader | Supervisor writes it before fork; the child entrypoint reads it and runs the existing `verifyWorkOrder` |
| `.daemon/executors/«slug».json` records | Written and removed by the child adapter; read by `readLiveReferencedVersionIds` (`engine/engine-store.ts`) and by `daemon status` (`engine/daemon-observe-cli.ts`); swept on boot from `daemon-cli.ts` startup |
| `executor_started` event variant | Emitted by the child entrypoint on its feature bus; consumed by the existing per-feature daemon.log renderer and persisted by `EventPersister` |
| `feature_dispatch_started.engineVersionId` | Set by the supervisor at launch; persisted to `.daemon/events.jsonl`; read by `daemon status` |
| Config keys `executor_isolation` and `supervisor_max_stale_hours` | Parsed by the existing daemon config loader; read in `daemon-cli.ts` |
| Supervisor restart policy (natural idle, age cap, mismatch) | Replaces the drained stale-engine gate in `engine/daemon.ts` (`observeBusyDrainRequest` / `idleBoundary`) |
| Cadence rebuild job | Registered with the existing background maintenance job (`engine/daemon-maintenance.ts`), wrapping the existing `refreshEngineSource` → `rebuildEngine` under `coordinatedRootMutation` |

Advisory overlap scan (`ai-conductor overlap-scan`): `origin/spec/daemon-self-host-guardrails`
touches `engine/daemon-deps.ts`, and `origin/spec/self-host-phase6-wiring` touches `daemon-cli.ts`.
Both are older spec branches. This is advisory and does not block.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A shared in-memory path is missed when the executor moves out of process (ADR A2), and child-mode runs silently lose coordination | Integration | Medium | High | Full-feature parity test in child mode; one test per brokered service; `executor_isolation: in-process` rollback lever |
| Engine-version skew: an older supervisor meets a newer executor protocol or event variant | Integration | Medium | High | Protocol-version handshake before work; relaunch on the supervisor's engine; opaque forwarding of unknown variants; mismatch triggers a drain restart |
| A busy-pool rebuild flips `dist` during an open self-host fingerprint window and halts features as drift | Technical | Low | High | Every root mutation runs through `coordinatedRootMutation` (verified existing path, ADR A3) |
| Orphaned children after a supervisor crash keep running and pin old versions | Technical | Medium | Medium | Child exits on IPC disconnect; boot sweep removes dead-pid executor records |
| GC aborts more often because there are more reference files to read | Technical | Low | Medium | Same fail-closed rule as pidfiles; records are written atomically (temp file plus rename) |
| Total memory ceiling becomes (concurrency + 1) times the per-process heap cap, because each child inherits the supervisor's `NODE_OPTIONS` cap | Performance | Medium | Medium | A child heap exhaustion fails only that dispatch as `error`; the supervisor memory sampler and heap guard keep measuring the supervisor only (Story 10) |
| Supervisor-side fixes lag up to the age cap | Technical | Medium | Low | `supervisor_max_stale_hours` is configurable; status shows supervisor staleness |
| Plan exceeds the scope ceiling as one spec | Knowledge | High | Medium | Operator-approved scope exception (ADR D10); plan tasks ordered so each lands behind the in-process default until the child adapter is complete |

## ADRs Created

- `adr-2026-10-15-per-dispatch-engine-pinned-executor`. Approved by the operator before this spec
  lands.

ADRs amended with additive notes:
- `adr-2026-08-27-daemon-dispatcher-executor-seam` (D1, D2, D5, out-of-scope list)
- `adr-2026-10-14-dispatch-first-daemon-maintenance` (decision 3)
- `adr-2026-07-22-origin-refresh-before-engine-rebuild` (preserved invariants)
- `adr-2026-07-03-harness-daemon-profile` (context)
- `adr-2026-07-07-single-generation-stale-respawn` (D1)
- `adr-2026-07-03-daemon-auto-restart-stale-engine` (D2)

## Conditions

1. The plan contains a full-feature parity test that drives one feature end to end through the
   child adapter, and one test per brokered service: rate-limit episode, provider suppression,
   live-boundary window/mutation, worktree lifecycle queue, shutdown, outcome.
2. The plan carries a `**Scope-exception:**` citing ADR D10.
3. The cadence-rebuild task (ADR D8) depends on the background maintenance job of
   adr-2026-10-14-dispatch-first-daemon-maintenance existing on the build base. If it is not on
   main when that task runs, the task registers with the existing maintenance seam and records the
   gap.
4. The plan has Architecture Obligation Coverage rows for every decision of the new ADR and of
   each amended ADR.
5. The new config keys `executor_isolation` and `supervisor_max_stale_hours` are registered in
   the config-key consumer registry and its user-level and self-host lists
   (adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal).
