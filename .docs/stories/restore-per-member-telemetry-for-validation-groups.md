**Status:** Accepted

# Technical stories: Sequential and parallel telemetry parity

Operator accepted these stories on 2026-09-10.

Source: jstoup111/ai-conductor#2414
Architecture: adr-2026-09-10-shared-step-lifecycle-telemetry, Decisions 1–7, approved 2026-09-10.
Scope: telemetry parity across sequential lifecycle steps, built-in validation groups, and configured parallel groups. Existing execution policy and state/gate authority are preserved. No PRD, dashboard change, new service, auxiliary rubric instrumentation, or nested BUILD task instrumentation.

## Story 1: Each executed step has its own duration and span

**Requirement:** Approved telemetry parity outcome; ADR Decisions 1, 3, 5.

As an operator, I want each executed step or configured member to have its own timing so that changing its scheduling mode does not make its duration disappear or include another member's work.

### Acceptance Criteria

#### Happy Path
- Given equivalent successful work runs serially, as a built-in group member, or as a configured group member, when its execution completes, then each execution contributes exactly one duration observation in milliseconds and one attributable step span under its run trace, with equivalent outcome and timing semantics.
- Given a group with unequal member durations and a concurrency cap below its member count, when its members complete, then each member's duration excludes time queued before admission, slower siblings' work, and deferred group-join work; a delayed final classification retains that member's observed finish boundary.

#### Negative Paths
- Given group membership degrades to one eligible member, when that member executes through the serial path, then its timing and span are recorded once, with no duplicate group/member observation.
- Given a member is skipped or cancelled before admission, when the remaining group executes, then that member creates no execution span or duration observation, including no zero-duration substitute.

### Done When
- [ ] Real dispatch-path fixtures export one duration sample and one span per executed member in all three modes, with existing serial/built-in step labels preserved.
- [ ] A deterministic cap-limited, staggered-completion fixture distinguishes each member's elapsed work from queue, sibling, and join time; width-one and non-dispatched cases assert their exact observation counts.

Coverage disposition: orchestration integration for path equivalence and admission ordering; lower-layer lifecycle/clock tests for timing permutations. Fake step/provider boundaries and in-memory exporters only.

## Story 2: Concurrent executions retain their own identity and provider attributes

**Requirement:** Approved attribution parity outcome; ADR Decisions 2, 5, 6.

As an operator, I want overlapping and repeated executions to stay distinguishable so that their spans, durations, and provider details cannot be attributed to another execution.

### Acceptance Criteria

#### Happy Path
- Given two configured groups contain identically named members and their observations interleave with another feature's observations, when telemetry is projected, then each observation belongs to the correct feature, run, parent group, and member; configured member labels are stable and unambiguous while existing lifecycle step labels remain unchanged.
- Given a preferred provider is unavailable and a fallback executes a member, when that execution closes, then its span and metrics carry the same supported provider/model/effort/tier and fallback attribution as equivalent serial execution, with fallback reason retained as trace context.

#### Negative Paths
- Given an earlier execution closes late after the same step/member has been redispatched, when its terminal or provider observation arrives, then it neither closes the new execution nor replaces the new execution's attribution.
- Given a provider omits usage or dispatch dimensions, when concurrent telemetry is exported, then absent values remain absent and are never borrowed from a sibling; execution/attempt IDs and free-text fallback reasons never enter metric data-point labels or metric Resource attributes.

### Done When
- [ ] Interleaved same-name member and cross-feature fixtures demonstrate independent spans, duration samples, and provider attributes, including redispatch with late observations.
- [ ] Exported attributes preserve serial/built-in labels, distinguish configured parent/member identity, omit unknown metadata, and keep unbounded correlation out of both metric label paths.

Coverage disposition: event-consumer integration for forwarding and shared-listener isolation; lower-layer identity and attribution tests for collision and absence cases.

## Story 3: Retry telemetry matches the execution's actual retry policy

**Requirement:** Approved retry parity outcome; ADR Decisions 3, 6.

As an operator, I want retries accounted consistently in serial and parallel execution so that retries explain latency without inflating execution or dispatch counts.

### Acceptance Criteria

#### Happy Path
- Given an execution fails once and succeeds on its next policy attempt, when it settles in any of the three scheduling modes, then it has one logical execution span and duration covering its retry lifetime, one policy retry, and the actual invoked provider attempts counted exactly once.
- Given a retry changes the resolved model or effort, when retry and terminal telemetry are exported, then observations carry their own resolved attempt metadata and the final execution's terminal attribution, without resetting the execution start time.

#### Negative Paths
- Given a member waits for a rate-limit episode or encounters a non-invoked provider candidate, when execution resumes, then that wait/candidate is not counted as a budget-consuming retry or an invoked dispatch; siblings retain independent accounting.
- Given every permitted work attempt fails or throws, when retries are exhausted, then the execution closes once as failed with its real retry count and elapsed time, and emits no success observation or extra attempt beyond the existing policy.

### Done When
- [ ] Equivalent serial/built-in/configured fixtures distinguish logical execution count, invoked dispatch count, and policy retry count for success-after-retry and exhaustion.
- [ ] Deterministic lower-layer tests cover changed attempt dimensions, thrown failures, rate-limit waits, non-invoked candidates, and zero-retry executions without zero-filled retry points.

Coverage disposition: lower-layer branch/lifecycle and metering tests for permutations; real dispatch integration for serial/parallel retry wiring.

## Story 4: Failure, refusal, and interruption produce truthful terminal telemetry

**Requirement:** Approved terminal parity outcome; ADR Decisions 1, 4, 5.

As an operator, I want every started execution to close truthfully when the process can still handle its termination so that incomplete or refused work is never shown as successful or silently lost.

### Acceptance Criteria

#### Happy Path
- Given work fails or an execution is refused at an existing refusal boundary, when the terminal decision is emitted in any scheduling mode, then its duration/span closes once and distinguishes failure from refusal; refusal does not become success or work failure.
- Given graceful shutdown or a catchable halt occurs with admitted members in flight, when cleanup completes, then each started execution has one corresponding terminal record and closed span with its actual terminal meaning, while queued members remain without execution observations.

#### Negative Paths
- Given a member resolves concurrently with shutdown or sends a duplicate terminal, when both paths finish, then only one terminal closes that execution and no newer execution is affected.
- Given a process cannot emit a terminal after an unrecoverable death, when its ledger is read later, then its timing remains explicitly incomplete; no terminal, successful duration, or zero-duration observation is invented from later runs.

### Done When
- [ ] Failure/refusal and shutdown fixtures assert exact lifecycle balance and distinct exported outcomes across all three paths.
- [ ] Deterministic race fixtures prove duplicate suppression, pre-admission cancellation, and late-result isolation; historical open-start fixtures retain partial timing with its reason.

Coverage disposition: lifecycle unit tests for races, refusal and duplicate handling; bounded orchestration integration for shutdown wiring; ledger-reader tests for uncatchable loss. No real process kill or operator session is used.

## Story 5: Instrumentation does not change gate or execution authority

**Requirement:** Approved preservation boundary; ADR Decisions 1, 4, 6.

As an operator, I want richer telemetry without changed gate decisions or publication ordering so that observing a member's completion cannot make an invalid feature appear shippable.

### Acceptance Criteria

#### Happy Path
- Given one validation member finishes successfully before a slower sibling whose verdict fails, when telemetry and the group join complete, then the first member retains its own timing while the group follows the existing non-green gate/remediation result and does not advance publication prematurely.
- Given a configured group has an advisory member failure, when that group joins, then the failed member remains visible as failed while the group's outcome follows its existing advisory policy; scheduling caps, provider selection, and checkpoint behavior remain unchanged.

#### Negative Paths
- Given a successful runner result later fails its objective evidence check or refusal handshake, when the authoritative outcome is determined, then member execution telemetry does not grant gate satisfaction, overwrite the non-green state, or misrepresent the eventual refusal/failure.
- Given an OTel projection/exporter is disabled, unavailable, or throws, when an otherwise identical execution runs, then its dispatches, retries, gate outcomes, and state writes match the execution with working telemetry; event persistence retains its existing failure policy.

### Done When
- [ ] Mixed-outcome and advisory-group integration fixtures assert both member telemetry and unchanged gate/state results, with no finish/publication dispatch before the existing authority permits it.
- [ ] Fake failing/disabled telemetry fixtures preserve execution behavior while recording no duplicate state commits or dispatches; persistence errors are not swallowed as exporter failures.

Coverage disposition: bounded real group-join integration with faithful gate evidence where required; lower-layer exporter failure-isolation tests. Fixtures stop at the join/decision boundary rather than running an unrelated SHIP tail.

## Story 6: Existing ledgers and metric totals remain compatible

**Requirement:** Approved backward-compatibility boundary; ADR Decisions 2, 5, 6.

As an operator, I want old evidence to remain readable and new member detail not to inflate totals so that telemetry parity preserves the meaning of historical reports and cost metrics.

### Acceptance Criteria

#### Happy Path
- Given a historical ledger without execution context, when existing telemetry/timing readers process it, then its prior supported interpretation remains available; a new context-bearing ledger also pairs executions correctly through the same reader path.
- Given member intervals overlap each other and the group envelope, when feature elapsed time is calculated, then overlap is counted once by interval union while per-member durations remain separately observable.

#### Negative Paths
- Given an invoked provider-attempt record and its compatible completion both carry provider data, when metrics and cost accounting consume them, then they count that invocation/usage once even when same-name executions interleave.
- Given malformed, unmatched, or incomplete historical lifecycle evidence, when it is processed, then it neither becomes a fabricated exact measurement nor closes an unrelated context-bearing execution; a legacy orphan completion does not create an orphan span.

### Done When
- [ ] Legacy and context-bearing fixtures preserve their expected parsed timing states, and overlapping group/member intervals produce a union total rather than a sum.
- [ ] Metering fixtures assert exact dispatch/token/cost totals under compatible-completion and interleaving cases; malformed/orphan fixtures assert honest absence or incomplete evidence.

Coverage disposition: EventPersister/timing-reader integration over temporary ledgers; lower-layer metering and span-manager tests. No historical production file is rewritten or backfilled.

## Story 7: A dispatch-path omission is caught before release

**Requirement:** #2414 recurrence-prevention outcome; ADR Decision 7.

As a harness maintainer, I want mechanical parity coverage to detect an uninstrumented execution path so that adding a built-in member cannot silently remove its duration signal.

### Acceptance Criteria

#### Happy Path
- Given the current built-in group registry, when parity coverage runs, then every dispatchable member is exercised through the actual grouped entry path and checked for member-specific lifecycle, duration, and span output, without a separately maintained member allowlist.
- Given serial, width-one, cap-one multi-member, wider built-in, and configured-group paths, when the common parity scenarios run, then each path produces the applicable equivalent observations with all providers and exporters controlled locally.

#### Negative Paths
- Given a dispatch still reaches its fake runner but member lifecycle emission is omitted, when the parity scenario runs, then its behavioral assertions fail on the missing lifecycle/duration/span rather than passing because the event type appears in an OTel registry.
- Given a new built-in member or changed skip policy, when the coverage inventory resolves the production registry, then it exercises the new applicable member or demonstrates its legitimate non-dispatch; an unexercised member cannot silently satisfy coverage.

### Done When
- [ ] Production registry-driven fixtures cover every applicable member and each named scheduling shape with bounded start, expected dispatches, and termination conditions.
- [ ] The parity assertions discriminate a missing-emission counterfactual while executing real internal wiring; all third-party calls are fake and all async cleanup is awaited.

Coverage disposition: one shared, bounded orchestration integration matrix. Failure permutations already covered below are not duplicated as separate full-workflow acceptance specs. Tests derive cases from actual membership, not source-string matching.

## Negative-category review

Concurrency, partial failure, interruption, dependency unavailability, resource admission, deduplication, data integrity, and alternate-path omission are covered above. Provider authentication/permission refusals are observed through existing typed outcomes, without changing their recovery policy. Configured names and historical event shape are the relevant input boundaries. No endpoint authorization, data deletion, schema migration, or user-upload surface is introduced. Export failures and persistence failures remain separate policies. All proof uses injected clocks and third-party fakes.

## Verify-claims ledger

Verified: existing serial and grouped entry points, group registry, shared metric listener, span manager, persister, timing rollup, and dispatch metering support the described proof boundaries. Source/test rediscovery seeds: conductor.ts dispatchGroupRound/runParallelGroupViaCore/emitExecutionEvent; group-core.ts runGroupBranch/runWithConcurrency; group-core.test.ts cap, retry, interval, and detached-session fixtures; event-persister.ts; timing-rollup.ts; otel/metrics-listener.ts; otel/span-manager.ts; dispatch-metering.ts.

The scenarios derive from the approved architecture. No new execution or gate policy is proposed. Stories accepted by the operator on 2026-09-10.

