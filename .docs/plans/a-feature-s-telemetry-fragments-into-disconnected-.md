# Implementation Plan: Portable feature history across bounded traces

**Date:** 2026-09-30
**Source:** jstoup111/ai-conductor#2011, including consolidated #2009
**Track:** technical
**Tier:** L
**Stories:** .docs/stories/a-feature-s-telemetry-fragments-into-disconnected-.md
**Conflict check:** Clean; operator approved 2026-09-30
**Operator plan approval:** Approved in chat on 2026-09-30
**Design:** ADR-014 D21–D26, with approved shared lifecycle D5 and cold-start D7 amendments

## Summary

Implement portable, bounded linked traces across feature dispatches and restarts, with
logical-step grouping and truthful execution slices/outcomes. The plan has 24 scoped TDD
tasks, estimated at 2–5 minutes each (roughly two hours before review/verification).
The shared lifecycle makes one combined feature preferable to competing grouping and
connectivity implementations. No export spool, vendor-specific viewer, new CLI/config
key, or execution-policy change is included.

## Technical Approach

Keep ConductorEventEmitter → EventPersister → events.jsonl as the only correlation spine.
Resolve feature identity atomically before enabled tracing starts; validate bounded history
outside handlers. SpanManager owns roots/groups/logical execution slices; OtelVisualizer
owns one deadline, serialized rotation, queued canonical publication and bounded teardown.
Interactive and daemon composition roots await OTel-private preparation while the public
VisualizerPlugin.start remains synchronous. Existing SDK/SpanExporter transports and the
separate MetricsListener retain ownership of delivery and metrics.

Segments rotate at one hour or 1,024 completion-driven slices/outcomes. ROOT_CONTEXT gives
each segment a fresh trace ID; links carry predecessor and continuation relationships.
Policy retries retain execution identity, re-runs get another ID, and classification after
early member settlement uses a zero-duration outcome linked to ended work. In-memory state
retains active/awaiting executions and current groups, not historical spans. Monotonic
intervals plus explicit wall-clock gaps preserve original evidence after suspension.

Local patterns: reuse resolveExecutionIdentity subjects/legacy pairing, the existing
observed-interval clock, registry-derived event subscriptions, the factory renderer_error
bridge, and caller-owned idempotent stop promises. The approved departure is early shared
create-if-absent identity ownership; existing opaque IDs/provider-session generation remain
intact. Module extraction is permitted for a private helper, not an alternative channel or
new service. The proposed helper paths below may be kept small and internal.

## Prerequisites and execution rules

- Accepted stories, clean conflict report, and approved D21–D26 are the authority. Their
  required historical-artifact corrections are already in DECIDE; no task edits a sealed
  artifact from another feature.
- Existing dependencies suffice. SDK serializer tests use the installed supported versions;
  no package upgrade or live collector is required.
- Every task uses RED → scoped GREEN → commit. Run affected tests through
  `ai-conductor scoped-run <selectors...>`; test-suite owns aggregate evidence. Do not run
  a full conductor workflow for a helper, startup, event consumer, or serializer assertion.
- The named test file plus its required observable checks is each mapped criterion's
  lowest-sufficient coverage disposition. Default tests fake all remote/provider/GitHub
  boundaries, inject clocks, and await/clean up owned temporary files, readers and timers.
- Proposed helpers and tests are implementation targets, not claims they exist already.
  Existing production seams were read during architecture and plan authoring.

## Tasks

### Task 1: Centralize atomic feature identity creation

**Story:** Story 1 (S1.1, S1.2)
**Type:** happy-path
**Dependencies:** none
**Files:** `src/conductor/src/engine/feature-identity.ts`, `src/conductor/src/engine/otel/resource.ts`, `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/engine/feature-identity.test.ts`, `src/conductor/test/engine/otel/resource.test.ts`

**Steps:**
1. Write the focused failing behavioral fixture described by the Done-when checks using the listed test seam; inject clocks and failing adapters where the scenario requires them.
2. Establish scoped RED before changing implementation.
3. Extract the existing conduct-session-id persistence into a shared bootstrap helper with stable/unavailable results. Publish a fully written same-directory temporary identity with an exclusive hard-link to the canonical path, then remove only that owned temporary path in finally; on EEXIST read the winning canonical value. This avoids exposing an empty canonical file between open and write, never overwrites a winner, and introduces no persistent sidecar. Keep buildResource synchronous and nonthrowing via a synchronous local helper; the async StepRunner caller can use the same helper. Preserve its existing ensure-directory and mid-run-loss diagnostics; do not replace this.sessionId or verdict/provider IDs. Existing nonempty trimmed opaque IDs remain supported.
4. Run scoped GREEN for the changed behavior and its named regression cases, then commit this task.

**Done when:**
- feature-identity.test.ts races two creators in one temporary pipeline directory and asserts one persisted winner returned to both; resource.test.ts and the StepRunner persistence seam reuse that same winner without replacing an existing nonempty opaque identity or its file bytes.
- After repeated resource construction and simulated step startup, the shared helper preserves the durable feature ID and file bytes; injected provider/session generators still yield fresh independent provider IDs and no retry or rotation writes them to conduct-session-id.

### Task 2: Preserve identity failures without repairing uncertain state

**Story:** Story 1 (S1.3)
**Type:** negative-path
**Dependencies:** 1
**Files:** `src/conductor/src/engine/feature-identity.ts`, `src/conductor/src/engine/otel/resource.ts`, `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/engine/feature-identity.test.ts`

**Steps:**
1. Write the focused failing behavioral fixture described by the Done-when checks using the listed test seam; inject clocks and failing adapters where the scenario requires them.
2. Establish scoped RED before changing implementation.
3. Represent missing-parent creation, existing empty/whitespace-only or invalid bounded data, read denial, and exclusive-write denial as distinct helper outcomes. Do not overwrite a present invalid value. Catch at telemetry bootstrap/resource fallback, retain an isolated transient identity and a bounded warning; keep StepRunner existing bookkeeping recovery and error semantics. Use injected filesystem failures rather than chmod assumptions under privileged test users.
4. Run scoped GREEN for the changed behavior and its named regression cases, then commit this task.

**Done when:**
- feature-identity.test.ts injects empty, whitespace-only, invalid, read-denied and create-denied cases and asserts existing file bytes are untouched, stable resolution is unavailable, telemetry returns an isolated transient identity with a bounded diagnostic, and no recovered-link eligibility is granted.
- StepRunner persistence-seam tests assert helper failure preserves its existing ensure-directory, mid-run-loss warning and error handling; telemetry catching the same failure cannot change the runner result or provider-session identity.

### Task 3: Declare segment events and exhaustive sink routing

**Story:** Story 8 (S8.1, S8.4)
**Type:** infrastructure
**Dependencies:** none
**Files:** `src/conductor/src/types/events.ts`, `src/conductor/src/engine/event-sinks.ts`, `src/conductor/src/engine/otel/metrics-listener.ts`, `src/conductor/src/engine/otel/otel-visualizer.ts`, `src/conductor/test/engine/event-sinks.test.ts`, `src/conductor/test/engine/event-persister.test.ts`

**Steps:**
1. Write the focused failing behavioral fixture described by the Done-when checks using the listed test seam; inject clocks and failing adapters where the scenario requires them.
2. Establish scoped RED before changing implementation.
3. Add versioned bounded trace_segment_opened, trace_segment_ended and trace_segment_rotate variants from D23, with closed continuity/reason unions and standard context fields. Derive subscriptions from EVENT_SINKS; opened/ended persist only; rotate persists and reaches trace handling, with a deliberate metrics no-op. Add a typed handler slot for rotation, completed by task 11. Exercise the real emitter and EventPersister against a temporary ledger; no new writer or channel.
4. Run scoped GREEN for the changed behavior and its named regression cases, then commit this task.

**Done when:**
- An emitter/EventPersister integration capture round-trips opened, ended and rotate in events.jsonl with version, scope, dispatch/index/context and exact boundary reasons; rotation is not a step/feature terminal, and unrelated legacy event decoding is unchanged.
- EVENT_SINKS tests assert opened/ended={persist:true,render:false,audit:false,otel:false}, rotate={persist:true,render:false,audit:false,otel:true}; registry-derived subscription and exhaustive trace/metric tables accept all three, and segment events produce no metric records or recursive trace effects.

### Task 4: Recover the latest valid predecessor through the shared decoder

**Story:** Story 2 (S2.2)
**Type:** happy-path
**Dependencies:** 3
**Files:** `src/conductor/src/engine/report-renderer.ts`, `src/conductor/src/engine/otel/trace-recovery.ts`, `src/conductor/test/engine/otel/trace-recovery.test.ts`, `src/conductor/test/engine/report-renderer.test.ts`

**Steps:**
1. Write the focused failing behavioral fixture described by the Done-when checks using the listed test seam; inject clocks and failing adapters where the scenario requires them.
2. Establish scoped RED before changing implementation.
3. Reuse/extract parseEvents line decoding without changing tolerant report behavior. Add a typed segment-record decoder; observe standard nonzero hex span-context IDs, flags and SDK tracestate parsing. Scan an initial file-size snapshot incrementally, retaining only latest same-scope candidate plus matching end marker. Valid opened without ended remains a predecessor with unknown end; missing history is first. Never re-export spans or edit ledger bytes.
4. Run scoped GREEN for the changed behavior and its named regression cases, then commit this task.

**Done when:**
- trace-recovery.test.ts reads real temporary event ledgers through the shared decoder and returns the latest valid same-scope predecessor; an opened record without matching ended links with unknown predecessor end, whereas absent history reports first continuity.
- The recovery snapshot excludes records appended after its captured size and keeps only one candidate/end state; input ledger bytes and historic timestamps remain unchanged, old spans are never re-exported, and report-renderer legacy fixtures retain their prior parsed results.

### Task 5: Refuse unsafe or unbounded recovery

**Story:** Story 1 (S1.4)
**Story:** Story 2 (S2.3, S2.4)
**Type:** negative-path
**Dependencies:** 4
**Files:** `src/conductor/src/engine/otel/trace-recovery.ts`, `src/conductor/test/engine/otel/trace-recovery.test.ts`

**Steps:**
1. Write the focused failing behavioral fixture described by the Done-when checks using the listed test seam; inject clocks and failing adapters where the scenario requires them.
2. Establish scoped RED before changing implementation.
3. Validate bounded record fields and exact canonical repository, worktree, feature label, branch and persisted run ID before accepting links. Use incremental chunks with a 256 KiB line buffer and a five-second injected-clock budget; abort pending reads and close the handle. Distinguish absent from corrupt/truncated relevant history, unsupported versions, zero/malformed IDs, scope mismatch and I/O failure. Ordinary legacy records stay tolerant; an invalid relevant tail must not silently resurrect an older clean end.
4. Run scoped GREEN for the changed behavior and its named regression cases, then commit this task.

**Done when:**
- trace-recovery.test.ts varies repository, branch, worktree, feature label and feature generation independently and also omits each scope field; every case returns unavailable with no recovered link, never joins by matching name alone, and never relabels historic data.
- Corrupt JSON relevant to recovery, a truncated relevant tail, unsupported version, invalid/nonzero-ID or flags violations, and mismatched context yield unavailable continuity and an isolated next segment, without inventing a predecessor or a clean stop.
- Injected reads exceeding five seconds, an unreadable ledger, and a line exceeding 256 KiB produce bounded diagnostics, unavailable continuity and no recovered link without blocking feature execution; cancellation prevents further reads and closes the handle with bounded retained memory.

### Task 6: Represent logical executions under per-segment step groups

**Story:** Story 4 (S4.1, S4.2)
**Type:** happy-path
**Dependencies:** none
**Files:** `src/conductor/src/engine/otel/span-manager.ts`, `src/conductor/test/engine/otel/span-manager.test.ts`

**Steps:**
1. Write the focused failing behavioral fixture described by the Done-when checks using the listed test seam; inject clocks and failing adapters where the scenario requires them.
2. Establish scoped RED before changing implementation.
3. Reuse resolveExecutionIdentity and its subject escaping; split logical execution state from the current SDK span handle. Maintain one group per resolved logical subject per segment, with role/step attributes and bounded operation names. Explicit executions remain independently keyed, so repeated and overlapping work preserves times/outcomes. Retain existing lifecycle labels; do not create a service per step or cast configured names to StepName.
4. Run scoped GREEN for the changed behavior and its named regression cases, then commit this task.

**Done when:**
- SpanManager SDK-capture tests assert repeated executions within a segment have distinct execution IDs, individual start/end times and outcomes beneath one step-group parent that is itself parented under the current segment root; a later segment retains the same logical-step identity.
- Interleaved configured members with identical names under different parents export distinct groups/executions using resolver subjects; timestamps preserve concurrent overlap and never serialize sibling work or combine their metadata.

### Task 7: Keep retries, re-runs and ambiguous legacy events distinct

**Story:** Story 4 (S4.3, S4.4)
**Type:** negative-path
**Dependencies:** 6, 8, 9
**Files:** `src/conductor/src/engine/otel/span-manager.ts`, `src/conductor/test/engine/otel/span-manager.test.ts`, `src/conductor/test/engine/execution-identity.test.ts`

**Steps:**
1. Write the focused failing behavioral fixture described by the Done-when checks using the listed test seam; inject clocks and failing adapters where the scenario requires them.
2. Establish scoped RED before changing implementation.
3. Use explicit execution IDs where present; generate a dispatch-scoped legacy per-start ID otherwise, retaining the existing pairing/ambiguity refusal. Carry retry counts and events on the same logical state; later re-runs create new IDs. Preserve scoped late-terminal suppression without retaining completed SDK spans or full historical ancestor lists.
4. Run scoped GREEN for the changed behavior and its named regression cases, then commit this task.

**Done when:**
- SpanManager tests drive a policy retry, a rotation and a later re-run: retry increments the original execution retry data, rotation changes only slice identity, and the re-run gets a distinct execution ID that grouping never merges with the original.
- Ambiguous context-free events, malformed explicit context, and late terminals for an earlier re-run retain the existing resolver refusal and cannot close or borrow provider/usage metadata from another execution or feature.

### Task 8: Create fresh linked segment roots and scoped continuations

**Story:** Story 3 (S3.2)
**Type:** happy-path
**Dependencies:** 6
**Files:** `src/conductor/src/engine/otel/span-manager.ts`, `src/conductor/test/engine/otel/span-manager.test.ts`

**Steps:**
1. Write the focused failing behavioral fixture described by the Done-when checks using the listed test seam; inject clocks and failing adapters where the scenario requires them.
2. Establish scoped RED before changing implementation.
3. Add start/rotate segment primitives using explicit ROOT_CONTEXT and fresh SDK trace IDs. Root name remains conductor.run with role=segment; maintain dispatch ID and segment index as trace attributes only. Each new root links at creation to at most its immediate predecessor; each continuation links to the last work slice. Close all group handles on segment close and release them. Do not reuse forceCloseAll for rotation.
4. Run scoped GREEN for the changed behavior and its named regression cases, then commit this task.

**Done when:**
- Repeated SpanManager rotation under many active subjects creates fresh parentless trace IDs with one immediate predecessor-root link and one preceding-slice link per continuation; operation names remain bounded across rotations and contain no dispatch UUID or segment index.
- Each segment releases its closed groups and handles and retains only active/awaiting logical state plus predecessor context; closure overhead is the number of active executions/groups rather than historical span or ancestor accumulation.

### Task 9: Rotate active work without an engine terminal

**Story:** Story 3 (S3.1)
**Story:** Story 5 (S5.4)
**Type:** happy-path
**Dependencies:** 6, 8
**Files:** `src/conductor/src/engine/otel/span-manager.ts`, `src/conductor/test/engine/otel/span-manager.test.ts`

**Steps:**
1. Write the focused failing behavioral fixture described by the Done-when checks using the listed test seam; inject clocks and failing adapters where the scenario requires them.
2. Establish scoped RED before changing implementation.
3. End running slices at the segment cutoff with continued and UNSET, then open continuations with incremented slice index while preserving logical identity/start, retries and provider facts. Suppress ordinary onStepClose/onRunClose callbacks during rotation. Copy no usage/terminal fields to nonterminal slices. The lifecycle tasks invoke this primitive at the approved time/count boundaries.
4. Run scoped GREEN for the changed behavior and its named regression cases, then commit this task.

**Done when:**
- At a time/count rotation request SpanManager closes the segment children/root and exposes a fresh linked segment; active executions keep their ID, increment slice index and continue with UNSET/continued, without terminal markers, engine completion events or close callbacks.
- For an active execution, SpanManager fixtures cover an exporter error both with and without rotation, plus ordinary segment closure with a successful exporter; in every case continued work slices retain UNSET/nonterminal status, are neither success nor failure, add no usage observations of any kind, and projection continues without changing the engine result.

### Task 10: Project authoritative terminal facts exactly once

**Story:** Story 5 (S5.1, S5.3)
**Type:** happy-path
**Dependencies:** 7, 9
**Files:** `src/conductor/src/engine/otel/span-manager.ts`, `src/conductor/test/engine/otel/span-manager.test.ts`

**Steps:**
1. Write the focused failing behavioral fixture described by the Done-when checks using the listed test seam; inject clocks and failing adapters where the scenario requires them.
2. Establish scoped RED before changing implementation.
3. Route done/failed/refused/interrupted through one logical-execution terminal transition preserving existing status semantics. Set execution.terminal once on the final running slice, with terminal usage only there. Preserve original work start and provider/fallback/retry context across rotation; delete completed logical state while preserving existing late-terminal suppression. Missing usage stays absent.
4. Run scoped GREEN for the changed behavior and its named regression cases, then commit this task.

**Done when:**
- SpanManager SDK captures of retry/fallback work across several segments keep execution identity, original work start and applicable provider/retry context on its slices; exactly one span carries conductor.execution.terminal=true and terminal usage facts, with no usage copied onto nonterminal slices.
- Duplicate or late terminal events after closure emit no second terminal-bearing span, do not transfer usage/provider facts to a later execution, and leave absent usage absent; successful, failed, refused and interrupted terminals retain their existing distinct status meaning.

### Task 11: Own one fixed deadline timer for each live segment

**Story:** Story 3 (S3.1)
**Story:** Story 7 (S7.1)
**Type:** happy-path
**Dependencies:** 3, 9
**Files:** `src/conductor/src/engine/otel/otel-visualizer.ts`, `src/conductor/src/engine/otel/span-manager.ts`, `src/conductor/test/engine/otel/otel-visualizer.test.ts`

**Steps:**
1. Write the focused failing behavioral fixture described by the Done-when checks using the listed test seam; inject clocks and failing adapters where the scenario requires them.
2. Establish scoped RED before changing implementation.
3. Add one unref deadline timer in the visualizer lifecycle with injected clocks and expected-segment token. Default 3,600,000 ms, injectable only in tests. Check expiry before each projected event and on timer callback; neither progress nor any event extends the deadline. Publish a canonical rotation request outside ordinary handlers and serialize projection. Schedule bounded forceFlush asynchronously through the existing provider; no additional SDK provider per segment.
4. Run scoped GREEN for the changed behavior and its named regression cases, then commit this task.

**Done when:**
- OtelVisualizer controlled-clock tests show the one-hour deadline is fixed despite intervening events, and both timer-driven and event-driven expiry close old slices/groups/root at that boundary and open linked continuations at the same instant with nonnegative durations.
- Before engine completion, the capture contains ended SDK spans from rotation while ongoing work retains execution identity and incremented slices; no engine terminal/callback or metric increment occurs, and forceFlush never awaits network on the engine-event path or constructs another provider.

### Task 12: Bound count rotation and serialize idle and boundary races

**Story:** Story 3 (S3.1, S3.2, S3.3, S3.4)
**Type:** negative-path
**Dependencies:** 10, 11
**Files:** `src/conductor/src/engine/otel/span-manager.ts`, `src/conductor/src/engine/otel/otel-visualizer.ts`, `src/conductor/test/engine/otel/span-manager.test.ts`, `src/conductor/test/engine/otel/otel-visualizer.test.ts`

**Steps:**
1. Write the focused failing behavioral fixture described by the Done-when checks using the listed test seam; inject clocks and failing adapters where the scenario requires them.
2. Establish scoped RED before changing implementation.
3. Count only completion-driven slices/outcome records toward 1,024. Transition once at the earlier count/deadline boundary; carry-over closures do not count recursively. Serialize terminal-versus-rotate and ignore stale segment tokens. Keep no-work startup lazy; when an active segment reaches a close boundary with no running work, retain predecessor/awaiting state but open nothing until trace-bearing activity. Use normal boundary reason for the triggering boundary; do not invent an idle engine outcome.
4. Run scoped GREEN for the changed behavior and its named regression cases, then commit this task.

**Done when:**
- At 1,024 completed slices/outcomes or one hour, whichever is first, the visualizer invokes one rotation, closes the segment and exposes fresh linked continuations with unchanged execution IDs, incremented slice indices and no execution-terminal marker/outcome or engine completion event; final size is threshold plus active execution/group closure overhead, not recursive count rotations.
- Same-instant terminal/rotation, duplicate triggers and callbacks for a closed expected segment end each slice once and produce at most one authoritative execution terminal; every fresh root retains only one immediate predecessor link.
- No-work startup and hours after an active segment closes idle produce no empty hourly traces; awaiting classification produces no work continuations, and later trace-bearing activity resumes linked history.

### Task 13: End member work at its observed settlement

**Story:** Story 6 (S6.1)
**Type:** happy-path
**Dependencies:** 10
**Files:** `src/conductor/src/engine/otel/span-manager.ts`, `src/conductor/test/engine/otel/span-manager.test.ts`

**Steps:**
1. Write the focused failing behavioral fixture described by the Done-when checks using the listed test seam; inject clocks and failing adapters where the scenario requires them.
2. Establish scoped RED before changing implementation.
3. At group_member_step phase=result freeze the existing observed work end and end its active slice with awaiting-outcome; keep pending classification as logical state without an open work handle. Reuse current member settlement observation, not sibling join time or provider-reported duration. Rotation must skip continuation creation for awaiting members.
4. Run scoped GREEN for the changed behavior and its named regression cases, then commit this task.

**Done when:**
- A SpanManager fixture with unequal admitted members ends the fast member work slice at its actual result timestamp as awaiting-outcome, excluding queue, sibling and group-join time.
- Advancing multiple segment deadlines while that member awaits classification produces no further work slices for it; measured start/end remain frozen while running siblings may continue.

### Task 14: Emit a late outcome linked to settled work

**Story:** Story 6 (S6.2)
**Type:** happy-path
**Dependencies:** 12, 13
**Files:** `src/conductor/src/engine/otel/span-manager.ts`, `src/conductor/test/engine/otel/span-manager.test.ts`

**Steps:**
1. Write the focused failing behavioral fixture described by the Done-when checks using the listed test seam; inject clocks and failing adapters where the scenario requires them.
2. Establish scoped RED before changing implementation.
3. For a real terminal on awaiting-outcome state, create a zero-duration execution-outcome at actual classification time under the current segment subject group. Link it to the last work slice; carry original measured interval, terminal outcome, retries and usage once. Lazily open a linked segment if idle. Do not backdate the span to work start or mutate an ended SDK span.
4. Run scoped GREEN for the changed behavior and its named regression cases, then commit this task.

**Done when:**
- After a controlled multi-day classification delay across several boundaries, SpanManager emits one zero-duration outcome at the real classification timestamp under the current segment group, linked to the last work slice with original measured work interval, final outcome, retry and usage facts exactly once.
- The captured original work span is byte-identical before and after classification; an idle classification opens only the necessary bounded segment/group/outcome, and the zero-duration record does not claim zero work or add a new logical execution.

### Task 15: Deduplicate settlement and interrupt pending classification truthfully

**Story:** Story 6 (S6.3, S6.4)
**Type:** negative-path
**Dependencies:** 14
**Files:** `src/conductor/src/engine/otel/span-manager.ts`, `src/conductor/test/engine/otel/span-manager.test.ts`

**Steps:**
1. Write the focused failing behavioral fixture described by the Done-when checks using the listed test seam; inject clocks and failing adapters where the scenario requires them.
2. Establish scoped RED before changing implementation.
3. Use the logical state transition to accept the first settlement and first authoritative terminal only. On catchable stop/halt with awaiting outcomes, preserve work interval and apply existing interrupted/incomplete terminal semantics to the classification record. This projects cleanup; it does not emit engine completion or satisfy a gate.
4. Run scoped GREEN for the changed behavior and its named regression cases, then commit this task.

**Done when:**
- Duplicate settlement/classification events leave the first measured settlement end unchanged, do not rewrite the ended SDK span, and emit no second terminal record.
- Shutdown/interruption while classification is pending preserves the original measured work interval and marks it interrupted/incomplete; captures contain no successful outcome, fake waiting work, backdated multi-day span or synthetic gate completion.

### Task 16: Represent scheduling gaps and clock rollback explicitly

**Story:** Story 7 (S7.2, S7.3, S7.4)
**Type:** negative-path
**Dependencies:** 11, 12
**Files:** `src/conductor/src/engine/otel/otel-visualizer.ts`, `src/conductor/src/engine/otel/span-manager.ts`, `src/conductor/src/execution/observed-interval.ts`, `src/conductor/test/engine/otel/otel-visualizer.test.ts`

**Steps:**
1. Write the focused failing behavioral fixture described by the Done-when checks using the listed test seam; inject clocks and failing adapters where the scenario requires them.
2. Establish scoped RED before changing implementation.
3. Reuse epochAnchoredMonotonicClock for interval math and inject wall-clock observations for discontinuity detection. On missed deadlines after a scheduling gap, close at the established projection cutoff, mark clock-gap/unobserved interval, and resume one segment at real observation time. Preserve separate actual engine interval evidence; never fast-forward timestamps or synthesize each missed hour. Rollback yields a bounded diagnostic and nonnegative projections.
4. Run scoped GREEN for the changed behavior and its named regression cases, then commit this task.

**Done when:**
- A controlled multi-hour scheduling-gap fixture closes the old segment at its established cutoff, records the unobserved interval, opens exactly one segment at actual resumed observation time, and preserves actual engine-duration evidence separately.
- Injected wall-clock rollback/discontinuity emits an explicit diagnostic and no negative intervals or invented timestamp ordering; normal timely rotations remain contiguous.
- A delayed/erroring fake transport receives original old timestamps after suspension with no synthetic missed-hour traces; engine event progress is independent of delivery and no local result certifies backend ingestion.

### Task 17: Close dispatch outcomes and children in causal order

**Story:** Story 9 (S9.1)
**Type:** happy-path
**Dependencies:** 12, 15
**Files:** `src/conductor/src/engine/otel/span-manager.ts`, `src/conductor/test/engine/otel/span-manager.test.ts`

**Steps:**
1. Write the focused failing behavioral fixture described by the Done-when checks using the listed test seam; inject clocks and failing adapters where the scenario requires them.
2. Establish scoped RED before changing implementation.
3. Centralize first dispatch terminal state independently from segment close state. Only dispatch-ending root receives complete/halted/terminated; rotated roots retain boundary reasons. Close active and awaiting children before groups/root using existing status semantics. A never-started dispatch remains no-work; a previously active idle dispatch may create a short final segment so its outcome is emitted without rewriting a closed root.
4. Run scoped GREEN for the changed behavior and its named regression cases, then commit this task.

**Done when:**
- SpanManager captures of complete, halt and graceful termination after multiple segments show conductor.run.outcome only on the dispatch-ending segment, intermediate boundary reasons without run outcomes, and every open child ended before its parent.
- Halt/termination marks remaining active or awaiting work interrupted/incomplete instead of success; an idle-but-previously-active dispatch emits its final bounded outcome segment, whereas a never-started dispatch creates no span.

### Task 18: Make stop and terminal races bounded and idempotent

**Story:** Story 9 (S9.2, S9.3, S9.4)
**Type:** negative-path
**Dependencies:** 17
**Files:** `src/conductor/src/engine/otel/otel-visualizer.ts`, `src/conductor/src/engine/otel/span-manager.ts`, `src/conductor/test/engine/otel/otel-visualizer.test.ts`

**Steps:**
1. Write the focused failing behavioral fixture described by the Done-when checks using the listed test seam; inject clocks and failing adapters where the scenario requires them.
2. Establish scoped RED before changing implementation.
3. Reuse the existing stop promise, cancellation and bounded shutdown seam; stop new projection, close exactly once, cancel the unref timer and release handlers/resources. Keep publication drain hook for task 20 before persistence detaches. Inject abrupt-loss tests by discarding an instance rather than killing an operator process. Never recover logical success from the presence of an opened context.
4. Run scoped GREEN for the changed behavior and its named regression cases, then commit this task.

**Done when:**
- Repeated OtelVisualizer.stop calls after work share one stop promise, close spans once, drain pending publications within the shutdown bound and release timers, subscriptions and exporter lifecycle resources exactly once.
- Completion racing with late halt, duplicate stop or a queued deadline callback preserves the first authoritative terminal; no callback opens or mutates a stopped trace.
- A recreated lifecycle after simulated abrupt loss of an unexported slice reports incomplete/unknown evidence without synthetic success; previously ended spans are not replayed, and losing an unpublished context is not mistaken for backend delivery.

### Task 19: Publish segment context through the canonical bus

**Story:** Story 8 (S8.1, S8.2)
**Type:** happy-path
**Dependencies:** 3, 12, 17
**Files:** `src/conductor/src/engine/otel/create-otel-visualizer.ts`, `src/conductor/src/engine/otel/otel-visualizer.ts`, `src/conductor/src/engine/otel/span-manager.ts`, `src/conductor/test/engine/otel/otel-visualizer.test.ts`, `src/conductor/test/engine/event-persister-wiring.test.ts`

**Steps:**
1. Write the focused failing behavioral fixture described by the Done-when checks using the listed test seam; inject clocks and failing adapters where the scenario requires them.
2. Establish scoped RED before changing implementation.
3. Follow the factory renderer_error injection pattern for opened/ended/rotate publication callbacks. Queue outside ordinary engine-event handlers; serialize at the lifecycle owner using emitOrThrow and an owned failure catch. Queue opened immediately after root context creation before advertising child recovery. Reuse EventPersister as sole file writer. Add a bounded drain hook usable at prepared startup and stop.
4. Run scoped GREEN for the changed behavior and its named regression cases, then commit this task.

**Done when:**
- The production factory, real emitter and EventPersister fixture capture versioned validated segment opened/rotate/ended records with scope/context and accurate closed reasons in events.jsonl; no alternate correlation file or engine terminal is emitted.
- Publication integration asserts opened precedes any advertised recoverable child context, opened/ended preserve causal order, and bootstrap/graceful-stop drains complete while the persister is attached; ordinary projection awaits neither ledger nor network I/O.
- Opened/ended publication never re-enters projection or MetricsListener, rotate has one explicit trace handler and a metrics no-op, and handling a rotation never recursively publishes another request.

### Task 20: Isolate publication rejection and bounded drain failure

**Story:** Story 8 (S8.3, S8.4)
**Type:** negative-path
**Dependencies:** 5, 18, 19
**Files:** `src/conductor/src/engine/otel/create-otel-visualizer.ts`, `src/conductor/src/engine/otel/otel-visualizer.ts`, `src/conductor/test/engine/otel/otel-visualizer.test.ts`, `src/conductor/test/engine/event-persister-wiring.test.ts`

**Steps:**
1. Write the focused failing behavioral fixture described by the Done-when checks using the listed test seam; inject clocks and failing adapters where the scenario requires them.
2. Establish scoped RED before changing implementation.
3. Catch actual emitOrThrow rejection at the lifecycle boundary; warn once and mark context non-durable without failing engine events. Bound bootstrap/stop drains with the existing lifecycle timeout policy, clear outstanding scheduled work, and prohibit post-stop publication. On recovery use only records actually in the ledger; an earlier durable predecessor may be reused but no unpublished context or clean-end claim is invented.
4. Run scoped GREEN for the changed behavior and its named regression cases, then commit this task.

**Done when:**
- Injected EventPersistError/disk/permission rejection and simulated death before queued publication yield bounded diagnostics, no claim that the unpublished context was recoverable, and no fabricated clean end; restart can use only an earlier actually durable candidate or unavailable continuity.
- Malformed correlation fields cannot become recovered links; rejection or hanging publication during shutdown remains within the lifecycle bound, all timer/handler/read resources are cleaned up, and no exception escapes into feature execution or prevents cleanup.
- The emitter/persister integration observes no post-stop publication or recursive segment/metric effects after a failed drain; feature result and already persisted ledger records remain unchanged.

### Task 21: Prepare enabled OTel context before resource construction

**Story:** Story 1 (S1.1, S1.2)
**Story:** Story 10 (S10.3)
**Type:** infrastructure
**Dependencies:** 1, 2, 5, 20
**Files:** `src/conductor/src/engine/otel/wire.ts`, `src/conductor/src/engine/otel/create-otel-visualizer.ts`, `src/conductor/src/engine/otel/otel-visualizer.ts`, `src/conductor/src/engine/plugin-loader.ts`, `src/conductor/test/otel-wire.test.ts`, `src/conductor/test/engine/otel/resource.test.ts`

**Steps:**
1. Write the focused failing behavioral fixture described by the Done-when checks using the listed test seam; inject clocks and failing adapters where the scenario requires them.
2. Establish scoped RED before changing implementation.
3. Add OTel-private async preparation in shared wire.ts: first check resolveOtelConfig, then resolve stable feature identity and canonical main root via resolveMainRepoRootStrict, then bounded recovery. Retain discriminated unavailable scope instead of treating resolver fallback as canonical identity. Allocate fresh conductor.dispatch.id per tracing lifetime and index zero; pass prepared state through only the built-in factory closure/context, leaving VisualizerPlugin.start synchronous. Do not put high-cardinality IDs on Resources or metric points.
4. Run scoped GREEN for the changed behavior and its named regression cases, then commit this task.

**Done when:**
- wire.ts preparation fixtures start enabled telemetry before any step and assert its resource and later StepRunner startup use the same atomically persisted feature identity, including a racing creator; only a fully resolved same-scope context enables recovery.
- Restart/rotation fixtures preserve nonempty opaque feature ID and original file bytes, allocate a fresh conductor.dispatch.id only for a new tracing lifecycle with index zero, and leave fresh provider-session generation unchanged.
- A disabled resolveOtelConfig result returns before identity creation, recovery reads/writes, timers or exporters; built-in factory preparation adds no required method or asynchronous start contract to unrelated VisualizerPlugin implementations.

### Task 22: Connect interactive startup and shutdown to prepared tracing

**Story:** Story 8 (S8.2)
**Story:** Story 10 (S10.1, S10.3, S10.4)
**Type:** happy-path
**Dependencies:** 21
**Files:** `src/conductor/src/index.ts`, `src/conductor/src/engine/otel/wire.ts`, `src/conductor/test/interactive-otel-wiring.test.ts`, `src/conductor/test/integration/otel-disabled-noop.test.ts`

**Steps:**
1. Write the focused failing behavioral fixture described by the Done-when checks using the listed test seam; inject clocks and failing adapters where the scenario requires them.
2. Establish scoped RED before changing implementation.
3. Integrate async preparation at the interactive composition root before registry-based built-in start; preserve buildInteractiveVisualizers selection and other plugin contracts. Keep EventPersister attached through publication drain and bounded OTel stop. Use actual entrypoint composition with injected provider/exporter boundaries and real SDK serialization, not a whole Conductor.run. This task owns interactive boundary proof only.
4. Run scoped GREEN for the changed behavior and its named regression cases, then commit this task.

**Done when:**
- Actual interactive startup/event/shutdown integration through the registry factory and real SDK decodes supported OTLP/file captures with standard parents and span links, stable feature/step attributes, dispatch filtering, and distinct segment/slice/outcome roles without any vendor-specific component.
- Disabled interactive OTel produces no trace-owned identity creation, correlation reads/writes, timer or exporter activity, while normal engine-owned persistence is unaffected and independently configured visualizer plugins retain their start/stop contract.
- Failing/unavailable exporters leave interactive feature results unchanged and cleanup bounded; correlated ledger persistence is not asserted as export acceptance, unrelated plugins need no lifecycle changes, and successful startup/stop drains preserve causal publication order while EventPersister remains attached.

### Task 23: Connect daemon dispatches and restart recovery to prepared tracing

**Story:** Story 2 (S2.1)
**Story:** Story 5 (S5.2)
**Story:** Story 8 (S8.2)
**Story:** Story 10 (S10.1, S10.3, S10.4)
**Type:** happy-path
**Dependencies:** 21
**Files:** `src/conductor/src/daemon-cli.ts`, `src/conductor/src/engine/otel/wire.ts`, `src/conductor/test/daemon-otel-wiring.test.ts`, `src/conductor/test/engine/otel-visualizer-parity.test.ts`

**Steps:**
1. Write the focused failing behavioral fixture described by the Done-when checks using the listed test seam; inject clocks and failing adapters where the scenario requires them.
2. Establish scoped RED before changing implementation.
3. In beginFeatureRun, keep fresh provider sessionId and startFeatureEventPersistence, prepare OTel before start, then drain while persistence remains attached at stop. Reuse daemon-owned MetricsListener/meter: per-dispatch tracing never creates another meter or stops the daemon spool drainer. This task owns daemon boundary and 72-hour restart integration; recreate actual tracing lifecycles over temporary ledgers using fake clocks and remote adapters, not a full multi-day build. Drive the same engine-event fixture through metrics/timing rollup with and without segmentation. Existing daemon-otel-wiring mocks wireOtelVisualizer; the new boundary fixture must restore the actual shared wiring/factory and fake only remote/process adapters so a mocked wire function cannot satisfy the proof.
4. Run scoped GREEN for the changed behavior and its named regression cases, then commit this task.

**Done when:**
- A controlled-clock 72-hour daemon-wiring fixture with several stop/restart lifecycles and a multi-hour execution captures distinct bounded traces retaining one feature identity, fresh dispatch IDs and per-dispatch segment indices, with each successor linked to its immediate valid predecessor and no replay of old spans.
- Actual daemon dispatch startup/event/stop through the shared registry factory and real SDK decodes supported OTLP/file captures with standard parentage/links, stable feature/step attributes, dispatch filtering and segment/slice/outcome roles, matching the interactive contract without a vendor-specific component.
- Identical engine events through real SpanManager, MetricsListener and timing-rollup with and without rotation yield equal duration, attempt, retry, usage and elapsed-union totals; new dispatch/segment/execution identifiers are absent from metric resources and data-point labels, and existing metric resources/instruments stay unchanged.
- Disabled daemon OTel creates no trace identity, correlation reads/writes, timers or exporter activity while engine persistence remains unaffected; failing/unavailable exporters do not change feature results, teardown stays bounded, ledger durability is never claimed as export acceptance, and unrelated plugin contracts remain unchanged.
- beginFeatureRun stop awaits ordered publication drain with EventPersister attached before detaching it, preserves fresh provider-session generation, flushes the existing daemon meter without shutting it down and leaves any process-owned export-spool drainer running.

### Task 24: Preserve direct-factory and transport compatibility

**Story:** Story 7 (S7.4)
**Story:** Story 10 (S10.2, S10.4)
**Type:** negative-path
**Dependencies:** 21
**Files:** `src/conductor/src/engine/otel/create-otel-visualizer.ts`, `src/conductor/src/engine/otel/otel-visualizer.ts`, `src/conductor/src/engine/otel/transport.ts`, `src/conductor/test/integration/otel-exporter.test.ts`, `src/conductor/test/engine/otel/transport.test.ts`

**Steps:**
1. Write the focused failing behavioral fixture described by the Done-when checks using the listed test seam; inject clocks and failing adapters where the scenario requires them.
2. Establish scoped RED before changing implementation.
3. Complete the built-in factory fallback for direct callers lacking prepared/recoverable scope: create an explicitly isolated in-process lifecycle using the same bounded projection. Exercise actual OTLP HTTP/protobuf, gRPC serializer boundary and file exporter with fake remote adapters; keep current headers, transports and SpanExporter interface. Compose with existing spool when supplied, never a new delivery queue, retry policy or age filter. Preserve constructor and export failure isolation. Named smoke tests remain opt-in; local captures prove protocol, not live Datadog/Tempo indexing.
4. Run scoped GREEN for the changed behavior and its named regression cases, then commit this task.

**Done when:**
- A direct createOtelVisualizer caller without recoverable scope emits bounded grouped in-process traces with predecessor/continuation links and explicitly isolated continuity, while the existing synchronous VisualizerPlugin.start contract remains usable.
- Real SDK/transport serializer fixtures decode the standard parent/link/role/identity fields over HTTP/protobuf, gRPC and file output with existing resource keys and configured headers intact; original timestamps survive an unavailable/delayed exporter and no local result certifies backend ingestion.
- Factory/transport error fixtures preserve feature results and bounded cleanup without propagating exporter errors, adding another delivery queue/age filter, equating ledger persistence with delivery, or imposing a new lifecycle requirement on other plugins.

## Task Dependency Graph

Each task's Dependencies field is authoritative. Independent starts are identity (1), event
schema/routing (3), and grouping (6). Recovery follows 3 → 4 → 5; projection follows
6 → 8 → 9 → 7/10, then timer/count and settlement branches. Publication joins schema,
rotation and terminal handling in 19/20. Shared preparation (21) joins identity, recovery
and lifecycle; interactive (22), daemon (23), and direct-factory/transport (24) own separate
production integration behavior. Overlapping Files sets still serialize their commits.
No task is a terminal whole-feature validation or unspecified repair step.

## Integration Points

| Production boundary | One owning task | Observable proof |
|---|---|---|
| Shared identity helper → existing resource/StepRunner persistence | 1 | One durable winner; existing bytes and independent provider IDs preserved |
| New event union/sinks → EventPersister and metric routing | 3 | Typed records on the existing ledger and exact sink effects |
| Existing line decoder → bounded correlation reader | 4 | Latest same-scope predecessor, unknown end/first distinction, snapshot immutability |
| Visualizer timer/event handling → projection rotation | 11 | Timed boundaries export slices without engine terminals or new providers |
| Built-in factory publication → canonical emitter/persister | 19 | Causal publication outside handlers and attached-persister drain |
| Shared OTel preparation → built-in registry factory/resource | 21 | Enabled-first preparation, stable scope and unchanged plugin contract |
| Interactive composition root → tracing lifecycle | 22 | Actual startup/events/shutdown and disabled/failure behavior |
| Daemon composition root → dispatch/restart tracing and shared metrics | 23 | 72-hour restart sequence and exact metrics/timing parity |
| Direct built-in factory and supported serialization → exporter adapter | 24 | Isolated fallback and portable encoded spans at fake transport boundary |

Negative-path tasks extend these owned boundaries with scoped fault tests; they do not
introduce duplicate broad integration fixtures. No story requires an additional whole-build
acceptance suite; writing-system-tests must honor the accepted lowest-sufficient dispositions.

## Coverage Check

All 40 criteria are diff-local: their assertions concern the changed projection and its
bounded production fixtures, not future remote state, unrelated commits, or live backend
settings. No outside-diff promise or waiver is used. Rows quote one cited task check exactly;
the independent judgement receives every Done-when check from every cited task.

| Criterion | Task id(s) | Done when quote | Disposition |
|---|---|---|---|
| Story 1 happy: Given a new feature without a persisted identity, when enabled telemetry starts before the first step, then it and later step startup use the same persisted feature identity, including when two creators race. | 21 | "wire.ts preparation fixtures start enabled telemetry before any step and assert its resource and later StepRunner startup use the same atomically persisted feature identity, including a racing creator; only a fully resolved same-scope context enables recovery." | diff-local |
| Story 1 happy: Given an existing nonempty opaque feature identity, when telemetry restarts or rotates, then it preserves that identity and file contents, assigns a fresh dispatch identity on restart, and leaves fresh provider-session generation unchanged. | 21 | "wire.ts preparation fixtures start enabled telemetry before any step and assert its resource and later StepRunner startup use the same atomically persisted feature identity, including a racing creator; only a fully resolved same-scope context enables recovery." | diff-local |
| Story 1 negative: Given an empty, unreadable, or invalid existing identity, or a denied creation, when telemetry starts, then it leaves the existing file untouched, reports bounded unavailable continuity, and cannot recover links under an uncertain identity; telemetry failure does not change step-runner failure handling. | 2 | "feature-identity.test.ts injects empty, whitespace-only, invalid, read-denied and create-denied cases and asserts existing file bytes are untouched, stable resolution is unavailable, telemetry returns an isolated transient identity with a bounded diagnostic, and no recovered-link eligibility is granted." | diff-local |
| Story 1 negative: Given a changed repository, branch, worktree, feature label, or feature generation, or missing scope, when copied history is encountered, then it cannot link to that history merely because a feature name matches; previously emitted identity is never relabeled. | 5 | "trace-recovery.test.ts varies repository, branch, worktree, feature label and feature generation independently and also omits each scope field; every case returns unavailable with no recovered link, never joins by matching name alone, and never relabels historic data." | diff-local |
| Story 2 happy: Given a feature that runs for 72 hours with several stops and restarts and an execution longer than one hour, when its locally captured telemetry is inspected, then distinct bounded traces retain one feature identity, distinguish dispatches and segment indices, and link each successor to its immediate predecessor without replaying old spans. | 23 | "A controlled-clock 72-hour daemon-wiring fixture with several stop/restart lifecycles and a multi-hour execution captures distinct bounded traces retaining one feature identity, fresh dispatch IDs and per-dispatch segment indices, with each successor linked to its immediate valid predecessor and no replay of old spans." | diff-local |
| Story 2 happy: Given a matching valid segment-open record without a persisted end record, when startup recovers it, then the next segment links to it while reporting the predecessor end as unknown; a genuinely absent history instead reports first-segment continuity. | 4 | "trace-recovery.test.ts reads real temporary event ledgers through the shared decoder and returns the latest valid same-scope predecessor; an opened record without matching ended links with unknown predecessor end, whereas absent history reports first continuity." | diff-local |
| Story 2 negative: Given missing identity scope or corrupt, truncated relevant, unsupported-version, invalid-ID, or mismatched correlation history, when startup attempts recovery, then it reports unavailable continuity and starts an isolated segment without inventing a predecessor or claiming a clean stop. | 5 | "trace-recovery.test.ts varies repository, branch, worktree, feature label and feature generation independently and also omits each scope field; every case returns unavailable with no recovered link, never joins by matching name alone, and never relabels historic data." | diff-local |
| Story 2 negative: Given an oversized line beyond 256 KiB, an unreadable ledger, or a recovery read exceeding five seconds, when recovery stops, then it releases its read resources, performs no further reads after cancellation, and lets the feature continue with bounded diagnostics and no recovered link. | 5 | "trace-recovery.test.ts varies repository, branch, worktree, feature label and feature generation independently and also omits each scope field; every case returns unavailable with no recovered link, never joins by matching name alone, and never relabels historic data." | diff-local |
| Story 3 happy: Given a responsive process with ongoing work, when a segment reaches one hour or 1,024 completed execution slices/outcome records, then it closes its spans and exposes a fresh linked segment; ongoing executions retain identity, increment slice indices, and continue without a terminal outcome or an engine completion event. | 12 | "At 1,024 completed slices/outcomes or one hour, whichever is first, the visualizer invokes one rotation, closes the segment and exposes fresh linked continuations with unchanged execution IDs, incremented slice indices and no execution-terminal marker/outcome or engine completion event; final size is threshold plus active execution/group closure overhead, not recursive count rotations." | diff-local |
| Story 3 happy: Given repeated rotation with many active subjects, when telemetry is captured, then each segment has only its immediate predecessor link, continuation slices link to their preceding slice, names remain bounded, and closure overhead is limited to the active executions/groups rather than accumulating history. | 8, 12 | "Repeated SpanManager rotation under many active subjects creates fresh parentless trace IDs with one immediate predecessor-root link and one preceding-slice link per continuation; operation names remain bounded across rotations and contain no dispatch UUID or segment index." | diff-local |
| Story 3 negative: Given a terminal event and a rotation trigger at the same boundary, or a stale/duplicate trigger, when they are processed, then each slice ends once and the execution has at most one authoritative terminal; closing carry-over slices does not trigger recursive count rotation. | 12 | "At 1,024 completed slices/outcomes or one hour, whichever is first, the visualizer invokes one rotation, closes the segment and exposes fresh linked continuations with unchanged execution IDs, incremented slice indices and no execution-terminal marker/outcome or engine completion event; final size is threshold plus active execution/group closure overhead, not recursive count rotations." | diff-local |
| Story 3 negative: Given no trace-bearing work, or a previously active segment that closes while idle, when hours pass, then no stream of empty traces appears; awaiting classification alone does not create work continuations, and future trace-bearing activity can resume linked history. | 12 | "At 1,024 completed slices/outcomes or one hour, whichever is first, the visualizer invokes one rotation, closes the segment and exposes fresh linked continuations with unchanged execution IDs, incremented slice indices and no execution-terminal marker/outcome or engine completion event; final size is threshold plus active execution/group closure overhead, not recursive count rotations." | diff-local |
| Story 4 happy: Given repeated executions of one logical step within a segment, when exported, then their individually identifiable work slices share one step-group parent under that segment and retain distinct start/end times and outcomes; later segments retain the same logical-step identity. | 6 | "SpanManager SDK-capture tests assert repeated executions within a segment have distinct execution IDs, individual start/end times and outcomes beneath one step-group parent that is itself parented under the current segment root; a later segment retains the same logical-step identity." | diff-local |
| Story 4 happy: Given concurrent configured members, including the same member name under different parents, when observations interleave, then their groups and executions stay distinct and their overlapping work intervals remain visible rather than serialized. | 6 | "SpanManager SDK-capture tests assert repeated executions within a segment have distinct execution IDs, individual start/end times and outcomes beneath one step-group parent that is itself parented under the current segment root; a later segment retains the same logical-step identity." | diff-local |
| Story 4 negative: Given a policy retry followed later by a genuine step re-run, when both are exported, then the retry retains the original execution identity and increments its retry data while the re-run gets a new identity; neither grouping nor rotation merges the two executions. | 7 | "SpanManager tests drive a policy retry, a rotation and a later re-run: retry increments the original execution retry data, rotation changes only slice identity, and the re-run gets a distinct execution ID that grouping never merges with the original." | diff-local |
| Story 4 negative: Given context-free legacy events with ambiguous attribution, malformed explicit context, or a late terminal for an older re-run, when projection occurs, then it preserves existing ambiguity refusal and cannot close or borrow metadata from a different execution. | 7 | "SpanManager tests drive a policy retry, a rotation and a later re-run: retry increments the original execution retry data, rotation changes only slice identity, and the re-run gets a distinct execution ID that grouping never merges with the original." | diff-local |
| Story 5 happy: Given an execution with retries and provider fallback spanning several segments, when it finishes, then its slices retain execution identity, original work start, and applicable provider/retry context, and exactly one span carries its terminal marker and terminal usage facts. | 10 | "SpanManager SDK captures of retry/fallback work across several segments keep execution identity, original work start and applicable provider/retry context on its slices; exactly one span carries conductor.execution.terminal=true and terminal usage facts, with no usage copied onto nonterminal slices." | diff-local |
| Story 5 happy: Given equivalent engine events with and without trace rotation, when metrics and timing rollups are compared, then duration, attempts, retries, usage, and elapsed-union totals are equal and new dispatch/segment/execution IDs appear on neither metric resources nor data-point labels. | 23 | "A controlled-clock 72-hour daemon-wiring fixture with several stop/restart lifecycles and a multi-hour execution captures distinct bounded traces retaining one feature identity, fresh dispatch IDs and per-dispatch segment indices, with each successor linked to its immediate valid predecessor and no replay of old spans." | diff-local |
| Story 5 negative: Given duplicate or late terminals after an execution has closed, when they arrive, then they neither emit another terminal-bearing span nor transfer usage/provider facts to a later execution; missing usage remains absent. | 10 | "SpanManager SDK captures of retry/fallback work across several segments keep execution identity, original work start and applicable provider/retry context on its slices; exactly one span carries conductor.execution.terminal=true and terminal usage facts, with no usage copied onto nonterminal slices." | diff-local |
| Story 5 negative: Given an exporter error or a segment ending while an execution is still active, when projection continues, then continued slices remain nonterminal with UNSET status and do not become failures, successes, or additive usage observations. | 9 | "At a time/count rotation request SpanManager closes the segment children/root and exposes a fresh linked segment; active executions keep their ID, increment slice index and continue with UNSET/continued, without terminal markers, engine completion events or close callbacks." | diff-local |
| Story 6 happy: Given a member settles before its group classifies the result, when settlement is observed, then its work slice ends at the real settlement boundary as awaiting outcome and no work slices continue during the wait. | 13 | "A SpanManager fixture with unequal admitted members ends the fast member work slice at its actual result timestamp as awaiting-outcome, excluding queue, sibling and group-join time." | diff-local |
| Story 6 happy: Given classification arrives after multiple segment boundaries, when the authoritative terminal is observed, then a zero-duration outcome record at the actual classification time links to the last work slice and carries the measured work interval, final outcome, retries, and usage exactly once. | 14 | "After a controlled multi-day classification delay across several boundaries, SpanManager emits one zero-duration outcome at the real classification timestamp under the current segment group, linked to the last work slice with original measured work interval, final outcome, retry and usage facts exactly once." | diff-local |
| Story 6 negative: Given duplicate settlement or classification events, when processed, then the first settlement boundary is not stretched, the ended span is not rewritten, and no second terminal record appears. | 15 | "Duplicate settlement/classification events leave the first measured settlement end unchanged, do not rewrite the ended SDK span, and emit no second terminal record." | diff-local |
| Story 6 negative: Given shutdown or interruption while classification is pending, when cleanup occurs, then telemetry preserves the measured work interval and marks unresolved work truthfully rather than reporting success, creating fake waiting work, or backdating a multi-day span. | 15 | "Duplicate settlement/classification events leave the first measured settlement end unchanged, do not rewrite the ended SDK span, and emit no second terminal record." | diff-local |
| Story 7 happy: Given responsive scheduling, when a timed rotation occurs, then old slices end and continuations begin at the established boundary with nonnegative intervals, without extending the deadline on each event. | 11 | "OtelVisualizer controlled-clock tests show the one-hour deadline is fixed despite intervening events, and both timer-driven and event-driven expiry close old slices/groups/root at that boundary and open linked continuations at the same instant with nonnegative durations." | diff-local |
| Story 7 happy: Given a process resumes after a multi-hour scheduling gap, when its next event is observed, then the old segment closes at its established projection cutoff, the unobserved interval is explicit, and one segment resumes at the real observation time while actual engine duration evidence is retained separately. | 16 | "A controlled multi-hour scheduling-gap fixture closes the old segment at its established cutoff, records the unobserved interval, opens exactly one segment at actual resumed observation time, and preserves actual engine-duration evidence separately." | diff-local |
| Story 7 negative: Given a wall clock rollback or discontinuity, when timing is projected, then emitted intervals never become negative and a discontinuity is reported rather than silently inventing ordering. | 16 | "A controlled multi-hour scheduling-gap fixture closes the old segment at its established cutoff, records the unobserved interval, opens exactly one segment at actual resumed observation time, and preserves actual engine-duration evidence separately." | diff-local |
| Story 7 negative: Given a collector outage or old queued data after suspension, when export is attempted, then original timestamps remain intact, no missed-hour traces are synthesized, and telemetry failure cannot block engine progress or falsely certify backend ingestion. | 16 | "A controlled multi-hour scheduling-gap fixture closes the old segment at its established cutoff, records the unobserved interval, opens exactly one segment at actual resumed observation time, and preserves actual engine-duration evidence separately." | diff-local |
| Story 8 happy: Given enabled tracing on the canonical feature bus, when segments open, rotate, and end, then versioned typed segment records enter the existing feature ledger with validated scope/context and accurate reasons; rotation is distinguishable from an engine terminal. | 19 | "The production factory, real emitter and EventPersister fixture capture versioned validated segment opened/rotate/ended records with scope/context and accurate closed reasons in events.jsonl; no alternate correlation file or engine terminal is emitted." | diff-local |
| Story 8 happy: Given successful persistence, when bootstrap or graceful shutdown drains publications, then records preserve causal order while the persister remains attached; ordinary projection does not wait for ledger or network I/O, and lifecycle records cannot recursively export or increment metrics. | 19 | "The production factory, real emitter and EventPersister fixture capture versioned validated segment opened/rotate/ended records with scope/context and accurate closed reasons in events.jsonl; no alternate correlation file or engine terminal is emitted." | diff-local |
| Story 8 negative: Given persistence rejects a queued publication or the process dies before that publication becomes durable, when telemetry continues or subsequently restarts, then it cannot claim the unpublished context was recoverable; available earlier durable history may be used, with bounded failure diagnostics and no fabricated clean end. | 20 | "Injected EventPersistError/disk/permission rejection and simulated death before queued publication yield bounded diagnostics, no claim that the unpublished context was recoverable, and no fabricated clean end; restart can use only an earlier actually durable candidate or unavailable continuity." | diff-local |
| Story 8 negative: Given malformed correlation fields or a publication failure during shutdown, when the failure boundary handles them, then invalid context cannot enter recovered links, teardown remains bounded, and an exception neither escapes into feature execution nor prevents required cleanup. | 20 | "Injected EventPersistError/disk/permission rejection and simulated death before queued publication yield bounded diagnostics, no claim that the unpublished context was recoverable, and no fabricated clean end; restart can use only an earlier actually durable candidate or unavailable continuity." | diff-local |
| Story 9 happy: Given a dispatch with several segments, when completion, halt, or graceful termination occurs, then only its dispatch-ending segment has the existing complete/halted/terminated run outcome; intermediate segments have boundary reasons without fake run outcomes, and every open child closes before its parent. | 17 | "SpanManager captures of complete, halt and graceful termination after multiple segments show conductor.run.outcome only on the dispatch-ending segment, intermediate boundary reasons without run outcomes, and every open child ended before its parent." | diff-local |
| Story 9 happy: Given repeated graceful stop calls after work, when teardown finishes, then spans close once, queued publications drain within the shutdown bound, and timers, event subscriptions, and exporter lifecycle resources are released once. | 18 | "Repeated OtelVisualizer.stop calls after work share one stop promise, close spans once, drain pending publications within the shutdown bound and release timers, subscriptions and exporter lifecycle resources exactly once." | diff-local |
| Story 9 negative: Given completion races with a late halt, duplicate stop, or an already queued deadline callback, when all settle, then the first authoritative terminal remains unchanged and no callback opens or changes a stopped trace. | 18 | "Repeated OtelVisualizer.stop calls after work share one stop promise, close spans once, drain pending publications within the shutdown bound and release timers, subscriptions and exporter lifecycle resources exactly once." | diff-local |
| Story 9 negative: Given abrupt process loss before a current slice is exported, when history is inspected after restart, then incomplete/unknown evidence remains explicit and no synthetic successful terminal is created; recoverable prior ended spans are not replayed. | 18 | "Repeated OtelVisualizer.stop calls after work share one stop promise, close spans once, drain pending publications within the shutdown bound and release timers, subscriptions and exporter lifecycle resources exactly once." | diff-local |
| Story 10 happy: Given equivalent events through interactive and daemon startup, when their supported OTLP and file output is decoded, then both carry standard parentage, span links, stable feature/step attributes, dispatch filtering, and distinct segment/slice/outcome roles with no vendor-specific component required. | 22, 23 | "Actual interactive startup/event/shutdown integration through the registry factory and real SDK decodes supported OTLP/file captures with standard parents and span links, stable feature/step attributes, dispatch filtering, and distinct segment/slice/outcome roles without any vendor-specific component." | diff-local |
| Story 10 happy: Given a direct built-in visualizer factory caller without recoverable scope, when it emits work, then it still receives bounded, grouped, linked in-process traces with explicitly isolated continuity and the existing visualizer start contract. | 24 | "A direct createOtelVisualizer caller without recoverable scope emits bounded grouped in-process traces with predecessor/continuation links and explicitly isolated continuity, while the existing synchronous VisualizerPlugin.start contract remains usable." | diff-local |
| Story 10 negative: Given disabled OTel, when either entry point starts/stops and processes work, then the tracing path creates no feature identity, correlation reads/writes, timers, or exporter activity; normal engine-owned persistence remains unaffected. | 22, 23 | "Actual interactive startup/event/shutdown integration through the registry factory and real SDK decodes supported OTLP/file captures with standard parents and span links, stable feature/step attributes, dispatch filtering, and distinct segment/slice/outcome roles without any vendor-specific component." | diff-local |
| Story 10 negative: Given a failing or unavailable exporter in either entry point, when work progresses and shutdown runs, then feature results remain unchanged, cleanup remains bounded, and correlation persistence does not masquerade as export acceptance; unrelated visualizer plugins need no new lifecycle requirement. | 22, 23 | "Actual interactive startup/event/shutdown integration through the registry factory and real SDK decodes supported OTLP/file captures with standard parents and span links, stable feature/step attributes, dispatch filtering, and distinct segment/slice/outcome roles without any vendor-specific component." | diff-local |

## Architecture Obligation Coverage

Every citable decision in the three changed governing ADRs is listed, including retained
constraints and the independent spool decisions. Exact task evidence below is one fragment;
the cited task checks collectively implement the complete applicable obligation.

| Decision | Disposition | Task(s) | Evidence |
|---|---|---|---|
| adr-014-otel-observability-exporter#D1 | task | task-19 | The production factory, real emitter and EventPersister fixture capture versioned validated segment opened/rotate/ended records with scope/context and accurate closed reasons in events.jsonl; no alternate correlation file or engine terminal is emitted. |
| adr-014-otel-observability-exporter#D2 | existing | none | engine/plugin-loader.ts registerBuiltins registers visualizer:otel and resolves it through PluginRegistry; packaging stays unchanged. |
| adr-014-otel-observability-exporter#D3 | task | task-21, task-22, task-23 | wire.ts preparation fixtures start enabled telemetry before any step and assert its resource and later StepRunner startup use the same atomically persisted feature identity, including a racing creator; only a fully resolved same-scope context enables recovery. |
| adr-014-otel-observability-exporter#D4 | task | task-11, task-19 | Before engine completion, the capture contains ended SDK spans from rotation while ongoing work retains execution identity and incremented slices; no engine terminal/callback or metric increment occurs, and forceFlush never awaits network on the engine-event path or constructs another provider. |
| adr-014-otel-observability-exporter#D5 | task | task-20, task-24 | Injected EventPersistError/disk/permission rejection and simulated death before queued publication yield bounded diagnostics, no claim that the unpublished context was recoverable, and no fabricated clean end; restart can use only an earlier actually durable candidate or unavailable continuity. |
| adr-014-otel-observability-exporter#D6 | task | task-24 | Real SDK/transport serializer fixtures decode the standard parent/link/role/identity fields over HTTP/protobuf, gRPC and file output with existing resource keys and configured headers intact; original timestamps survive an unavailable/delayed exporter and no local result certifies backend ingestion. |
| adr-014-otel-observability-exporter#D7 | task | task-23 | Identical engine events through real SpanManager, MetricsListener and timing-rollup with and without rotation yield equal duration, attempt, retry, usage and elapsed-union totals; new dispatch/segment/execution identifiers are absent from metric resources and data-point labels, and existing metric resources/instruments stay unchanged. |
| adr-014-otel-observability-exporter#D8 | task | task-23 | Identical engine events through real SpanManager, MetricsListener and timing-rollup with and without rotation yield equal duration, attempt, retry, usage and elapsed-union totals; new dispatch/segment/execution identifiers are absent from metric resources and data-point labels, and existing metric resources/instruments stay unchanged. |
| adr-014-otel-observability-exporter#D9 | no-change | none | Daemon metric events and daemon-lifetime MetricsListener in wireDaemonOtel keep their existing ownership; new segment events are feature projection records, not replacement daemon signals. |
| adr-014-otel-observability-exporter#D10 | no-change | none | Keep the current metric dimensions, static custom attributes and feature-tier sources in otel/metrics.ts, metrics-listener.ts and resource.ts; new correlation IDs are trace/event-only. Task 23 proves metric/resource parity; this decision adds no new metric work. |
| adr-014-otel-observability-exporter#D11 | no-change | none | Keep the current metric dimensions, static custom attributes and feature-tier sources in otel/metrics.ts, metrics-listener.ts and resource.ts; new correlation IDs are trace/event-only. Task 23 proves metric/resource parity; this decision adds no new metric work. |
| adr-014-otel-observability-exporter#D12 | no-change | none | Keep the current metric dimensions, static custom attributes and feature-tier sources in otel/metrics.ts, metrics-listener.ts and resource.ts; new correlation IDs are trace/event-only. Task 23 proves metric/resource parity; this decision adds no new metric work. |
| adr-014-otel-observability-exporter#D13 | no-change | none | Keep the current metric dimensions, static custom attributes and feature-tier sources in otel/metrics.ts, metrics-listener.ts and resource.ts; new correlation IDs are trace/event-only. Task 23 proves metric/resource parity; this decision adds no new metric work. |
| adr-014-otel-observability-exporter#D14 | no-change | none | Keep the current metric dimensions, static custom attributes and feature-tier sources in otel/metrics.ts, metrics-listener.ts and resource.ts; new correlation IDs are trace/event-only. Task 23 proves metric/resource parity; this decision adds no new metric work. |
| adr-014-otel-observability-exporter#D15 | no-change | none | Delivery spooling is owned by the approved durable-otel-export-queue feature, not implemented by this change. Keep SpanExporter composition, original timestamps, process-owned drainer lifetime and existing diagnostic ownership; no new queue, age filter or lease is introduced. |
| adr-014-otel-observability-exporter#D16 | no-change | none | Delivery spooling is owned by the approved durable-otel-export-queue feature, not implemented by this change. Keep SpanExporter composition, original timestamps, process-owned drainer lifetime and existing diagnostic ownership; no new queue, age filter or lease is introduced. |
| adr-014-otel-observability-exporter#D17 | no-change | none | Delivery spooling is owned by the approved durable-otel-export-queue feature, not implemented by this change. Keep SpanExporter composition, original timestamps, process-owned drainer lifetime and existing diagnostic ownership; no new queue, age filter or lease is introduced. |
| adr-014-otel-observability-exporter#D18 | no-change | none | Run-provenance decision owned and delivered by #2000; this feature neither implements nor alters it. |
| adr-014-otel-observability-exporter#D19 | no-change | none | Run-provenance decision owned and delivered by #2000; this feature neither implements nor alters it. |
| adr-014-otel-observability-exporter#D20 | no-change | none | Run-provenance decision owned and delivered by #2000; this feature neither implements nor alters it. |
| adr-014-otel-observability-exporter#D21 | task | task-8, task-9, task-11, task-12 | Repeated SpanManager rotation under many active subjects creates fresh parentless trace IDs with one immediate predecessor-root link and one preceding-slice link per continuation; operation names remain bounded across rotations and contain no dispatch UUID or segment index. |
| adr-014-otel-observability-exporter#D22 | task | task-1, task-2, task-5, task-21, task-22, task-23 | feature-identity.test.ts races two creators in one temporary pipeline directory and asserts one persisted winner returned to both; resource.test.ts and the StepRunner persistence seam reuse that same winner without replacing an existing nonempty opaque identity or its file bytes. |
| adr-014-otel-observability-exporter#D23 | task | task-3, task-4, task-5, task-19, task-20 | An emitter/EventPersister integration capture round-trips opened, ended and rotate in events.jsonl with version, scope, dispatch/index/context and exact boundary reasons; rotation is not a step/feature terminal, and unrelated legacy event decoding is unchanged. |
| adr-014-otel-observability-exporter#D24 | task | task-6, task-7, task-9, task-10, task-13, task-14, task-15 | SpanManager SDK-capture tests assert repeated executions within a segment have distinct execution IDs, individual start/end times and outcomes beneath one step-group parent that is itself parented under the current segment root; a later segment retains the same logical-step identity. |
| adr-014-otel-observability-exporter#D25 | task | task-11, task-12, task-16, task-17, task-18, task-20 | OtelVisualizer controlled-clock tests show the one-hour deadline is fixed despite intervening events, and both timer-driven and event-driven expiry close old slices/groups/root at that boundary and open linked continuations at the same instant with nonnegative durations. |
| adr-014-otel-observability-exporter#D26 | task | task-21, task-22, task-23, task-24 | wire.ts preparation fixtures start enabled telemetry before any step and assert its resource and later StepRunner startup use the same atomically persisted feature identity, including a racing creator; only a fully resolved same-scope context enables recovery. |
| adr-2026-07-27-cold-start-within-step-retries#D1 | no-change | none | Provider resume capability, fresh invocation IDs, cold-start retry/recovery and session-policy behavior remain owned by provider-session/provider-execution and step-runners. This feature changes only durable telemetry identity ownership, never provider dispatch policy. |
| adr-2026-07-27-cold-start-within-step-retries#D2 | no-change | none | Provider resume capability, fresh invocation IDs, cold-start retry/recovery and session-policy behavior remain owned by provider-session/provider-execution and step-runners. This feature changes only durable telemetry identity ownership, never provider dispatch policy. |
| adr-2026-07-27-cold-start-within-step-retries#D3 | no-change | none | Provider resume capability, fresh invocation IDs, cold-start retry/recovery and session-policy behavior remain owned by provider-session/provider-execution and step-runners. This feature changes only durable telemetry identity ownership, never provider dispatch policy. |
| adr-2026-07-27-cold-start-within-step-retries#D4 | no-change | none | Provider resume capability, fresh invocation IDs, cold-start retry/recovery and session-policy behavior remain owned by provider-session/provider-execution and step-runners. This feature changes only durable telemetry identity ownership, never provider dispatch policy. |
| adr-2026-07-27-cold-start-within-step-retries#D5 | no-change | none | Provider resume capability, fresh invocation IDs, cold-start retry/recovery and session-policy behavior remain owned by provider-session/provider-execution and step-runners. This feature changes only durable telemetry identity ownership, never provider dispatch policy. |
| adr-2026-07-27-cold-start-within-step-retries#D6 | no-change | none | Provider resume capability, fresh invocation IDs, cold-start retry/recovery and session-policy behavior remain owned by provider-session/provider-execution and step-runners. This feature changes only durable telemetry identity ownership, never provider dispatch policy. |
| adr-2026-07-27-cold-start-within-step-retries#D7 | task | task-1, task-2, task-21, task-22, task-23 | feature-identity.test.ts races two creators in one temporary pipeline directory and asserts one persisted winner returned to both; resource.test.ts and the StepRunner persistence seam reuse that same winner without replacing an existing nonempty opaque identity or its file bytes. |
| adr-2026-09-10-shared-step-lifecycle-telemetry#D1 | no-change | none | Conductor tracked lifecycle remains the sole execution/gate owner; trace rotation projects its existing events and cannot emit engine terminals. |
| adr-2026-09-10-shared-step-lifecycle-telemetry#D2 | task | task-7 | SpanManager tests drive a policy retry, a rotation and a later re-run: retry increments the original execution retry data, rotation changes only slice identity, and the re-run gets a distinct execution ID that grouping never merges with the original. |
| adr-2026-09-10-shared-step-lifecycle-telemetry#D3 | task | task-13, task-14, task-15 | A SpanManager fixture with unequal admitted members ends the fast member work slice at its actual result timestamp as awaiting-outcome, excluding queue, sibling and group-join time. |
| adr-2026-09-10-shared-step-lifecycle-telemetry#D4 | task | task-10, task-15, task-17, task-18 | SpanManager SDK captures of retry/fallback work across several segments keep execution identity, original work start and applicable provider/retry context on its slices; exactly one span carries conductor.execution.terminal=true and terminal usage facts, with no usage copied onto nonterminal slices. |
| adr-2026-09-10-shared-step-lifecycle-telemetry#D5 | task | task-6, task-21, task-23 | SpanManager SDK-capture tests assert repeated executions within a segment have distinct execution IDs, individual start/end times and outcomes beneath one step-group parent that is itself parented under the current segment root; a later segment retains the same logical-step identity. |
| adr-2026-09-10-shared-step-lifecycle-telemetry#D6 | task | task-10, task-23 | SpanManager SDK captures of retry/fallback work across several segments keep execution identity, original work start and applicable provider/retry context on its slices; exactly one span carries conductor.execution.terminal=true and terminal usage facts, with no usage copied onto nonterminal slices. |
| adr-2026-09-10-shared-step-lifecycle-telemetry#D7 | no-change | none | Existing Conductor dispatch parity remains authoritative. No scheduling, observer or admission path changes; changed tracing entry-point proofs belong to tasks 22/23 and lower-layer fixtures preserve member timing and attribution. |

## Verification and review evidence

- Mechanical checks: 24 parseable tasks; two to five single-line Done-when checks each;
  all 40 exact acceptance rows mapped; dependency graph acyclic; protected-target scan
  passed with no violations. Native parsers confirmed all 37 architecture obligations
  and all ten story IDs. The dependency graph is acyclic.
- Independent criterion judgement: all 40 criteria ASSERTS. The first fresh reviewer
  identified five missing explicit assertions; a second cleared four revised claims,
  and a third cleared the remaining fault-case distinction. No refusal was overruled.
  Reviewers received only serialized criterion/check pairs, not authoring context.
- Advisory overlap scan over the Files union and #2011 completed after retrying a
  network failure: `Overlap with origin/spec/self-host-phase6-wiring: src/conductor/src/daemon-cli.ts`.
  `Note: renames or name-only diffs may not be detected by this scan.` No blocker was
  reported. This is coordination evidence, not an authorization to widen the feature.
- No behavioral tests or live backend smoke ran during this specification-only pass.
  Implementation RED/GREEN belongs to the named tasks; aggregate and SHIP proof belongs
  to its existing owning gates.
- Verify-claims: approved architecture choices are confirmed inputs; source seams were
  read directly (verified). Private helper factoring is a proposed implementation choice
  within those boundaries. No new load-bearing backend or provider assumption is used.
