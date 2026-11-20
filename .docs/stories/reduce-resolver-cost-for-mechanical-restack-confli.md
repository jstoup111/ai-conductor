**Status:** Accepted

# Acceptance stories for #3632

Source: approved technical track and adr-2026-11-15-accepted-restack-resolution-reuse. These accepted stories extend automatic-resolution behavior; existing operator-tip and scheduling stories remain authoritative.

## Story 1: Resolve independently eligible bookkeeping conflicts without a model

As an operator, I want known bookkeeping conflicts settled without buying a resolver invocation.

### Acceptance Criteria
#### Happy Path
- Given a replay with multiple conflicts each eligible under the existing halt-record or remediation-block rules, when the child replays, then the rule-defined content survives and no provider is invoked.
- Given intentional revert/reapply history and originally empty evidence commits, when prevention selects replay candidates, then their required effects and rewrite correspondences survive.
#### Negative Paths
- Given eligible bookkeeping conflicts mixed with a source-code conflict, when replay runs, then the unresolved source conflict reaches the configured resolver and no partially resolved child is accepted.
- Given conflicting bodies for the same remediation identifier, when deterministic resolution runs, then its existing mismatch refusal remains and stack refs do not move.
- Given adjacent-line source edits or conflicting memory content without an eligible rule, when replay runs, then neither proximity nor the file path authorizes automatic union.
### Done When
- [ ] Focused replay fixtures assert final tree content, provider-call counts, preserved evidence history, and unmoved refs on refusal.

## Story 2: Reuse accepted automatic work after a higher-child halt

As an operator, I want completed conflict resolution retained when a later child blocks the restack.

### Acceptance Criteria
#### Happy Path
- Given child 2 has a durably accepted automatic resolution and child 3 subsequently halts, when a new operation retries with child 2's exact inputs unchanged, then child 2 retains its accepted tip with zero new resolver calls.
- Given an interrupted operation with an accepted child, when journal recovery resumes, then it uses the same acceptance rules and avoids another resolver invocation for that child.
#### Negative Paths
- Given a change to the child's range, replay parent, replay policy, validation version, or supplied operator decision, when reuse is attempted, then the old automatic result is not applied and reporting names the invalidating input.
- Given malformed evidence, missing reachable objects, or evidence from another feature or child, when reuse is attempted, then that evidence cannot authorize acceptance or move stack refs.
- Given a crash before durable acceptance, when execution resumes, then another provider attempt is allowed and the report does not claim the earlier result was reused.
### Done When
- [ ] A local Git integration flow drives accepted child → later-child halt → new operation and asserts identical reused tip, exact rewrites, and provider call count.
- [ ] Recovery and invalidation fixtures assert each input distinction independently, including same conflict text under different parents.

## Story 3: Reject unsafe shortcuts before applying the stack

As an operator, I want a rejected shortcut to leave the stack unchanged and escalate predictably.

### Acceptance Criteria
#### Happy Path
- Given an unresolved source conflict lacking an applicable deterministic rule and eligible for the existing strong resolver, when acceptance checks it, then the configured strong resolver receives the unresolved work within the existing bounded attempt policy.
- Given all children have accepted candidates and expected refs remain unchanged, when the cascade applies, then refs move atomically and existing invalidation and revalidation requirements still apply.
#### Negative Paths
- Given invalid bookkeeping evidence or an owned-path bookkeeping candidate that violates its deterministic rule, when checked, then a validation error is reported, no provider is invoked, and no stack ref moves; ownership alone cannot authorize it.
- Given an unrelated path edit, invalid rewrite evidence, or a forbidden parent revert, when checked, then the candidate is refused under the applicable existing safeguards.
- Given another actor changes an expected ref, when application is attempted, then no subset of the planned ref transaction is applied.
- Given resolver timeout, unavailability, or exhausted attempts, when escalation ends, then an explicit failure outcome is reported without cycling back through shortcuts or claiming a design decision was necessarily required.
### Done When
- [ ] Boundary tests assert shortcut rejection, bounded provider calls, atomic refusal, and post-application gate invalidation using fake provider adapters.

## Story 4: Keep retained results safe across persistence and cleanup failures

As an operator, I want retained resolutions to survive aborts without corrupting other accepted work.

### Acceptance Criteria
#### Happy Path
- Given an accepted automatic result, when its operation aborts on a higher child, then its durable evidence and referenced objects remain reachable for a matching retry.
- Given successful application or existing feature cleanup, when retained evidence is retired, then only the owned automatic-resolution state is retired.
#### Negative Paths
- Given disk, permission, or Git persistence failure before durable acceptance, when execution handles the failure, then it does not advertise a reusable result or apply the stack from that unrecorded acceptance.
- Given a concurrent replacement of retained evidence, when an older operation attempts to replace or retire it, then the newer evidence survives the expected-value refusal.
- Given legacy state without automatic-acceptance evidence, when read, then existing operator-tip behavior remains available but the new automatic shortcut is not inferred.
### Done When
- [ ] Persistence and cleanup tests assert retained object reachability, expected-value failures, legacy compatibility, and isolation between two feature identities.

## Story 5: Report actual resolution work by operation and round

As an operator, I want to distinguish avoided repeat work from actual resolver attempts and cost.

### Acceptance Criteria
#### Happy Path
- Given deterministic, reused, and strong-resolver outcomes in a routed operation, when reporting reads the persisted event stream, then it groups outcomes by operation and round and identifies child, conflict commit, tier, provider attempts, and recorded cost.
- Given recovery reports an already recorded terminal outcome, when totals are calculated, then that outcome counts once while genuinely distinct provider attempts each remain counted.
#### Negative Paths
- Given missing cost or historical events without correlation, when reporting aggregates them, then it marks the value unknown or unattributed rather than assigning zero or guessing a round by time.
- Given an invalidated reuse candidate followed by a provider resolution, when totals are calculated, then the rejected candidate is not counted as a completed reused resolution.
- Given two distinct conflicts in one child or two operations in one round, when aggregated, then distinct conflict units and provider attempts are not collapsed together.
- Given event persistence fails after durable acceptance, when the operation reports failure and later resumes, then it does not erase accepted state, fabricate a successful report, or double-count terminal outcomes.
### Done When
- [ ] An emitter-to-persister-to-report test verifies round correlation, actual costs, missing-data presentation, and resumed-event deduplication without real provider calls.

## Coverage disposition

Stories 1 and rule permutations in Story 3 use focused replay/acceptance tests. Story 2 owns the distinct cross-operation Git integration flow, including recovery. Story 4 uses focused persistence adapter and local-Git lifecycle coverage. Story 5 owns event-to-reader integration. Reuse existing sufficient proofs for unchanged operator-tip and scheduling behaviors; do not duplicate their complete suites. Final task mapping will identify exact selectors.

## Negative category evaluation

Invalid input, data integrity, concurrency, partial failure, dependency unavailability, permissions, disk exhaustion, deduplication, and alternate error-path side effects are covered above. Provider timeouts are exercised at the fake adapter boundary. Retained acceptance is immutable per recorded identity; replacement uses expected-value checks. Cleanup is feature-scoped and cannot cascade to other features. No new authentication endpoint, network service, upload, database, or exception-class hierarchy is introduced. Production errors must be classified through existing typed Git/provider outcomes rather than treated as a successful cache miss indiscriminately.
