# Coherence: Portable feature history across bounded traces

Date: 2026-09-30
Source-Ref: jstoup111/ai-conductor#2011
Track: technical
Tier: L
Verdict: covered
Operator review: Approved in chat on 2026-09-30

## Scope and interpretation

This review maps four staged outcomes, ten accepted stories, 24 approved tasks,
three changed ADRs (37 citable decisions), and all 40 acceptance criteria. The
technical track has no PRD/FR layer. #2009 step grouping is consolidated into #2011.

The exact staged outcome quotes below retain the intake wording. The operator
explicitly approved the narrower representation in ADR-014 D21/D26: connected
history means standard links plus stable feature identity across bounded traces.
Per-dispatch inspection means filtering by dispatch identity across its segments.
Neither outcome 1 nor outcome 4 promises a universal single-waterfall viewer or
one trace per arbitrarily long dispatch. Retention, sampling and indexing remain
backend concerns; local protocol proof does not establish live Datadog acceptance.

## Outcome mapping

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Quote |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-2, story-3, story-8, story-10 | covered | All telemetry for one feature, across every dispatch and re-kick from first dispatch to ship, is capturable and viewable as one connected whole rather than trace by trace. |
| outcome | outcome-2 | story-2, story-3, story-7, story-9, story-10 | covered | Within that whole, individual dispatches remain distinguishable — their ordering, boundaries, and the gaps between them are visible, not merged into one undifferentiated run. |
| outcome | outcome-3 | story-1, story-2 | covered | Distinct features remain fully separate; a fresh feature never inherits or joins another feature's trace identity. |
| outcome | outcome-4 | story-3, story-4, story-5, story-6, story-9, story-10 | covered | Existing per-dispatch inspection (open a single run's trace and see its steps) still works. |

Outcome 1 is delivered by identity/recovery plus bounded segment projection and
both production entry points. Outcome 2 retains dispatch/segment order, boundary
reasons and explicit clock/continuity gaps. Outcome 3 refuses incomplete or
mismatched identity scope. Outcome 4 preserves inspectable child work, grouping,
individual outcomes and dispatch filtering under the approved interpretation above.

## Story and task mapping

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| story | story-1 | task-1, task-2, task-5, task-21 | covered | All four criteria have exact checks in the criterion table below. |
| story | story-2 | task-4, task-5, task-23 | covered | All four criteria have exact checks in the criterion table below. |
| story | story-3 | task-8, task-9, task-11, task-12 | covered | All four criteria have exact checks in the criterion table below. |
| story | story-4 | task-6, task-7 | covered | All four criteria have exact checks in the criterion table below. |
| story | story-5 | task-9, task-10, task-23 | covered | All four criteria have exact checks in the criterion table below. |
| story | story-6 | task-13, task-14, task-15 | covered | All four criteria have exact checks in the criterion table below. |
| story | story-7 | task-11, task-16, task-24 | covered | All four criteria have exact checks in the criterion table below. |
| story | story-8 | task-3, task-19, task-20, task-22, task-23 | covered | All four criteria have exact checks in the criterion table below. |
| story | story-9 | task-17, task-18 | covered | All four criteria have exact checks in the criterion table below. |
| story | story-10 | task-21, task-22, task-23, task-24 | covered | All four criteria have exact checks in the criterion table below. |
| task | task-1 | story-1 | covered | Centralize atomic feature identity creation; the approved task's Story lines bind this work to these stories. |
| task | task-2 | story-1 | covered | Preserve identity failures without repairing uncertain state; the approved task's Story lines bind this work to these stories. |
| task | task-3 | story-8 | covered | Declare segment events and exhaustive sink routing; the approved task's Story lines bind this work to these stories. |
| task | task-4 | story-2 | covered | Recover the latest valid predecessor through the shared decoder; the approved task's Story lines bind this work to these stories. |
| task | task-5 | story-1, story-2 | covered | Refuse unsafe or unbounded recovery; the approved task's Story lines bind this work to these stories. |
| task | task-6 | story-4 | covered | Represent logical executions under per-segment step groups; the approved task's Story lines bind this work to these stories. |
| task | task-7 | story-4 | covered | Keep retries, re-runs and ambiguous legacy events distinct; the approved task's Story lines bind this work to these stories. |
| task | task-8 | story-3 | covered | Create fresh linked segment roots and scoped continuations; the approved task's Story lines bind this work to these stories. |
| task | task-9 | story-3, story-5 | covered | Rotate active work without an engine terminal; the approved task's Story lines bind this work to these stories. |
| task | task-10 | story-5 | covered | Project authoritative terminal facts exactly once; the approved task's Story lines bind this work to these stories. |
| task | task-11 | story-3, story-7 | covered | Own one fixed deadline timer for each live segment; the approved task's Story lines bind this work to these stories. |
| task | task-12 | story-3 | covered | Bound count rotation and serialize idle and boundary races; the approved task's Story lines bind this work to these stories. |
| task | task-13 | story-6 | covered | End member work at its observed settlement; the approved task's Story lines bind this work to these stories. |
| task | task-14 | story-6 | covered | Emit a late outcome linked to settled work; the approved task's Story lines bind this work to these stories. |
| task | task-15 | story-6 | covered | Deduplicate settlement and interrupt pending classification truthfully; the approved task's Story lines bind this work to these stories. |
| task | task-16 | story-7 | covered | Represent scheduling gaps and clock rollback explicitly; the approved task's Story lines bind this work to these stories. |
| task | task-17 | story-9 | covered | Close dispatch outcomes and children in causal order; the approved task's Story lines bind this work to these stories. |
| task | task-18 | story-9 | covered | Make stop and terminal races bounded and idempotent; the approved task's Story lines bind this work to these stories. |
| task | task-19 | story-8 | covered | Publish segment context through the canonical bus; the approved task's Story lines bind this work to these stories. |
| task | task-20 | story-8 | covered | Isolate publication rejection and bounded drain failure; the approved task's Story lines bind this work to these stories. |
| task | task-21 | story-1, story-10 | covered | Prepare enabled OTel context before resource construction; the approved task's Story lines bind this work to these stories. |
| task | task-22 | story-8, story-10 | covered | Connect interactive startup and shutdown to prepared tracing; the approved task's Story lines bind this work to these stories. |
| task | task-23 | story-2, story-5, story-8, story-10 | covered | Connect daemon dispatches and restart recovery to prepared tracing; the approved task's Story lines bind this work to these stories. |
| task | task-24 | story-7, story-10 | covered | Preserve direct-factory and transport compatibility; the approved task's Story lines bind this work to these stories. |

## ADR mapping

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| adr | adr-014-otel-observability-exporter | story-1, story-2, story-3, story-4, story-5, story-6, story-7, story-8, story-9, story-10 | covered | D1–D26 reviewed against the plan Architecture Obligation Coverage and complete cited checks; retained metrics and separate spool obligations keep their owners. |
| adr | adr-2026-07-27-cold-start-within-step-retries | story-1, story-4, story-10 | covered | D1–D6 provider policy is unchanged; amended D7 is implemented by the shared atomic identity helper and enabled startup, with failure and provider-session preservation checks. |
| adr | adr-2026-09-10-shared-step-lifecycle-telemetry | story-4, story-5, story-6, story-9, story-10 | covered | D1–D7 preserve engine execution authority, member timing, retry identity, once-only terminal facts and metrics; amended D5 permits the bounded trace hierarchy. |

## Criterion mapping

Each row reuses the approved plan Coverage Check criterion, task IDs and exact
Done-when evidence without alteration. All cited checks, not merely the quoted
fragment, form the claim. Independent plan coverage judges passed all 40 final
claims; coherence-check §4a therefore requires no duplicate judgement. Every
disposition is planned proof within this implementation diff, not an assertion
that its behavioral tests have already run.

| Row class | Exact criterion | Task id(s) | Verdict | Done when quote | Disposition |
|---|---|---|---|---|---|
| criterion | Story 1 happy: Given a new feature without a persisted identity, when enabled telemetry starts before the first step, then it and later step startup use the same persisted feature identity, including when two creators race. | 21 | covered | "wire.ts preparation fixtures start enabled telemetry before any step and assert its resource and later StepRunner startup use the same atomically persisted feature identity, including a racing creator; only a fully resolved same-scope context enables recovery." | diff-local |
| criterion | Story 1 happy: Given an existing nonempty opaque feature identity, when telemetry restarts or rotates, then it preserves that identity and file contents, assigns a fresh dispatch identity on restart, and leaves fresh provider-session generation unchanged. | 21 | covered | "wire.ts preparation fixtures start enabled telemetry before any step and assert its resource and later StepRunner startup use the same atomically persisted feature identity, including a racing creator; only a fully resolved same-scope context enables recovery." | diff-local |
| criterion | Story 1 negative: Given an empty, unreadable, or invalid existing identity, or a denied creation, when telemetry starts, then it leaves the existing file untouched, reports bounded unavailable continuity, and cannot recover links under an uncertain identity; telemetry failure does not change step-runner failure handling. | 2 | covered | "feature-identity.test.ts injects empty, whitespace-only, invalid, read-denied and create-denied cases and asserts existing file bytes are untouched, stable resolution is unavailable, telemetry returns an isolated transient identity with a bounded diagnostic, and no recovered-link eligibility is granted." | diff-local |
| criterion | Story 1 negative: Given a changed repository, branch, worktree, feature label, or feature generation, or missing scope, when copied history is encountered, then it cannot link to that history merely because a feature name matches; previously emitted identity is never relabeled. | 5 | covered | "trace-recovery.test.ts varies repository, branch, worktree, feature label and feature generation independently and also omits each scope field; every case returns unavailable with no recovered link, never joins by matching name alone, and never relabels historic data." | diff-local |
| criterion | Story 2 happy: Given a feature that runs for 72 hours with several stops and restarts and an execution longer than one hour, when its locally captured telemetry is inspected, then distinct bounded traces retain one feature identity, distinguish dispatches and segment indices, and link each successor to its immediate predecessor without replaying old spans. | 23 | covered | "A controlled-clock 72-hour daemon-wiring fixture with several stop/restart lifecycles and a multi-hour execution captures distinct bounded traces retaining one feature identity, fresh dispatch IDs and per-dispatch segment indices, with each successor linked to its immediate valid predecessor and no replay of old spans." | diff-local |
| criterion | Story 2 happy: Given a matching valid segment-open record without a persisted end record, when startup recovers it, then the next segment links to it while reporting the predecessor end as unknown; a genuinely absent history instead reports first-segment continuity. | 4 | covered | "trace-recovery.test.ts reads real temporary event ledgers through the shared decoder and returns the latest valid same-scope predecessor; an opened record without matching ended links with unknown predecessor end, whereas absent history reports first continuity." | diff-local |
| criterion | Story 2 negative: Given missing identity scope or corrupt, truncated relevant, unsupported-version, invalid-ID, or mismatched correlation history, when startup attempts recovery, then it reports unavailable continuity and starts an isolated segment without inventing a predecessor or claiming a clean stop. | 5 | covered | "trace-recovery.test.ts varies repository, branch, worktree, feature label and feature generation independently and also omits each scope field; every case returns unavailable with no recovered link, never joins by matching name alone, and never relabels historic data." | diff-local |
| criterion | Story 2 negative: Given an oversized line beyond 256 KiB, an unreadable ledger, or a recovery read exceeding five seconds, when recovery stops, then it releases its read resources, performs no further reads after cancellation, and lets the feature continue with bounded diagnostics and no recovered link. | 5 | covered | "trace-recovery.test.ts varies repository, branch, worktree, feature label and feature generation independently and also omits each scope field; every case returns unavailable with no recovered link, never joins by matching name alone, and never relabels historic data." | diff-local |
| criterion | Story 3 happy: Given a responsive process with ongoing work, when a segment reaches one hour or 1,024 completed execution slices/outcome records, then it closes its spans and exposes a fresh linked segment; ongoing executions retain identity, increment slice indices, and continue without a terminal outcome or an engine completion event. | 12 | covered | "At 1,024 completed slices/outcomes or one hour, whichever is first, the visualizer invokes one rotation, closes the segment and exposes fresh linked continuations with unchanged execution IDs, incremented slice indices and no execution-terminal marker/outcome or engine completion event; final size is threshold plus active execution/group closure overhead, not recursive count rotations." | diff-local |
| criterion | Story 3 happy: Given repeated rotation with many active subjects, when telemetry is captured, then each segment has only its immediate predecessor link, continuation slices link to their preceding slice, names remain bounded, and closure overhead is limited to the active executions/groups rather than accumulating history. | 8, 12 | covered | "Repeated SpanManager rotation under many active subjects creates fresh parentless trace IDs with one immediate predecessor-root link and one preceding-slice link per continuation; operation names remain bounded across rotations and contain no dispatch UUID or segment index." | diff-local |
| criterion | Story 3 negative: Given a terminal event and a rotation trigger at the same boundary, or a stale/duplicate trigger, when they are processed, then each slice ends once and the execution has at most one authoritative terminal; closing carry-over slices does not trigger recursive count rotation. | 12 | covered | "At 1,024 completed slices/outcomes or one hour, whichever is first, the visualizer invokes one rotation, closes the segment and exposes fresh linked continuations with unchanged execution IDs, incremented slice indices and no execution-terminal marker/outcome or engine completion event; final size is threshold plus active execution/group closure overhead, not recursive count rotations." | diff-local |
| criterion | Story 3 negative: Given no trace-bearing work, or a previously active segment that closes while idle, when hours pass, then no stream of empty traces appears; awaiting classification alone does not create work continuations, and future trace-bearing activity can resume linked history. | 12 | covered | "At 1,024 completed slices/outcomes or one hour, whichever is first, the visualizer invokes one rotation, closes the segment and exposes fresh linked continuations with unchanged execution IDs, incremented slice indices and no execution-terminal marker/outcome or engine completion event; final size is threshold plus active execution/group closure overhead, not recursive count rotations." | diff-local |
| criterion | Story 4 happy: Given repeated executions of one logical step within a segment, when exported, then their individually identifiable work slices share one step-group parent under that segment and retain distinct start/end times and outcomes; later segments retain the same logical-step identity. | 6 | covered | "SpanManager SDK-capture tests assert repeated executions within a segment have distinct execution IDs, individual start/end times and outcomes beneath one step-group parent that is itself parented under the current segment root; a later segment retains the same logical-step identity." | diff-local |
| criterion | Story 4 happy: Given concurrent configured members, including the same member name under different parents, when observations interleave, then their groups and executions stay distinct and their overlapping work intervals remain visible rather than serialized. | 6 | covered | "SpanManager SDK-capture tests assert repeated executions within a segment have distinct execution IDs, individual start/end times and outcomes beneath one step-group parent that is itself parented under the current segment root; a later segment retains the same logical-step identity." | diff-local |
| criterion | Story 4 negative: Given a policy retry followed later by a genuine step re-run, when both are exported, then the retry retains the original execution identity and increments its retry data while the re-run gets a new identity; neither grouping nor rotation merges the two executions. | 7 | covered | "SpanManager tests drive a policy retry, a rotation and a later re-run: retry increments the original execution retry data, rotation changes only slice identity, and the re-run gets a distinct execution ID that grouping never merges with the original." | diff-local |
| criterion | Story 4 negative: Given context-free legacy events with ambiguous attribution, malformed explicit context, or a late terminal for an older re-run, when projection occurs, then it preserves existing ambiguity refusal and cannot close or borrow metadata from a different execution. | 7 | covered | "SpanManager tests drive a policy retry, a rotation and a later re-run: retry increments the original execution retry data, rotation changes only slice identity, and the re-run gets a distinct execution ID that grouping never merges with the original." | diff-local |
| criterion | Story 5 happy: Given an execution with retries and provider fallback spanning several segments, when it finishes, then its slices retain execution identity, original work start, and applicable provider/retry context, and exactly one span carries its terminal marker and terminal usage facts. | 10 | covered | "SpanManager SDK captures of retry/fallback work across several segments keep execution identity, original work start and applicable provider/retry context on its slices; exactly one span carries conductor.execution.terminal=true and terminal usage facts, with no usage copied onto nonterminal slices." | diff-local |
| criterion | Story 5 happy: Given equivalent engine events with and without trace rotation, when metrics and timing rollups are compared, then duration, attempts, retries, usage, and elapsed-union totals are equal and new dispatch/segment/execution IDs appear on neither metric resources nor data-point labels. | 23 | covered | "A controlled-clock 72-hour daemon-wiring fixture with several stop/restart lifecycles and a multi-hour execution captures distinct bounded traces retaining one feature identity, fresh dispatch IDs and per-dispatch segment indices, with each successor linked to its immediate valid predecessor and no replay of old spans." | diff-local |
| criterion | Story 5 negative: Given duplicate or late terminals after an execution has closed, when they arrive, then they neither emit another terminal-bearing span nor transfer usage/provider facts to a later execution; missing usage remains absent. | 10 | covered | "SpanManager SDK captures of retry/fallback work across several segments keep execution identity, original work start and applicable provider/retry context on its slices; exactly one span carries conductor.execution.terminal=true and terminal usage facts, with no usage copied onto nonterminal slices." | diff-local |
| criterion | Story 5 negative: Given an exporter error or a segment ending while an execution is still active, when projection continues, then continued slices remain nonterminal with UNSET status and do not become failures, successes, or additive usage observations. | 9 | covered | "At a time/count rotation request SpanManager closes the segment children/root and exposes a fresh linked segment; active executions keep their ID, increment slice index and continue with UNSET/continued, without terminal markers, engine completion events or close callbacks." | diff-local |
| criterion | Story 6 happy: Given a member settles before its group classifies the result, when settlement is observed, then its work slice ends at the real settlement boundary as awaiting outcome and no work slices continue during the wait. | 13 | covered | "A SpanManager fixture with unequal admitted members ends the fast member work slice at its actual result timestamp as awaiting-outcome, excluding queue, sibling and group-join time." | diff-local |
| criterion | Story 6 happy: Given classification arrives after multiple segment boundaries, when the authoritative terminal is observed, then a zero-duration outcome record at the actual classification time links to the last work slice and carries the measured work interval, final outcome, retries, and usage exactly once. | 14 | covered | "After a controlled multi-day classification delay across several boundaries, SpanManager emits one zero-duration outcome at the real classification timestamp under the current segment group, linked to the last work slice with original measured work interval, final outcome, retry and usage facts exactly once." | diff-local |
| criterion | Story 6 negative: Given duplicate settlement or classification events, when processed, then the first settlement boundary is not stretched, the ended span is not rewritten, and no second terminal record appears. | 15 | covered | "Duplicate settlement/classification events leave the first measured settlement end unchanged, do not rewrite the ended SDK span, and emit no second terminal record." | diff-local |
| criterion | Story 6 negative: Given shutdown or interruption while classification is pending, when cleanup occurs, then telemetry preserves the measured work interval and marks unresolved work truthfully rather than reporting success, creating fake waiting work, or backdating a multi-day span. | 15 | covered | "Duplicate settlement/classification events leave the first measured settlement end unchanged, do not rewrite the ended SDK span, and emit no second terminal record." | diff-local |
| criterion | Story 7 happy: Given responsive scheduling, when a timed rotation occurs, then old slices end and continuations begin at the established boundary with nonnegative intervals, without extending the deadline on each event. | 11 | covered | "OtelVisualizer controlled-clock tests show the one-hour deadline is fixed despite intervening events, and both timer-driven and event-driven expiry close old slices/groups/root at that boundary and open linked continuations at the same instant with nonnegative durations." | diff-local |
| criterion | Story 7 happy: Given a process resumes after a multi-hour scheduling gap, when its next event is observed, then the old segment closes at its established projection cutoff, the unobserved interval is explicit, and one segment resumes at the real observation time while actual engine duration evidence is retained separately. | 16 | covered | "A controlled multi-hour scheduling-gap fixture closes the old segment at its established cutoff, records the unobserved interval, opens exactly one segment at actual resumed observation time, and preserves actual engine-duration evidence separately." | diff-local |
| criterion | Story 7 negative: Given a wall clock rollback or discontinuity, when timing is projected, then emitted intervals never become negative and a discontinuity is reported rather than silently inventing ordering. | 16 | covered | "A controlled multi-hour scheduling-gap fixture closes the old segment at its established cutoff, records the unobserved interval, opens exactly one segment at actual resumed observation time, and preserves actual engine-duration evidence separately." | diff-local |
| criterion | Story 7 negative: Given a collector outage or old queued data after suspension, when export is attempted, then original timestamps remain intact, no missed-hour traces are synthesized, and telemetry failure cannot block engine progress or falsely certify backend ingestion. | 16 | covered | "A controlled multi-hour scheduling-gap fixture closes the old segment at its established cutoff, records the unobserved interval, opens exactly one segment at actual resumed observation time, and preserves actual engine-duration evidence separately." | diff-local |
| criterion | Story 8 happy: Given enabled tracing on the canonical feature bus, when segments open, rotate, and end, then versioned typed segment records enter the existing feature ledger with validated scope/context and accurate reasons; rotation is distinguishable from an engine terminal. | 19 | covered | "The production factory, real emitter and EventPersister fixture capture versioned validated segment opened/rotate/ended records with scope/context and accurate closed reasons in events.jsonl; no alternate correlation file or engine terminal is emitted." | diff-local |
| criterion | Story 8 happy: Given successful persistence, when bootstrap or graceful shutdown drains publications, then records preserve causal order while the persister remains attached; ordinary projection does not wait for ledger or network I/O, and lifecycle records cannot recursively export or increment metrics. | 19 | covered | "The production factory, real emitter and EventPersister fixture capture versioned validated segment opened/rotate/ended records with scope/context and accurate closed reasons in events.jsonl; no alternate correlation file or engine terminal is emitted." | diff-local |
| criterion | Story 8 negative: Given persistence rejects a queued publication or the process dies before that publication becomes durable, when telemetry continues or subsequently restarts, then it cannot claim the unpublished context was recoverable; available earlier durable history may be used, with bounded failure diagnostics and no fabricated clean end. | 20 | covered | "Injected EventPersistError/disk/permission rejection and simulated death before queued publication yield bounded diagnostics, no claim that the unpublished context was recoverable, and no fabricated clean end; restart can use only an earlier actually durable candidate or unavailable continuity." | diff-local |
| criterion | Story 8 negative: Given malformed correlation fields or a publication failure during shutdown, when the failure boundary handles them, then invalid context cannot enter recovered links, teardown remains bounded, and an exception neither escapes into feature execution nor prevents required cleanup. | 20 | covered | "Injected EventPersistError/disk/permission rejection and simulated death before queued publication yield bounded diagnostics, no claim that the unpublished context was recoverable, and no fabricated clean end; restart can use only an earlier actually durable candidate or unavailable continuity." | diff-local |
| criterion | Story 9 happy: Given a dispatch with several segments, when completion, halt, or graceful termination occurs, then only its dispatch-ending segment has the existing complete/halted/terminated run outcome; intermediate segments have boundary reasons without fake run outcomes, and every open child closes before its parent. | 17 | covered | "SpanManager captures of complete, halt and graceful termination after multiple segments show conductor.run.outcome only on the dispatch-ending segment, intermediate boundary reasons without run outcomes, and every open child ended before its parent." | diff-local |
| criterion | Story 9 happy: Given repeated graceful stop calls after work, when teardown finishes, then spans close once, queued publications drain within the shutdown bound, and timers, event subscriptions, and exporter lifecycle resources are released once. | 18 | covered | "Repeated OtelVisualizer.stop calls after work share one stop promise, close spans once, drain pending publications within the shutdown bound and release timers, subscriptions and exporter lifecycle resources exactly once." | diff-local |
| criterion | Story 9 negative: Given completion races with a late halt, duplicate stop, or an already queued deadline callback, when all settle, then the first authoritative terminal remains unchanged and no callback opens or changes a stopped trace. | 18 | covered | "Repeated OtelVisualizer.stop calls after work share one stop promise, close spans once, drain pending publications within the shutdown bound and release timers, subscriptions and exporter lifecycle resources exactly once." | diff-local |
| criterion | Story 9 negative: Given abrupt process loss before a current slice is exported, when history is inspected after restart, then incomplete/unknown evidence remains explicit and no synthetic successful terminal is created; recoverable prior ended spans are not replayed. | 18 | covered | "Repeated OtelVisualizer.stop calls after work share one stop promise, close spans once, drain pending publications within the shutdown bound and release timers, subscriptions and exporter lifecycle resources exactly once." | diff-local |
| criterion | Story 10 happy: Given equivalent events through interactive and daemon startup, when their supported OTLP and file output is decoded, then both carry standard parentage, span links, stable feature/step attributes, dispatch filtering, and distinct segment/slice/outcome roles with no vendor-specific component required. | 22, 23 | covered | "Actual interactive startup/event/shutdown integration through the registry factory and real SDK decodes supported OTLP/file captures with standard parents and span links, stable feature/step attributes, dispatch filtering, and distinct segment/slice/outcome roles without any vendor-specific component." | diff-local |
| criterion | Story 10 happy: Given a direct built-in visualizer factory caller without recoverable scope, when it emits work, then it still receives bounded, grouped, linked in-process traces with explicitly isolated continuity and the existing visualizer start contract. | 24 | covered | "A direct createOtelVisualizer caller without recoverable scope emits bounded grouped in-process traces with predecessor/continuation links and explicitly isolated continuity, while the existing synchronous VisualizerPlugin.start contract remains usable." | diff-local |
| criterion | Story 10 negative: Given disabled OTel, when either entry point starts/stops and processes work, then the tracing path creates no feature identity, correlation reads/writes, timers, or exporter activity; normal engine-owned persistence remains unaffected. | 22, 23 | covered | "Actual interactive startup/event/shutdown integration through the registry factory and real SDK decodes supported OTLP/file captures with standard parents and span links, stable feature/step attributes, dispatch filtering, and distinct segment/slice/outcome roles without any vendor-specific component." | diff-local |
| criterion | Story 10 negative: Given a failing or unavailable exporter in either entry point, when work progresses and shutdown runs, then feature results remain unchanged, cleanup remains bounded, and correlation persistence does not masquerade as export acceptance; unrelated visualizer plugins need no new lifecycle requirement. | 22, 23 | covered | "Actual interactive startup/event/shutdown integration through the registry factory and real SDK decodes supported OTLP/file captures with standard parents and span links, stable feature/step attributes, dispatch filtering, and distinct segment/slice/outcome roles without any vendor-specific component." | diff-local |

## Semantic review and evidence

Coverage and consistency: inferred, 95% confidence from the accepted criteria,
approved D21–D26 and companion amendments, and all 24 complete Done-when blocks.
Every task was compared with every criterion, prioritizing negative/no-op and
preserved-behavior constraints. No unresolved contradiction or oscillation was found.

The preserved-behavior sweep confirms disabled startup returns before the new
identity/recovery/timer/export effects (tasks 21–23); engine-owned persistence is
separate. Tasks 1/2 preserve opaque identity bytes and fresh provider invocation IDs.
Tasks 3/9/19 cannot emit engine terminals or record metrics, while task 23 compares
both metric resources and data-point labels as well as exact metric/rollup totals.
Tasks 13–15 prevent settlement from turning classification waits into working time.
Tasks 17/18 preserve first-terminal ownership and close children before parents.

Achievability: inferred, 95% confidence from the planned mechanisms and source
seams verified during architecture/plan authoring. The legal continuity states
first/linked/unavailable distinguish missing history from refused recovery; linked
history may have unknown predecessor end. Continued/awaiting-outcome states are
nonterminal. Late authoritative classification has its own zero-duration record
with the original measured interval, so it requires neither span mutation nor
fabricated multi-day work. Closed segment reasons remain distinct from dispatch
outcomes. Idle and disabled paths express absence of spans/effects explicitly.

Input-boundary ownership is concrete: tasks 1/2 cover identity files, tasks 3–5
the actual ledger/emitter and shared decoder, tasks 19/20 publication durability
and rejection, tasks 21–23 enabled production preparation and both composition
roots, and task 24 actual supported serializers/direct-factory behavior. The
72-hour fixture recreates lifecycles through daemon wiring with real SDK capture
and fake transport; it neither presumes a backend UI nor executes a whole build.

Architecture obligations: all 37 mappings were reviewed individually. ADR-014
D1/D3–D8 and D21–D26 are supported by the collectively cited task checks. D2 is
verified directly in engine/plugin-loader.ts registerBuiltins, which registers
the otel visualizer through PluginRegistry. D9–D14 retain the existing independent
metric ownership, dimensions and configuration; this feature does not change
those policies. D15–D17 remain the separate spool feature's obligations; task 23
preserves a process-owned drainer when present, and task 24 forbids a second queue
or age filter. No missing spool implementation is silently claimed as existing.

Cold-start D1–D6 require no provider-policy change; D7 alone changes durable
feature-identity ownership without changing fresh invocation generation. Shared
lifecycle D1 and D7 keep the existing engine/emission owners; D2–D6 constrain the
changed projection and are supported by retry, settlement, terminal and metrics
checks. D26 documentation remains a mandatory same-change HARNESS/finish obligation
(README and affected OTel guides, including Datadog guidance); the plan skill
excludes ordinary documentation from implementation tasks. This review does not
waive that obligation or invent a documentation task.

No new unconfirmed load-bearing assumption is needed. Exact-copy restoration of
all identity and history remains the accepted D22 detection limit. Responsive
observation bounds do not guarantee ingestion during suspension/outage, backend
retention, or delivery of an unexported slice after abrupt loss.

## Validation

Native parser and validators pass: 81 rows (4 outcomes, 10 stories, 24 tasks,
3 ADRs, 40 criteria), real-ID cross-check, exact outcome quotes, criterion
Done-when evidence, story/task coverage, and all 37 architecture obligations.
The land wrapper derives changed ADRs from committed/untracked files; existing
tracked DECIDE amendments must be committed before its final invocation. Its
first pre-commit invocation could not enumerate those amendments. The direct
validators above received the actual three changed ADRs, without any waiver.
Final guarded land validation remains mandatory before publication.
No waiver requested. No implementation or behavioral test execution in DECIDE.
