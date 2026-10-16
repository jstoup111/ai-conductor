# Conflict Check: Engine updates reach dispatched features without a full daemon drain (#2392)

**Date:** 2026-10-15
**Stories checked:** `.docs/stories/engine-updates-reach-dispatched-features-only-afte.md` (Stories
1–16), compared against all of `.docs/stories/` (602 files) and every APPROVED ADR.
**Result:** PASSED. Zero blocking conflicts remain. Every resolution below was confirmed by the
operator on 2026-10-15, and two scan rounds were run.

## ADR corpus

**Examined, because they overlap these stories:**
- adr-2026-10-15-per-dispatch-engine-pinned-executor
- adr-2026-08-27-daemon-dispatcher-executor-seam
- adr-2026-07-07-single-generation-stale-respawn
- adr-2026-07-03-daemon-auto-restart-stale-engine
- adr-2026-10-14-dispatch-first-daemon-maintenance
- adr-2026-07-22-origin-refresh-before-engine-rebuild
- adr-2026-07-03-harness-daemon-profile
- adr-2026-07-04-versioned-engine-store-atomic-flip
- adr-2026-07-06-stale-engine-respawn-in-place
- adr-2026-07-04-pending-restart-queue
- adr-2026-07-05-daemon-rate-limit-episode-coordinator
- adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability
- adr-014-otel-observability-exporter
- adr-2026-07-26-event-sink-registry-exhaustiveness
- adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting
- adr-2026-08-21-engine-identity-in-build-review-cache-key
- adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal
- adr-2026-06-30-sandbox-build-isolation
- adr-010-pidfile-lock-daemon-liveness

**Narrowed out, because their subject is unrelated to these stories:**
- adr-005-non-autonomy-and-read-only-governor
- adr-2026-08-17-structural-live-checkout-containment
- adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation
- adr-2026-10-10-retain-self-host-provider-transcripts
- adr-2026-08-26-setup-once-per-worktree-marker
- adr-2026-07-22-token-liveness-probe-via-cli-invocation
- adr-2026-07-27-project-config-scaffolder
- adr-2026-07-10-session-hook-task-stamping
- adr-2026-07-07-ship-ci-feedback-loop
- adr-2026-07-07-daemon-owned-build-credential
- adr-2026-07-04-durable-pause-marker
- adr-2026-07-04-event-driven-halt-clear-wake
- adr-2026-07-04-auth-failure-park-and-poll
- adr-2026-08-04-live-tier-provisions-its-own-provider-home
- adr-2026-07-06-installed-root-resolution-for-global-writes
- adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep
- adr-2026-10-14-ac-prefixed-skill-names
- adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag
- adr-2026-08-08-finish-human-required-halt-rendering
- adr-2026-07-11-attribution-abstain-or-loud
- adr-2026-07-10-validation-group-join
- adr-2026-07-10-concurrent-group-core
- adr-2026-07-09-deterministic-evidence-attribution-enforcement
- adr-2026-07-05-halt-pr-presentation-reliability
- adr-2026-07-04-respawn-in-place-restart
- adr-2026-08-11-halt-events-ride-the-persisted-spine
- adr-2026-07-29-operator-park-scheduling-unit-boundary
- adr-2026-07-22-heartbeat-lease-deferred
- adr-2026-07-22-per-feature-cost-rollup-in-shipped-record
- adr-2026-07-04-resolution-worktree-lifecycle

None of the overlapping ADRs is fully superseded.

## Conflict: The maintenance job is forbidden to run the engine rebuild

**Stories involved:** Story 12 vs ADR: Dispatch-first daemon maintenance
**Files:** [.docs/stories/engine-updates-reach-dispatched-features-only-afte.md] vs [.docs/decisions/adr-2026-10-14-dispatch-first-daemon-maintenance.md]
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-10-14-dispatch-first-daemon-maintenance
**Story ID:** Story 12
**ADR opposing sentence (verbatim):** "The job never runs a stale-engine rebuild, a restart, or a queued restart; those stay drain-then-act, and the drained boundary also waits for the job to settle."
**Story opposing sentence (verbatim):** "when the background maintenance job runs, then it fetches, fast-forwards, rebuilds and flips `dist` without waiting for the pool to drain."

**Description:** The approved job may not run a rebuild, but Story 12 requires the job to run one
while executors are busy.

**Resolution Options:**
1. Amend D3: the rebuild is allowed under the stale-engine gates; restarts stay out of the job.
2. Run the rebuild from a separate timer outside the job.

**Recommendation:** Option 1, applied. A separate timer would add a second single-flight mechanism.

## Conflict: The origin-refresh rebuild may run only at a drained boundary

**Stories involved:** Story 12 vs ADR: Origin refresh before engine rebuild
**Files:** [.docs/stories/engine-updates-reach-dispatched-features-only-afte.md] vs [.docs/decisions/adr-2026-07-22-origin-refresh-before-engine-rebuild.md]
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-07-22-origin-refresh-before-engine-rebuild
**Story ID:** Story 12
**ADR opposing sentence (verbatim):** "The engine **rebuild** half remains drained-boundary-only, and the minimum-interval rate limit below stays in force."
**Story opposing sentence (verbatim):** "when the background maintenance job runs, then it fetches, fast-forwards, rebuilds and flips `dist` without waiting for the pool to drain."

**Description:** A rebuild cannot be both drained-only and run while the pool is busy.

**Resolution Options:**
1. Add amendment notes on the drained-only sentence and on the quiescent-only invariant.
2. Restrict the rebuild to drained boundaries, which abandons #2392 outcome 1.

**Recommendation:** Option 1, applied. The rate limit and fail-closed degradation are preserved.

## Conflict: Shipped stories require rebuild and restart only when drained

**Stories involved:** Stories 11–12 vs daemon-stale-engine-origin-advance (negative path, Done When) and enable-single-repo-daemon-concurrency-un-clamp-the Stories 2 and 7
**Files:** [.docs/stories/engine-updates-reach-dispatched-features-only-afte.md] vs [.docs/stories/daemon-stale-engine-origin-advance.md], [.docs/stories/enable-single-repo-daemon-concurrency-un-clamp-the.md]
**Type:** contradiction
**Severity:** blocking

**Description:** The shipped criteria said that no rebuild or restart happens while builds are in
flight, and that stale-engine rebuild and restart fire at the drained boundary. Stories 11 and 12
rebuild while busy and restart at a natural idle.

**Resolution Options:**
1. Replace the superseded criteria in place. BUILD flips their tests.
2. Leave them as history and accept failing tests.

**Recommendation:** Option 1, applied. The superseded criteria were replaced in place, and the
shipped behavior that survives (queued restarts drain, rate-limit deferral) is kept.

## Conflict: Stale-engine gates were missing from restart, mismatch and rebuild

**Stories involved:** Stories 3, 11, 12 vs ADR: Stale-engine respawn in place, and 2026-07-03-daemon-auto-restart-stale-engine
**Files:** [.docs/stories/engine-updates-reach-dispatched-features-only-afte.md] vs [.docs/decisions/adr-2026-07-06-stale-engine-respawn-in-place.md]
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-07-06-stale-engine-respawn-in-place
**Story ID:** Story 11
**ADR opposing sentence (verbatim):** "[…] its gates are unchanged from the 2026-07-03 ADR: `auto_restart_on_stale_engine` config flag (default **false**), self-host repos only, determinate identity verdict, non-convergence loop-guard clear."
**Story opposing sentence (verbatim):** "Given the supervisor's boot build differs from `dist` and executors are running, when the next claim boundary arrives, then claiming continues and no drain begins."

**Description:** As first drafted, the restart and rebuild stories applied to every daemon.

**Resolution Options:**
1. Gate the restart policy, the mismatch restart and the rebuild on the existing armed gates. Consumers adopt builds only through per-dispatch pinning.

**Recommendation:** Option 1, applied (ADR D3, D7 and D8; Stories 3, 11 and 12).

## Conflict: The environment-isolation story had no reachable premise

**Stories involved:** Story 10 (original) vs enable-single-repo-daemon-concurrency-un-clamp-the Story 10
**Files:** [.docs/stories/engine-updates-reach-dispatched-features-only-afte.md] vs [.docs/stories/enable-single-repo-daemon-concurrency-un-clamp-the.md]
**Type:** overlap
**Severity:** blocking

**Description:** The only `CLAUDE_CONFIG_DIR` mutation is in the legacy no-`providerExecution`
branch, which is already refused when concurrency is above 1. Concurrent environment mutation
therefore cannot occur.

**Resolution Options:**
1. Replace Story 10 with process-identity guarantees: the supervisor memory sampler, the heap guard,
   the `pgrep` count, and the legacy-branch refusal carried into child mode.

**Recommendation:** Option 1, applied. The env-race claim was also removed from the new ADR.

## Conflict: The WorkOrder file was written before the worktree existed

**Stories involved:** Story 1 vs ADR: Per-dispatch engine-pinned executor (draft D3)
**Files:** [.docs/stories/engine-updates-reach-dispatched-features-only-afte.md] vs [.docs/decisions/adr-2026-10-15-per-dispatch-engine-pinned-executor.md]
**Type:** sequencing
**Severity:** blocking

**Description:** The supervisor wrote `.worktrees/«slug»/.pipeline/work-order.json` before the
child created the worktree. On a first dispatch, `git worktree add` refuses a non-empty directory.

**Resolution Options:**
1. Send the WorkOrder over IPC after the hello; the child persists it once the worktree exists.

**Recommendation:** Option 1, applied (ADR D3, Story 1, diagram).

## Conflict: The child memory sample would replace the daemon memory evidence

**Stories involved:** Story 10 (first revision) vs continuous-daemon-grows-to-4-2-gb-in-three-hours-a Stories 1, 2 and 5
**Files:** [.docs/stories/engine-updates-reach-dispatched-features-only-afte.md] vs [.docs/stories/continuous-daemon-grows-to-4-2-gb-in-three-hours-a.md]
**Type:** contradiction
**Severity:** blocking

**Description:** Sampling the child's memory would stop recording the supervisor's own growth. A
child's rss could also trigger a heap dump of the supervisor.

**Resolution Options:**
1. Keep the supervisor sampler and heap guard unchanged. A child heap exhaustion becomes an `error` outcome.

**Recommendation:** Option 1, applied (Story 10, ADR D5).

## Degrading items resolved by clarification

- **Rate-limit deferral.** A natural-idle restart is deferred while an episode is active (Story 11).
- **Stale age.** It is measured from first staleness (Story 11).
- **Pending restart and the maintenance job.** A restart is pending only once its boundary is
  reached. Staleness alone never stops the job (Story 11; adr-2026-10-14 amendment;
  daemon-reconciliation-delays-first-feature-dispatc Story 3 ordering kept).
- **Origin refresh when the flag is off.** It is unchanged; only the rebuild is gated (Story 12).
- **Natural idle.** It means no executor running, regardless of eligible backlog (Story 11).
- **Protocol-compatible qualifier and no sticky fallback.** Covered in Stories 1 and 12 and ADR D3.
- **Who emits `feature_dispatch_*`.** The supervisor emits it, once per dispatch (Stories 7 and 8,
  ADR D4).
- **Orphaned children.** A successor supervisor terminates a previous generation's live child
  before re-dispatching it (Story 9, ADR D5).
- **OTel engine version.** It reports the executor's pin (Story 13).
- **Unknown event variants.** They are neither rendered nor persisted by the supervisor (Story 7).
- **Heap ceiling.** (concurrency + 1) × cap is accepted as a consequence (ADR D5, review risk).
- **Stale ADR wording.** Amendment notes were added to adr-2026-07-03-harness-daemon-profile and
  to adr-2026-08-27's out-of-scope list.

## Accepted degrading conflicts

None remain open.
