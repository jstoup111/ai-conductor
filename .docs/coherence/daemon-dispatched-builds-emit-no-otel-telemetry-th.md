# Coherence Mapping: Daemon-dispatched builds emit OTel telemetry via the shared visualizer seam

Feature: daemon-dispatched-builds-emit-no-otel-telemetry-th (#1934). Tier M, technical track
(no PRD — the fr row class is omitted). Outcome ids are 1-based over the staged intake bullets
in `.pipeline/intake-outcomes.md`. The adr row covers the one non-deleted `adr-*.md` in this
change set (adr-014, amended additively). Criterion rows carry the extractor-exact criterion
text, cited task id(s), verdict, a verbatim quote from one cited task's body, and the
diff-locality disposition.

| Row class | Cited id / criterion | Counterpart / cited task id(s) | Verdict | Notes / quote | Disposition |
|---|---|---|---|---|---|
| outcome | outcome-1 | story-1 | covered | Daemon dispatch produces spans and metrics equivalent to an interactive run of the same feature, through one shared seam |
| outcome | outcome-2 | story-2 | covered | Feature/project/run-id resource attribution, readable without local files; durable id stitches re-dispatches |
| outcome | outcome-3 | story-3 | covered | Flush rides the dispatch-end stop on clean, HALT, and error ends — not only clean process exit |
| outcome | outcome-4 | story-4 | covered | Disabled/absent config leaves the daemon unchanged; unreachable endpoint degrades to bounded warnings |
| outcome | outcome-5 | story-5 | covered | A committed test fails when a signal reaches the interactive exporter but not the daemon path |
| adr | adr-014-otel-observability-exporter | story-1, story-2 | covered | Amended 2026-08-26: shared wiring seam at both entry points; read-only run-id in the daemon path. Story 1 implements the seam; Story 2 honors the run-id constraint |
| story | story-1 | task-4, task-5, task-6, task-8, task-10 | covered | Helper extraction (4), interactive call site (5), daemon call site (6), constructor-throw negative (8), regression guard (10) |
| story | story-2 | task-3, task-6 | covered | Session-id threading (3); resource attributes, read-only resolve, no-write and unreadable-dir negatives (6) |
| story | story-3 | task-7, task-9 | covered | Awaited stop, HALT/error path, idempotent stop (7); hanging-endpoint bounded flush (9) |
| story | story-4 | task-8, task-9 | covered | Disabled/invalid-config negatives (8); unreachable-endpoint degradation (9) |
| story | story-5 | task-1, task-2, task-10 | covered | Registry column (1), derived subscriptions (2), parity guard (10) |
| task | task-1 | story-5 | covered | Adds the otel sink column and otelEventTypes() the derivation criteria require |
| task | task-2 | story-5 | covered | Replaces the visualizer's literal subscription list with the derived set |
| task | task-3 | story-2 | covered | Threads the dispatch session id so the injected run id equals the persisted one |
| task | task-4 | story-1 | covered | Extracts wireOtelVisualizer; disabled-null, enabled-started, injected-runId/no-write tests |
| task | task-5 | story-1 | covered | Interactive entry point routes through the helper |
| task | task-6 | story-1 | covered | Per-dispatch attach on the feature-scoped bus with read-only run-id resolution (also serves story-2's attribution criteria) |
| task | task-7 | story-3 | covered | Async scope stop awaits flush; HALT and idempotency tests |
| task | task-8 | story-4 | covered | Disabled, invalid-config, and constructor-throw negatives (constructor-throw serves story-1) |
| task | task-9 | story-4 | covered | Unreachable/hanging endpoint degradation (hanging-flush serves story-3) |
| task | task-10 | story-5 | covered | Cross-path parity acceptance guard (regression negative serves story-1) |
| criterion | Story 1 happy: Given OTel is enabled in resolved config, when the daemon dispatches a feature and its run emits step lifecycle events on the feature-scoped bus, then the OTLP exporter receives a run trace with per-step child spans and step duration/token metrics for that dispatch | task-6 | covered | "attaches a visualizer to the feature-scoped bus" | diff-local |
| criterion | Story 1 happy: Given OTel is enabled, when both the interactive entry point and the daemon entry point wire telemetry, then both do so through the same shared wiring helper rather than duplicated inline blocks | task-5 | covered | "route the otel branch of the `selectVisualizers` loop the connector-seam feature landed in `src/conductor/src/index.ts` through a `wireOtelVisualizer` call" | diff-local |
| criterion | Story 1 negative: Given OTel is enabled but the visualizer constructor throws (for example a disabled config passed by mistake), when the daemon wires a dispatch, then a renderer_error event is emitted, no visualizer attaches, and the dispatch proceeds normally | task-8 | covered | "whose visualizer constructor throws, a renderer_error event is emitted, no visualizer attaches, and the dispatch proceeds normally" | diff-local |
| criterion | Story 1 negative: Given the shared helper is wired only into one entry point in a hypothetical regression, when the parity test in Story 5 runs, then it fails naming the unwired path | task-10 | covered | "prove the negative by temporarily filtering one type from the daemon fake and asserting the test fails naming it" | diff-local |
| criterion | Story 2 happy: Given a daemon dispatch for feature slug S in project P, when telemetry is exported, then its resource carries conductor.feature=S, conductor.project=P, and a non-empty conductor.run.id | task-6 | covered | "resource carries conductor.feature=slug, conductor.project, and conductor.run.id" | diff-local |
| criterion | Story 2 happy: Given a feature worktree whose .pipeline/conduct-session-id exists from a prior dispatch, when a later daemon process re-dispatches the feature, then the exported conductor.run.id equals the durable file's id, stitching both dispatches | task-6 | covered | "existing conduct-session-id content when present" | diff-local |
| criterion | Story 2 negative: Given a fresh worktree where .pipeline/conduct-session-id does not exist yet at wiring time, when the daemon path resolves the run id, then it uses the caller-injected dispatch session id and does not write .pipeline/conduct-session-id (the step runner remains that file's only writer) | task-6, task-3 | covered | "no write to conduct-session-id occurs when the file is absent" | diff-local |
| criterion | Story 2 negative: Given the worktree's .pipeline directory is unreadable, when the daemon path resolves the run id, then resolution degrades to the injected id without throwing and the dispatch proceeds | task-6 | covered | "an unreadable pipeline dir degrades to the injected id without throwing" | diff-local |
| criterion | Story 3 happy: Given an attached per-dispatch visualizer, when the dispatch completes cleanly and its feature scope stop runs, then the visualizer's stop is awaited and force-flushes traces and metrics before the scope is torn down | task-7 | covered | "awaits the visualizer's stop before detaching persistence" | diff-local |
| criterion | Story 3 negative: Given an attached per-dispatch visualizer, when the dispatch ends in HALT or a thrown error, then the same stop path runs and the final events emitted before the halt are flushed to the exporter | task-7 | covered | "a dispatch that ends in HALT/thrown error still runs the same stop path and events emitted pre-halt reach the fake exporter" | diff-local |
| criterion | Story 3 negative: Given the exporter endpoint hangs during the final flush, when stop runs, then stop resolves within the visualizer's bounded flush behavior and the daemon continues to its next dispatch | task-9 | covered | "the scope stop resolves despite the hanging flush" | diff-local |
| criterion | Story 3 negative: Given two signals or a repeated stop during flush, when stop is invoked again, then the second invocation returns the existing stop promise and no second flush starts | task-7 | covered | "a second stop invocation returns the first stop's promise (no second flush)" | diff-local |
| criterion | Story 4 happy: Given no otel block or a disabled otel config, when the daemon dispatches features, then no visualizer is constructed, no OTel dependency work runs, and dispatch behavior and log output are unchanged | task-8 | covered | "constructs no visualizer (constructor spy never called)" | diff-local |
| criterion | Story 4 negative: Given OTel enabled with an unreachable endpoint, when a dispatch emits events, then export failures surface as bounded renderer_error warnings on the bus and the build's outcome is unaffected | task-9 | covered | "renderer_error events on the feature bus (bounded via the existing warn-once wrappers, not one per export), the dispatch completes successfully" | diff-local |
| criterion | Story 4 negative: Given OTel enabled with an invalid config value, when config resolves, then resolution yields enabled false with an error message and the daemon runs as if OTel were absent | task-8 | covered | "with an invalid otel config, resolution yields enabled=false and dispatch proceeds identically" | diff-local |
| criterion | Story 5 happy: Given the interactive and daemon wiring paths, when the parity test emits each telemetry-relevant event type through both paths, then both exporters observe the same signal set and the test passes | task-10 | covered | "assert the daemon path observed every signal the interactive path observed" | diff-local |
| criterion | Story 5 happy: Given the shared helper's subscription set, when it is constructed, then the set derives from the EVENT_SINKS registry rather than a hand-maintained literal list | task-2 | covered | "replace the literal `eventTypes` array" | diff-local |
| criterion | Story 5 negative: Given a telemetry-relevant event type reaching the interactive exporter but not the daemon path, when the parity test runs, then it fails naming the missing event type | task-10 | covered | "with an assertion message naming any missing event type" | diff-local |
| criterion | Story 5 negative: Given a new ConductorEvent type is added to EVENT_SINKS with telemetry relevance, when the parity test runs without updating the helper, then derivation keeps both paths in sync and the test still passes | task-1 | covered | "explicit `otel` value (exhaustive Record — omission is a type error)" | diff-local |

No `gap` or `fail` rows. Every `covered` verdict was checked against the artifacts in this
worktree. Consistency pass (§4d): cross-layer pairs share subjects (run identity, flush,
degradation) and were checked in both directions — the one contradiction candidate (outcome-2's
durable attribution vs adr-2026-07-27's single-writer rule) is resolved inside the design
itself (read-only resolve + threaded id), recorded in the architecture review's C1 and the
adr-014 amendment; no oscillation remains. Story 1's constructor-throw criterion initially had
no covering task; plan task 8 was amended during this DECIDE pass to cover it.
