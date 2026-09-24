**Status:** Accepted

# Stories: Provider substitution policy and exhaustion suppression (#1492)

## Story 1: A pinned step is never executed on another provider

**Requirement:** Technical intent TI-1 — substitution policy narrows the resolved candidate list rather than reordering it, globally and per step (ADR D2).

As an operator, I want to declare that no provider substitution may occur so that a step I pinned to one provider cannot execute on another, whatever makes the pinned provider unavailable.

### Acceptance Criteria

#### Happy Path

- Given substitution is disallowed globally and a step selects one provider, when its candidate list is resolved, then the list contains only that provider.
- Given substitution is disallowed for one step only and other steps are unconfigured, when each candidate list is resolved, then only that step's list is narrowed and every other step resolves to today's union.
- Given substitution is disallowed and a step declares no selection of its own, when its candidate list is resolved, then it resolves to the configured global list unchanged, because there is no pin to narrow to.
- Given no substitution setting appears in either scope, when any candidate list is resolved, then the result is the union of step selection and configured providers, identical to current behavior.
- Given substitution is disallowed and the step's single candidate is refused admission, when the step runs, then no attempt is recorded against any provider other than the step's own selection.

#### Negative Paths

- Given substitution is disallowed globally and a step selects a provider absent from the registered provider set, when configuration is loaded, then the existing unregistered-provider validation error is raised rather than silently widening the list to a registered fallback.
- Given the substitution setting carries a value outside its accepted closed set, when configuration is loaded, then loading fails with the existing fail-closed type error naming the key, and no run begins under an assumed default.
- Given substitution is disallowed at the global scope and permitted for one step, when that step's candidate list is resolved, then the step's own setting governs that step and the global setting continues to govern every other step, with neither silently overriding the other.
- Given substitution is disallowed and the step's only candidate raises a run-scoped unavailability that today triggers fallback, when the step runs, then the unavailability surfaces instead of another provider being invoked.
- Given a project configuration omits the substitution setting entirely, when it is loaded alongside a user-level configuration that sets it, then existing user-under-project precedence applies and the resolved list matches that precedence rather than a hardcoded default.

### Done When

- [ ] `resolveProviderCandidates` returns the step selection alone when substitution is disallowed, and the existing union when it is unset, proven by tests over both scopes.
- [ ] A test asserts that with substitution disallowed, the `provider_attempt` records emitted for a pinned step name only the pinned provider.
- [ ] The new configuration key is present in the config-key consumer registry with a production consumer declaration, satisfying adr-2026-08-26 D4.
- [ ] A test loads a configuration with no substitution setting and asserts the resolved candidate list is byte-for-byte the list resolved before this change.

## Story 2: One admission gate decides every refusal, and records it

**Requirement:** Technical intent TI-2 — a single per-candidate admission seam answers "may this candidate be invoked now", and both refusal classes are recorded on the existing `provider_attempt` record (ADR D1, D3).

As an operator reading telemetry, I want every refusal to dispatch a provider to appear in the records I already read so that I can tell a policy refusal from an exhaustion refusal without new tooling.

### Acceptance Criteria

#### Happy Path

- Given a candidate the policy forbids, when the step resolves candidates, then a `provider_attempt` is recorded for that candidate with `invoked` false and the policy refusal reason.
- Given a candidate suppressed as usage-exhausted, when the step resolves candidates, then a `provider_attempt` is recorded with `invoked` false and the suppression refusal reason.
- Given a candidate the gate admits, when it is invoked, then its `provider_attempt` carries `invoked` true and no refusal reason, unchanged from today.
- Given a candidate refused by the gate, when the step completes, then no provider subprocess was spawned for that candidate.
- Given an existing reader of `provider_attempt` records, when it processes a refusal record, then it parses it without modification, because the refusal reuses the existing record shape.

#### Negative Paths

- Given a candidate that is both policy-forbidden and suppressed, when the gate refuses it, then exactly one `provider_attempt` is recorded carrying exactly one refusal reason, never two records or a combined reason.
- Given telemetry emission for a refusal fails, when the step continues, then the refusal itself still takes effect and the failure is reported through the existing attempt-telemetry error path rather than admitting the candidate.
- Given a candidate refused by the gate, when its record is inspected, then the refusal reason belongs to the record's closed set and is not free-form text.
- Given a provider already refused earlier in the same step, when the candidate loop reaches it again, then it is refused again without a subprocess rather than being admitted on a second look.
- Given the gate is consulted for a candidate, when the step runs under a provider configuration that predates this change, then the gate admits every candidate and emits no refusal record.

### Done When

- [ ] A single admission function is the only caller-visible decision point for both refusal classes, and the candidate loop has no path that invokes a provider bypassing it.
- [ ] Tests assert `provider_attempt` carries `invoked: false` plus the correct refusal reason for a policy refusal and for a suppression refusal, and `invoked: true` with no reason for an admitted candidate.
- [ ] A test asserts the process-spawn seam is never reached for a refused candidate.
- [ ] The admission decision performs no filesystem or ledger read, proven by a test in which the gate is exercised with the I/O seam mocked to fail.
- [ ] Both new refusal reasons are members of the record's existing closed reason set, with exhaustive handling verified.

## Story 3: A provider found exhausted is not re-dispatched for the rest of its window

**Requirement:** Technical intent TI-3 — provider availability is daemon-scoped state, constructed above per-feature runs and injected, so it survives the dispatch boundary that discards every runtime cache (ADR D4, D8). Suppression is scoped to usage exhaustion alone; the authentication-failure and expired-session classes that share the same recovery-precedence guard never suppress a provider.

As an operator, I want a provider already observed usage-exhausted to stop being re-dispatched so that the number of real invocations that exist only to rediscover the same limit is bounded per window instead of growing per step and per dispatch.

### Acceptance Criteria

#### Happy Path

- Given a provider observed usage-exhausted during a step, when a later step in the same run resolves candidates, then that provider is refused without a subprocess while its window is unexpired.
- Given a provider suppressed during one feature's run, when a later feature run begins and resolves candidates, then the suppression is still in force, because the store was constructed above the per-feature boundary.
- Given a feature run begins, when its provider runtimes and model-availability caches are rebuilt, then the injected availability store is not rebuilt with them.
- Given no availability store is injected, when candidates are resolved, then behavior is today's, with every candidate admitted.
- Given a provider is suppressed, when a different provider is resolved as a candidate, then the different provider is admitted normally.

#### Negative Paths

- Given a provider suppressed in one feature run, when a concurrently running feature resolves the same provider, then it is refused there too rather than each feature re-earning the suppression independently.
- Given the availability store is absent because the run is interactive rather than daemon-hosted, when a provider is observed exhausted, then the run behaves exactly as it does today and no error is raised for the missing store.
- Given a suppression is recorded while a second exhaustion of the same provider reports a later deadline, when both are applied, then the later deadline governs rather than the earlier one shortening the window.
- Given the suppression record cannot be persisted, when the run continues, then in-memory suppression still takes effect for the current daemon process and the persistence failure is surfaced rather than silently dropped.
- Given a daemon process is replaced, when it resolves candidates for a provider whose window has not elapsed, then it does not spawn more than one real invocation to rediscover that provider's state.
- Given a provider invocation fails authentication, when candidates are next resolved, then that provider is admitted rather than suppressed, so the existing park-and-poll wait can resume the same attempt after credentials refresh.
- Given a provider invocation reports an expired session, when candidates are next resolved, then that provider is admitted rather than suppressed, because only usage exhaustion opens a suppression window.

### Done When

- [ ] The availability store is constructed once at daemon startup alongside the existing rate-limit episode and injected into each conductor through the existing injection sites.
- [ ] A test proves suppression recorded during one feature run is still observed by a subsequent feature run in the same process.
- [ ] A test proves an absent store leaves candidate admission and provider attempts identical to pre-change behavior.
- [ ] A test proves the later of two competing deadlines for one provider governs its window.
- [ ] The suppression record reaching the daemon-wide ledger is not feature-forwarded, proven by asserting it is present in that ledger after a feature-run emission.
- [ ] A test proves an authentication failure and an expired session leave the provider admitted, so neither opens a suppression window.
- [ ] If durability introduces a new event type rather than extending an existing record, that type carries a sink declaration in the total event-sink registry at introduction, satisfying adr-2026-07-26 exhaustiveness.

## Story 4: The ledger names which provider was exhausted and when it recovers

**Requirement:** Technical intent TI-4 — the `rate_limit` record gains an optional provider and an optional deadline, preserving the meaning of historical records (ADR D5).

As an operator, I want the suppression, its reason, and the time remaining before re-attempt to be visible in telemetry I already read so that an exhaustion window is diagnosable from the persisted ledger.

### Acceptance Criteria

#### Happy Path

- Given a rate-limited result carrying a parsed deadline, when the rate-limit record is emitted, then it carries the provider that was exhausted and that deadline.
- Given a rate-limited result carrying no parsed deadline, when the record is emitted, then it carries the provider and the bounded deadline actually used for the wait.
- Given a historical rate-limit record written before this change, when it is read, then it parses successfully and retains its current interpretation.
- Given a suppression is in force, when an operator reads the persisted ledger, then the provider, the refusal reason, and the remaining time to re-attempt are derivable from records already present.
- Given the record is emitted, when it is routed, then it is persisted through the existing sink routing with no sink declaration change.

#### Negative Paths

- Given a provider limit message containing account identifiers, when the suppression reason is recorded, then the recorded reason is sanitized and the raw message is not persisted.
- Given a rate-limited result whose provider cannot be determined, when the record is emitted, then the provider field is omitted rather than recorded as a guess or an empty string.
- Given a parsed deadline further in the future than the accepted bound, when it is applied, then the bounded value is used and recorded, so a mis-parse cannot wedge a provider for an unbounded window.
- Given a consumer that reads only the fields present before this change, when it processes a record carrying the new fields, then it continues to work unchanged.
- Given the record is emitted, when the OpenTelemetry exporter is inspected, then the absence of this event from that exporter's own subscription list is unchanged by this feature and is not assumed to have been fixed by extending the event.

### Done When

- [ ] Both new fields are optional on the event type, and a fixture of a pre-change record parses and renders unchanged.
- [ ] Tests assert the provider and the effective deadline appear on the emitted record for both the parsed-deadline and defaulted-deadline paths.
- [ ] A test asserts a provider limit message containing an account identifier does not appear verbatim in any persisted record.
- [ ] A test asserts a deadline beyond the accepted bound is clamped before being recorded and applied.

## Story 5: Suppression expires on its own and never demotes a provider

**Requirement:** Technical intent TI-5 — suppression is self-expiring, bounded, and changes only whether a subprocess is spawned (ADR D6).

As an operator, I want a suppressed provider to be attempted again once its window elapses so that a transient limit never permanently demotes a provider or requires me to intervene.

### Acceptance Criteria

#### Happy Path

- Given a provider suppressed until a deadline, when candidates are resolved after that deadline, then the provider is admitted and invoked with no operator action.
- Given a provider suppressed with no parsed deadline, when the bounded default interval elapses, then the provider is admitted again.
- Given a provider whose suppression has expired, when it is admitted and succeeds, then subsequent steps treat it as ordinarily available.
- Given a provider that failed authentication rather than exhausting usage, when candidates are resolved, then no suppression window exists for it to expire from.
- Given a provider is suppressed, when the candidate list is resolved, then the order of candidates is unchanged and only admission differs.
- Given a provider suppressed and then re-admitted after expiry, when it is exhausted again, then a fresh window is recorded rather than the previous window being extended indefinitely.

#### Negative Paths

- Given a provider whose suppression deadline has just passed, when two steps resolve candidates at nearly the same moment, then both observe the provider as admitted rather than one observing a stale suppression.
- Given the system clock moves backward while a suppression is in force, when admission is evaluated, then the provider is not suppressed beyond its bounded maximum window.
- Given a suppression whose deadline is in the past at the moment it is recorded, when admission is evaluated, then the provider is admitted rather than being suppressed by an already-expired window.
- Given a provider suppressed repeatedly across successive windows, when its records are inspected, then no state marks it permanently unavailable and no candidate reordering has occurred.
- Given a suppression is in force for every configured provider, when all their deadlines elapse, then every provider is admitted again without requiring a process restart.

### Done When

- [ ] Admission is evaluated against an injected clock, and tests advance that clock to prove re-admission at the deadline and at the bounded default.
- [ ] A test proves an already-expired deadline recorded as a suppression results in immediate admission.
- [ ] A test proves suppression never changes candidate order, comparing resolved order with and without an active suppression.
- [ ] A test proves repeated suppression and expiry cycles leave no residual state that would keep a provider refused.

## Story 6: Refusing every candidate still waits, and never becomes a failure

**Requirement:** Technical intent TI-6 — usage exhaustion remains a coordinated wait rather than a substitution or a failure, and the existing rate-limit episode is unmodified (ADR D7, D8).

As an operator, I want a step whose providers are all suppressed to enter the existing wait so that the change removes wasted dispatches without converting a transient pause into a halted feature.

### Acceptance Criteria

#### Happy Path

- Given every candidate for a step is suppressed, when the step runs, then it yields the rate-limited outcome and the conductor enters its existing wait.
- Given every candidate is suppressed and the wait completes, when the step retries, then it retries without having consumed the retry budget.
- Given a rate-limited result, when the candidate loop evaluates it, then the loop does not advance to another provider, preserving current behavior.
- Given a step whose first candidate is suppressed and whose second is admitted, when the step runs, then the second candidate executes and no wait is entered.
- Given the rate-limit episode coordinator is present, when a provider is suppressed, then the episode's own entry, deadline, and escalation behavior are unchanged by this feature.

#### Negative Paths

- Given every candidate is suppressed, when the step resolves, then it does not report candidates exhausted, does not raise a provider-unavailable failure, and does not write a halt marker.
- Given every candidate is suppressed, when the step's status is inspected, then it is not stamped with the step-level refused status and no step-refusal event is emitted, because candidate admission is not a step entry condition.
- Given every candidate is suppressed and a retry budget is nearly consumed, when the wait path is taken, then the budget is not decremented by the suppression.
- Given substitution is disallowed and the single pinned candidate is suppressed, when the step runs, then it waits rather than halting or invoking any other provider.
- Given a step's candidates are all suppressed while the daemon's dispatch gate is inactive, when the step runs, then the wait is entered by the step itself rather than depending on the dispatch gate to prevent the work.
- Given a suppressed candidate and a genuine provider failure on another candidate in the same step, when the step resolves, then the genuine failure retains its existing classification and is not reported as a rate limit.

### Done When

- [ ] A test asserts that with every candidate suppressed, the step yields a rate-limited outcome, the wait is entered, and no halt marker is written.
- [ ] A test asserts the retry budget is unchanged across a fully-suppressed step, matching the existing rate-limit contract.
- [ ] A test asserts a rate-limited result still does not advance the candidate loop to another provider.
- [ ] The rate-limit episode module is unmodified by this change, and its existing tests pass without amendment.
- [ ] A test asserts a fully-suppressed step carries no step-level refused status and emits no step-refusal event, keeping candidate admission distinct from the step entry conditions that status denotes.
