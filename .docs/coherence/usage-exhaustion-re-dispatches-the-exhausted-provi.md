# Coherence Check: Provider substitution policy and exhaustion suppression

Date: 2026-09-23
Source: jstoup111/ai-conductor#1492
Tier: M; technical track; session-default model.
Verdict: PASS — all required layers covered, no waiver required.

Operator approval: James Stoup approved the outcome-6 resolution in composer chat on 2026-09-23.

## Inputs and Judgment

This review compares the six sanitized staged issue outcomes, six accepted stories, 20 approved
plan tasks, and the one ADR added by this change set, whose eight citable decisions are adjudicated
individually below. All 64 exact happy and negative criteria have task completion evidence. The
outcome quotes are taken from `.pipeline/intake-outcomes.md`, including its source-bound digest,
and are reproduced exactly as staged rather than rewritten from the issue text.

The `fr` row class is omitted: this is a technical-track spec with no PRD, so there are no
enumerated requirements to tie out and the class is not required.

Coverage, consistency, and achievability were judged separately. One cross-layer inconsistency was
found and resolved during this pass; it is described below the outcome table. Verdict confidence is
96%, grounded in the cited artifact text and in direct reads of the provider-execution, event, and
persistence sources the design depends on.

## Outcomes

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Quote |
|---|---|---|---|---|
| outcome | outcome-1 | story-1 | covered | - An operator can configure, globally and per step, that no provider substitution may occur. With that in |
| outcome | outcome-2 | story-1, story-2 | covered | - A step pinned to a single provider is observably honored: its `provider_attempt` records show no attempt |
| outcome | outcome-3 | story-3 | covered | - After a provider is observed usage-exhausted, later steps and later feature dispatches inside the same |
| outcome | outcome-4 | story-5 | covered | - That suppression expires on its own: when the provider's reported reset time arrives — or after a bounded |
| outcome | outcome-5 | story-4 | covered | - The suppression, its reason, and the time remaining until re-attempt are visible in the telemetry an |
| outcome | outcome-6 | story-1, story-3 | covered | - With neither setting configured, behavior is unchanged from today. |

Outcome notes, in order: (1) Story 1 delivers the run-level and step-level policy; task-1 declares it and task-3 narrows the resolved list. (2) Story 1 asserts only the pinned provider is attempted; Story 2 records each refusal on the existing attempt record, so the honoring is checkable rather than asserted. (3) Story 3 bounds re-dispatch per window via the daemon-scoped store injected above the per-feature run boundary. (4) Story 5 expires the window against an injected clock, at the parsed deadline or the bounded default, with no operator action. (5) Story 4 carries the provider and deadline on the rate-limit record and Story 2 carries the refusal reason, so all three facts are derivable from records an operator already reads. (6) Binds the substitution setting only, per the 2026-09-23 amendments to the track boundary and ADR decision 6: suppression is unconditional, and run outcomes are unchanged because exhaustion still ends in the same wait.

**Cross-layer inconsistency found and resolved.** `outcome-6` says behavior is unchanged when
"neither setting" is configured, which presumes two configurable settings. The approved design ships
one — the substitution policy of ADR decision 2 — and makes suppression unconditional, with no key
that disables it. Read literally, an unconfigured repository would not be unchanged: an exhausted
provider is suppressed and a later step is refused without a subprocess. The operator confirmed on
2026-09-23 that the outcome binds the substitution setting only, because ADR decision 7 keeps
exhaustion a wait, so run outcomes are identical; what changes unconditionally is the number of
subprocesses spawned to rediscover a known limit and the two optional record fields of decision 5.
`.docs/track/` and ADR decision 6 each carry an additive amendment recording this, originals
preserved. The row is `covered` on that reading.

## Stories

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| story | story-1 | task-1, task-2, task-3, task-4, task-20 | covered | Configuration, narrowing, preserved validation, and the entry-point proof. |
| story | story-2 | task-7, task-8, task-9, task-20, task-22 | covered | One admission seam plus its refusal records and their resilience. |
| story | story-3 | task-5, task-6, task-12, task-18, task-19, task-20, task-21 | covered | The availability store, its daemon-scoped injection, exhaustion-only scoping, durability, and sharing. |
| story | story-4 | task-10, task-11 | covered | The rate-limit record fields and their bounding and sanitization. |
| story | story-5 | task-5, task-12, task-13, task-14 | covered | The store module properties, exhaustion-only scoping, expiry, and clock bounding. |
| story | story-6 | task-15, task-16, task-17 | covered | The wait behavior, preserved non-advancement, and the untouched episode coordinator. |

## Tasks

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| task | task-1 | story-1 | covered | the config type declares the substitution-policy value as optional at run level and step level, and a value outside its closed set fails config load with an error naming the key |
| task | task-2 | story-1 | covered | the new key carries a consumer declaration in the total config-key consumer registry, and the registry still typechecks as total |
| task | task-3 | story-1 | covered | resolveProviderCandidates returns only the step selection when the policy disallows substitution and the step declares a selection |
| task | task-4 | story-1 | covered | a step selecting a provider absent from the registered set raises the existing unregistered-provider validation error rather than widening the list to a registered fallback |
| task | task-5 | story-3, story-5 | covered | the store answers admission and records suppression against an injected clock, and the module performs no filesystem or ledger access |
| task | task-6 | story-3 | covered | the store is constructed once at daemon startup beside the rate-limit episode and injected into each conductor through the existing injection sites, above the per-feature run boundary |
| task | task-7 | story-2 | covered | candidate execution consults a single admission function before invoking any candidate, and no candidate path reaches the dispatch seam without it |
| task | task-8 | story-2 | covered | the skip-reason set gains only the provider-suppressed member, and no policy-refusal member, within its existing closed set, so an existing provider attempt reader parses a refusal record without modification |
| task | task-9 | story-2 | covered | a telemetry emission failure on a refusal routes through the existing attempt-telemetry error path while the candidate remains refused and unspawned |
| task | task-10 | story-4 | covered | the rate-limit record declares provider and deadline as optional fields, and a pre-change record fixture parses and renders unchanged |
| task | task-11 | story-4 | covered | a parsed deadline beyond the accepted bound is clamped before it is applied and before it is recorded |
| task | task-12 | story-3, story-5 | covered | the rate-limit branch records suppression only for the usage-exhaustion class, not for every class sharing the recovery-precedence guard |
| task | task-13 | story-5 | covered | advancing the injected clock past a suppression deadline admits the provider again with no operator action |
| task | task-14 | story-5 | covered | a backward system-clock movement leaves the provider suppressed no longer than the bounded maximum window |
| task | task-15 | story-6 | covered | a step whose every candidate is suppressed yields the rate-limited outcome and the conductor enters its existing wait |
| task | task-16 | story-6 | covered | a rate-limited result still does not advance the candidate loop to another provider |
| task | task-17 | story-6 | covered | the rate-limit episode module is absent from this feature diff and its existing tests pass without amendment |
| task | task-18 | story-3 | covered | the suppression record reaching the daemon-wide ledger is not feature-forwarded, asserted by its presence in that ledger after a feature-run emission |
| task | task-19 | story-3 | covered | a provider suppressed in one feature run is refused in a concurrently running feature rather than re-earned independently there |
| task | task-20 | story-1, story-2, story-3 | covered | driving a step through the daemon dispatch entry point with substitution disallowed produces provider attempt records naming only the pinned provider and no other |
| task | task-21 | story-3 | covered | both production GroupCore consumers open the shared suppression window and call the daemon-origin persistence callback when a group member reports usage exhaustion, exactly as the serial rate-limit branch does |
| task | task-22 | story-2 | covered | the policy-refused refusal reason and skip-reason member are removed, and the admission gate carries no substitution-policy branch |

## Architecture Decisions

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| adr | adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability | story-1, story-2, story-3, story-4, story-5, story-6 | covered | Decisions D1-D8 are each mapped to a `task` disposition whose cited Done-when checks assert the decision; the individual dispositions are judged below. |

Decision-by-decision judgement of the plan's `## Architecture Obligation Coverage` table:

- **D1** (task-7, task-22) — One admission function is the sole decision point for suppression; per the 2026-09-25 amendment substitution policy is resolver-owned, and task-22 check 1 removes the unreachable policy-refusal surface.
- **D2** (task-3, task-2, task-1) — Narrowing lives in the single existing resolver, the key is declared fail-closed, and the consumer registry entry is required by task-2.
- **D3** (task-8) — Refusals extend the existing closed skip-reason set on the existing attempt record; no new event type is minted.
- **D4** (task-6, task-5) — The store is pure and clock-injected, constructed above the per-feature boundary and injected like the rate-limit episode, so it is not rebuilt per run.
- **D5** (task-10) — Both fields are optional and stamped at the single existing emit site; a pre-change fixture must still parse unchanged.
- **D6** (task-13, task-14) — Expiry is a clock comparison needing no operator action, bounded against clock regression, and task-5 check 4 forbids permanent-unavailability state.
- **D7** (task-15, task-16) — The all-suppressed path yields the rate-limited outcome and the existing wait, writes no halt marker, stamps no refused status, and leaves loop non-advancement intact.
- **D8** (task-17) — Verify-only: the episode module must be absent from the feature diff with its tests unamended.

No decision is dispositioned `existing` or `no-change`, so no such evidence required verification.

## Criteria

| Row class | Exact criterion | Task id(s) | Verdict | Done when quote | Disposition |
|---|---|---|---|---|---|
| criterion | Story 1 happy: Given substitution is disallowed globally and a step selects one provider, when its candidate list is resolved, then the list contains only that provider. | task-3 | covered | "resolveProviderCandidates returns only the step selection when the policy disallows substitution and the step declares a selection" | diff-local |
| criterion | Story 1 happy: Given substitution is disallowed for one step only and other steps are unconfigured, when each candidate list is resolved, then only that step's list is narrowed and every other step resolves to today's union. | task-3 | covered | "a policy set for one step narrows only that step, asserted by resolving two steps where one sets the policy and the other does not, with each scope governing its own step" | diff-local |
| criterion | Story 1 happy: Given substitution is disallowed and a step declares no selection of its own, when its candidate list is resolved, then it resolves to the configured global list unchanged, because there is no pin to narrow to. | task-3 | covered | "resolveProviderCandidates returns the configured global list unchanged when the policy disallows substitution and the step declares no selection of its own" | diff-local |
| criterion | Story 1 happy: Given no substitution setting appears in either scope, when any candidate list is resolved, then the result is the union of step selection and configured providers, identical to current behavior. | task-3 | covered | "with the policy unset, resolveProviderCandidates returns the union of step selection and configured providers, byte-identical to the pre-change result for the same inputs" | diff-local |
| criterion | Story 1 happy: Given substitution is disallowed and the step's single candidate is refused admission, when the step runs, then no attempt is recorded against any provider other than the step's own selection. | task-20 | covered | "driving a step through the daemon dispatch entry point with substitution disallowed produces provider attempt records naming only the pinned provider and no other" | diff-local |
| criterion | Story 1 negative: Given substitution is disallowed globally and a step selects a provider absent from the registered provider set, when configuration is loaded, then the existing unregistered-provider validation error is raised rather than silently widening the list to a registered fallback. | task-4 | covered | "a step selecting a provider absent from the registered set raises the existing unregistered-provider validation error rather than widening the list to a registered fallback" | diff-local |
| criterion | Story 1 negative: Given the substitution setting carries a value outside its accepted closed set, when configuration is loaded, then loading fails with the existing fail-closed type error naming the key, and no run begins under an assumed default. | task-1 | covered | "the config type declares the substitution-policy value as optional at run level and step level, and a value outside its closed set fails config load with an error naming the key" | diff-local |
| criterion | Story 1 negative: Given substitution is disallowed at the global scope and permitted for one step, when that step's candidate list is resolved, then the step's own setting governs that step and the global setting continues to govern every other step, with neither silently overriding the other. | task-3 | covered | "a policy set for one step narrows only that step, asserted by resolving two steps where one sets the policy and the other does not, with each scope governing its own step" | diff-local |
| criterion | Story 1 negative: Given substitution is disallowed and the step's only candidate raises a run-scoped unavailability that today triggers fallback, when the step runs, then the unavailability surfaces instead of another provider being invoked. | task-4 | covered | "with substitution disallowed, a single candidate raising a run-scoped unavailability surfaces that unavailability and no other provider is invoked, asserted by attempt records naming only the pinned provider" | diff-local |
| criterion | Story 1 negative: Given a project configuration omits the substitution setting entirely, when it is loaded alongside a user-level configuration that sets it, then existing user-under-project precedence applies and the resolved list matches that precedence rather than a hardcoded default. | task-1 | covered | "existing user-under-project precedence governs the new key, asserted by a merge test in which the project value wins and a user-only value survives" | diff-local |
| criterion | Story 2 happy: Given a candidate the policy forbids, when the step resolves candidates, then that candidate is excluded from the dispatch list at resolution and no `provider_attempt` is recorded for it. | task-8 | covered | "the dispatch path passes the step's substitution policy to resolveProviderCandidates so a policy-forbidden candidate is never in the dispatch list and emits no provider attempt" | diff-local |
| criterion | Story 2 happy: Given a candidate suppressed as usage-exhausted, when the step resolves candidates, then a `provider_attempt` is recorded with `invoked` false and the suppression refusal reason. | task-8 | covered | "a suppression-refused candidate emits a provider attempt carrying invoked false and the suppression refusal reason" | diff-local |
| criterion | Story 2 happy: Given a candidate the gate admits, when it is invoked, then its `provider_attempt` carries `invoked` true and no refusal reason, unchanged from today. | task-8 | covered | "an admitted candidate emits a provider attempt carrying invoked true and no refusal reason" | diff-local |
| criterion | Story 2 happy: Given a candidate refused by the gate, when the step completes, then no provider subprocess was spawned for that candidate. | task-7 | covered | "a refused candidate never reaches the process-spawn seam, asserted with that seam mocked to fail if reached" | diff-local |
| criterion | Story 2 happy: Given an existing reader of `provider_attempt` records, when it processes a refusal record, then it parses it without modification, because the refusal reuses the existing record shape. | task-8 | covered | "the skip-reason set gains only the provider-suppressed member, and no policy-refusal member, within its existing closed set, so an existing provider attempt reader parses a refusal record without modification" | diff-local |
| criterion | Story 2 negative: Given a candidate that is both policy-forbidden and suppressed, when the step dispatches, then no `provider_attempt` is recorded for it, and a suppressed candidate the policy permits records exactly one `provider_attempt` carrying exactly one refusal reason, never two records or a combined reason. | task-8 | covered | "a candidate that is both policy-forbidden and suppressed emits no provider attempt, and a suppressed candidate the policy permits emits exactly one provider attempt carrying exactly one refusal reason" | diff-local |
| criterion | Story 2 negative: Given telemetry emission for a refusal fails, when the step continues, then the refusal itself still takes effect and the failure is reported through the existing attempt-telemetry error path rather than admitting the candidate. | task-9 | covered | "a telemetry emission failure on a refusal routes through the existing attempt-telemetry error path while the candidate remains refused and unspawned" | diff-local |
| criterion | Story 2 negative: Given a candidate refused by the gate, when its record is inspected, then the refusal reason belongs to the record's closed set and is not free-form text. | task-8 | covered | "the skip-reason set gains only the provider-suppressed member, and no policy-refusal member, within its existing closed set, so an existing provider attempt reader parses a refusal record without modification" | diff-local |
| criterion | Story 2 negative: Given a provider already refused earlier in the same step, when the candidate loop reaches it again, then it is refused again without a subprocess rather than being admitted on a second look. | task-9 | covered | "a provider refused earlier in the same step is refused again when the candidate loop reaches it, without a subprocess" | diff-local |
| criterion | Story 2 negative: Given the gate is consulted for a candidate, when the step runs under a provider configuration that predates this change, then the gate admits every candidate and emits no refusal record. | task-9 | covered | "with no policy configured and no suppression in force, the gate admits every candidate and emits no refusal record" | diff-local |
| criterion | Story 3 happy: Given a provider observed usage-exhausted during a step, when a later step in the same run resolves candidates, then that provider is refused without a subprocess while its window is unexpired. | task-19, task-21 | covered | "a usage-exhausted group member's provider is refused without a subprocess in a later or concurrent feature dispatch while its window is unexpired" | diff-local |
| criterion | Story 3 happy: Given a provider suppressed during one feature's run, when a later feature run begins and resolves candidates, then the suppression is still in force, because the store was constructed above the per-feature boundary. | task-6 | covered | "a suppression recorded during one feature run is still observed by a later feature run in the same process, asserted across two feature-run boundaries that rebuild the provider runtimes" | diff-local |
| criterion | Story 3 happy: Given a feature run begins, when its provider runtimes and model-availability caches are rebuilt, then the injected availability store is not rebuilt with them. | task-6 | covered | "the store is constructed once at daemon startup beside the rate-limit episode and injected into each conductor through the existing injection sites, above the per-feature run boundary" | diff-local |
| criterion | Story 3 happy: Given no availability store is injected, when candidates are resolved, then behavior is today's, with every candidate admitted. | task-6 | covered | "an absent store leaves candidate admission and provider attempts identical to pre-change behavior and raises no error" | diff-local |
| criterion | Story 3 happy: Given a provider is suppressed, when a different provider is resolved as a candidate, then the different provider is admitted normally. | task-19 | covered | "a different provider remains admitted while one provider is suppressed" | diff-local |
| criterion | Story 3 negative: Given a provider suppressed in one feature run, when a concurrently running feature resolves the same provider, then it is refused there too rather than each feature re-earning the suppression independently. | task-19, task-21 | covered | "both production GroupCore consumers open the shared suppression window and call the daemon-origin persistence callback when a group member reports usage exhaustion, exactly as the serial rate-limit branch does" | diff-local |
| criterion | Story 3 negative: Given the availability store is absent because the run is interactive rather than daemon-hosted, when a provider is observed exhausted, then the run behaves exactly as it does today and no error is raised for the missing store. | task-6 | covered | "an absent store leaves candidate admission and provider attempts identical to pre-change behavior and raises no error" | diff-local |
| criterion | Story 3 negative: Given a suppression is recorded while a second exhaustion of the same provider reports a later deadline, when both are applied, then the later deadline governs rather than the earlier one shortening the window. | task-5 | covered | "the later of two competing deadlines for one provider governs its window, asserted by recording an earlier deadline second" | diff-local |
| criterion | Story 3 negative: Given the suppression record cannot be persisted, when the run continues, then in-memory suppression still takes effect for the current daemon process and the persistence failure is surfaced rather than silently dropped. | task-18 | covered | "a persistence failure surfaces through the existing error path while in-memory suppression still takes effect for the current process" | diff-local |
| criterion | Story 3 negative: Given a daemon process is replaced, when it resolves candidates for a provider whose window has not elapsed, then it does not spawn more than one real invocation to rediscover that provider's state. | task-18 | covered | "a replaced daemon process spawns at most one real invocation to rediscover a provider whose window has not elapsed" | diff-local |
| criterion | Story 3 negative: Given a provider invocation fails authentication, when candidates are next resolved, then that provider is admitted rather than suppressed, so the existing park-and-poll wait can resume the same attempt after credentials refresh. | task-12 | covered | "an authentication failure leaves the provider admitted, so the existing park-and-poll wait can resume the same attempt after credentials refresh, and opens no suppression window" | diff-local |
| criterion | Story 3 negative: Given a provider invocation reports an expired session, when candidates are next resolved, then that provider is admitted rather than suppressed, because only usage exhaustion opens a suppression window. | task-12 | covered | "an expired session leaves the provider admitted and opens no suppression window" | diff-local |
| criterion | Story 4 happy: Given a rate-limited result carrying a parsed deadline, when the rate-limit record is emitted, then it carries the provider that was exhausted and that deadline. | task-10 | covered | "a rate-limited result carrying a parsed deadline emits a record carrying the exhausted provider and that deadline" | diff-local |
| criterion | Story 4 happy: Given a rate-limited result carrying no parsed deadline, when the record is emitted, then it carries the provider and the bounded deadline actually used for the wait. | task-10 | covered | "a rate-limited result carrying no parsed deadline emits a record carrying the provider and the bounded deadline actually used for the wait" | diff-local |
| criterion | Story 4 happy: Given a historical rate-limit record written before this change, when it is read, then it parses successfully and retains its current interpretation. | task-10 | covered | "the rate-limit record declares provider and deadline as optional fields, and a pre-change record fixture parses and renders unchanged" | diff-local |
| criterion | Story 4 happy: Given a suppression is in force, when an operator reads the persisted ledger, then the provider, the refusal reason, and the remaining time to re-attempt are derivable from records already present. | task-10, task-8 | covered | "the provider, the refusal reason, and the remaining time to re-attempt are derivable from the persisted records alone" | diff-local |
| criterion | Story 4 happy: Given the record is emitted, when it is routed, then it is persisted through the existing sink routing with no sink declaration change. | task-10 | covered | "the record is routed by its existing sink declaration with no change to the event-sink registry entry" | diff-local |
| criterion | Story 4 negative: Given a provider limit message containing account identifiers, when the suppression reason is recorded, then the recorded reason is sanitized and the raw message is not persisted. | task-11 | covered | "a provider limit message containing an account identifier does not appear verbatim in any persisted record" | diff-local |
| criterion | Story 4 negative: Given a rate-limited result whose provider cannot be determined, when the record is emitted, then the provider field is omitted rather than recorded as a guess or an empty string. | task-11 | covered | "a rate-limited result whose provider cannot be determined omits the provider field rather than recording an empty or guessed value" | diff-local |
| criterion | Story 4 negative: Given a parsed deadline further in the future than the accepted bound, when it is applied, then the bounded value is used and recorded, so a mis-parse cannot wedge a provider for an unbounded window. | task-11 | covered | "a parsed deadline beyond the accepted bound is clamped before it is applied and before it is recorded" | diff-local |
| criterion | Story 4 negative: Given a consumer that reads only the fields present before this change, when it processes a record carrying the new fields, then it continues to work unchanged. | task-11 | covered | "a consumer reading only the pre-change fields processes a record carrying the new fields unchanged" | diff-local |
| criterion | Story 4 negative: Given the record is emitted, when the OpenTelemetry exporter is inspected, then the absence of this event from that exporter's own subscription list is unchanged by this feature and is not assumed to have been fixed by extending the event. | task-11 | covered | "the OpenTelemetry exporter subscription list is unchanged by this feature, asserted against its declared list rather than assumed" | diff-local |
| criterion | Story 5 happy: Given a provider suppressed until a deadline, when candidates are resolved after that deadline, then the provider is admitted and invoked with no operator action. | task-13 | covered | "advancing the injected clock past a suppression deadline admits the provider again with no operator action" | diff-local |
| criterion | Story 5 happy: Given a provider suppressed with no parsed deadline, when the bounded default interval elapses, then the provider is admitted again. | task-13 | covered | "advancing the injected clock past the bounded default interval admits a provider suppressed with no parsed deadline" | diff-local |
| criterion | Story 5 happy: Given a provider whose suppression has expired, when it is admitted and succeeds, then subsequent steps treat it as ordinarily available. | task-13 | covered | "a provider admitted after expiry and succeeding is treated as ordinarily available by subsequent steps" | diff-local |
| criterion | Story 5 happy: Given a provider that failed authentication rather than exhausting usage, when candidates are resolved, then no suppression window exists for it to expire from. | task-12 | covered | "an authentication failure leaves the provider admitted, so the existing park-and-poll wait can resume the same attempt after credentials refresh, and opens no suppression window" | diff-local |
| criterion | Story 5 happy: Given a provider is suppressed, when the candidate list is resolved, then the order of candidates is unchanged and only admission differs. | task-5, task-3 | covered | "the store exposes no permanent-unavailability state and never reorders providers, asserted after repeated suppression and expiry cycles" | diff-local |
| criterion | Story 5 happy: Given a provider suppressed and then re-admitted after expiry, when it is exhausted again, then a fresh window is recorded rather than the previous window being extended indefinitely. | task-13 | covered | "a provider re-admitted after expiry and exhausted again receives a fresh window rather than an extension of the previous one" | diff-local |
| criterion | Story 5 negative: Given a provider whose suppression deadline has just passed, when two steps resolve candidates at nearly the same moment, then both observe the provider as admitted rather than one observing a stale suppression. | task-13 | covered | "two admission evaluations at nearly the same moment just after a deadline both observe the provider admitted" | diff-local |
| criterion | Story 5 negative: Given the system clock moves backward while a suppression is in force, when admission is evaluated, then the provider is not suppressed beyond its bounded maximum window. | task-14 | covered | "a backward system-clock movement leaves the provider suppressed no longer than the bounded maximum window" | diff-local |
| criterion | Story 5 negative: Given a suppression whose deadline is in the past at the moment it is recorded, when admission is evaluated, then the provider is admitted rather than being suppressed by an already-expired window. | task-5 | covered | "a deadline at or before the injected now leaves the provider admitted rather than suppressed" | diff-local |
| criterion | Story 5 negative: Given a provider suppressed repeatedly across successive windows, when its records are inspected, then no state marks it permanently unavailable and no candidate reordering has occurred. | task-5 | covered | "the store exposes no permanent-unavailability state and never reorders providers, asserted after repeated suppression and expiry cycles" | diff-local |
| criterion | Story 5 negative: Given a suppression is in force for every configured provider, when all their deadlines elapse, then every provider is admitted again without requiring a process restart. | task-14 | covered | "once every configured provider deadline elapses, all providers are admitted again without a process restart" | diff-local |
| criterion | Story 6 happy: Given every candidate for a step is suppressed, when the step runs, then it yields the rate-limited outcome and the conductor enters its existing wait. | task-15 | covered | "a step whose every candidate is suppressed yields the rate-limited outcome and the conductor enters its existing wait" | diff-local |
| criterion | Story 6 happy: Given every candidate is suppressed and the wait completes, when the step retries, then it retries without having consumed the retry budget. | task-15 | covered | "the retry budget is unchanged across a fully-suppressed step, including when the budget is nearly consumed" | diff-local |
| criterion | Story 6 happy: Given a rate-limited result, when the candidate loop evaluates it, then the loop does not advance to another provider, preserving current behavior. | task-16 | covered | "a rate-limited result still does not advance the candidate loop to another provider" | diff-local |
| criterion | Story 6 happy: Given a step whose first candidate is suppressed and whose second is admitted, when the step runs, then the second candidate executes and no wait is entered. | task-16 | covered | "a step whose first candidate is suppressed and whose second is admitted executes the second candidate and enters no wait" | diff-local |
| criterion | Story 6 happy: Given the rate-limit episode coordinator is present, when a provider is suppressed, then the episode's own entry, deadline, and escalation behavior are unchanged by this feature. | task-17 | covered | "the episode entry, deadline, and escalation behavior are unaffected when a provider is suppressed" | diff-local |
| criterion | Story 6 negative: Given every candidate is suppressed, when the step resolves, then it does not report candidates exhausted, does not raise a provider-unavailable failure, and does not write a halt marker. | task-15 | covered | "such a step does not report candidates exhausted, does not raise a provider-unavailable failure, and writes no halt marker" | diff-local |
| criterion | Story 6 negative: Given every candidate is suppressed, when the step's status is inspected, then it is not stamped with the step-level refused status and no step-refusal event is emitted, because candidate admission is not a step entry condition. | task-15 | covered | "such a step carries no step-level refused status and emits no step-refusal event" | diff-local |
| criterion | Story 6 negative: Given every candidate is suppressed and a retry budget is nearly consumed, when the wait path is taken, then the budget is not decremented by the suppression. | task-15 | covered | "the retry budget is unchanged across a fully-suppressed step, including when the budget is nearly consumed" | diff-local |
| criterion | Story 6 negative: Given substitution is disallowed and the single pinned candidate is suppressed, when the step runs, then it waits rather than halting or invoking any other provider. | task-16 | covered | "with substitution disallowed and the single pinned candidate suppressed, the step waits rather than halting or invoking another provider" | diff-local |
| criterion | Story 6 negative: Given a step's candidates are all suppressed while the daemon's dispatch gate is inactive, when the step runs, then the wait is entered by the step itself rather than depending on the dispatch gate to prevent the work. | task-15 | covered | "the wait is entered by the step itself, asserted with the daemon dispatch gate inactive" | diff-local |
| criterion | Story 6 negative: Given a suppressed candidate and a genuine provider failure on another candidate in the same step, when the step resolves, then the genuine failure retains its existing classification and is not reported as a rate limit. | task-16 | covered | "a genuine provider failure alongside a suppressed candidate retains its existing classification and is not reported as a rate limit" | diff-local |

Two criteria cite a second task because one task's checks alone do not reach the criterion. Story 4
happy "the provider, the refusal reason, and the remaining time to re-attempt are derivable" needs
task-8 as well as task-10: the record fields carry the provider and deadline, but the refusal reason
lives on the attempt record task-8 extends. Story 5 happy "the order of candidates is unchanged and
only admission differs" needs task-3 as well as task-5: the store never reorders, and task-3 fixes
what resolution order is.

Every other criterion is judged achievable from its single cited task's checks read together, since
a task's `Done when` block is its complete definition of done. Where a quoted check restates the
criterion's outcome, the same task's remaining checks name the mechanism that produces it — task-10
is the clearest case, where check 5 states the derivability the criterion asks for and checks 1-4
supply the optional fields, the emit site, and the routing that make it true.

No criterion requires a behavior the approved architecture forbids. The constraint sweep against ADR
decisions 6, 7, and 8 found no criterion deliverable only by violating one: the all-suppressed
criteria are satisfied by the wait decision 7 mandates, not against it, and no criterion asks for the
substitution decision 7 excludes.

Disposition is `diff-local` for all 64 criteria: each is decided by this feature's own diff, and no
commit outside it can change whether the criterion holds.

## Preserved-behavior sweep

The unconfigured path is the one behavior these stories promise to preserve, so every task
introducing a side effect was compared against it. Task-8 adds refusal records, task-10 adds record
fields, and task-18 adds a persistence write. Task-9 check 3 bounds the first explicitly — with no
policy configured and no suppression in force, no refusal record is emitted — and task-3 check 3
requires the resolved candidate list be byte-identical to the pre-change result. The record-field and
persistence effects are unconditional by design and are the subject of the outcome-6 resolution
above, not an unbounded side effect on a path promised unchanged.
