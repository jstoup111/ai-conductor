**Status:** Accepted

# Stories: Measured feature active duration always reaches OTEL

Technical track (no PRD). Tier: M. Scope boundary: `.docs/track/feature-active-duration-is-dropped-from-otel-whene.md`.
Governing decisions: `adr-014-otel-observability-exporter` Decision 9 as amended 2026-10-26, and
`.docs/decisions/architecture-review-2026-10-26-feature-active-duration-is-dropped-from-otel-whene.md`
conditions C1 to C4.

**Intent.** Since 2026-10-24 every shipped feature's timing rollup has been `partial`, and the OTEL
listener records `conductor.feature.duration.active` only for `exact` rollups, so Datadog receives
no active duration. Recent ships are `provider-evidence-incomplete` with a measured active total;
older ones are `active-evidence-incomplete` because of retired `coverage_binding` step events.

Terms used below:

- **Reason class:** one of `empty-active-union`, `active-evidence-incomplete`, `open-executions`,
  `provider-outside-active-union`, `provider-evidence-incomplete`, `ledger-unreadable`.
- **Active point:** a data point on `conductor.feature.duration.active`.
- **Missing count:** an increment of `conductor.feature.duration.active.missing`.
- **Pre-spawn failure:** a provider dispatch that returns failure before any provider subprocess is
  started. The closed set is: an abort observed before spawn (all adapters); git-guard setup (all
  adapters); Claude's interactive native-schema refusal; Codex readiness and native-schema setup; Pi's
  missing `HARNESS.md`, unresolved skill command, native-schema setup, and missing subagents package;
  and the engine's native-schema scratch-home acquisition.

## Story 1: A measured active duration reaches OTEL with its timing state and reason

As an operator reading feature metrics in Datadog, I want every measured active duration exported
with its timing state, and every unmeasured one counted with its reason, so that active time is
never silently missing.

### Acceptance Criteria

#### Happy Path
- Given feature S ships with tier M and a timing rollup of state exact and active total 5000 ms, when the ship is recorded, then conductor.feature.duration.active has one point of 5000 for feature S carrying tier M and state exact and no reason attribute, and the missing counter is not incremented
- Given feature S ships with a rollup of state partial, reason provider-evidence-incomplete, and active total 23907699 ms, when the ship is recorded, then conductor.feature.duration.active has one point of 23907699 carrying state partial and reason provider-evidence-incomplete, and the missing counter is not incremented
- Given the daemon ships feature S whose rollup is partial with reason provider-evidence-incomplete, when it emits feature_shipped, then the event's active object carries state partial, the active total, and reason provider-evidence-incomplete

#### Negative Paths
- Given feature S ships with a rollup of state partial and reason active-evidence-incomplete and no active total, when the ship is recorded, then conductor.feature.duration.active has no point for S (absent, never zero), the missing counter gains one increment carrying state partial and reason active-evidence-incomplete, and conductor.feature.duration.wall is still recorded
- Given feature S ships with a rollup of state unavailable, when the ship is recorded, then no active point is recorded for S and the missing counter gains one increment carrying state unavailable and no reason attribute
- Given a rollup whose reason is open-executions naming the keys step:build and parallel:wiring_check, when feature_shipped is emitted and recorded, then the event's reason and the missing counter's reason attribute are exactly open-executions and contain no execution key
- Given a worktree whose events.jsonl contains a line that is not valid JSON, when feature S ships, then feature_shipped carries state partial with reason ledger-unreadable and no active total, the missing counter records reason ledger-unreadable, and the shipped record's Time block is unchanged from today's reason-free partial
- Given a feature_shipped from an older ledger with state partial, an active total, and no reason field, when it is replayed through the listener, then one active point is recorded carrying state partial and no reason attribute, with no placeholder value
- Given a feature_shipped whose active total is not a finite number, when it is recorded, then no active point is recorded and the missing counter gains one increment carrying the event's state

### Done When
- [ ] A listener test records feature_shipped events for exact, partial with an active total, partial without one, and unavailable, and asserts the exact attribute set and value of every active point and missing-counter increment
- [ ] A daemon-runner test asserts feature_shipped carries the reason class for each of the five rollup routes and for an unreadable ledger, with open execution keys collapsed to open-executions
- [ ] A test asserts the instrument named conductor.feature.duration.active.missing exists and that no data point on either instrument carries a label name outside the existing closed vocabulary
- [ ] A test replays a reason-free legacy feature_shipped and asserts it is accepted and recorded without a reason attribute

## Story 2: Ledgers written before coverage_binding was retired keep their measured active time

As an operator, I want features whose ledgers still carry retired coverage_binding step events to
report measured active time, so that the step's retirement does not degrade their timing.

### Acceptance Criteria

#### Happy Path
- Given a ledger where every step_started has a matching terminal with an active interval, including a step_started and step_completed pair for coverage_binding whose executionContext subject is lifecycle-step coverage_binding, when the timing rollup is computed, then its state is exact and its active total includes the coverage_binding interval
- Given the same ledger with context-free coverage_binding start and terminal events, when the timing rollup is computed, then its state is exact

#### Negative Paths
- Given a ledger with a coverage_binding step_started carrying an executionContext and no matching terminal, when the timing rollup is computed, then its state is partial with reason open-executions
- Given a ledger whose step_started and step_completed name a lifecycle-step subject that has never been a built-in step, such as not_a_real_step, when the timing rollup is computed, then its state is partial with reason active-evidence-incomplete
- Given a coverage_binding lifecycle-step execution context, when it is resolved outside the timing rollup, then it is still rejected as an unknown step exactly as before

### Done When
- [ ] A timing-rollup test over a correlated ledger containing a closed coverage_binding execution asserts state exact and the expected active total
- [ ] A timing-rollup test asserts an open coverage_binding execution yields open-executions and an unknown never-built-in step yields active-evidence-incomplete
- [ ] A test asserts the global step-name guard still rejects coverage_binding

## Story 3: A provider failure before spawn is not recorded as an invoked attempt

As an operator, I want a provider dispatch that failed before starting the provider to be recorded
as not invoked, so that it does not demand observed provider time that never existed.

### Acceptance Criteria

#### Happy Path
- Given a Codex dispatch with a native schema and no scratch home available, when the dispatch fails native-schema setup, then its provider_attempt is recorded with invoked false, outcome failure, and the setup failure reason
- Given a Claude, Codex, or Pi dispatch whose git-guard setup throws, when the dispatch returns, then its provider_attempt is recorded with invoked false
- Given a Pi dispatch whose native-schema setup throws, when the dispatch returns, then its provider_attempt is recorded with invoked false
- Given the engine fails to acquire a native-schema scratch home before invoking the provider, when the attempt is recorded, then it is recorded with invoked false
- Given a Pi dispatch refused before spawn because HARNESS.md is missing, its skill command is unresolved, or its enabled subagents package is not installed, or a Claude interactive dispatch carrying a native schema, or any adapter dispatch whose abort signal fired before spawn, when the dispatch returns, then its provider_attempt is recorded with invoked false and the refusal keeps its existing unavailable, unresolved-command, or unsupported flag
- Given a ledger whose only provider anomalies are pre-spawn failures and whose active evidence is complete, when the timing rollup is computed, then its state is exact

#### Negative Paths
- Given a provider subprocess that starts and exits non-zero, when the attempt is recorded, then it is recorded with invoked true and the result carries no executionDisposition
- Given a Codex or Pi dispatch whose abort signal fires after its subprocess has started, when it returns, then its provider_attempt is recorded with invoked true, the result carries no executionDisposition, and it keeps its streamed token usage
- Given an invoked attempt whose provider ran but reported no observed interval, when the timing rollup is computed, then its state is still partial with reason provider-evidence-incomplete
- Given a native-schema scratch-home teardown that fails after the provider ran, when the attempt is recorded, then it is recorded with invoked true and keeps the provider's observed intervals and token usage
- Given a pre-spawn failure on a provider, when the next dispatch to that provider runs, then that provider is attempted normally and is not recorded as cached-unavailable or suppressed
- Given a CI-fix repair session whose provider dispatch ends in a pre-spawn failure, when the session outcome is classified, then its kind is not-started rather than failed

### Done When
- [ ] Adapter tests for Claude, Codex, and Pi assert each return in the closed pre-spawn set carries executionDisposition not-started and returns after spawn, including a post-spawn abort, do not
- [ ] A provider-execution test asserts attempt metadata records invoked false for a not-started result and invoked true for a spawned failure
- [ ] A provider-execution test asserts scratch acquisition failure records invoked false and teardown failure after invocation keeps observed intervals
- [ ] A test asserts a pre-spawn failure leaves the provider's availability and suppression state unchanged

## Story 4: Remediation closure judgement runs on Codex outside self-host builds

As an operator, I want the remediation closure judgement to receive a native-schema scratch home,
so that a Codex-routed judgement actually runs instead of failing setup on every attempt.

### Acceptance Criteria

#### Happy Path
- Given a non-self-host build whose remediation closure judgement routes to Codex, when the judgement is dispatched, then the Codex invocation receives an owned native-schema scratch home under the feature worktree, the provider runs, and its provider_attempt is recorded with invoked true and at least one observed interval
- Given a self-host build whose remediation closure judgement routes to Codex, when the judgement is dispatched, then it uses the self-host provider home exactly as other self-host native-schema dispatches do

#### Negative Paths
- Given the scratch home cannot be acquired for the closure judgement, when the judgement is attempted twice, then no provider subprocess is started, both attempts are recorded with invoked false, and the judgement ends unjudged exactly as any twice-failed closure-judgement dispatch does
- Given two features whose closure judgements run concurrently, when both dispatch to Codex, then each receives a distinct scratch home and neither reads the other's schema

### Done When
- [ ] A step-runner test asserts the closure-judgement dispatch passes a native-schema scratch input naming the feature worktree, matching the other native-schema auxiliary dispatches
- [ ] A test asserts a Codex-routed closure judgement in a non-self-host run reaches provider invocation instead of returning the scratch-home setup failure
- [ ] A test asserts two concurrent closure-judgement dispatches receive distinct scratch homes
