# Conflict Check: Durable OTel export spool

**Date:** 2026-09-29
**Stories checked:** .docs/stories/durable-otel-export-queue-telemetry-is-buffered-wh.md (Stories 1-6) against all `.docs/stories/`
**ADR corpus:** repo_wide. 38 ADRs examined, 287 narrowed out for non-overlapping subject, none excluded as superseded.
**Result:** PASS after resolution. 2 blocking and 3 degrading conflicts were found; the operator resolved all 5 on 2026-09-29.

Examined ADRs: adr-014-otel-observability-exporter, adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting, adr-2026-07-26-event-sink-registry-exhaustiveness, adr-2026-09-10-shared-step-lifecycle-telemetry, adr-2026-08-11-halt-events-ride-the-persisted-spine, adr-2026-07-10-intra-step-build-progress-events, adr-2026-08-08-pipeline-owned-closeout-timestamps, adr-2026-08-09-hook-owned-containment-event-ledger, adr-2026-08-09-reseal-audit-rides-the-existing-event-spine, adr-2026-07-07-audit-trail-event-sink, adr-2026-07-22-per-feature-cost-rollup-in-shipped-record, adr-2026-08-19-live-provider-stream-observation, adr-2026-07-10-observed-close-watch-registry, adr-2026-08-17-structural-live-checkout-containment, adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation, adr-2026-08-09-worktree-local-provider-scratch, adr-2026-07-10-park-marker-main-root-resolution, adr-2026-07-04-operator-park-marker, adr-2026-07-04-durable-pause-marker, adr-2026-07-03-gated-snapshot-status-read-model, adr-010-pidfile-lock-daemon-liveness, adr-2026-07-22-heartbeat-lease-deferred, adr-2026-09-11-immutable-state-lease-recovery-succession, adr-2026-07-06-stale-engine-respawn-in-place, adr-2026-07-07-single-generation-stale-respawn, adr-2026-07-03-daemon-auto-restart-stale-engine, adr-2026-07-04-pending-restart-queue, adr-2026-08-27-daemon-dispatcher-executor-seam, adr-2026-07-03-harness-daemon-profile, adr-2026-07-05-daemon-rate-limit-episode-coordinator, adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability, adr-2026-08-07-project-teardown-hook-contract-and-containment, adr-2026-07-29-engine-observed-provider-time-partition, adr-2026-08-12-execution-lifecycle-completeness-for-timing, adr-015-daemon-pr-labeling-sweep, adr-2026-07-08-main-checkout-leak-triage-and-write-fence, adr-2026-07-03-priority-fetch-fail-soft, adr-2026-09-06-inbound-intake-trust-boundary.

## Conflict: Default-on spool made gRPC a config error

**Stories involved:** Story 6 (this spec) vs config-validation-gaps Story 6
**Files:** [.docs/stories/durable-otel-export-queue-telemetry-is-buffered-wh.md] vs [.docs/stories/config-validation-gaps-satisfiesversion-and-six-ot.md]
**Type:** contradiction
**Severity:** blocking

**Description:** The existing story requires "Given an `otel` block with `exporter: otlp`, an endpoint, and `protocol: grpc`, when telemetry config is resolved, then telemetry is enabled with protocol `grpc`." The draft required that same config to disable OTel with an error.

**Resolution Options:**
1. Fall back: gRPC with the spool at its default exports unspooled with one bounded warning; only an explicit `otel.spool.enabled: true` errors.
2. Keep the error and amend the existing story in a companion PR.

**Recommendation:** Option 1, because it keeps the existing story true and needs no foreign edit. **Operator selected Option 1.** ADR-014 D15 and this spec's Story 6 now say so.

## Conflict: Spool acknowledgment silenced the export-failure warning

**Stories involved:** Stories 1 and 2 (this spec) vs daemon-dispatched-builds Story 4 and otel-observability "Exporter failures never break the run"
**Files:** [.docs/stories/durable-otel-export-queue-telemetry-is-buffered-wh.md] vs [.docs/stories/daemon-dispatched-builds-emit-no-otel-telemetry-th.md], [.docs/stories/otel-observability.md]
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-014-otel-observability-exporter
**Story ID:** Story 4 (daemon-dispatched-builds-emit-no-otel-telemetry-th)
**ADR opposing sentence (verbatim):** "Decision 5's bounded warning is now rendered (`renderer_error` reaches `daemon.log`) so an export failure is visible instead of silently persisted."
**Story opposing sentence (verbatim):** "Given OTel enabled with an unreachable endpoint, when a dispatch emits events, then export failures surface as bounded renderer_error warnings on the bus and the build's outcome is unaffected"

**Description:** With write-first spooling, the SDK export succeeds against a dead endpoint, so no `renderer_error` fires from the export path and an outage becomes invisible.

**Resolution Options:**
1. The drainer emits one bounded `renderer_error` per transition into a failure class and one recovery notice. Periodic backlog events are persisted, not rendered. A companion PR re-points the two existing criteria to the drainer's warning.
2. The spooling exporter also emits a `renderer_error` on its run's bus while the drainer is unhealthy.

**Recommendation:** Option 1, because it keeps visibility without flooding `daemon.log` (adr-2026-08-19-live-provider-stream-observation keeps periodic events unrendered). **Operator selected Option 1.** ADR-014 D17 and this spec's Stories 2 and 3 carry the transition warning. The two existing criteria are re-pointed in a companion main-based story PR, because the land stem gate rejects foreign-stem story edits on this branch.

## Conflict: Lease reclaim race and pid reuse

**Stories involved:** Story 4 (this spec) vs lease precedent ADRs
**Files:** [.docs/stories/durable-otel-export-queue-telemetry-is-buffered-wh.md] vs [.docs/decisions/adr-010-pidfile-lock-daemon-liveness.md], [.docs/decisions/adr-2026-09-11-immutable-state-lease-recovery-succession.md]
**Type:** overlap
**Severity:** degrading
**ADR filename stem:** adr-2026-09-11-immutable-state-lease-recovery-succession
**Story ID:** Story 4
**ADR opposing sentence (verbatim):** "separate reads and deletion permit a delayed contender to remove another contender's replacement"
**Story opposing sentence (verbatim):** "Given two processes race to reclaim a stale lease, when both attempt acquisition, then exactly one holds the lease afterward"

**Description:** A pid-plus-heartbeat lease reclaimed by delete-then-create cannot guarantee a single winner, and a reused pid would block reclaim forever.

**Resolution:** Follow adr-010: pid plus uuid plus heartbeat, `O_EXCL` succession, and uuid mismatch with an expired heartbeat counts as stale. **Operator accepted.** Written into D16 and Story 4.

## Conflict: Orphaned spool when OTel is later disabled

**Stories involved:** Story 6 (this spec) vs adr-2026-08-09-worktree-local-provider-scratch
**Type:** resource-contention
**Severity:** degrading
**ADR filename stem:** adr-2026-08-09-worktree-local-provider-scratch
**Story ID:** Story 6
**ADR opposing sentence (verbatim):** "nothing ever sweeps the root `.daemon/`."
**Story opposing sentence (verbatim):** "Given `otel.spool.enabled: false`, when config resolves, then batches are exported directly with today's behavior and no spool directory is created"

**Resolution:** A disabled process leaves an existing spool untouched and warns once, naming its path and size. **Operator accepted.** Written into D17 and Story 6.

## Conflict: Stale-engine respawn skips the flush

**Stories involved:** Story 4 (this spec) vs adr-2026-07-06-stale-engine-respawn-in-place
**Type:** overlap
**Severity:** degrading
**ADR filename stem:** adr-2026-07-06-stale-engine-respawn-in-place
**Story ID:** Story 4
**ADR opposing sentence (verbatim):** "if `triggerSelfRestart` is injected (session-hosted), fire it — tmux swaps the process in place"
**Story opposing sentence (verbatim):** "so that routine daemon restarts and stale-engine respawns never create telemetry gaps"

**Description:** The daemon installs only a SIGTERM handler (`daemon-cli.ts`), so a tmux respawn skips the provider flush and leaves the lease held until it goes stale.

**Resolution:** Best-effort zero loss. The daemon also flushes into the spool and releases the lease on SIGHUP, and Story 4's outcome is worded as best-effort. **Operator selected the SIGHUP flush, accepting best-effort.** Written into D16 and Story 4.

## Accepted risks (not conflicts)

- The event-spine skill verdict is to extend the union; the spool directory is transport state, not a channel.
- ADR-014 D11 and D14 ("no new event type") are scoped to dispatch dimensions and do not reach spool events.
- Self-host containment: `.daemon` is volatile to the live boundary and bound read-write, and OTel runs in the engine outside bwrap.
