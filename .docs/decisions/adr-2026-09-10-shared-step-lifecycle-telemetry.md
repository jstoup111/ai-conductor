# ADR: Shared lifecycle instrumentation for sequential and parallel telemetry

Date: 2026-09-10
Source: jstoup111/ai-conductor#2414
Review mode: full, Tier L, technical track
Status: APPROVED
Deciders: James Stoup, operator approval in composer session on 2026-09-10.

## Confirmed scope

The operator selected shared lifecycle instrumentation and technical track. Cover serial lifecycle steps, built-in validation members, and configured parallel members. Preserve scheduling, provider selection, retry budgets, checkpoint behavior, advisory-group behavior, and gate/state ownership. No Grafana changes, external service, execution-engine replacement, nested BUILD task instrumentation, or auxiliary rubric instrumentation.

## Context and evidence

Verified in conductor.ts: the serial loop calls emitExecutionEvent through emitTracked; the validation dispatchGroupRound observer records dispatch timestamps and verdict identity but does not emit member lifecycle starts/terminals. runParallelGroupViaCore calls the same runGroupBranch without an observer. The existing openExecutions/closingExecutions machinery already orders lifecycle delivery and suppresses late terminals, but keys by step name.

Verified in group-core.ts: runGroupBranch emits one dispatch callback per attempt and one result callback per returned branch outcome. The callbacks currently lack attempt detail and execution identity. BranchOutcome discards much of StepRunResult's provider metadata. These callbacks are useful integration points, but cannot be treated as a complete lifecycle contract unchanged.

Verified in event-persister.ts, timing-rollup.ts, otel/metrics-listener.ts, and otel/span-manager.ts: interval and span maps use step names. The persister owns persisted activeInterval measurement; timing rollup unions overlapping intervals. MetricsListener is the single production metric projection; the visualizer is spans-only. step_refused is currently excluded from OTel, although persistence treats it as a terminal when a step was opened.

Grafana confirmed current dispatch series without duration/span series for both validators. This is supporting context, not a test dependency or historical-data recovery requirement.

## Governing decisions and reuse check

- adr-2026-07-10-concurrent-group-core: retain one capped group core and detached member sessions; no second executor.
- adr-2026-07-10-validation-group-join: preserve width-one serial degradation, single-writer state/gate joins, and consolidated remediation.
- adr-2026-08-12-execution-lifecycle-completeness-for-timing: each started execution closes once on catchable exits; unrecoverable loss stays partial; no fabricated historical interval.
- adr-2026-08-24-refused-step-status: refusal is not work failure and does not satisfy a gate.
- adr-014-otel-observability-exporter, especially Decisions 4, 5, 7, 10, 11: bounded event-fed projections, failure-isolated export, one metrics listener, stable dimensions, attempt-owned dispatch accounting.

A new ADR is warranted for the uncovered cross-module execution identity and shared lifecycle ownership contract. It extends the existing decisions; it does not replace the executors or metric-provider ownership. Existing decisions are otherwise reused.

## Alternatives

### A. Shared lifecycle instrumentation — selected by operator

The dispatch owners supply typed observations to a common lifecycle seam. All telemetry consumers resolve the same execution identity from the existing event spine. This closes omission and collision gaps with a smaller behavioral surface than an executor rewrite.

### B. Unified executor

Serial execution becomes a width-one case of one executor. This has stronger structural unification, but would require touching policy and state coordination beyond the telemetry outcome. Rejected by operator in favor of A.

### C. Reconstruct members from group ceremony

Group start/end events do not establish individual execution boundaries or member retry/provider detail. Rejected because member wall-clock duration cannot be recovered from the group envelope.

## Decision

1. **One lifecycle instrumentation owner.** Extend/extract the conductor's tracked execution emission into a shared engine seam used by the serial loop, validation fan-out, configured fan-out, and shutdown. It owns identity, started/open/closing/closed transitions, and terminal deduplication. Group core reports typed observations into that seam; it never owns gate commits or depends on OTel. Production grouped dispatch must supply this observer, rather than silently relying on an optional callback. The existing emitExecutionEvent ordering and in-flight terminal promises are the local pattern basis; exact class/module factoring remains an implementation choice.

2. **Identity is explicit and separate from policy identity.** Add backward-compatible execution context to existing lifecycle, retry, and provider-attempt events. A new execution ID is minted for a logical step/member execution; retries remain within it, and a later redispatch has a fresh ID. A discriminated subject represents either a lifecycle step or a configured member with its parent group and member name. Arbitrary member names must not be added to the lifecycle registry or cast into StepName for telemetry. Keep provider attempt IDs distinct and preserve verdict-handshake run IDs. Thread context through per-invocation options/scoped callbacks, never a mutable shared current-step field. Consumers use execution ID scoped to feature/run; historical context-free events retain legacy pairing.

3. **Member timing follows the member.** A member lifecycle starts after admission by the concurrency cap, at its own execution boundary. It spans that member's retries and waits that belong to its execution; retry does not reopen or reset the duration clock. Its work interval ends when that member settles, excluding slower siblings and deferred join work. Group envelope timing remains separate. Preserve the existing serial observation boundary and units. If a final gate/refusal classification is known only at join, keep the already-observed member finish boundary so delayed classification cannot inflate its work duration. Preserve EventPersister as the owner of persisted activeInterval evidence; carry any required member-boundary observation through the same typed event stream, not a sidecar or post-hoc artifact timestamp. Do not substitute provider-reported duration for engine-observed elapsed time.

4. **Terminal outcomes are truthful and exactly once.** Successful execution, exhausted work failure, refusal, and catchable interruption retain their distinct meaning across dispatch modes. A member can finish execution before the group decides its authoritative gate/state outcome; telemetry cannot grant a gate pass or make a failed/refused group green. Close the member once and independently of sibling results. No synthetic start/duration for skipped or cancelled-before-admission members. Late results after closure cannot re-close a newer execution. SIGKILL/host loss remains incomplete evidence rather than a fabricated success or zero duration. Apply refusal projection equally to serial and parallel events.

5. **All current consumers share the identity interpretation.** Carry optional context through EventPersister, daemon forwarding, timing-rollup, MetricsListener, SpanManager/visualizer, and relevant event-rendering/dispatch-metering consumers. Retain lifecycle step labels for existing serial and built-in steps. Configured members use a stable, unambiguous parent/member label on the existing step dimension; execution/attempt IDs remain event/trace context, never metric labels or metric Resource fields. Span parenting stays under the existing run trace, with parent/member attributes for configured branches. Historical ledgers and context-free events retain compatibility; adding member intervals must not inflate feature elapsed totals because interval union remains the aggregation rule.

6. **Dispatch/cost/provider facts keep their existing authority.** provider_attempt remains the source of invoked-dispatch accounting and resolved provider/model/fallback metadata. Correlate it with its owning execution so interleaved branches cannot borrow dimensions or consume one another's legacy-completion suppression. Lifecycle completion must not count another dispatch or add token/cost totals a second time. Missing usage/dimensions stay absent. Count policy retries under the existing retry semantics; a rate-limit wait or skipped fallback candidate does not become a new budget-consuming retry. The same MetricsListener serves interactive and daemon paths; visualizers do not record metrics.

7. **Parity is tested at actual entry points.** Run a common observable scenario matrix through real Conductor dispatch paths with fake step/provider boundaries and in-memory metric/span exporters. Cover ordinary serial, width-one degradation, built-in width-two/three, cap-one with multiple eligible members, and configured groups. Exercise unequal completion times, policy retry, rate limit, fallback, thrown failure, refusal, cancellation before/after admission, graceful halt, late terminal, repeated execution, same-name members in distinct groups, and concurrent feature streams. Derive built-in-member coverage from the group registry so a newly added member is exercised automatically. Failure to emit an expected lifecycle must fail a behavioral assertion, not a string-matching source audit. No default test accesses Grafana or a real third-party service.

## Wiring Surface

| Surface | Production caller/consumer |
| --- | --- |
| Shared lifecycle tracking and execution context | conductor.ts serial loop, dispatchGroupRound, runParallelGroupViaCore, closeOpenExecutions |
| Required branch lifecycle observer | group-core.ts runGroupBranch; supplied by both conductor group callers |
| Per-invocation telemetry context | StepRunOptions and step-runners.ts provider-aware invocation/event callback seams |
| Additive typed event context and identity resolver | types/events.ts; conductor and all lifecycle consumers |
| Interval correlation and historical compatibility | EventPersister and timing-rollup.ts |
| Metrics/span correlation and terminal projection | MetricsListener handlers; OtelVisualizer and SpanManager; EVENT_SINKS |
| Dispatch deduplication and presentation attribution | DispatchMeteringTracker and consumers of member-attributed lifecycle events |

## Feasibility

No new dependency, service, port, database, or credential is needed. Existing TypeScript discriminated unions, injected clocks, event emitter, execution tracking, and OTel SDK seams support the design. Work is isolated in a feature worktree. Compatibility work is additive at the event boundary, with explicit legacy fallback. BUILD must inventory all consumers of touched event variants and keep the lifecycle registry's domain closed.

## Complexity and domain integrity

Large: correlation spans multiple consumers and two concurrent execution owners, including terminal races. Use typed execution subjects and terminal outcomes rather than name parsing or boolean status flags. A member's telemetry identity is not a lifecycle policy identity, provider session ID, or gate verdict. Transient in-memory maps are appropriate bookkeeping; durable evidence remains the existing event ledger.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| Member and group gate status conflated | Data | Medium | High | Preserve join authority; distinct execution and gate facts; mixed-outcome tests |
| Late terminal closes a newer execution | Data | Medium | High | Explicit execution identity and common terminal ownership |
| Duration includes queue or sibling time | Technical | Medium | Medium | Staggered clocks and cap-limited entry-path tests |
| New completion events double-count usage | Data | Medium | High | Execution-aware provider-attempt deduplication and compatibility tests |
| Historic events become unreadable or totals inflate | Integration | Medium | High | Optional context, legacy fixtures, interval union assertions |
| Dynamic identifiers cause metric series growth | Performance | Medium | Medium | Keep execution IDs trace/event-only; stable configured step labels |
| Failure in export changes execution | Integration | Low | High | Existing failure-isolated projections; fake failing exporter checks |

## Overlap and verification

Early overlap-scan over conductor, group-core, event types, persistence, timing, metrics, and span manager reported no overlap/no open blockers on 2026-09-10. This is advisory and not a guarantee against future concurrent merges.

The component diagram passed ai-conductor render-diagrams --check. Full integrity validation passed with tsx dependencies and local IPC available: 302 passed, 0 failed, 1 warning. No runtime code changed.

## Verdict

Feasible with the constraints above. The operator approved this proposal on 2026-09-10. Verify-claims: CLEAR for observed source facts and approved decisions. These decisions are the intended implementation contract, not a claim that parity is already implemented.

## Consequences

Positive: all three execution paths share correlation and terminal accounting while existing scheduling and gate owners remain authoritative. Negative: event readers require coordinated additive-context support and historical fallback; configured member identities require care at the boundary with the closed lifecycle registry.

## Follow-up Actions

- Derive technical acceptance stories from Decisions 1–7, including negative outcomes and historical compatibility.
- Map each decision to behavior-owning implementation tasks after story approval and conflict review.
- Preserve the single event spine and one metrics listener throughout implementation.

