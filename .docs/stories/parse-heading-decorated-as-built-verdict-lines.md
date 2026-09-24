**Status:** Accepted

# Stories: Parse heading-decorated as-built verdict lines (#2203)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the as-built verdict: the reviewer's
formatting of a Markdown verdict line never decides the gate, a reviewer-written report with no typed
verdict is not a verdict, and every engine consumer of the verdict (gate, halt body, retained shipment
findings) reads the same typed as-built verdict. The delivered-outcome field is owned by #2175 and is
exercised here only in its already-supported form.

## Story 1: Read a decorated verdict line as the verdict it states

As the operator of an autonomous build, I want an as-built review that states a recognized verdict to
be read as that verdict regardless of how the reviewer would have formatted a Markdown verdict line, so
that a complete approving review does not become a needs-human halt over formatting.

### Acceptance Criteria

#### Happy Path

- Given an as-built dispatch whose structured result carries verdict `APPROVED WITH DRIFT NOTES`, when the as-built outcome is classified from the persisted typed verdict, then it is classified as approved and the rendered report shows that verdict.
- Given a persisted typed verdict of `APPROVED` and a rendered report whose verdict line has been hand-decorated with a heading prefix, bold markers, and a lower-case value, when the gate is evaluated, then it is classified approved from the typed verdict and the report's formatting has no effect.

#### Negative Paths

- Given a worktree holding only a reviewer-written `.pipeline/architecture-review-as-built.md` whose verdict is a heading-decorated line and no typed verdict, when the as-built completion check runs, then the gate is scored `absent` and the step reruns rather than passing or halting on the line's format.
- Given an as-built structured result whose `verdict` is a value outside the closed vocabulary, when the engine validates it, then it is rejected with a diagnostic naming `verdict` and carrying that raw value, and the attempt is scored `absent` and reruns.

### Done When

- [ ] The as-built outcome classifier returns the approved outcome for a typed approving verdict.
- [ ] Hand-decorating the rendered report's verdict line never changes a consumer's outcome.
- [ ] A Markdown-only heading-decorated report scores `absent`, and an out-of-vocabulary typed verdict is rejected with its field-named diagnostic.

## Story 2: Keep every reader of the verdict line in agreement

As the operator, I want the halt body and the retained shipment findings to read the as-built verdict
the same way the gate does, so that no consumer can silently drop a blocking-findings detail or a
delivered plan-gap record for the same review.

### Acceptance Criteria

#### Happy Path

- Given a persisted BLOCKED typed verdict carrying typed findings, when the as-built halt body is rendered, then it lists those findings with their class and governing reference instead of an empty detail.
- Given a persisted PLAN_GAP typed verdict with `outcomeDelivered` true, when the retained shipment findings are collected, then the plan-gap finding is recorded from that typed verdict, the same one the gate read.

#### Negative Paths

- Given a worktree carrying no typed as-built verdict, even when a reviewer-written Markdown report with a verdict line is present, when the halt body is rendered and the retained shipment findings are collected, then the halt body carries no blocking-findings detail and no plan-gap finding is recorded.

### Done When

- [ ] A BLOCKED typed verdict reaches the operator-facing halt with its typed findings enumerated.
- [ ] A delivered PLAN_GAP typed verdict yields the retained plan-gap finding through the same reader the gate uses.
- [ ] A worktree with no typed verdict yields neither a blocking-findings detail nor a retained plan-gap finding.
- [ ] No engine module reads the as-built verdict line from Markdown; the repository check from #2188 Story 8 enforces it.

## Negative-category review

Invalid input is the live category and is covered three ways: a reviewer-written heading-decorated
report with no typed verdict, a typed verdict whose value is outside the closed vocabulary, and a
worktree with no typed verdict at all — each must fail closed, because a consumer that starts accepting
these is the precise way this change could ship a review that was never approved. Data integrity is
covered by the agreement criteria: a verdict the gate accepts must not be invisible to the halt
renderer or the shipment record. The subject is a read of one already-persisted typed verdict, so auth
and permission failures, timeouts and network errors, concurrent access, resource exhaustion, partial
failure and rollback, dependency unavailability, cascade deletion, immutability, exception hierarchies,
and dedup keys have no surface here and are inapplicable. Idempotency is trivially held: the read is a
pure function of the persisted verdict.
