# Conflict Check: Daemon records that a build is not advancing HEAD but never acts on it

**Date:** 2026-10-02
**Stories checked:** `.docs/stories/daemon-records-that-a-build-is-not-advancing-head-.md` (Stories 1–6) against all 528 stories in `.docs/stories/`
**ADR corpus:** `repo_wide` (config `conflict_check.adr_corpus`)
**Result:** PASSED: zero blocking conflicts. One degrading conflict resolved by an ADR amendment plus a companion story PR. Three story-phrasing overlaps resolved in place.

## Conflict: heartbeat freshness as a precondition to ending an attempt vs TI-4's Done-When

**Stories involved:** Story 3 / Story 4 (this feature) vs TI-4 (provider-preparation supervision)
**Files:** [.docs/stories/daemon-records-that-a-build-is-not-advancing-head-.md] vs [.docs/stories/daemon-build-review-can-wedge-before-provider-laun.md]
**Type:** contradiction
**Severity:** degrading
**ADR filename stem:** adr-2026-07-30-provider-preparation-lifecycle-supervision
**Story ID:** 4
**ADR opposing sentence (verbatim):** "Heartbeat data may remain for status visibility, but neither absence nor staleness may kill or replace a spawned provider."
**Story opposing sentence (verbatim):** "Given `active_stall_action: end_attempt`, when a build attempt stays `active-not-committing` for 30 minutes, then a `build_active_stall` with `action: \"end_attempt\"` is emitted and the running provider attempt is ended."

**Description:** The ADR and TI-4's negatives forbid termination caused by heartbeat absence or
staleness, and the new design keeps that: a quiet tick never arms the bound. TI-4's Done-When ("No
production path converts heartbeat age or external process discovery into post-spawn termination.")
reads literally broader, because the new path requires a *fresh* heartbeat as one precondition of
ending an attempt.

**Resolution Options:**
1. Additive amendment (decision 8) on adr-2026-07-30 naming active-stall ending as a distinct,
   opt-in, dispatcher-owned authority. Reword TI-4's Done-When to absence/staleness in a companion
   main-based PR.
2. Amend the ADR only and leave TI-4's wording.
3. Accept as degrading with no change.

**Recommendation and operator selection:** Option 1. It keeps the original intent explicit and
removes the literal clash at its source. Applied: amendment on
`adr-2026-07-30-provider-preparation-lifecycle-supervision` (decision 8). TI-4 is reworded in the
companion PR, because the land gate rejects edits to another feature's story file.

## Overlaps resolved in place (story phrasing)

- **`build_stall` reason** (resource contention with `no-daemon-level-metrics-queue-depth-halts-and-gate.md`
  Story 5's `conductor.daemon.stalls{reason=…}`): Story 3 now uses the closed reason
  `active_stall`, with the bound carried by `build_active_stall`. No free-text reason, and no
  unbounded metric label.
- **Fresh-pulse quiet warning** (overlap with `show-provider-activity-age-on-the-build-quiet-warn.md`
  Story 1): Story 1 now states that the warning still fires once and carries
  `activity: "active-not-committing"`.
- **Aborted result misread as a free-retry signal** (overlap with `per-step-provider-routing-927.md`
  non-budget-consuming recovery): Story 6 now requires the aborted result to be neither
  rate-limited, auth-failed nor session-expired.

## Examined, no conflict

- Fallback after cancellation: adr-2026-07-24-provider-aware-step-execution-fresh-session-scope
  ("no provider fallback for authentication or ordinary failures") and
  `unusable-provider-candidate-throws-instead-of-fall.md` agree with "no further candidate".
- Park interaction: `daemon-park-does-not-stop-retries-inside-an-alread.md` and
  `park-in-flight-features-at-step-boundaries-after-p.md` scope "no abort" to the park trigger. The
  per-attempt controller is separate from park.
- SIGTERM / rate-limit wait controllers (adr-2026-07-05-daemon-rate-limit-episode-coordinator): the
  per-attempt controller is not registered with `registerAbortController`.
- Retry/floor/ceiling ADRs (adr-2026-07-23-commit-movement-liveness-floor,
  adr-2026-07-12-progress-aware-build-halt, adr-2026-07-13-retry-classify-rerun-vs-route,
  adr-2026-08-19-unretryable-step-runner-failures-route-by-kind): build stays outside the
  classifier, and ended attempts are bounded by the existing ceilings. No oscillation in either
  direction.
- Event shape stories (`emit-intra-step-build-progress-and-stall-as-events.md`,
  `build-progress-1-based-display.md`, `surface-commit-recency-in-daemon-build-progress-li.md`,
  `build-post-task-tail-telemetry.md`): `activity` is additive, and quiet/re-arm semantics are unchanged.

Plan obligations surfaced (not conflicts): config-key consumer registry entry
(adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal decision 4); `ui_renderer`
fan-out of the new event kind; one terminal lifecycle outcome per ended attempt
(adr-2026-09-10-shared-step-lifecycle-telemetry decision 4).

Narrowed-out ADRs (keyword hits, no bearing): adr-010-pidfile-lock-daemon-liveness,
adr-2026-07-03-daemon-auto-restart-stale-engine, adr-2026-07-04-respawn-in-place-restart,
adr-2026-07-06-stale-engine-respawn-in-place, adr-2026-07-07-single-generation-stale-respawn,
adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting, adr-2026-07-22-heartbeat-lease-deferred,
adr-014-otel-observability-exporter, adr-2026-08-07-project-teardown-hook-contract-and-containment,
adr-2026-08-09-worktree-local-provider-scratch, adr-2026-07-13-park-all-dispatch-paths,
adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever,
adr-2026-08-12-execution-lifecycle-completeness-for-timing,
adr-2026-08-19-live-provider-stream-observation, adr-2026-07-26-cross-dispatch-kickback-livelock-bound,
adr-2026-09-24-built-in-provider-catalog-and-boot-discovery, adr-2026-08-05-build-settle-outcome-stamp.
