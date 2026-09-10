# Conflict Check: export-the-telemetry-dimensions-the-engine-already

**Date:** 2026-09-09
**Stories checked:** `.docs/stories/export-the-telemetry-dimensions-the-engine-already.md` (Stories 1–6) against every file in `.docs/stories/` and the `repo_wide` ADR corpus.
**Result:** 0 blocking, 3 degrading (accepted), 1 phrasing conflict resolved in the new stories.

## ADR corpus (repo_wide)

All 310 `adr-*.md` files were examined (delegated full read, 2026-09-09). Narrowed to those whose subject overlaps OTel export, the event schema, provider routing, or usage semantics: adr-014-otel-observability-exporter (incl. all amendments), adr-2026-07-26-event-sink-registry-exhaustiveness, adr-2026-08-11-halt-events-ride-the-persisted-spine, adr-2026-07-13-retry-classify-rerun-vs-route, adr-2026-07-27-cost-unmetered-is-a-first-class-state, adr-2026-07-22-per-feature-cost-rollup-in-shipped-record, adr-2026-07-29-engine-observed-provider-time-partition, adr-2026-07-05-retry-as-escalation-ladder, adr-2026-08-09-seal-rotation-authorship-predicate, adr-2026-08-12-cumulative-build-review-convergence-bound, adr-2026-08-13-durable-base-advance-attribution, adr-2026-08-08-pipeline-owned-closeout-timestamps, adr-2026-07-07-audit-trail-event-sink, adr-2026-07-10-intra-step-build-progress-events, adr-2026-07-22-build-dispatch-json-usage-capture, adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation. The remaining ADRs were narrowed out as non-overlapping (list held in the architecture review's sweep digest). No ADR was excluded on supersession grounds; none of the narrowed set is superseded. Each narrowed ADR was compared against the six stories in both directions: no opposing sentence pair exists — adr-014 was amended (D10–D11) during architecture review precisely so its enumerated label set includes the new dimensions.

## Conflict: Span tier attribute named two ways

**Stories involved:** Story 4 (Step spans carry the dispatch dimensions) vs "Step spans carry attributes and bus events"
**Files:** [.docs/stories/export-the-telemetry-dimensions-the-engine-already.md] vs [.docs/stories/otel-observability.md]
**Type:** resource-contention
**Severity:** blocking (resolved)

**Description:** The original OTel stories name the tier span attribute `conductor.complexity_tier` ("carries … `conductor.complexity_tier` (when known)"); Story 4 as first drafted named it `conductor.tier`. The attribute was never implemented (no `complexity_tier` reference exists under `src/conductor/src/engine/otel/`), but two accepted stories naming one value two ways would leave BUILD to pick.

**Resolution Options:**
1. Rename in the new story and ADR-014 D10 to the already-documented `conductor.complexity_tier`.
2. Replace the name in the original story.
3. Emit both names.

**Recommendation / applied:** Option 1 — the new spec adopts the existing documented name; Story 4, adr-014 D10, and the architecture diagram now say `conductor.complexity_tier`. No foreign story edited.

## Conflict: Dispatch counter attribute set grows

**Stories involved:** Story 3 (Dispatch counter distinguishes provider fallback) vs "Dispatch metering classification is positively visible" (Story 2)
**Files:** [.docs/stories/export-the-telemetry-dimensions-the-engine-already.md] vs [.docs/stories/exported-telemetry-carries-no-cost-signal-so-spend.md]
**Type:** overlap
**Severity:** degrading (accepted)

**Description:** The #1936 story asserts `conductor.step.dispatches` "adds 1 with attributes `{ step, metering: 'fully-metered' }`". Story 3 adds `provider` and `fallback` (and Story 2 adds `model`, `effort`, `tier`) to the same data point. Both directions hold: the count-once and `metering` assertions remain true; only an exact-set equality in that feature's tests becomes a superset check. The #1938 story's own rule — "pre-existing attributes are unchanged in name and value (additive only)" — is satisfied.

**Resolution:** Accepted as additive. Tests asserting the exact set are updated in BUILD; the accepted #1936 story text is not edited on this branch (foreign-stem story edits are rejected at land).

## Conflict: Listener/visualizer parity snapshot

**Stories involved:** Story 6 (Daemon and interactive metric paths export the same dimensions) vs "Daemon-level signals ride the event spine" (Story 7) and "A parity test fails when a signal reaches one path's exporter but not the other" (Story 5)
**Files:** [.docs/stories/export-the-telemetry-dimensions-the-engine-already.md] vs [.docs/stories/no-daemon-level-metrics-queue-depth-halts-and-gate.md], [.docs/stories/daemon-dispatched-builds-emit-no-otel-telemetry-th.md]
**Type:** overlap
**Severity:** degrading (accepted)

**Description:** #1937's parity test compares the listener's attribute keys to "the pre-change visualizer-recorded set". This feature changes both sets together (Story 6 requires equality), so the parity test's expected key set moves but the invariant it protects holds in both directions.

**Resolution:** Accepted; the parity fixture is extended in BUILD, not weakened.

## Conflict: Handler-coverage "tests pass unchanged" guard

**Stories involved:** Stories 2–5 vs "Every traced event type reaches a handler" (Story 1)
**Files:** [.docs/stories/export-the-telemetry-dimensions-the-engine-already.md] vs [.docs/stories/mechanically-enforce-otel-handler-coverage-for-ote.md]
**Type:** overlap
**Severity:** degrading (accepted)

**Description:** That story's Done-when says the sixteen traced types "keep their existing span and metric effects, proven by the existing … test files passing unchanged". It was a point-in-time regression guard for that feature; this feature deliberately extends the effects of `step_completed`, `step_failed`, `step_retry`, and `provider_attempt`, so some of those tests change. The routing invariant (every traced type has a handler) is untouched and the `missingMetricsHandlerTypes` check still runs.

**Resolution:** Accepted; no oscillation (satisfying either does not re-break the other's invariant).

## Pairs examined clean

Stories 1–6 vs `every-project-reports-the-same-otel-identity-so-me` (identity attrs additive, run id still absent from labels), `stamp-released-harness-version-on-otel-trace-resou` (metric Resource untouched), `fix-otel-step-duration-histogram-bucket-saturation` (boundaries untouched), `build-post-task-tail-telemetry`, `demote-task-stamping-to-telemetry`, `wave-c-telemetry-event-log` (no shared instrument or field). Within the new file: Stories 2/3/4/5 each own distinct attributes; Story 6 constrains both projections equally; Story 1 feeds 2, 4, 6 with no circular ordering.
