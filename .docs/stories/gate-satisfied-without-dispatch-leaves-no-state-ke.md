**Status:** Accepted

# Stories: Gate satisfied without dispatch leaves no state key, so FINISH invalidates forever (#1587)

Track: technical

Tier: M

Approved by the operator on 2026-09-14. Scope is FINISH's implementation-evidence observation and
the diagnostic its refusal carries, per
`.docs/decisions/architecture-review-2026-09-14-gate-satisfied-without-dispatch-leaves-no-state-ke.md`.
Persisting a step status when a gate resolves without dispatch, and bounding the `finish` kickback
gate, are outside this slice and were refused by approved decisions recorded in the track marker.

## Story 1: FINISH and the loop agree about a gate the loop already resolved

As an operator whose feature has reached the publication tail, I want FINISH to judge implementation
evidence by the same authority the loop used to resolve those gates, so that a gate the loop already
accepted does not send the whole BUILD verification round-trip a second time for nothing.

### Acceptance Criteria

#### Happy Path

- Given `build_review` and `test_suite` each carry a satisfied gate verdict and neither has a step-status key, when FINISH observes implementation evidence, then the evidence reads valid and publication proceeds past the implementation-evidence preflight.
- Given `build_review` and `test_suite` each carry a satisfied gate verdict and each also has a `done` step status, when FINISH observes implementation evidence, then the evidence reads valid, as it does today.
- Given a gate was resolved by a skip verdict rather than a run, when FINISH observes implementation evidence, then that gate counts as satisfied and does not by itself make the evidence invalid.

#### Negative Paths

- Given `build_review` carries a gate verdict whose satisfied flag is false, when FINISH observes implementation evidence, then the evidence reads invalid and publication is blocked at the implementation-evidence preflight.
- Given `test_suite` has no gate verdict on disk and no step-status key, when FINISH observes implementation evidence, then the evidence reads invalid rather than defaulting to satisfied.
- Given `build_review` carries a satisfied gate verdict but its step status is `stale`, when FINISH observes implementation evidence, then the evidence reads invalid, because a staled step must re-run regardless of an older verdict.
- Given the gate-verdict directory cannot be read at all, when FINISH observes implementation evidence, then the observation falls back to step status alone and does not throw, and a feature whose steps are not `done` still reads invalid.
- Given a gate-verdict file exists but its content is malformed, when FINISH observes implementation evidence, then that gate is treated as carrying no verdict rather than as satisfied.

### Done When

- [ ] A fixture with satisfied `build_review` and `test_suite` verdicts and no step-status keys for either reaches the transition selection stage of FINISH, and the same fixture is blocked at the implementation-evidence preflight before the change.
- [ ] A fixture whose `build_review` verdict carries a false satisfied flag is blocked at the implementation-evidence preflight, with both step-status keys absent and present.
- [ ] A fixture whose `test_suite` has neither a verdict nor a step-status key is blocked at the implementation-evidence preflight.
- [ ] A fixture whose `build_review` verdict is satisfied while its step status is `stale` is blocked at the implementation-evidence preflight.
- [ ] A fixture whose gate-verdict directory is absent completes the observation without raising, and its result is decided by step status alone.
- [ ] A fixture whose `build_review` verdict file contains unparseable content is blocked at the implementation-evidence preflight rather than reading as satisfied.
- [ ] The observation reaches its satisfaction answer through the selector's exported gate-satisfaction function, evidenced by a test that substitutes that function and observes the call.

## Story 2: A blocked publication names the step that must be re-run

As an operator reading a halted or kicked-back feature, I want the refusal to name which step's
evidence is unsatisfied, so that I can act on the actual gate instead of re-running a whole BUILD
verification chain to discover which member was failing.

### Acceptance Criteria

#### Happy Path

- Given `build_review` is the only unsatisfied member when FINISH observes implementation evidence, when publication is blocked, then the refusal carries `build_review` as the named unsatisfied step in a typed field.
- Given `test_suite` is the only unsatisfied member, when publication is blocked, then the refusal carries `test_suite` as the named unsatisfied step in a typed field.
- Given both members are unsatisfied, when publication is blocked, then the refusal names both, in the order the members are evaluated.
- Given a blocked publication is routed back to build, when the kickback evidence and the build retry hint are composed, then each names the unsatisfied step or steps carried on the typed field.

#### Negative Paths

- Given a consumer needs to know which step was unsatisfied, when it obtains that step, then it reads the typed field, and a test that changes the refusal's human-readable message leaves every consumer's behavior unchanged.
- Given implementation evidence is indeterminate rather than invalid, when publication is blocked, then the refusal carries no named unsatisfied step, because no step was established as unsatisfied.
- Given a publication is blocked for a condition other than invalid implementation evidence, when the refusal is rendered, then it carries no named unsatisfied step and the existing guidance for that condition is unchanged.

### Done When

- [ ] A fixture with only `build_review` unsatisfied produces a refusal whose typed unsatisfied-step field equals exactly the `build_review` member.
- [ ] A fixture with only `test_suite` unsatisfied produces a refusal whose typed unsatisfied-step field equals exactly the `test_suite` member.
- [ ] A fixture with both members unsatisfied produces a refusal naming both.
- [ ] The kickback evidence recorded when FINISH routes back to build contains the named step or steps, asserted against the recorded evidence value rather than against log text.
- [ ] A test that rewrites the invalid-evidence message text leaves the named step and every consumer assertion passing, proving no consumer parses the message.
- [ ] An indeterminate implementation-evidence observation produces a refusal with no named unsatisfied step.
- [ ] A refusal for a different publication condition carries no named unsatisfied step and renders its existing guidance unchanged.

## Negative-category review

**Dependency unavailability** is the dominant category and is covered in Story 1 by the unreadable
verdict-directory and malformed-verdict-file criteria. The gate-verdict store is the one new
dependency this change introduces into the FINISH observation path, and its failure must degrade to
the prior state-only answer rather than to a confident satisfied.

**Data integrity** is covered by the malformed-verdict criterion and by the `stale` criterion: a
verdict that exists but cannot be trusted, and a verdict that is true but superseded by the step's
own status, must both read unsatisfied. These are the two ways the new read could manufacture a pass
the loop would not have granted.

**Partial failure** is covered by the both-members-unsatisfied criteria in Story 2 — the refusal must
not name only the first member it happened to evaluate.

**Exception-class behavior** is covered by the unreadable-directory criterion: the observation must
resolve to a value rather than raising, because the publication observer maps a raised observation to
`indeterminate`, a different condition with a different route.

**Invariant side-effect on alternate branches** is covered by the Story 2 criterion asserting the
kickback evidence and the build retry hint each carry the named step. The typed field existing on the
refusal value does not by itself reach the operator; the branch that composes those two strings is
the one that must consume it.

**Invalid input, auth/permission, concurrency, resource exhaustion, and cascade deletion** do not
apply. This change adds no user-facing input, no protected resource, no new shared mutable state, no
unbounded allocation, and no entity with dependents. The observation is a single read on a path that
already performs git and GitHub observation under the same conditions.
