# Implementation Plan: Provider substitution policy and exhaustion suppression

**Date:** 2026-09-23
**Stories:** .docs/stories/usage-exhaustion-re-dispatches-the-exhausted-provi.md
**Conflict check:** Clean as of 2026-09-23

## Summary

Adds a provider-substitution policy and a daemon-scoped suppression window for a usage-exhausted provider, in 20 tasks across configuration, candidate admission, telemetry, and durability.

## Technical Approach

The work lands in one subsystem through four seams, in this order.

**Configuration.** A new optional substitution-policy value is declared at run level and step level, validated fail-closed, and declared in the total config-key consumer registry. It changes `resolveProviderCandidates` from returning the union of step selection and configured providers to returning the step's own selection alone. Unset, the union is returned exactly as today.

**Admission.** A single admission function is consulted per candidate immediately before dispatch, in the existing candidate loop. Policy refusal and suppression refusal both exit through it; no candidate path bypasses it. Refusals reuse the existing provider attempt record with `invoked` false, extending its closed skip-reason set rather than minting a new event.

**Availability state.** A new pure, clock-injected module holds suppression windows keyed by provider. It is constructed once at daemon startup beside the rate-limit episode and injected into each conductor, above the per-feature run boundary that rebuilds every provider runtime. An absent store means today's behavior. Suppression is written only for the usage-exhaustion class, never for the authentication-failure or expired-session classes that share the same recovery-precedence guard.

**Telemetry and durability.** The rate-limit record gains an optional provider and deadline, stamped at its single existing emit site; both are optional so historical records keep their meaning. Durability across a daemon replacement comes from emitting the suppression record daemon-origin, because the daemon-wide ledger drops feature-forwarded events.

Local pattern context: the availability module mirrors the existing rate-limit episode coordinator — pure, injected clock, no ambient time, no I/O — and its injection mirrors that coordinator's optional-dependency wiring, where an absent dependency means current behavior. Preserve those traits; the allowed variation is per-provider keying and the absence of a wait primitive. Rediscover both by searching the engine directory for a coordinator taking an injected now function, and daemon startup for where that coordinator is constructed. Do not anchor to line numbers.

Sequencing rationale: configuration and the availability module are independent roots and can run in parallel; admission depends on the module; telemetry depends on admission; the wait behavior depends on the refusal records existing.

## Prerequisites
- None. No migration, no new dependency, no external setup.

## Tasks

### Task 1: Declare the substitution-policy configuration and its fail-closed validation
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests: a value outside the accepted closed set fails config load with an error naming the key; a config omitting the key loads with the value absent; a user-level value applies when the project omits the key, and the project value wins when both set it.
2. Verify tests fail (RED)
3. Implement the optional run-level and step-level declaration plus its fail-closed check, reusing the existing validation branch shape rather than adding a parallel validator.
4. Verify tests pass (GREEN)
5. Commit with message: "feat(config): declare provider substitution policy"

**Done when:**
- the config type declares the substitution-policy value as optional at run level and step level, and a value outside its closed set fails config load with an error naming the key
- a config omitting the key loads with the value absent rather than a materialized default, asserted by the loader test
- existing user-under-project precedence governs the new key, asserted by a merge test in which the project value wins and a user-only value survives

**Files likely touched:**
- src/conductor/src/types/config.ts — add the optional substitution-policy value at run level and step level
- src/conductor/src/engine/config.ts — fail-closed type check and precedence for the new key

**Dependencies:** none

### Task 2: Declare the new config key in the config-key consumer registry
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing test: the total config-key consumer registry contains a declaration for the new key.
2. Verify test fails (RED)
3. Implement the declaration naming its production consumer.
4. Verify test passes (GREEN)
5. Commit with message: "feat(config): declare consumer for substitution policy key"

**Done when:**
- the new key carries a consumer declaration in the total config-key consumer registry, and the registry still typechecks as total
- the declaration names candidate resolution as the production consumer rather than recording no consumer

**Files likely touched:**
- src/conductor/src/types/config.ts — add the consumer declaration for the new key

**Dependencies:** 1

### Task 3: Narrow the resolved candidate list when substitution is disallowed
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests for the four resolution outcomes below, driving resolveProviderCandidates directly.
2. Verify tests fail (RED)
3. Implement the narrowing inside resolveProviderCandidates, the single existing resolver every candidate list already flows through.
4. Verify tests pass (GREEN)
5. Commit with message: "feat(provider): narrow candidates when substitution is disallowed"

**Done when:**
- resolveProviderCandidates returns only the step selection when the policy disallows substitution and the step declares a selection
- resolveProviderCandidates returns the configured global list unchanged when the policy disallows substitution and the step declares no selection of its own
- with the policy unset, resolveProviderCandidates returns the union of step selection and configured providers, byte-identical to the pre-change result for the same inputs
- a policy set for one step narrows only that step, asserted by resolving two steps where one sets the policy and the other does not, with each scope governing its own step
- with substitution disallowed at the global scope and permitted for exactly one step, resolveProviderCandidates returns the permitted union for that step while every other step resolves to the global disallowed result, asserted over that exact configuration with neither scope silently overriding the other

**Files likely touched:**
- src/conductor/src/engine/provider-selection.ts — narrow the union when the policy disallows substitution

**Dependencies:** 1

### Task 4: Preserve unregistered-provider validation and run-scoped unavailability under a narrowed list
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests: a step selecting an unregistered provider still raises the existing validation error; with substitution disallowed, a single candidate raising run-scoped unavailability surfaces rather than falling back.
2. Verify tests fail (RED)
3. Implement so narrowing runs before neither validation nor unavailability handling is bypassed.
4. Verify tests pass (GREEN)
5. Commit with message: "fix(provider): keep validation reachable under a narrowed candidate list"

**Done when:**
- a step selecting a provider absent from the registered set raises the existing unregistered-provider validation error rather than widening the list to a registered fallback
- with substitution disallowed, a single candidate raising a run-scoped unavailability surfaces that unavailability and no other provider is invoked, asserted by attempt records naming only the pinned provider

**Files likely touched:**
- src/conductor/src/engine/provider-selection.ts — keep the existing validation path reachable under narrowing

**Dependencies:** 3

### Task 5: Introduce the provider availability store as a pure, clock-injected module
**Story:** 3
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing tests for the four properties below against an injected clock.
2. Verify tests fail (RED)
3. Implement the module mirroring the existing rate-limit episode module shape: pure, clock-injected, no ambient time and no I/O. Preserve those traits; the allowed variation is the keying by provider and the absence of a wait primitive. Find the comparable module by searching the engine directory for a coordinator taking an injected now function.
4. Verify tests pass (GREEN)
5. Commit with message: "feat(provider): add the provider availability store"

**Done when:**
- the store answers admission and records suppression against an injected clock, and the module performs no filesystem or ledger access
- the later of two competing deadlines for one provider governs its window, asserted by recording an earlier deadline second
- a deadline at or before the injected now leaves the provider admitted rather than suppressed
- the store exposes no permanent-unavailability state and never reorders providers, asserted after repeated suppression and expiry cycles
- with one provider suppressed, the resolved candidate list keeps the same providers in the same order as the unsuppressed resolution and differs only in that provider's admission, asserted by comparing both resolutions

**Files likely touched:**
- src/conductor/src/engine/provider-availability.ts — new module holding suppression windows keyed by provider

**Dependencies:** none

### Task 6: Construct the availability store at daemon startup and inject it per feature run
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing tests: a suppression recorded during one feature run is observed by a later feature run in the same process; an absent store leaves behavior unchanged.
2. Verify tests fail (RED)
3. Implement construction above the per-feature boundary and injection through the existing conductor injection sites, following the same optional-dependency shape the rate-limit episode already uses so an absent dependency means current behavior. Find it by searching daemon-cli for the rate-limit episode construction.
4. Verify tests pass (GREEN)
5. Commit with message: "feat(daemon): inject the provider availability store"

**Done when:**
- the store is constructed once at daemon startup beside the rate-limit episode and injected into each conductor through the existing injection sites, above the per-feature run boundary
- a suppression recorded during one feature run is still observed by a later feature run in the same process, asserted across two feature-run boundaries that rebuild the provider runtimes
- an absent store leaves candidate admission and provider attempts identical to pre-change behavior and raises no error

**Files likely touched:**
- src/conductor/src/daemon-cli.ts — construct the store once beside the rate-limit episode and pass it to each conductor
- src/conductor/src/engine/conductor.ts — accept and hold the injected store

**Dependencies:** 5

### Task 7: Add the admission gate to the candidate loop
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests: a refused candidate never reaches the process-spawn seam; the admission decision performs no I/O.
2. Verify tests fail (RED)
3. Implement one admission function consulted per candidate immediately before dispatch, with no candidate path bypassing it.
4. Verify tests pass (GREEN)
5. Commit with message: "feat(provider): gate candidate dispatch on admission"

**Done when:**
- candidate execution consults a single admission function before invoking any candidate, and no candidate path reaches the dispatch seam without it
- a refused candidate never reaches the process-spawn seam, asserted with that seam mocked to fail if reached
- the admission decision performs no filesystem or ledger read, asserted with the I/O seam mocked to throw

**Files likely touched:**
- src/conductor/src/engine/provider-execution.ts — consult a single admission function before invoking any candidate

**Dependencies:** 5

### Task 8: Record both refusal classes on the existing provider attempt record
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests for the five record outcomes below.
2. Verify tests fail (RED)
3. Implement the closed-set extension and the emission, handling the set exhaustively.
4. Verify tests pass (GREEN)
5. Commit with message: "feat(telemetry): record provider admission refusals"

**Done when:**
- the skip-reason set gains the policy-refusal and suppression-refusal members within its existing closed set, so an existing provider attempt reader parses a refusal record without modification
- the dispatch path passes the step's substitution policy to resolveProviderCandidates so a policy-forbidden candidate is never in the dispatch list and emits no provider attempt
- a suppression-refused candidate emits a provider attempt carrying invoked false and the suppression refusal reason
- an admitted candidate emits a provider attempt carrying invoked true and no refusal reason
- a candidate that is both policy-forbidden and suppressed emits no provider attempt, and a suppressed candidate the policy permits emits exactly one provider attempt carrying exactly one refusal reason

**Files likely touched:**
- src/conductor/src/types/events.ts — extend the closed skip-reason set with the two refusal members
- src/conductor/src/engine/provider-execution.ts — emit the refusal attempt record

**Dependencies:** 7

### Task 9: Keep a refusal effective when its telemetry fails or the loop revisits it
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests: a telemetry failure leaves the candidate refused; a revisited candidate is refused again; an unconfigured run emits no refusal record.
2. Verify tests fail (RED)
3. Implement so the refusal decision is independent of its telemetry emission.
4. Verify tests pass (GREEN)
5. Commit with message: "fix(provider): keep refusals effective when telemetry fails"

**Done when:**
- a telemetry emission failure on a refusal routes through the existing attempt-telemetry error path while the candidate remains refused and unspawned
- a provider refused earlier in the same step is refused again when the candidate loop reaches it, without a subprocess
- with no policy configured and no suppression in force, the gate admits every candidate and emits no refusal record

**Files likely touched:**
- src/conductor/src/engine/provider-execution.ts — preserve refusal under telemetry failure and repeat visits

**Dependencies:** 8

### Task 10: Carry the provider and deadline on the rate-limit record
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests for the five record outcomes below, including a pre-change fixture.
2. Verify tests fail (RED)
3. Implement both fields as optional and stamp them at the single existing emit site, following the optional-field precedent used when the halt record gained its step field. Preserve that trait: historical records keep their meaning. Find it by searching the event types for an optional field added for attribution.
4. Verify tests pass (GREEN)
5. Commit with message: "feat(telemetry): name the exhausted provider and its deadline"

**Done when:**
- the rate-limit record declares provider and deadline as optional fields, and a pre-change record fixture parses and renders unchanged
- a rate-limited result carrying a parsed deadline emits a record carrying the exhausted provider and that deadline
- a rate-limited result carrying no parsed deadline emits a record carrying the provider and the bounded deadline actually used for the wait
- the record is routed by its existing sink declaration with no change to the event-sink registry entry
- the provider, the refusal reason, and the remaining time to re-attempt are derivable from the persisted records alone

**Files likely touched:**
- src/conductor/src/types/events.ts — add the two optional fields to the rate-limit record
- src/conductor/src/engine/conductor.ts — stamp the fields at the existing emit site

**Dependencies:** none

### Task 11: Bound and sanitize what the rate-limit record carries
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests for the five outcomes below, including a limit message bearing an account identifier.
2. Verify tests fail (RED)
3. Implement clamping before application and before recording, and a sanitized reason.
4. Verify tests pass (GREEN)
5. Commit with message: "fix(telemetry): bound and sanitize rate-limit record fields"

**Done when:**
- a parsed deadline beyond the accepted bound is clamped before it is applied and before it is recorded
- a provider limit message containing an account identifier does not appear verbatim in any persisted record
- a rate-limited result whose provider cannot be determined omits the provider field rather than recording an empty or guessed value
- a consumer reading only the pre-change fields processes a record carrying the new fields unchanged
- the OpenTelemetry exporter subscription list is unchanged by this feature, asserted against its declared list rather than assumed

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — clamp the deadline and sanitize the recorded reason

**Dependencies:** 10

### Task 12: Open a suppression window only for usage exhaustion
**Story:** 3
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests: an authentication failure and an expired session each leave the provider admitted; only usage exhaustion suppresses.
2. Verify tests fail (RED)
3. Implement the write scoped to the usage-exhaustion class rather than to the shared recovery-precedence guard.
4. Verify tests pass (GREEN)
5. Commit with message: "fix(provider): suppress only on usage exhaustion"

**Done when:**
- the rate-limit branch records suppression only for the usage-exhaustion class, not for every class sharing the recovery-precedence guard
- an authentication failure leaves the provider admitted, so the existing park-and-poll wait can resume the same attempt after credentials refresh, and opens no suppression window
- an expired session leaves the provider admitted and opens no suppression window

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — record suppression only for the usage-exhaustion class

**Dependencies:** 6

### Task 13: Re-admit a provider when its window elapses
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests for the five expiry outcomes below by advancing the injected clock.
2. Verify tests fail (RED)
3. Implement expiry as a comparison against the injected clock, with no separate clearing step an operator must trigger.
4. Verify tests pass (GREEN)
5. Commit with message: "feat(provider): expire suppression windows automatically"

**Done when:**
- advancing the injected clock past a suppression deadline admits the provider again with no operator action, and the next dispatch invokes that provider, asserted on the injected provider invoker
- advancing the injected clock past the bounded default interval admits a provider suppressed with no parsed deadline
- a provider re-admitted after expiry and exhausted again receives a fresh window rather than an extension of the previous one
- two admission evaluations at nearly the same moment just after a deadline both observe the provider admitted
- a provider admitted after expiry and succeeding is treated as ordinarily available by subsequent steps

**Files likely touched:**
- src/conductor/src/engine/provider-availability.ts — expiry and re-admission behavior

**Dependencies:** 5

### Task 14: Bound suppression against clock regression and multi-provider expiry
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests: a backward clock movement does not extend suppression past the bounded maximum; every provider is admitted once all deadlines elapse.
2. Verify tests fail (RED)
3. Implement the bound.
4. Verify tests pass (GREEN)
5. Commit with message: "fix(provider): bound suppression against clock regression"

**Done when:**
- a backward system-clock movement leaves the provider suppressed no longer than the bounded maximum window
- once every configured provider deadline elapses, all providers are admitted again without a process restart

**Files likely touched:**
- src/conductor/src/engine/provider-availability.ts — bound the window against clock movement

**Dependencies:** 13

### Task 15: Yield the existing wait when every candidate is suppressed
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests for the five outcomes below, including assertions that no halt marker is written and no step-level refused status is stamped.
2. Verify tests fail (RED)
3. Implement the all-suppressed return as the rate-limited outcome, never a candidates-exhausted failure.
4. Verify tests pass (GREEN)
5. Commit with message: "fix(provider): all-suppressed candidates wait rather than fail"

**Done when:**
- a step whose every candidate is suppressed yields the rate-limited outcome and the conductor enters its existing wait
- such a step does not report candidates exhausted, does not raise a provider-unavailable failure, and writes no halt marker
- such a step carries no step-level refused status and emits no step-refusal event
- the retry budget is unchanged across a fully-suppressed step, including when the budget is nearly consumed
- the wait is entered by the step itself, asserted with the daemon dispatch gate inactive

**Files likely touched:**
- src/conductor/src/engine/provider-execution.ts — return the rate-limited outcome when all candidates are refused by suppression
- src/conductor/src/engine/conductor.ts — enter the existing wait on that outcome

**Dependencies:** 8

### Task 16: Preserve loop non-advancement and existing failure classification
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests for the four outcomes below.
2. Verify tests fail (RED)
3. Implement without altering the recovery-precedence short-circuit.
4. Verify tests pass (GREEN)
5. Commit with message: "test(provider): pin non-advancement and failure classification"

**Done when:**
- a rate-limited result still does not advance the candidate loop to another provider
- a step whose first candidate is suppressed and whose second is admitted executes the second candidate and enters no wait
- a genuine provider failure alongside a suppressed candidate retains its existing classification and is not reported as a rate limit
- with substitution disallowed and the single pinned candidate suppressed, the step waits rather than halting or invoking another provider

**Files likely touched:**
- src/conductor/src/engine/provider-execution.ts — leave the recovery-precedence short-circuit intact

**Dependencies:** 15

### Task 17: Confirm the rate-limit episode coordinator is untouched
**Story:** 6
**Type:** verification

**Steps:**
1. Inspect the feature diff for any change to the rate-limit episode module.
2. Run the existing rate-limit episode tests unchanged.
3. Record the result; complete with an evidence trailer rather than a code commit.

**Done when:**
- the rate-limit episode module is absent from this feature diff and its existing tests pass without amendment
- the episode entry, deadline, and escalation behavior are unaffected when a provider is suppressed

**Files likely touched:**
- none

**Verify-only:** yes

**Dependencies:** 15

### Task 18: Persist the suppression as a daemon-origin record
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests: the record appears in the daemon-wide ledger after a feature-run emission; a persistence failure surfaces without disabling in-memory suppression.
2. Verify tests fail (RED)
3. Implement the emission so it is not feature-forwarded, since the daemon ledger drops feature-forwarded events.
4. Verify tests pass (GREEN)
5. Commit with message: "feat(daemon): persist provider suppression daemon-origin"

**Done when:**
- the suppression record reaching the daemon-wide ledger is not feature-forwarded, asserted by its presence in that ledger after a feature-run emission
- a persistence failure surfaces through the existing error path while in-memory suppression still takes effect for the current process
- any new event type introduced for durability carries a sink declaration in the total event-sink registry, and the registry still typechecks as total
- a replaced daemon process spawns at most one real invocation to rediscover a provider whose window has not elapsed

**Files likely touched:**
- src/conductor/src/daemon-cli.ts — emit the suppression record daemon-origin
- src/conductor/src/engine/event-persister.ts — route the daemon-origin record to the daemon ledger

**Dependencies:** 6

### Task 19: Share suppression across concurrent and later steps
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests: a provider suppressed in one feature run is refused in a concurrent one; an unsuppressed provider stays admitted; a later step honours an earlier step's window.
2. Verify tests fail (RED)
3. Implement by consulting the single injected store rather than any per-runtime cache.
4. Verify tests pass (GREEN)
5. Commit with message: "feat(provider): share suppression across concurrent features"

**Done when:**
- a provider suppressed in one feature run is refused in a concurrently running feature rather than re-earned independently there
- a different provider remains admitted while one provider is suppressed
- a provider suppressed during an earlier step is refused without a subprocess in a later step while its window is unexpired

**Files likely touched:**
- src/conductor/src/engine/provider-execution.ts — consult the shared store for every candidate

**Dependencies:** 6

### Task 20: Prove admission through the daemon dispatch entry point
**Story:** 1
**Story:** 2
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing integration tests driving a step through the daemon dispatch entry point rather than calling the gate directly.
2. Verify tests fail (RED)
3. Wire nothing new; this task proves the existing entry point reaches the admission behavior the sibling tasks implement.
4. Verify tests pass (GREEN)
5. Commit with message: "test(provider): prove admission through daemon dispatch"

**Done when:**
- driving a step through the daemon dispatch entry point with substitution disallowed produces provider attempt records naming only the pinned provider and no other
- driving a later step through the same entry point after a provider is suppressed produces a refusal record and no subprocess for that provider

**Files likely touched:**
- src/conductor/test/provider-admission-entry.test.ts — integration coverage through the daemon dispatch entry point

**Dependencies:** 15

### Task 21: Wire usage-exhaustion suppression into both GroupCore consumers
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests driving the built-in validation group and a configured parallel group through GroupCore with a member reporting usage exhaustion, authentication failure, and expired session.
2. Verify tests fail (RED)
3. Implement by extending the branch-executor dependencies with the availability store and the daemon-origin persistence callback, and opening the window in the GroupCore rate-limit branch exactly as the serial branch in conductor.ts does.
4. Verify tests pass (GREEN)
5. Commit with message: "feat(provider): suppress exhausted providers from GroupCore members"

**Done when:**
- both production GroupCore consumers open the shared suppression window and call the daemon-origin persistence callback when a group member reports usage exhaustion, exactly as the serial rate-limit branch does
- a usage-exhausted group member's provider is refused without a subprocess in a later or concurrent feature dispatch while its window is unexpired
- an authentication failure or expired session reported by a group member opens no suppression window and writes no suppression record

**Files likely touched:**
- src/conductor/src/engine/group-core.ts — extend branch-executor dependencies and the rate-limit branch
- src/conductor/src/engine/conductor.ts — pass the store and persistence callback at both GroupCore roots

**Dependencies:** 12, 18

### Task 22: Remove the unreachable policy-refusal surface
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests asserting the skip-reason set and the gate's refusal reasons contain no policy member.
2. Verify tests fail (RED)
3. Remove the policy-refused reason, its skip-reason member, and the dead gate and executor paths in provider-execution.ts and provider-selection.ts, per ADR D1 as amended 2026-09-25.
4. Verify tests pass (GREEN)
5. Commit with message: "refactor(provider): remove unreachable policy-refusal surface"

**Done when:**
- the policy-refused refusal reason and skip-reason member are removed, and the admission gate carries no substitution-policy branch
- resolveProviderCandidates remains the sole owner of substitution policy, and a policy-forbidden candidate still emits no provider attempt

**Files likely touched:**
- src/conductor/src/engine/provider-execution.ts — remove the gate's policy branch and its refusal handling
- src/conductor/src/engine/provider-selection.ts — keep narrowing as the sole policy owner
- src/conductor/src/types/events.ts — remove the policy skip-reason member

**Dependencies:** 8

## Task Dependency Graph

```text
Task 1 ──┬─ Task 2
         └─ Task 3 ── Task 4
Task 5 ──┬─ Task 6 ──┬─ Task 12
         │           ├─ Task 18
         │           └─ Task 19
         ├─ Task 7 ── Task 8 ──┬─ Task 9
         │                    └─ Task 15 ──┬─ Task 16
         │                                 ├─ Task 17
         │                                 └─ Task 20
         └─ Task 13 ── Task 14
Task 10 ── Task 11
Task 12 ── Task 21
Task 18 ── Task 21
Task 8 ── Task 22
```

## Integration Points
- After Task 8: a refused candidate is observable end to end in the attempt records.
- After Task 15: the full all-suppressed path can be exercised without a halt.
- After Task 20: admission is proven through the daemon dispatch entry point.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given substitution is disallowed globally and a step selects one provider, when its candidate list is resolved, then the list contains only that provider. | 3 | "resolveProviderCandidates returns only the step selection when the policy disallows substitution and the step declares a selection" | diff-local |
| Story 1 happy: Given substitution is disallowed for one step only and other steps are unconfigured, when each candidate list is resolved, then only that step's list is narrowed and every other step resolves to today's union. | 3 | "a policy set for one step narrows only that step, asserted by resolving two steps where one sets the policy and the other does not, with each scope governing its own step" | diff-local |
| Story 1 happy: Given substitution is disallowed and a step declares no selection of its own, when its candidate list is resolved, then it resolves to the configured global list unchanged, because there is no pin to narrow to. | 3 | "resolveProviderCandidates returns the configured global list unchanged when the policy disallows substitution and the step declares no selection of its own" | diff-local |
| Story 1 happy: Given no substitution setting appears in either scope, when any candidate list is resolved, then the result is the union of step selection and configured providers, identical to current behavior. | 3 | "with the policy unset, resolveProviderCandidates returns the union of step selection and configured providers, byte-identical to the pre-change result for the same inputs" | diff-local |
| Story 1 happy: Given substitution is disallowed and the step's single candidate is refused admission, when the step runs, then no attempt is recorded against any provider other than the step's own selection. | 20 | "driving a step through the daemon dispatch entry point with substitution disallowed produces provider attempt records naming only the pinned provider and no other" | diff-local |
| Story 1 negative: Given substitution is disallowed globally and a step selects a provider absent from the registered provider set, when configuration is loaded, then the existing unregistered-provider validation error is raised rather than silently widening the list to a registered fallback. | 4 | "a step selecting a provider absent from the registered set raises the existing unregistered-provider validation error rather than widening the list to a registered fallback" | diff-local |
| Story 1 negative: Given the substitution setting carries a value outside its accepted closed set, when configuration is loaded, then loading fails with the existing fail-closed type error naming the key, and no run begins under an assumed default. | 1 | "the config type declares the substitution-policy value as optional at run level and step level, and a value outside its closed set fails config load with an error naming the key" | diff-local |
| Story 1 negative: Given substitution is disallowed at the global scope and permitted for one step, when that step's candidate list is resolved, then the step's own setting governs that step and the global setting continues to govern every other step, with neither silently overriding the other. | 3 | "a policy set for one step narrows only that step, asserted by resolving two steps where one sets the policy and the other does not, with each scope governing its own step" | diff-local |
| Story 1 negative: Given substitution is disallowed and the step's only candidate raises a run-scoped unavailability that today triggers fallback, when the step runs, then the unavailability surfaces instead of another provider being invoked. | 4 | "with substitution disallowed, a single candidate raising a run-scoped unavailability surfaces that unavailability and no other provider is invoked, asserted by attempt records naming only the pinned provider" | diff-local |
| Story 1 negative: Given a project configuration omits the substitution setting entirely, when it is loaded alongside a user-level configuration that sets it, then existing user-under-project precedence applies and the resolved list matches that precedence rather than a hardcoded default. | 1 | "existing user-under-project precedence governs the new key, asserted by a merge test in which the project value wins and a user-only value survives" | diff-local |
| Story 2 happy: Given a candidate the policy forbids, when the step resolves candidates, then that candidate is excluded from the dispatch list at resolution and no `provider_attempt` is recorded for it. | 8 | "the dispatch path passes the step's substitution policy to resolveProviderCandidates so a policy-forbidden candidate is never in the dispatch list and emits no provider attempt" | diff-local |
| Story 2 happy: Given a candidate suppressed as usage-exhausted, when the step resolves candidates, then a `provider_attempt` is recorded with `invoked` false and the suppression refusal reason. | 8 | "a suppression-refused candidate emits a provider attempt carrying invoked false and the suppression refusal reason" | diff-local |
| Story 2 happy: Given a candidate the gate admits, when it is invoked, then its `provider_attempt` carries `invoked` true and no refusal reason, unchanged from today. | 8 | "an admitted candidate emits a provider attempt carrying invoked true and no refusal reason" | diff-local |
| Story 2 happy: Given a candidate refused by the gate, when the step completes, then no provider subprocess was spawned for that candidate. | 7 | "a refused candidate never reaches the process-spawn seam, asserted with that seam mocked to fail if reached" | diff-local |
| Story 2 happy: Given an existing reader of `provider_attempt` records, when it processes a refusal record, then it parses it without modification, because the refusal reuses the existing record shape. | 8 | "the skip-reason set gains the policy-refusal and suppression-refusal members within its existing closed set, so an existing provider attempt reader parses a refusal record without modification" | diff-local |
| Story 2 negative: Given a candidate that is both policy-forbidden and suppressed, when the step dispatches, then no `provider_attempt` is recorded for it, and a suppressed candidate the policy permits records exactly one `provider_attempt` carrying exactly one refusal reason, never two records or a combined reason. | 8 | "a candidate that is both policy-forbidden and suppressed emits no provider attempt, and a suppressed candidate the policy permits emits exactly one provider attempt carrying exactly one refusal reason" | diff-local |
| Story 2 negative: Given telemetry emission for a refusal fails, when the step continues, then the refusal itself still takes effect and the failure is reported through the existing attempt-telemetry error path rather than admitting the candidate. | 9 | "a telemetry emission failure on a refusal routes through the existing attempt-telemetry error path while the candidate remains refused and unspawned" | diff-local |
| Story 2 negative: Given a candidate refused by the gate, when its record is inspected, then the refusal reason belongs to the record's closed set and is not free-form text. | 8 | "the skip-reason set gains the policy-refusal and suppression-refusal members within its existing closed set, so an existing provider attempt reader parses a refusal record without modification" | diff-local |
| Story 2 negative: Given a provider already refused earlier in the same step, when the candidate loop reaches it again, then it is refused again without a subprocess rather than being admitted on a second look. | 9 | "a provider refused earlier in the same step is refused again when the candidate loop reaches it, without a subprocess" | diff-local |
| Story 2 negative: Given the gate is consulted for a candidate, when the step runs under a provider configuration that predates this change, then the gate admits every candidate and emits no refusal record. | 9 | "with no policy configured and no suppression in force, the gate admits every candidate and emits no refusal record" | diff-local |
| Story 3 happy: Given a provider observed usage-exhausted during a step, when a later step in the same run resolves candidates, then that provider is refused without a subprocess while its window is unexpired. | 19, 21 | "a usage-exhausted group member's provider is refused without a subprocess in a later or concurrent feature dispatch while its window is unexpired" | diff-local |
| Story 3 happy: Given a provider suppressed during one feature's run, when a later feature run begins and resolves candidates, then the suppression is still in force, because the store was constructed above the per-feature boundary. | 6 | "a suppression recorded during one feature run is still observed by a later feature run in the same process, asserted across two feature-run boundaries that rebuild the provider runtimes" | diff-local |
| Story 3 happy: Given a feature run begins, when its provider runtimes and model-availability caches are rebuilt, then the injected availability store is not rebuilt with them. | 6 | "the store is constructed once at daemon startup beside the rate-limit episode and injected into each conductor through the existing injection sites, above the per-feature run boundary" | diff-local |
| Story 3 happy: Given no availability store is injected, when candidates are resolved, then behavior is today's, with every candidate admitted. | 6 | "an absent store leaves candidate admission and provider attempts identical to pre-change behavior and raises no error" | diff-local |
| Story 3 happy: Given a provider is suppressed, when a different provider is resolved as a candidate, then the different provider is admitted normally. | 19 | "a different provider remains admitted while one provider is suppressed" | diff-local |
| Story 3 negative: Given a provider suppressed in one feature run, when a concurrently running feature resolves the same provider, then it is refused there too rather than each feature re-earning the suppression independently. | 19, 21 | "a provider suppressed in one feature run is refused in a concurrently running feature rather than re-earned independently there" | diff-local |
| Story 3 negative: Given the availability store is absent because the run is interactive rather than daemon-hosted, when a provider is observed exhausted, then the run behaves exactly as it does today and no error is raised for the missing store. | 6 | "an absent store leaves candidate admission and provider attempts identical to pre-change behavior and raises no error" | diff-local |
| Story 3 negative: Given a suppression is recorded while a second exhaustion of the same provider reports a later deadline, when both are applied, then the later deadline governs rather than the earlier one shortening the window. | 5 | "the later of two competing deadlines for one provider governs its window, asserted by recording an earlier deadline second" | diff-local |
| Story 3 negative: Given the suppression record cannot be persisted, when the run continues, then in-memory suppression still takes effect for the current daemon process and the persistence failure is surfaced rather than silently dropped. | 18 | "a persistence failure surfaces through the existing error path while in-memory suppression still takes effect for the current process" | diff-local |
| Story 3 negative: Given a daemon process is replaced, when it resolves candidates for a provider whose window has not elapsed, then it does not spawn more than one real invocation to rediscover that provider's state. | 18 | "a replaced daemon process spawns at most one real invocation to rediscover a provider whose window has not elapsed" | diff-local |
| Story 3 negative: Given a provider invocation fails authentication, when candidates are next resolved, then that provider is admitted rather than suppressed, so the existing park-and-poll wait can resume the same attempt after credentials refresh. | 12 | "an authentication failure leaves the provider admitted, so the existing park-and-poll wait can resume the same attempt after credentials refresh, and opens no suppression window" | diff-local |
| Story 3 negative: Given a provider invocation reports an expired session, when candidates are next resolved, then that provider is admitted rather than suppressed, because only usage exhaustion opens a suppression window. | 12 | "an expired session leaves the provider admitted and opens no suppression window" | diff-local |
| Story 4 happy: Given a rate-limited result carrying a parsed deadline, when the rate-limit record is emitted, then it carries the provider that was exhausted and that deadline. | 10 | "a rate-limited result carrying a parsed deadline emits a record carrying the exhausted provider and that deadline" | diff-local |
| Story 4 happy: Given a rate-limited result carrying no parsed deadline, when the record is emitted, then it carries the provider and the bounded deadline actually used for the wait. | 10 | "a rate-limited result carrying no parsed deadline emits a record carrying the provider and the bounded deadline actually used for the wait" | diff-local |
| Story 4 happy: Given a historical rate-limit record written before this change, when it is read, then it parses successfully and retains its current interpretation. | 10 | "the rate-limit record declares provider and deadline as optional fields, and a pre-change record fixture parses and renders unchanged" | diff-local |
| Story 4 happy: Given a suppression is in force, when an operator reads the persisted ledger, then the provider, the refusal reason, and the remaining time to re-attempt are derivable from records already present. | 10 | "the provider, the refusal reason, and the remaining time to re-attempt are derivable from the persisted records alone" | diff-local |
| Story 4 happy: Given the record is emitted, when it is routed, then it is persisted through the existing sink routing with no sink declaration change. | 10 | "the record is routed by its existing sink declaration with no change to the event-sink registry entry" | diff-local |
| Story 4 negative: Given a provider limit message containing account identifiers, when the suppression reason is recorded, then the recorded reason is sanitized and the raw message is not persisted. | 11 | "a provider limit message containing an account identifier does not appear verbatim in any persisted record" | diff-local |
| Story 4 negative: Given a rate-limited result whose provider cannot be determined, when the record is emitted, then the provider field is omitted rather than recorded as a guess or an empty string. | 11 | "a rate-limited result whose provider cannot be determined omits the provider field rather than recording an empty or guessed value" | diff-local |
| Story 4 negative: Given a parsed deadline further in the future than the accepted bound, when it is applied, then the bounded value is used and recorded, so a mis-parse cannot wedge a provider for an unbounded window. | 11 | "a parsed deadline beyond the accepted bound is clamped before it is applied and before it is recorded" | diff-local |
| Story 4 negative: Given a consumer that reads only the fields present before this change, when it processes a record carrying the new fields, then it continues to work unchanged. | 11 | "a consumer reading only the pre-change fields processes a record carrying the new fields unchanged" | diff-local |
| Story 4 negative: Given the record is emitted, when the OpenTelemetry exporter is inspected, then the absence of this event from that exporter's own subscription list is unchanged by this feature and is not assumed to have been fixed by extending the event. | 11 | "the OpenTelemetry exporter subscription list is unchanged by this feature, asserted against its declared list rather than assumed" | diff-local |
| Story 5 happy: Given a provider suppressed until a deadline, when candidates are resolved after that deadline, then the provider is admitted and invoked with no operator action. | 13 | "advancing the injected clock past a suppression deadline admits the provider again with no operator action" | diff-local |
| Story 5 happy: Given a provider suppressed with no parsed deadline, when the bounded default interval elapses, then the provider is admitted again. | 13 | "advancing the injected clock past the bounded default interval admits a provider suppressed with no parsed deadline" | diff-local |
| Story 5 happy: Given a provider whose suppression has expired, when it is admitted and succeeds, then subsequent steps treat it as ordinarily available. | 13 | "a provider admitted after expiry and succeeding is treated as ordinarily available by subsequent steps" | diff-local |
| Story 5 happy: Given a provider that failed authentication rather than exhausting usage, when candidates are resolved, then no suppression window exists for it to expire from. | 12 | "an authentication failure leaves the provider admitted, so the existing park-and-poll wait can resume the same attempt after credentials refresh, and opens no suppression window" | diff-local |
| Story 5 happy: Given a provider is suppressed, when the candidate list is resolved, then the order of candidates is unchanged and only admission differs. | 5 | "the store exposes no permanent-unavailability state and never reorders providers, asserted after repeated suppression and expiry cycles" | diff-local |
| Story 5 happy: Given a provider suppressed and then re-admitted after expiry, when it is exhausted again, then a fresh window is recorded rather than the previous window being extended indefinitely. | 13 | "a provider re-admitted after expiry and exhausted again receives a fresh window rather than an extension of the previous one" | diff-local |
| Story 5 negative: Given a provider whose suppression deadline has just passed, when two steps resolve candidates at nearly the same moment, then both observe the provider as admitted rather than one observing a stale suppression. | 13 | "two admission evaluations at nearly the same moment just after a deadline both observe the provider admitted" | diff-local |
| Story 5 negative: Given the system clock moves backward while a suppression is in force, when admission is evaluated, then the provider is not suppressed beyond its bounded maximum window. | 14 | "a backward system-clock movement leaves the provider suppressed no longer than the bounded maximum window" | diff-local |
| Story 5 negative: Given a suppression whose deadline is in the past at the moment it is recorded, when admission is evaluated, then the provider is admitted rather than being suppressed by an already-expired window. | 5 | "a deadline at or before the injected now leaves the provider admitted rather than suppressed" | diff-local |
| Story 5 negative: Given a provider suppressed repeatedly across successive windows, when its records are inspected, then no state marks it permanently unavailable and no candidate reordering has occurred. | 5 | "the store exposes no permanent-unavailability state and never reorders providers, asserted after repeated suppression and expiry cycles" | diff-local |
| Story 5 negative: Given a suppression is in force for every configured provider, when all their deadlines elapse, then every provider is admitted again without requiring a process restart. | 14 | "once every configured provider deadline elapses, all providers are admitted again without a process restart" | diff-local |
| Story 6 happy: Given every candidate for a step is suppressed, when the step runs, then it yields the rate-limited outcome and the conductor enters its existing wait. | 15 | "a step whose every candidate is suppressed yields the rate-limited outcome and the conductor enters its existing wait" | diff-local |
| Story 6 happy: Given every candidate is suppressed and the wait completes, when the step retries, then it retries without having consumed the retry budget. | 15 | "the retry budget is unchanged across a fully-suppressed step, including when the budget is nearly consumed" | diff-local |
| Story 6 happy: Given a rate-limited result, when the candidate loop evaluates it, then the loop does not advance to another provider, preserving current behavior. | 16 | "a rate-limited result still does not advance the candidate loop to another provider" | diff-local |
| Story 6 happy: Given a step whose first candidate is suppressed and whose second is admitted, when the step runs, then the second candidate executes and no wait is entered. | 16 | "a step whose first candidate is suppressed and whose second is admitted executes the second candidate and enters no wait" | diff-local |
| Story 6 happy: Given the rate-limit episode coordinator is present, when a provider is suppressed, then the episode's own entry, deadline, and escalation behavior are unchanged by this feature. | 17 | "the episode entry, deadline, and escalation behavior are unaffected when a provider is suppressed" | diff-local |
| Story 6 negative: Given every candidate is suppressed, when the step resolves, then it does not report candidates exhausted, does not raise a provider-unavailable failure, and does not write a halt marker. | 15 | "such a step does not report candidates exhausted, does not raise a provider-unavailable failure, and writes no halt marker" | diff-local |
| Story 6 negative: Given every candidate is suppressed, when the step's status is inspected, then it is not stamped with the step-level refused status and no step-refusal event is emitted, because candidate admission is not a step entry condition. | 15 | "such a step carries no step-level refused status and emits no step-refusal event" | diff-local |
| Story 6 negative: Given every candidate is suppressed and a retry budget is nearly consumed, when the wait path is taken, then the budget is not decremented by the suppression. | 15 | "the retry budget is unchanged across a fully-suppressed step, including when the budget is nearly consumed" | diff-local |
| Story 6 negative: Given substitution is disallowed and the single pinned candidate is suppressed, when the step runs, then it waits rather than halting or invoking any other provider. | 16 | "with substitution disallowed and the single pinned candidate suppressed, the step waits rather than halting or invoking another provider" | diff-local |
| Story 6 negative: Given a step's candidates are all suppressed while the daemon's dispatch gate is inactive, when the step runs, then the wait is entered by the step itself rather than depending on the dispatch gate to prevent the work. | 15 | "the wait is entered by the step itself, asserted with the daemon dispatch gate inactive" | diff-local |
| Story 6 negative: Given a suppressed candidate and a genuine provider failure on another candidate in the same step, when the step resolves, then the genuine failure retains its existing classification and is not reported as a rate limit. | 16 | "a genuine provider failure alongside a suppressed candidate retains its existing classification and is not reported as a rate limit" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability#D1 | task | task-7, task-22 | the policy-refused refusal reason and skip-reason member are removed, and the admission gate carries no substitution-policy branch |
| adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability#D2 | task | task-3, task-2, task-1 | resolveProviderCandidates returns only the step selection when the policy disallows substitution and the step declares a selection |
| adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability#D3 | task | task-8 | the dispatch path passes the step's substitution policy to resolveProviderCandidates so a policy-forbidden candidate is never in the dispatch list and emits no provider attempt |
| adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability#D4 | task | task-6, task-5 | the store is constructed once at daemon startup beside the rate-limit episode and injected into each conductor through the existing injection sites, above the per-feature run boundary |
| adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability#D5 | task | task-10 | the rate-limit record declares provider and deadline as optional fields, and a pre-change record fixture parses and renders unchanged |
| adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability#D6 | task | task-13, task-14 | advancing the injected clock past a suppression deadline admits the provider again with no operator action |
| adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability#D7 | task | task-15, task-16 | a step whose every candidate is suppressed yields the rate-limited outcome and the conductor enters its existing wait |
| adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability#D8 | task | task-17 | the rate-limit episode module is absent from this feature diff and its existing tests pass without amendment |

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic
