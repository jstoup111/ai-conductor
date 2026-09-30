**Status:** Accepted

# Technical stories: Portable feature history across bounded traces

Source: jstoup111/ai-conductor#2011, including consolidated #2009.
Operator approved the complete acceptance package in chat on 2026-09-30.

Requirement authority: approved track scope and ADR-014 D18–D23, with the approved
shared lifecycle D5 and cold-start D7 amendments. Technical / Large; no PRD.
Scope: exported telemetry across compatible tools, including Datadog; three-day features,
restarts, long executions, repeated steps, truthful timing, and existing metrics parity.
Viewer layout, retention administration, and export-spool implementation are excluded.
The scenarios below are proposed acceptance behavior, not claims of shipped support.

## Story 1: Stable feature identity without joining unrelated work

**Requirement:** #2011 feature continuity and isolation; D19.

As an operator, I want a feature recognized before its first step so that dispatches join
the right history without changing provider sessions.

### Acceptance Criteria

#### Happy Path
- Given a new feature without a persisted identity, when enabled telemetry starts before the first step, then it and later step startup use the same persisted feature identity, including when two creators race.
- Given an existing nonempty opaque feature identity, when telemetry restarts or rotates, then it preserves that identity and file contents, assigns a fresh dispatch identity on restart, and leaves fresh provider-session generation unchanged.

#### Negative Paths
- Given an empty, unreadable, or invalid existing identity, or a denied creation, when telemetry starts, then it leaves the existing file untouched, reports bounded unavailable continuity, and cannot recover links under an uncertain identity; telemetry failure does not change step-runner failure handling.
- Given a changed repository, branch, worktree, feature label, or feature generation, or missing scope, when copied history is encountered, then it cannot link to that history merely because a feature name matches; previously emitted identity is never relabeled.

### Done When
- [ ] Isolated temporary-directory fixtures demonstrate one winning persisted identity and unchanged legacy bytes across bootstrap, step startup, and restart.
- [ ] Exported contexts distinguish feature, dispatch, and provider identities and omit recovered links for each scope mismatch.

## Story 2: Recover connected history over three days

**Requirement:** #2011 cross-dispatch inspection; D18–D20, D23.

As an operator, I want to follow earlier dispatches after restart so that a three-day feature
remains inspectable without a three-day open trace.

### Acceptance Criteria

#### Happy Path
- Given a feature that runs for 72 hours with several stops and restarts and an execution longer than one hour, when its locally captured telemetry is inspected, then distinct bounded traces retain one feature identity, distinguish dispatches and segment indices, and link each successor to its immediate predecessor without replaying old spans.
- Given a matching valid segment-open record without a persisted end record, when startup recovers it, then the next segment links to it while reporting the predecessor end as unknown; a genuinely absent history instead reports first-segment continuity.

#### Negative Paths
- Given missing identity scope or corrupt, truncated relevant, unsupported-version, invalid-ID, or mismatched correlation history, when startup attempts recovery, then it reports unavailable continuity and starts an isolated segment without inventing a predecessor or claiming a clean stop.
- Given an oversized line beyond 256 KiB, an unreadable ledger, or a recovery read exceeding five seconds, when recovery stops, then it releases its read resources, performs no further reads after cancellation, and lets the feature continue with bounded diagnostics and no recovered link.

### Done When
- [ ] A controlled-clock production-wiring fixture captures a connected 72-hour sequence across recreated lifecycles and a multi-hour execution using the real SDK and a local fake transport.
- [ ] Recovery fixtures show absent versus unavailable versus unknown-end outcomes, unchanged historical bytes/timestamps, and bounded reading of a startup size snapshot despite later appends.

## Story 3: Bound trace size and duration without finishing engine work

**Requirement:** Approved long-running-feature outcome; D18, D21–D22.

As an operator, I want ongoing work exported in bounded portions so that even one long
dispatch does not hold all its spans until completion.

### Acceptance Criteria

#### Happy Path
- Given a responsive process with ongoing work, when a segment reaches one hour or 1,024 completed execution slices/outcome records, then it closes its spans and exposes a fresh linked segment; ongoing executions retain identity, increment slice indices, and continue without a terminal outcome or an engine completion event.
- Given repeated rotation with many active subjects, when telemetry is captured, then each segment has only its immediate predecessor link, continuation slices link to their preceding slice, names remain bounded, and closure overhead is limited to the active executions/groups rather than accumulating history.

#### Negative Paths
- Given a terminal event and a rotation trigger at the same boundary, or a stale/duplicate trigger, when they are processed, then each slice ends once and the execution has at most one authoritative terminal; closing carry-over slices does not trigger recursive count rotation.
- Given no trace-bearing work, or a previously active segment that closes while idle, when hours pass, then no stream of empty traces appears; awaiting classification alone does not create work continuations, and future trace-bearing activity can resume linked history.

### Done When
- [ ] Timer- and event-driven boundary fixtures show completed SDK spans before engine completion, without extra completion callbacks, metric increments, providers, or dispatches.
- [ ] Captures prove fixed deadlines, count-threshold overhead, one predecessor per root, no recursive rotation, and no empty hourly output.

## Story 4: Group repeated steps while preserving each execution

**Requirement:** Consolidated #2009 grouping and overlap; D21.

As an operator, I want repeated executions under a stable step group so that I can compare
attempts while still seeing concurrency and individual results.

### Acceptance Criteria

#### Happy Path
- Given repeated executions of one logical step within a segment, when exported, then their individually identifiable work slices share one step-group parent under that segment and retain distinct start/end times and outcomes; later segments retain the same logical-step identity.
- Given concurrent configured members, including the same member name under different parents, when observations interleave, then their groups and executions stay distinct and their overlapping work intervals remain visible rather than serialized.

#### Negative Paths
- Given a policy retry followed later by a genuine step re-run, when both are exported, then the retry retains the original execution identity and increments its retry data while the re-run gets a new identity; neither grouping nor rotation merges the two executions.
- Given context-free legacy events with ambiguous attribution, malformed explicit context, or a late terminal for an older re-run, when projection occurs, then it preserves existing ambiguity refusal and cannot close or borrow metadata from a different execution.

### Done When
- [ ] SDK captures show segment → logical-step group → execution-slice/outcome ancestry, with stable role/step attributes and independent concurrent intervals.
- [ ] Resolver/projection fixtures distinguish retry, re-run, configured parent/member collisions, and legacy per-start identities without high-cardinality operation names.

## Story 5: Count outcomes and usage once across slices

**Requirement:** #2009 individual execution detail; D18, D21; shared lifecycle D2–D6.

As an operator, I want one execution's retries and costs preserved across rotation so that
tracing improvements do not inflate operational totals.

### Acceptance Criteria

#### Happy Path
- Given an execution with retries and provider fallback spanning several segments, when it finishes, then its slices retain execution identity, original work start, and applicable provider/retry context, and exactly one span carries its terminal marker and terminal usage facts.
- Given equivalent engine events with and without trace rotation, when metrics and timing rollups are compared, then duration, attempts, retries, usage, and elapsed-union totals are equal and new dispatch/segment/execution IDs appear on neither metric resources nor data-point labels.

#### Negative Paths
- Given duplicate or late terminals after an execution has closed, when they arrive, then they neither emit another terminal-bearing span nor transfer usage/provider facts to a later execution; missing usage remains absent.
- Given an exporter error or a segment ending while an execution is still active, when projection continues, then continued slices remain nonterminal with UNSET status and do not become failures, successes, or additive usage observations.

### Done When
- [ ] Captured terminal-bearing span count is exactly one per authoritatively completed execution, with usage absent from its other slices.
- [ ] Paired event-consumer fixtures compare exact metrics/rollups and attribute sets while exercising real projection and independent metrics ownership.

## Story 6: Separate early work settlement from late classification

**Requirement:** Truthful member timing; D21 and shared lifecycle D3/D5.

As an operator, I want a member's measured work to stop when it settles so that waiting for
a group decision never appears as additional work.

### Acceptance Criteria

#### Happy Path
- Given a member settles before its group classifies the result, when settlement is observed, then its work slice ends at the real settlement boundary as awaiting outcome and no work slices continue during the wait.
- Given classification arrives after multiple segment boundaries, when the authoritative terminal is observed, then a zero-duration outcome record at the actual classification time links to the last work slice and carries the measured work interval, final outcome, retries, and usage exactly once.

#### Negative Paths
- Given duplicate settlement or classification events, when processed, then the first settlement boundary is not stretched, the ended span is not rewritten, and no second terminal record appears.
- Given shutdown or interruption while classification is pending, when cleanup occurs, then telemetry preserves the measured work interval and marks unresolved work truthfully rather than reporting success, creating fake waiting work, or backdating a multi-day span.

### Done When
- [ ] Unequal-member fixtures show active work excluding queue, sibling, and join time, including a classification delayed by days under a controlled clock.
- [ ] The original exported work span remains byte-for-byte unchanged after classification; its linked outcome has equal start/end timestamps and the correct measured interval attributes.

## Story 7: Preserve truthful timing through scheduling and clock gaps

**Requirement:** Multi-day trace safety and truthful timestamps; D22.

As an operator, I want unobserved time identified honestly so that a suspended process does
not look like continuously observed work.

### Acceptance Criteria

#### Happy Path
- Given responsive scheduling, when a timed rotation occurs, then old slices end and continuations begin at the established boundary with nonnegative intervals, without extending the deadline on each event.
- Given a process resumes after a multi-hour scheduling gap, when its next event is observed, then the old segment closes at its established projection cutoff, the unobserved interval is explicit, and one segment resumes at the real observation time while actual engine duration evidence is retained separately.

#### Negative Paths
- Given a wall clock rollback or discontinuity, when timing is projected, then emitted intervals never become negative and a discontinuity is reported rather than silently inventing ordering.
- Given a collector outage or old queued data after suspension, when export is attempted, then original timestamps remain intact, no missed-hour traces are synthesized, and telemetry failure cannot block engine progress or falsely certify backend ingestion.

### Done When
- [ ] Controlled monotonic/wall-clock fixtures capture normal boundaries, a long suspension, and rollback with explicit gap evidence and a bounded number of spans.
- [ ] A delayed/erroring fake transport receives original timestamps while engine events continue independently.

## Story 8: Persist correlation without creating another telemetry channel

**Requirement:** Restart continuity and event-spine integrity; D20.

As an operator, I want recoverable trace relationships in the normal event history so that
restarts can explain continuity without a separate state file.

### Acceptance Criteria

#### Happy Path
- Given enabled tracing on the canonical feature bus, when segments open, rotate, and end, then versioned typed segment records enter the existing feature ledger with validated scope/context and accurate reasons; rotation is distinguishable from an engine terminal.
- Given successful persistence, when bootstrap or graceful shutdown drains publications, then records preserve causal order while the persister remains attached; ordinary projection does not wait for ledger or network I/O, and lifecycle records cannot recursively export or increment metrics.

#### Negative Paths
- Given persistence rejects a queued publication or the process dies before that publication becomes durable, when telemetry continues or subsequently restarts, then it cannot claim the unpublished context was recoverable; available earlier durable history may be used, with bounded failure diagnostics and no fabricated clean end.
- Given malformed correlation fields or a publication failure during shutdown, when the failure boundary handles them, then invalid context cannot enter recovered links, teardown remains bounded, and an exception neither escapes into feature execution nor prevents required cleanup.

### Done When
- [ ] A real bus/persister/decoder fixture round-trips opened/ended/rotate records in the existing events.jsonl with the declared sink routing and unchanged unrelated event decoding.
- [ ] Rejected-publication fixtures demonstrate failure visibility, bounded drain/cleanup, no recursive events or metric side effects, and recovery restricted to actually persisted context.

## Story 9: End a dispatch once and clean up every active child

**Requirement:** Existing terminal semantics across bounded segments; D22.

As an operator, I want a dispatch's final outcome distinguished from segment rotation so
that a halted feature is never displayed as successfully completed.

### Acceptance Criteria

#### Happy Path
- Given a dispatch with several segments, when completion, halt, or graceful termination occurs, then only its dispatch-ending segment has the existing complete/halted/terminated run outcome; intermediate segments have boundary reasons without fake run outcomes, and every open child closes before its parent.
- Given repeated graceful stop calls after work, when teardown finishes, then spans close once, queued publications drain within the shutdown bound, and timers, event subscriptions, and exporter lifecycle resources are released once.

#### Negative Paths
- Given completion races with a late halt, duplicate stop, or an already queued deadline callback, when all settle, then the first authoritative terminal remains unchanged and no callback opens or changes a stopped trace.
- Given abrupt process loss before a current slice is exported, when history is inspected after restart, then incomplete/unknown evidence remains explicit and no synthetic successful terminal is created; recoverable prior ended spans are not replayed.

### Done When
- [ ] Captures show intermediate versus final root attributes and truthful incomplete children for halt/termination, including a dispatch that was idle between segments.
- [ ] Teardown instrumentation reports no live timer/listener and one bounded provider shutdown after duplicate/racing calls.

## Story 10: Deliver the same portable behavior through every enabled entry point

**Requirement:** Cross-tool and Datadog scope; D23.

As an operator, I want the emitted relationships available through existing transports so
that selecting a tracing tool does not select a different correctness model.

### Acceptance Criteria

#### Happy Path
- Given equivalent events through interactive and daemon startup, when their supported OTLP and file output is decoded, then both carry standard parentage, span links, stable feature/step attributes, dispatch filtering, and distinct segment/slice/outcome roles with no vendor-specific component required.
- Given a direct built-in visualizer factory caller without recoverable scope, when it emits work, then it still receives bounded, grouped, linked in-process traces with explicitly isolated continuity and the existing visualizer start contract.

#### Negative Paths
- Given disabled OTel, when either entry point starts/stops and processes work, then the tracing path creates no feature identity, correlation reads/writes, timers, or exporter activity; normal engine-owned persistence remains unaffected.
- Given a failing or unavailable exporter in either entry point, when work progresses and shutdown runs, then feature results remain unchanged, cleanup remains bounded, and correlation persistence does not masquerade as export acceptance; unrelated visualizer plugins need no new lifecycle requirement.

### Done When
- [ ] Tests exercise actual interactive and daemon composition roots through the production factory, real SDK/serializers, and fake third-party adapters, stopping at the changed startup/event/shutdown boundary.
- [ ] Decoded OTLP and file captures prove portable protocol fields and disabled/failure behavior; no test result is described as live Datadog or Tempo acceptance.

## Coverage dispositions

All rows are planned lower-layer behavioral proof, not claims that tests already pass.
Criterion keys below are the engine-derived positions (happy paths then negative paths);
they are references only, not authored prefixes on criteria. Existing test suites provide
fixtures/regression context, but do not already prove segmentation.

| Criteria | Lowest sufficient proof and concrete cases |
|---|---|
| S1.1–S1.4 | Identity/resource integration with temporary files: exclusive-create race, legacy preservation, denied/invalid identity, every scope mismatch; extend resource.test.ts and shared-helper tests. |
| S2.1 | OTel wiring integration: controlled 72-hour capture across lifecycle recreation with real SDK, persister and fake transport; no whole build execution. |
| S2.2–S2.4 | Recovery reader/decoder tests: missing end, absent history, corrupt/mismatched contexts, line/time limits, cancellation and snapshot append. |
| S3.1–S3.4 | Span-manager/visualizer clock tests: time/count thresholds, active-child overhead, terminal/rotation ordering, stale triggers and idle periods. |
| S4.1–S4.4 | Execution-resolver/span-manager tests: repeated steps, parent/member collisions, overlapping work, retries/re-runs and legacy ambiguity. |
| S5.1, S5.3–S5.4 | Span-manager tests: metadata carryover, exact terminal/usage count, duplicate terminals and exporter errors. |
| S5.2 | Consumer integration: one event fixture drives real spans, MetricsListener and timing rollup; compare segmented/unsegmented values and label sets. |
| S6.1–S6.4 | Member-projection tests: settlement, multi-day classification, duplicate events and interrupted pending outcomes with immutable SDK captures. |
| S7.1–S7.4 | Injected-clock/lifecycle tests: timely boundary, scheduling gap, rollback and delayed/erroring transport. |
| S8.1–S8.4 | Bus/persister/decoder integration: sink routing, ordered publication, disk rejection, abrupt pre-publication loss, malformed context and shutdown rejection. |
| S9.1–S9.4 | Visualizer lifecycle tests: complete/halt/terminate across segments, idle-then-terminal, duplicate stop, stale timer, abrupt-loss restart. |
| S10.1–S10.4 | Entry-point integration in interactive and daemon wiring suites, including real serialization, direct factory fallback, disabled tracing, failed exporter and unchanged plugin contract. |

No new acceptance/system suite is needed: the distinct 72-hour flow is proven through the
real telemetry composition path without executing unrelated engine steps. All network,
provider and GitHub boundaries are faked. Live-backend smoke, if separately authorized,
is opt-in and cannot substitute for these local checks.

## Negative-category assessment

Each story was evaluated against all mandatory categories. Codes: I invalid input,
P permissions, T timeouts/network, C concurrency, R resource exhaustion, F partial failure,
U unavailable dependency, D data integrity, M immutability, E exception handling,
K deduplication keys, A alternate-branch side effects.

| Story | Relevant categories covered by its negatives | Nonapplicable categories and boundary |
|---|---|---|
| 1 | I,P,C,F,U,D,M,E,K,A | T,R are covered at bounded recovery/publication, stories 2/8; no bulk processing here. |
| 2 | I,P,T,R,F,U,D,M,E,A | C snapshot appends in Done When; K deduplication of lifecycle records is story 8/9. |
| 3 | C,R,F,D,K,A | I,P,T,U,E outside pure rotation; M ended-span immutability in stories 6/7. |
| 4 | I,C,D,K,A | P,T,R,F,U,E outside pure attribution; M handled by terminal suppression in story 5. |
| 5 | C,F,U,D,M,E,K,A | I absent usage covered; P,T,R handled at export/recovery boundaries. |
| 6 | C,F,D,M,K,A | I,P,T,R,U,E outside local member-state transitions. |
| 7 | I,T,F,U,D,M,E,A | C deadline ownership in story 3; P,R,K outside clock arithmetic. |
| 8 | I,P,T,C,R,F,U,D,M,E,K,A | None; publication faults include permission/disk errors and duplicate/stale identity handling. |
| 9 | C,T,F,U,D,M,E,K,A | I,P,R outside local terminal ownership; bounded exporter shutdown covers waiting. |
| 10 | P,T,F,U,E,A | I,C,R,D,M,K covered in the owned lower-layer permutations above, not duplicated at entry points. |

Cascade deletion is nonapplicable to every story: no entity deletion or relational cascade
is introduced. Cleanup of child spans/resources is explicitly covered by stories 6/9.
There is no application-authentication surface; P means filesystem/exporter authorization
failures. E cases use actual rejected/thrown error shapes at adapters, not assumptions
about an unrelated exception hierarchy. All duplicate suppression must distinguish real
re-runs, features and segments so a legitimate new execution cannot be discarded.

## Verify-claims disposition

Verified, 100%: the operator approved D18–D23 and the companion architecture amendments.
Verified source observations and protocol references are recorded in the architecture review.
The scenarios assert approved target behavior; implementation correctness is unproven.
No assumptions about backend retention, indexing, sampling, or live ingestion are required.
Copying every identity and the full ledger is indistinguishable from restoring the same
feature, as explicitly accepted in D19. Bounded traces do not guarantee real-time ingestion
during suspension/outage or delivery of an unexported slice after process death.
Verdict: CLEAR. Operator accepted these stories on 2026-09-30.
