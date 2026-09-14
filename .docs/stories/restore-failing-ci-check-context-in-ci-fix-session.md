**Status:** Accepted

# Stories: Reliable CI repair dispatch

Track: technical

Source: jstoup111/ai-conductor#2153 and the operator-approved expanded scope.

Architecture: `architecture-review-2026-09-11-restore-failing-ci-check-context-in-ci-fix-session` (operator approved).

## Story 1: Supply the failing-check context that made the PR eligible

**Requirement:** #2153 useful failure context and explicit retrieval failure; architecture design 1.

As an operator, I want CI repair to receive the failed checks and their links so that the repair session can diagnose the actual failure.

### Acceptance Criteria

#### Happy Path

- Given an otherwise eligible PR with completed failed check runs, when repair starts, then its supplied context contains the failed check names and available detail links from the check state used to select that PR.
- Given an eligible mixed rollup containing failed check runs and completed external commit statuses, when repair context is prepared, then it includes the relevant failing names or contexts and available links, including terminal failure states already supported by CI-fix eligibility beyond the literal FAILURE value.

#### Negative Paths

- Given the check listing cannot be read because of authentication, permission, timeout, or other API failure, when eligibility/context preparation runs, then no repair starts, no repair attempt is consumed, and an attributed diagnostic distinguishes the retrieval failure from an empty successful result.
- Given required check data is malformed or no usable failed-check context is available, when repair preparation runs, then it defers with a concrete context error and neither starts a blind repair nor consumes an attempt.
- Given a failed check has a usable name but no detail link, when context is prepared, then the name remains present and no URL is invented; an unnamed entry is identified explicitly rather than silently omitted or assigned another check's name.
- Given any rollup entry is still pending or running, when the sweep considers the PR, then the existing terminal-check gate prevents repair and leaves the attempt count unchanged.

### Done When

- [ ] A production dispatch boundary exercised with faithful GitHub fixtures delivers the selected PR's expected check identities and links to the repair provider.
- [ ] Read-error, malformed-input, missing-link, mixed-status, and nonterminal fixtures produce the specified context/refusal results and exact attempt deltas.

## Story 2: Keep optional log enrichment useful and bounded

**Requirement:** Existing failing-log context and architecture design 1's bounded enrichment.

As an operator, I want optional CI logs to help the repair session without preventing it from using known check information or overwhelming its context.

### Acceptance Criteria

#### Happy Path

- Given failed checks with available job logs, when repair context is enriched, then relevant excerpts accompany the known check identities and links within a finite total context budget.
- Given multiple failed checks refer to the same workflow run, when optional logs are gathered, then enrichment does not repeat the same full-run retrieval for each check and the relevant failed checks remain identifiable.

#### Negative Paths

- Given log retrieval times out, is denied, or the log is unavailable, when enrichment completes, then the usable names and links remain in the repair context and an attributed degradation diagnostic identifies the optional-log failure.
- Given logs or check metadata exceed the documented enrichment/context limits, when context is built, then retrieval work and output size stay within those limits and any omitted context is marked explicitly rather than presented as complete.

### Done When

- [ ] Boundary fixtures observe the limited number of optional log requests and the exact final context supplied to a repair.
- [ ] Oversized-input and failed-log fixtures prove the declared finite budgets, explicit truncation/degradation, and retention of available useful check context.

## Story 3: Run repairs with the configured build provider policy

**Requirement:** Operator-selected inheritance; architecture design 2.

As an operator, I want repairs to follow my build provider settings so that configuring Codex, Claude, or a supported provider selection has the same meaning for builds and CI repairs.

### Acceptance Criteria

#### Happy Path

- Given a working Codex-only or Claude-only build configuration, when CI repair runs, then it uses that provider and the effective build model and effort; Codex-only repair does not depend on a Claude executable being installed.
- Given build has an explicit provider preference different from the first run-level provider, when CI repair runs, then build's preferred provider is tried first and allowed fallback follows the existing configured order with provider-native model and effort settings.
- Given the selected Codex readiness probe is inconclusive in a case where the existing provider policy permits ordinary dispatch, when CI repair runs, then it reports degraded readiness and permits the actual invocation to determine the outcome.

#### Negative Paths

- Given the preferred provider is explicitly unavailable in a way the existing fallback policy allows, when a configured fallback is usable, then repair uses that fallback with a fresh provider-native session and does not require the unavailable provider to pass an independent global probe.
- Given affirmative authentication failure, permission denial, or an ordinary execution failure, when the shared provider policy forbids fallback for that result, then repair retains the classified failure rather than selecting another provider or reporting a successful repair.
- Given all eligible providers are affirmatively prevented from starting a repair, when dispatch finishes, then the operator receives the relevant provider/reason and the result does not claim an attempted successful session.
- Given a supported custom or legacy provider has no Claude/Codex-specific readiness probe or no affirmative no-start evidence, when repair is dispatched, then no new provider-specific probe is required and the absence of evidence cannot authorize an attempt refund.

### Done When

- [ ] Faithful provider-boundary fixtures capture the effective provider/model/effort and fresh-session options for single-provider, overridden preference, and allowed fallback cases.
- [ ] Readiness, authentication, permission, ordinary failure, and custom-provider fixtures prove matching build-policy dispositions and no unconditional attempted-success conversion.

## Story 4: Charge only justified attempts and reset only on remote green

**Requirement:** Expanded attempt-accounting scope; architecture design 3 and CI-feedback ADR decisions 3–5.

As an operator, I want bounded repair attempts to reflect actual repair opportunities so that startup refusals do not exhaust them and local success cannot make retries unlimited.

### Acceptance Criteria

#### Happy Path

- Given a repair proceeds past preparation, when its reserved attempt is reconciled, then an attempted repair consumes exactly one attempt regardless of the number of provider/model fallback candidates used within it.
- Given a later sweep observes GitHub CI green, when it reconciles the watched PR, then the existing attempt reset and failure-detection reset occur.

#### Negative Paths

- Given direct execution evidence proves no repair started, when the reserved attempt is reconciled, then the previous attempt count and repair cooldown timestamp are restored while the PR's failure-detection state remains intact.
- Given an earlier candidate actually attempted repair and a later candidate is skipped or fails before execution, when the result is reconciled, then the consumed attempt remains; the final refusal cannot erase the earlier attempt.
- Given a dispatch throws or returns an unknown/ambiguous result without affirmative no-start proof, when accounting completes, then the reserved attempt is retained and neither a refund nor a green reset occurs.
- Given repair produces no committed change, fails, or verifies and publishes locally while GitHub is not yet green, when accounting completes, then the consumed attempt remains and the existing cooldown/cap still applies.
- Given a PR is draft, conflicting, still has running checks, is cooling down, has sticky remediation, or is blocked by the existing serial guard, when the sweep runs, then it does not start that repair or consume a new attempt; at most one repair dispatch occurs per tick.
- Given attempts are exhausted and CI remains failed, when the existing escalation path runs, then its sticky escalation behavior remains in force and local publication or a missing diagnostic cannot reset the counter.

### Done When

- [ ] Sweep fixtures assert exact persisted count, cooldown, and failure-detection values for each permitted refund, consumed attempt, and remote-green reset.
- [ ] Mixed fallback, unknown-result, noop, local-publication, cap, and eligibility fixtures demonstrate that neither premature exhaustion nor unlimited repair retries are introduced.

## Story 5: Report repair verification and publication truthfully

**Requirement:** Expanded false-success correction; architecture design 4.

As an operator, I want a successful repair result to mean that a committed repair passed daemon verification and was published so that refused work cannot appear repaired.

### Acceptance Criteria

#### Happy Path

- Given a provider successfully commits a repair, when preservation checks and the configured verifier pass and publication succeeds, then the daemon reports verified publication while leaving GitHub's later CI verdict distinct.
- Given a repair session is started, when it receives its instructions, then the session is responsible for diagnosis and committing the repair while the daemon retains ownership of tests and publication.

#### Negative Paths

- Given the provider returns failure or produces no committed change, when the wrapper evaluates the result, then it reports failure or no change rather than inventing a changed success and does not publish a repair.
- Given preservation checks refuse the proposed repair, when the wrapper completes, then it reports the failed stage and does not run publication or claim verified success.
- Given the configured verifier fails or cannot establish required verification, when the wrapper completes, then it reports verification failure and does not publish or claim verified success.
- Given verification passes but the lease-protected push is refused, including a concurrent branch update, when the wrapper completes, then it reports publication failure, preserves remote work, and does not claim verified publication.
- Given an earlier repair stage fails, when the failure passes through dispatcher and sweep handling, then no caller converts it into a green or successful-publication result and the consumed attempt is retained unless no-start was affirmatively established.

### Done When

- [ ] Repair-boundary fixtures observe committed-change detection, ordered daemon guards/verification/publication, and the exact terminal result at the sweep boundary.
- [ ] Failure fixtures prove publication is not reached after provider/guard/verifier failure, and rejected publication never produces a successful result or premature attempt reset.
- [ ] Both supported provider dispatch paths receive the daemon-owned testing/publication instructions.

## Story 6: Retain actionable diagnostics without changing repair authority

**Requirement:** #2153 visible failures and architecture design 5.

As an operator, I want repair preparation and execution failures to remain visible after the session so that I can identify the affected PR and distinguish a context problem from a provider, verification, or publication problem.

### Acceptance Criteria

#### Happy Path

- Given context retrieval, optional-log enrichment, readiness, verification, or publication reports a failure, when the daemon handles it, then the existing persisted event stream and operator rendering identify the PR/feature, stage, bounded classified reason, and provider when known.
- Given the daemon is restarted after a recorded repair diagnostic, when its existing event reader reads the retained event data, then the same diagnostic remains readable without consulting a separate CI-repair log format or reconstructing it from current state.

#### Negative Paths

- Given an event sink or renderer fails, when a repair outcome is reconciled, then fallback selection, attempt accounting, verification, and publication outcomes remain determined by execution results rather than by diagnostic delivery.
- Given failure payloads contain oversized details or credential-bearing provider diagnostics, when the diagnostic is recorded, then the retained record stays bounded and uses the permitted classified facts without copying raw credential-bearing payloads.
- Given a provider refusal or successful local publication is observed, when diagnostics are emitted, then the record cannot mislabel the former as an attempted successful repair or the latter as remote CI green.

### Done When

- [ ] A real internal emitter/persistence/reader flow with fake external boundaries retains and renders each required stage with correct PR/provider attribution.
- [ ] Sink-failure and sensitive/oversized-payload fixtures demonstrate unchanged control results and bounded permitted diagnostic content.

## Negative-category review

Invalid input and data integrity: malformed check data and ambiguous control results are explicit refusals or conservative accounting cases. Authentication, permission, timeouts, network errors, and dependency unavailability: covered at GitHub reads, optional logs, provider readiness/execution, verification, and publication. Resource exhaustion: context/enrichment bounds and inability to establish verification are covered. Concurrent access: existing serial eligibility and lease-refused publication are preserved. Partial failure and alternate branches: all post-provider stages retain truthful results and attempt accounting; diagnostic failure changes no authority.

Exception classification: provider and GitHub failure fixtures must exercise the real error/result shapes at their adapters, not invented nested payloads or text-only stand-ins. Deduplication: checks sharing a workflow run avoid repeated full-run log enrichment while distinct failing checks remain identifiable. Cascade deletion and model-level immutability do not apply; this change deletes no entities and introduces no persistent domain model. Existing worktree cleanup remains owned by the repair lifecycle rather than being replaced here.

## Coverage disposition

Every criterion above requires behavioral proof; no prose-matching test alone satisfies it. Story 1's dispatch delivery, Story 3's provider execution, Story 4's sweep accounting, Story 5's verification/publication, and Story 6's event persistence require real internal boundary flows with faithful external fakes. Formatting, truncation, classification, and enrichment permutations belong in narrow helper/adapter tests. Existing sufficient behavioral tests for unchanged eligibility protections may be reused with their concrete test names recorded in the plan. BUILD entry owns any distinct acceptance specifications; each implementation task owns its scoped integration and negative-path tests.

## Verify-claims ledger

Verified source/decision inputs are recorded in the approved architecture review. The operator approved these acceptance criteria in chat; they are not a claim that the implementation already delivers them. No new provider policy, attempt cap, failure-classification policy, or user configuration is assumed. Precise finite context/enrichment budgets are to be stated in the implementation plan and proven at their owning test boundary.
