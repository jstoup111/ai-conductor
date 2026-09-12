**Status:** Accepted

# Stories: Provider setup failures preserve configured fallback

Source: jstoup111/ai-conductor#1285

Operator acceptance: Approved in the composer session, 2026-09-11.

## Scope and authority

Technical track, Medium tier. The operator approved general provider setup scope, approach A, the sequence diagram, and the lightweight architecture review. The acceptance contract below implements those decisions; self-host isolation is one regression case, not the feature boundary.

| Requirement | Approved outcome | Stories |
|-------------|------------------|---------|
| TR-1 | Skip a candidate with explicitly classified setup unavailability and complete on the next usable configured provider | 1 |
| TR-2 | Stop only after eligible candidates are exhausted; setup-only exhaustion does not spend dispatch retries | 3 |
| TR-3 | Report each skip with its reason and attribute real execution correctly | 4 |
| TR-4 | Setup skips consume no dispatch retry or lifecycle replacement; ordinary runtime failures retain retries | 1, 3 |
| TR-5 | Preserve authentication, safety, cleanup, provider context, and existing runtime failure policy | 1, 2, 3 |
| TR-6 | Prove fallback through production wiring, including the reported isolation-capability failure and both provider directions | 1, 2, 3, 4 |

## Story 1: Complete on the next usable configured provider

**Requirement:** TR-1, TR-4, TR-5, TR-6

As an operator, I want an unusable provider to be skipped so my configured fallback can complete the same step.

### Acceptance Criteria

#### Happy Path
- Given ordinary non-self-host execution with an ordered provider list and an explicitly classified setup capability failure on its first candidate, when the step runs, then the unusable candidate is not invoked, the next usable configured candidate actually invokes and completes the step, and the skip consumes no dispatch retry or lifecycle replacement; this holds with either built-in provider first.
- Given self-host execution configured with Codex followed by Claude and Codex's required isolation capability absent, when the step runs, then Codex is not invoked, Claude completes using its own native settings and fresh execution context, and the step completes within the same attempt.
- Given an earlier candidate is skipped and the next candidate succeeds, when execution returns, then later candidates and unconfigured providers are not invoked, and the successful candidate receives its own model, effort, session, authentication, and permission context.

#### Negative Paths
- Given the first candidate throws an unexpected preparation error, including an ordinary error whose text says it is unavailable, when the step runs, then the error retains its existing failure disposition and no later provider invokes on the strength of that text.
- Given setup encounters invalid configuration or an inconsistent provider registry, when execution rejects the input, then it does not treat that defect as permission to run a different provider.
- Given a candidate is unusable only in one setup context, when a later eligible execution does not require that missing capability, then the earlier skip does not permanently exclude it from that later context.
- Given the first candidate completes successfully, when a configured fallback exists, then the first candidate remains the actual provider and the fallback does not run.

### Done When
- [ ] A production configuration-to-runner execution trace shows zero invocations of the setup-failed candidate, one successful invocation of the fallback, and zero retries attributable to the skip in both built-in provider orders.
- [ ] The original self-host failure is reproduced at the real internal preparation boundary with fake external providers, and the returned step result identifies successful Claude execution.
- [ ] Captured fallback invocation parameters show candidate-native settings and a fresh session, with no credentials or permission context inherited from the skipped candidate.

## Story 2: Release failed setup safely before advancing

**Requirement:** TR-5, TR-6

As an operator, I want setup failure to release its resources and preserve safety decisions so fallback cannot inherit a broken or unauthorized execution context.

### Acceptance Criteria

#### Happy Path
- Given setup allocates resources before discovering explicit capability unavailability, when fallback proceeds, then every resource allocated by that failed setup is released exactly once before the next candidate begins preparation, and the fallback can acquire what it needs and complete.
- Given a supervised attempt skips one candidate and proceeds to another, when the fallback reaches process creation, then it is governed by the same active lifecycle authority and the skipped candidate has not consumed a replacement allowance.

#### Negative Paths
- Given failed setup cannot complete required cleanup or verification, when the executor considers fallback, then the unresolved failure is reported and no later provider starts.
- Given the attempt is cancelled, superseded, or times out during preparation or cleanup, when pending work later resumes, then no provider can spawn using the revoked authority, and existing lifecycle recovery limits remain in force.
- Given setup encounters an authentication failure, a required permission refusal, or a required safety failure, when other providers are configured, then the original recovery or blocking disposition is retained and fallback does not bypass it.
- Given partial preparation fails from a filesystem or resource-allocation error without an explicit capability-unavailability classification, when execution unwinds, then owned resources are released and the original failure does not become a candidate skip.
- Given another execution holds its own setup resources, when this execution skips a candidate, then it releases only its own resources and does not revoke or clean up the other execution's context.

### Done When
- [ ] Ordered resource observations show release of every acquired failed-candidate resource before fallback preparation and no duplicate release.
- [ ] Cancellation and cleanup-failure cases observe zero subsequent provider process creations at an injected process boundary.
- [ ] The reported self-host case leaves no held boundary window or scratch context, and a concurrent independent execution retains its own resources.

## Story 3: Stop setup-only exhaustion without losing runtime retries

**Requirement:** TR-2, TR-4, TR-5, TR-6

As an operator, I want retry spending to reflect actual runtime failures so a list of deterministically unusable providers cannot burn the step's retry budget.

### Acceptance Criteria

#### Happy Path
- Given every configured candidate is explicitly unavailable before provider invocation and more than one retry is configured, when ordinary step execution, one-shot execution, or auxiliary execution exhausts the list, then it returns terminal setup-only exhaustion after one ordered pass, invokes no provider, schedules no ordinary dispatch retry, and reports each candidate's reason; the same rule holds for a single-candidate list.
- Given an unavailable setup candidate is skipped and a usable fallback invokes but returns an ordinary runtime failure, when retry policy permits another attempt, then that runtime failure consumes its normal retry allowance and is not misreported as setup-only exhaustion.

#### Negative Paths
- Given every candidate is unavailable before invocation, when the result crosses intermediate execution wrappers, then no wrapper turns it into a generic retryable failure or repeats the same list solely to spend the remaining retry allowance.
- Given at least one candidate actually invoked before the list was exhausted, when execution reports the terminal result, then it does not claim that no invocation occurred and existing runtime/model-unavailability retry policy remains authoritative.
- Given the fallback returns authentication failure, rate limiting, session expiry, cancellation, or an ordinary failure, when a further provider exists, then each result retains its existing recovery, retry, or stop policy rather than being reclassified as setup unavailability.

### Done When
- [ ] With retry allowance greater than one, ordinary, one-shot, and auxiliary boundary observations show exactly one setup-only pass and no provider invocations or ordinary retry scheduling.
- [ ] A fallback-runtime-failure scenario records the normal retry progression and a later successful invocation when its scripted retry succeeds.
- [ ] Setup-only and mixed post-invocation exhaustion produce distinguishable terminal observations without losing candidate reasons.

## Story 4: Explain skips without inventing provider activity

**Requirement:** TR-3, TR-6

As an operator, I want to see why a provider was skipped and which provider did the work so I can distinguish a working fallback from repeated setup failure.

### Acceptance Criteria

#### Happy Path
- Given a candidate is skipped for explicit setup unavailability and another is selected, when the existing diagnostic consumers receive the execution record, then they identify the skipped provider, capability/reason, recovery action, and next provider, and show the skipped candidate as not invoked.
- Given the fallback invokes and completes, when its execution and usage are recorded, then the actual provider owns its native model, effort, usage, and invocation attribution, while the skipped candidate contributes no fabricated usage or dispatch.

#### Negative Paths
- Given every candidate is skipped before invocation, when exhaustion is reported, then all skipped providers and reasons remain visible, no successful actual provider is invented, and a newly observed setup skip is not described as a cached skip.
- Given a setup diagnostic contains sensitive text, when skip, fallback, and terminal messages are emitted, then established redaction removes the sensitive value while retaining the actionable reason.
- Given the existing attempt-recording sink throws, when fallback is otherwise eligible, then that observational failure does not change execution authority or prevent the fallback from completing.

### Done When
- [ ] Existing event-consumer observations distinguish skipped and invoked candidates and identify the actual successful provider.
- [ ] An all-skipped result lists every candidate reason without dispatch or usage attributed to a skipped candidate.
- [ ] A diagnostic canary is absent from recorded messages, and a failing attempt sink does not change the successful execution result.

## Coverage disposition

Every criterion above is mandatory. Existing tests are corroborating coverage for preserved behavior, not proof that the new setup-failure path is wired.

| Story | Lowest sufficient behavioral proof |
|-------|------------------------------------|
| 1 | New bounded integration coverage through the real step runner for ordinary setup skip and both provider orders; original self-host preparation case through real internal wiring with fake external boundaries. Executor-level cases cover early success, unavailable-scope isolation, invalid input, and exception classification. Existing provider-routing acceptance and provider-execution tests supply native-context and ordering baselines. |
| 2 | Focused preparation/cleanup integration with fixture-owned resources, real internal ownership transitions, and fake providers/process boundaries. Use deterministic cancellation and concurrent contexts; executor-level negative tests cover auth/safety/non-capability errors. Existing lifecycle tests supply the permit contract baseline, extended only where the new setup branch needs proof. |
| 3 | Bounded real caller/executor integration for each distinct ordinary, one-shot, and auxiliary result-mapping/retry boundary. Fake providers return scripted ordinary failures and success. Assert pass counts, invocation counts, retained disposition, and retry progression directly; no unrelated full pipeline. |
| 4 | Shared executor metadata and existing event-consumer integration, with fake provider usage and a failing injected attempt sink. Existing redaction tests are reusable where they exercise the same path; extend them for the setup-unavailability branch. |

All automated proof uses faithful fakes at every third-party boundary. No real Claude, Codex, GitHub, or network service is required. A live fallback incident beyond #1285 remains unverified; no acceptance claim depends on reproducing an unspecified incident.

## Negative-path category assessment

| Category | Application |
|----------|-------------|
| Invalid input | Story 1 rejects malformed configuration/registry state without fallback; Stories 2–4 consume already-resolved execution input. |
| Authentication and permissions | Stories 2 and 3 preserve blocking/recovery authority; Story 1 checks context isolation; Story 4 redacts sensitive diagnostics. |
| Timeouts and network errors | Stories 2 and 3 retain lifecycle and runtime policy. No new network call is introduced. |
| Concurrent access | Story 2 isolates owned resources and active attempt authority; Story 4 attributes each observation to its own candidate. |
| Resource exhaustion | Story 2 covers partial setup allocation failure and failed cleanup. |
| Partial failure and rollback | Story 2 covers resources acquired before failed setup; Story 3 covers failures after actual invocation. |
| Dependency unavailability | Stories 1 and 3 cover first-candidate failure and complete exhaustion; Story 4 covers their visible record. |
| Data integrity | Stories 1, 3, and 4 preserve provider identity, result disposition, counts, and diagnostic attribution. No database writes or data migration are added. |
| Cascade deletion | Not applicable: no production entity deletion or dependent-record lifecycle is introduced. Resource cleanup belongs to Story 2. |
| Model immutability | Not applicable: no immutable domain model is introduced. Existing session/attempt ownership remains covered by Stories 1 and 2. |
| Exception hierarchy | Stories 1 and 2 distinguish explicit capability failures from arbitrary, auth, safety, allocation, and cleanup failures. |
| Dedup/idempotency | Story 1 prevents a context-specific skip from poisoning later execution; Story 2 asserts single resource release; Story 3 asserts one ordered pass. No new durable deduplication scheme is introduced. |
| Alternate-branch side effects | Stories 2 and 4 cover cleanup and reporting on setup failure and all-skipped exhaustion, not only after successful invocation. |

## Verify-Claims Ledger

- [verified] Scope, approach, Medium classification, diagram, and architecture review are operator-approved in this session.
- [verified] Existing provider-execution and routing acceptance tests cover returned availability, native context, ordinary-failure precedence, and lifecycle permits. They do not establish the new setup-exception conversion and caller-level terminal-exhaustion behavior.
- [verified] Prior scoped run: 95 assertions passed; the private-temp rerun passed after an earlier teardown warning. No code or tests were changed.
- [unverified] Additional live fallback failure beyond the supplied issue. No new behavior is inferred from that concern alone.

Verdict: CLEAR. There are no unconfirmed behavioral assumptions; the operator accepted these stories in this session.
