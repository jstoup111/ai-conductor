**Status:** Accepted

# Stories: Stop retrying an unresolved skill dispatch and name its remedy (#1631)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the auxiliary dispatch retry loop and
the diagnosis recorded when a build_review rubric's skill command cannot be resolved. A pre-dispatch
existence preflight for ordinary lifecycle steps, and parity of the unresolved-command signal across
providers, remain outside this slice.

## Story 1: Stop burning a member's retry budget on an unresolved skill command

As an operator, I want a deterministic unresolved-command failure to end an auxiliary member's
attempts immediately so that a fault no retry can change does not consume the member's allowance.

### Acceptance Criteria

#### Happy Path

- Given an auxiliary member's first provider attempt reports an unresolved skill command, when the auxiliary executor settles that member, then it makes no further provider attempt and returns that attempt's result with its unresolved-command classification intact.
- Given an auxiliary member's first provider attempt fails for an ordinary reason, when the auxiliary executor settles that member, then it retries up to the member's configured allowance exactly as before.

#### Negative Paths

- Given an auxiliary member is configured with a second provider candidate and its first candidate reports an unresolved skill command, when the auxiliary executor settles that member, then the second provider is never invoked and the returned result still names the unresolved command.
- Given an auxiliary member exhausts its configured allowance on ordinary failures, when the auxiliary executor settles that member, then the returned result is the last ordinary failure and carries no unresolved-command classification.

### Done When

- [ ] A unit fixture whose injected provider reports an unresolved command records exactly one provider invocation for a member configured with an allowance greater than one.
- [ ] A unit fixture with two configured provider candidates and an unresolved command on the first records zero invocations against the second.
- [ ] The existing auxiliary retry and model-ladder fixtures still observe their full configured attempt sequence and their unchanged returned result.

## Story 2: Name the cause and the remedy when a rubric's skill command cannot be resolved

As an operator, I want the recorded rubric failure to name the skill and the remedy so that I do not
have to infer a stale base from raw provider output.

### Acceptance Criteria

#### Happy Path

- Given a rubric dispatch whose provider attempt reports an unresolved skill command, when that rubric branch settles, then the lap records a dispatch failure whose detail names the rubric skill, states that retrying cannot resolve it, and gives both the catalog-relink and the rebase remedy.
- Given a rubric branch settles as an infrastructure failure after dispatch and carries a detail, when the coordinator emits its infrastructure-failure event, then the event carries that detail as its excerpt.

#### Negative Paths

- Given a rubric dispatch fails for any reason other than an unresolved skill command, when that rubric branch settles, then the recorded detail is the existing contract-rejection diagnosis and no remedy text is added.
- Given a rubric branch settles as an infrastructure failure with no detail, when the coordinator emits its infrastructure-failure event, then the event omits its excerpt field rather than carrying an empty one.

### Done When

- [ ] A unit fixture renders the remedy detail for a named rubric skill, and the rendered string contains the skill name, the unresolved command name, the relink remedy, and the rebase remedy.
- [ ] A rubric-dispatch fixture whose injected provider reports an unresolved command settles that rubric as an infrastructure failure whose detail is the rendered remedy, and never as a passing judgement.
- [ ] A coordinator fixture asserts the post-dispatch infrastructure-failure event carries the branch detail as its excerpt, and omits the excerpt when the branch has none.

## Negative-category review

Dependency unavailability is the governing category and is covered directly: an unresolvable skill
command is a dependency the provider cannot supply, and both stories assert it terminates rather than
degrades. Partial failure is covered by Story 2's other-reason criterion, which keeps every existing
rejection diagnosis intact while one member fails for a new reason. Data integrity is covered by the
requirement that an unresolved command never settles as a judgement — the failure stays an
infrastructure failure, so no gate reports success on criteria that were never loaded. Idempotency is
covered by the allowance criteria: repeating the lap produces the same single attempt and the same
detail. Invalid input, authentication, resource exhaustion, cascade deletion, and model immutability
are inapplicable — this slice adds no user input surface, no protected resource, no allocation, no
entity, and no persisted record. Concurrent access needs no new criterion: rubric members already run
through the existing bounded fan-out and this change alters only what one member does with its own
result. Timeouts and rate limits keep their existing recovery precedence, which this change does not
reach.
