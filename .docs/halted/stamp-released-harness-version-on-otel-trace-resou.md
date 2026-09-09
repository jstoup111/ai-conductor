# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-09-09T16:55:59.648Z
Slug: stamp-released-harness-version-on-otel-trace-resou
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-stamp-released-harness-version-on-otel-trace-resou
Head SHA: b74a9e4b570e8a213fb720afc33968b34d60a723
Halted at: 2026-09-07T18:17:48.521Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: needs human DECIDE — AB-1 (architectural-clarity: AB-1 needs a human architectural decision, not code the daemon can task. ADR-014 Decision 8 (.docs/decisions/adr-014-otel-observability-exporter.md:259-271) requires a worker-stable metric Resource, but the worker identity it depends on is entirely unimplemented in this repository: grep over src/conductor/src finds zero occurrences of otel.worker_name, workerName, conductor.worker, or host.name, and docs/ never documents the config key, so Decision 8's metric-identity redesign (the MetricsRecorder data-point seam that would carry `feature` after conductor.feature leaves the Resource) has not shipped and is far outside this Small trace-attribute feature. The pre-existing feature-stable shape at src/conductor/src/engine/otel/resource.ts:57-68 therefore cannot be repaired by any task this plan admits: the approved plan's Task 1 Step 3 directs BUILD to leave the metrics early return and its attribute object untouched and its Done-when 4 asserts exactly the five feature-stable keys (.docs/plans/stamp-released-harness-version-on-otel-trace-resou.md:52-61,72-77), which directly contradicts the sealed Story 3 criterion demanding the worker-stable set (.docs/stories/stamp-released-harness-version-on-otel-trace-resou.md:63,71). Closing AB-1 requires the operator to choose between two paths the daemon may not choose for itself — expand this feature to absorb the unshipped Decision 8 identity redesign (amending the sealed plan and every metric consumer of conductor.feature), or approve an ADR superseding Decision 8 and reseal Story 3 — and both amend sealed .docs/ artifacts, which routes to the owning DECIDE step rather than to build or acceptance_specs. build is additionally invalid here because an unresolved architectural decision remains; existing-task is invalid because no active-plan task's Done when admits the remedy (Task 1 asserts its negation, Tasks 2 and 3 own the wire seam and start boundaries only); plan is invalid because worker-stable metric identity is not in-scope functionality this plan omitted.)
```
