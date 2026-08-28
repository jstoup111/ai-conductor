# ADR: Daemon dispatcher/executor seam with pinned-base work orders and policy-gated maintenance

**Date:** 2026-08-27
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session for issue #568

## Context

The daemon contains a working N-worker pool administratively clamped to 1
(`clampDaemonConcurrency`, governed by
`adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting` Decision 4 — note
`daemon-command.ts` cites it as "ADR-014", a mis-reference; ADR-014 is the OTel exporter).
Both stated reasons for the clamp have weakened: slug-tagged per-feature loggers now exist
(issue #254), and issue #568 established that single-process N-worker concurrency does not
hit the multi-process blockers (the in-memory `started`/`inFlight` sets stay authoritative
inside one process; the ADR-010 pidfile lock is per daemon process, not per feature).

Beyond the clamp, serial execution is assumed by an idle-gate family: every shared root
operation — backlog refresh + `fastForwardRoot`, `sweepBestEffort`, stale-engine
rebuild/restart, queued restarts, base-advance re-kick — runs only when
`inFlight.size === 0` (`adr-2026-07-03-daemon-auto-restart-stale-engine` D2,
`adr-2026-07-22-origin-refresh-before-engine-rebuild` invariant 1,
`adr-2026-07-04-pending-restart-queue`, `adr-2026-07-04-respawn-in-place-restart`,
`adr-2026-07-07-single-generation-stale-respawn` D2). At N>1 the pool is rarely fully
idle, so all of these starve.

The operator's stated direction (2026-08-27): daemons will eventually run in the cloud
behind a work dispatcher, so functionality that runs outside "perform this task" should not
be welded to daemon-local state, and the dispatch contract should be a file manifest — the
documents to execute against — rather than an assumption that those documents are always
checked into git.

## Options Considered

### Option A: Un-clamp in place (filer's hypothesis in #568)
- **Pros:** Smallest diff; flag through the clamp, relax the idle gates ad hoc, tag logs.
- **Cons:** Cements dispatcher/executor coupling in `daemon.ts`; every idle-gate site gets
  a bespoke fix with no shared policy; a future cloud dispatcher requires a contract
  rewrite; self-host N>1 stays unproven.

### Option B: Dispatcher/executor seam designed for a central-dispatcher future, un-clamp behind it (chosen)
- **Pros:** One seam with a serializable contract; shared-root concerns get named owners
  and explicit policies; the un-clamp becomes a config change on top of a boundary a cloud
  dispatcher can later plug into; matches the injected work-source seam the supervisor ADR
  (D5) already anticipated.
- **Cons:** Larger refactor of the daemon core; the seam's rules (no root paths, no
  `.daemon/` reads executor-side) must be enforced, not just documented.

### Option C: Multi-process task-handoff worker
- **Pros:** Full process isolation per feature.
- **Cons:** Exactly the rearchitecture #568 scopes out — needs durable claims, a claim
  layer over `.pipeline` state (#564 seam), and breaks the ADR-010 single-owner model.
  Deferred, but the chosen contract must not foreclose it.

## Decision

Extract a dispatcher/executor seam inside the single daemon process and un-clamp the pool
behind explicit configuration. Eight decisions:

**D1 — Seam and ownership.** The dispatcher owns everything that touches shared repo state:
backlog scan/discovery, work claims, root-checkout operations (fetch/fast-forward, engine
rebuild, relink, restarts), periodic sweeps, the rate-limit episode coordinator, and the
self-host live boundary. The executor owns exactly one feature build inside its own
workspace (worktree + `.pipeline/`). Executor code never reads or writes the root checkout
or root `.daemon/` state; dispatcher-owned adapters perform any such access on its behalf.
The v1 executor runs in-process (wrapping today's `runFeature`), but the contract between
the two sides is process-separable.

**D2 — Serializable WorkOrder with a document manifest.** Dispatch crosses the seam as a
plain serializable struct: repo identity, feature slug, pinned base SHA, and a document
manifest — the spec/plan/story artifacts to execute against, as refs plus content hashes.
Today the manifest is resolved from git and the executor materializes its worktree from the
pinned SHA; the contract does not require manifest documents to exist in git, so a future
dispatcher can supply them directly. The manifest is **transport for the dispatcher→executor
hop only**: it is not persisted as an artifact-resolution authority and does not alter the
deterministic no-manifest identity ladder of `adr-2026-07-28-feature-aware-artifact-resolution`
(D3 there remains binding).

**D3 — WorkClaims formalizes the existing dispatch authority; it does not add a second one.**
The in-memory `started`/`inFlight`/`parked` sets move behind a `WorkClaims` interface
(claim/release/list), which `pickEligible` consults exactly where it consults those sets
today — preserving `adr-2026-07-04-event-driven-halt-clear-wake` D3 (one dispatch
authority) and `adr-2026-07-13-park-all-dispatch-paths` (all dispatch funnels through the
one guarded primitive). v1 ships the in-memory implementation only. No heartbeat/lease is
built (per `adr-2026-07-22-heartbeat-lease-deferred`); a durable implementation is a future
ADR. The claim registry also becomes the liveness source for "genuinely active in the
daemon" predicates (`adr-2026-07-04-resolution-worktree-lifecycle` D3).

**D4 — Pinned-base work orders.** Each work order pins the base SHA resolved at claim time;
the executor's worktree is cut from that SHA, and executor-side "what is my base"
consumers use the pin. Rationale for why this is safe against the fresh-base ADR family:
local `fastForwardRoot`/fetch never moves `origin/*` on the remote — remote advance happens
independently of this change — and merge-base-relative predicates (protected-artifact seal,
delta-aware invalidation, artifact resolution) are fork-point-stable when the tracking ref
advances without a rebase. The two tip-equality consumers are redefined explicitly:
`adr-2026-08-26-setup-once-per-worktree-marker` D2's "currently resolved base SHA" becomes
**the dispatched work order's pinned SHA** (evaluated, as today, only at dispatch
boundaries), and the base-advance re-kick/per-SHA bound
(`adr-2026-07-28-total-halt-classification-legacy-boundary` D7) stays dispatcher-side,
keyed on the root's advancing SHA, and applies only to non-in-flight features.
`adr-2026-07-23-build-review-fresh-base-disposition` is unchanged: it probes the remote
directly and its semantics do not depend on when the local root fetched. Durable
base-advance attribution (`adr-2026-08-13`) joins on the order's claimed base for in-flight
features.

**D5 — Maintenance policies replace the idle-only gate.** The `inFlight.size === 0`
expression stops being the universal guard; each shared operation declares its policy:
- *Fetch + backlog refresh + root fast-forward:* may run while executors are busy (in-flight
  orders are pinned per D4; newly claimed orders pin the post-advance SHA). This amends
  `adr-2026-07-22-origin-refresh-before-engine-rebuild` invariant 1; its rate-limit
  (minimum-interval) decision stays in force.
- *Stale-engine rebuild/restart, queued restarts:* drain-then-act — the dispatcher stops
  claiming, lets executors finish, then acts at the drained boundary. This generalizes the
  "idle boundary" of `adr-2026-07-03-daemon-auto-restart-stale-engine` D2,
  `adr-2026-07-04-pending-restart-queue`, `adr-2026-07-04-respawn-in-place-restart`, and
  `adr-2026-07-07-single-generation-stale-respawn` D2 from "no feature running" to "pool
  drained", preserving their mid-build-invariance intent. Precedent:
  `adr-2026-07-29-operator-park-scheduling-unit-boundary` D4 (drain, then decide).
- *Periodic sweeps (`sweepBestEffort`):* run on a timer regardless of pool occupancy; the
  sweep context already carries `isFeatureInFlight` and per-op predicates skip in-flight
  slugs. Reap-gate fetch discipline (`adr-2026-07-29-defer-feature-worktree-reap…` D3
  explicit fetch) is unchanged.
- *Pause and rate-limit episode:* gate the dispatcher's claim loop (no new claims), never
  individual executors — consistent with `adr-2026-07-04-durable-pause-marker` and
  `adr-2026-07-05-daemon-rate-limit-episode-coordinator` D2 (in-flight untouched).

**D6 — Interleaving-correct live boundary, dispatcher-side.** Fingerprint/verify windows
stay per provider dispatch, but a dispatcher-side coordinator makes them correct under
interleaving: dispatcher-attributed root mutations (fast-forward, rebuild, relink) are
serialized against open windows or recorded as attributed re-baseline events, so executor A
is never halted by dispatcher work or by executor B's excluded-path writes. **No exclusion
is added** to the fingerprint surface (`adr-2026-08-17-structural-live-checkout-containment`
D4 stays binding), the provider-state surface keeps its unconditional-halt semantics, and
unattributed drift still fails closed. Self-host runs remain provable per dispatch;
containment is proven, never assumed (same ADR, D2).

**D7 — Explicit concurrency configuration.** A new top-level config key (working name
`daemon_concurrency`, default **1**, clamped to ≥1) replaces the unconditional clamp,
following the `validation_concurrency` shape (`adr-2026-07-10-concurrent-group-core` D1):
typed key, `validateConfig` allow-list entry, `resolve*` clamp helper, and a consumer
declaration in the config-key consumer registry
(`adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal` D4). The
`--concurrency` CLI flag remains: an explicitly passed flag wins, otherwise the config key
applies, otherwise the default of 1. At the resolved value 1, dispatch ordering, gate
evaluation, and log output are byte-for-byte today's serial daemon.

**D8 — Central slug attribution for the remaining unattributed sinks.** The per-feature
scoped buses and loggers stay the attribution mechanism; the residual unattributed sinks —
the process-level `console.warn/error` tee and the global bus subscriber — are fixed by
central machinery (stamping at one seam, not a slug argument threaded through call sites),
per the `adr-2026-08-11-halt-events-ride-the-persisted-spine` central-stamp precedent and
`adr-2026-07-26-event-sink-registry-exhaustiveness` (any new dispatcher/executor event
declares its sinks).

**Explicitly out of scope:** multi-process or remote executors, durable/distributed claims,
any transport, #564's run-state relocation, per-feature attachable tmux sessions, and any
weakening of the ADR-010 single-daemon-process lock.

## Consequences

### Positive
- A single daemon builds N features concurrently, operator-gated, with serial behavior
  preserved at the default.
- Shared-root concerns have named owners and policies instead of one overloaded idle gate;
  starvation of fast-forward/sweeps/stale-engine recovery at N>1 is designed out.
- The dispatch contract (WorkOrder + manifest + claims interface) is the boundary a future
  cloud dispatcher plugs into; the executor contract is process-separable from day one.
- Self-host concurrency is provable rather than accidental; the live boundary keeps its
  fail-closed posture without exclusion-list growth.

### Negative
- A substantial refactor of `daemon.ts`'s run loop with a genuine behavioral-equivalence
  burden at concurrency 1.
- Eight prior ADRs carry amendment notes; readers must follow them to this ADR for the
  current gate semantics.
- In-process env mutation hazards become races at N>1: the legacy no-`providerExecution`
  branch in `conductor.ts` mutates `process.env` (`CLAUDE_CONFIG_DIR`) process-globally, so
  N>1 must refuse or serialize that branch (`adr-2026-06-30-sandbox-build-isolation`).
- The main-checkout leak triage's all-or-nothing heal
  (`adr-2026-07-08-main-checkout-leak-triage-and-write-fence`) cannot attribute a
  multi-feature leak; at N>1 fast-forward then refuses and must surface the refusal loudly
  rather than stall silently. Extending triage to multi-candidate attribution is future
  work.
- GitHub API pressure rises with N (per-executor discovery-adjacent `gh` calls); the
  once-per-discovery-pass hoists (`adr-2026-08-08` D2) become more important, not less.

### Follow-up Actions
- [ ] Amendment notes on the eight affected ADRs (supervisor D4, stale-engine D2,
      origin-refresh invariant 1, pending-restart-queue, respawn-in-place,
      single-generation D2, harness-daemon-profile, setup-once-per-worktree D2) pointing
      here.
- [ ] Fix the "ADR-014" mis-reference comment in `daemon-command.ts` while replacing the
      clamp.
- [ ] BUILD-time audit task: enumerate executor-side sites that resolve `origin/<base>`'s
      tip and route them through the work order's pinned SHA.
- [ ] Register the new config key in the consumer registry; document in
      `docs/reference/configuration.md`, `docs/reference/cli.md`,
      `docs/guides/running-the-daemon.md`.
