**Status:** Accepted

# Stories: Enforce the plan task-count hard stop at land (#1645)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the land-time refusal, the explicit
in-artifact exception that admits a deliberately large plan, and a single readable source for the
band boundaries. Threshold recalibration and warning-band authoring behavior remain outside this
slice.

## Story 1: Refuse an over-threshold plan at land

As an operator, I want a plan past the documented hard stop to be refused when it lands so that an
oversized plan cannot reach BUILD merely because the authoring agent ignored prose no code reads.

### Acceptance Criteria

#### Happy Path

- Given a plan whose addressable task count is at or above the hard-stop boundary and which declares no scope exception, when the spec is landed, then land fails and the message names the plan's task count and the hard-stop boundary.
- Given a plan whose addressable task count is below the hard-stop boundary, when the spec is landed, then land succeeds exactly as it does today with no additional artifact, prompt, or declaration required.

#### Negative Paths

- Given a plan below the hard-stop boundary whose fenced code examples contain further task headings that would carry it over that boundary, when the spec is landed, then those fenced headings are not counted and land succeeds.

### Done When

- [ ] A land fixture whose plan carries task ids at the hard-stop boundary and no declaration is refused, and the refusal text contains both the count and the boundary.
- [ ] A land fixture one task below the boundary lands unchanged with no new file written and no new required header.
- [ ] A land fixture whose over-boundary task headings sit inside a fenced block lands successfully.

## Story 2: Admit a deliberately large plan through one explicit recorded declaration

As an operator, I want the only way past the hard stop to be an explicit rationale written into the
plan itself so that the decision and its reason are readable afterward by someone who was not
present.

### Acceptance Criteria

#### Happy Path

- Given a plan at or above the hard-stop boundary that declares exactly one scope exception with a non-empty rationale, when the spec is landed, then land succeeds and the committed plan artifact still carries that rationale verbatim.

#### Negative Paths

- Given a plan at or above the hard-stop boundary whose scope-exception declaration has an empty rationale, when the spec is landed, then land fails naming the declaration as malformed rather than treating it as authorization.
- Given a plan at or above the hard-stop boundary carrying two or more scope-exception declarations, when the spec is landed, then land fails as ambiguous rather than accepting either declaration.

### Done When

- [ ] A land fixture at the boundary with one non-empty declaration lands, and reading the committed plan back from the branch shows the rationale text unchanged.
- [ ] Empty-rationale and duplicate-declaration land fixtures are each refused with a message that distinguishes a malformed declaration from an absent one.
- [ ] A declaration on a plan below the boundary changes nothing about the land outcome.

## Story 3: Make the band boundaries readable from one place

As a plan author, I want the boundaries the gate enforces and the boundaries the plan skill
documents to be provably the same numbers so that I can tell what the current limits are without
inferring them from prose no code reads.

### Acceptance Criteria

#### Happy Path

- Given the engine exports the band boundaries as named constants, when the gate refuses a plan and when the plan skill documents its scope bands, then both render the same boundary values from those constants.

#### Negative Paths

- Given documented band text whose boundary numbers differ from the exported constants, when the boundaries are compared, then the comparison reports the drift instead of passing.

### Done When

- [ ] A contract test reads the plan skill's scope-band section and asserts its boundary numbers equal the exported constants.
- [ ] A drifted band-text fixture makes the comparison report a mismatch, proving the check can fail.
- [ ] The gate's refusal message derives its boundary number from the exported constant rather than a literal.

## Negative-category review

Invalid input is covered by the empty-rationale and duplicate-declaration cases and by the fenced
example-heading case, which is the realistic malformed-count input for a Markdown artifact. Data
integrity is covered by reading the committed plan back after land to prove the rationale survives.
Idempotency and dedup are covered by requiring exactly one declaration and by proving a declaration
below the boundary is inert. Auth, timeout, network, dependency-unavailability, concurrency,
resource-exhaustion, and partial-failure/rollback categories are inapplicable: the gate is a pure
in-process text predicate over an already-read artifact, performs no I/O of its own, holds no state,
and refuses by throwing on the existing land error path, which the surrounding land tests already
prove leaves the worktree in place. Cascade-deletion, model-immutability, and exception-hierarchy
categories are inapplicable because nothing is deleted, persisted, or rescued by type. The
invariant-side-effect category is addressed by asserting the below-boundary path is unchanged, so
the new check cannot silently alter an ordinary land.
