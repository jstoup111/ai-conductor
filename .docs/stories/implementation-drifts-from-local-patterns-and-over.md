**Status:** Accepted

# Stories: feature-specific pattern reuse and lowest-sufficient testing

**Track:** Technical — no PRD. These stories derive from the approved architecture review for
jstoup111/ai-conductor#1552.

## Story 1: DECIDE establishes an applicable pattern basis

**Requirement:** Technical intent — preserve approved architecture and reuse a suitable established
pattern when one applies, without creating universal project style rules.

As an operator, I want DECIDE to establish the relevant local precedent for a feature so that BUILD
starts from an approved, project-consistent basis rather than an implementer's preferred abstraction.

### Acceptance Criteria

#### Happy Path

- Given approved architecture governs the feature, when DECIDE selects its implementation basis,
  then the approved architecture is authoritative even when current code demonstrates a conflicting
  pattern.
- Given no approved decision settles the implementation shape and a suitable established pattern
  exists, when architecture review completes, then it records the pattern's role, important semantic
  traits, applicability rationale, allowed variation, and current-checkout search hints.
- Given the selected precedent applies only to a particular feature concern, when its context is
  handed forward, then it is bounded to that concern and does not become a universal project style
  rule.

#### Negative Paths

- Given current code conflicts with an approved decision, when DECIDE evaluates that code, then it
  rejects the code as precedent and does not carry it into BUILD context.
- Given no suitable established pattern can be verified, when architecture review completes, then it
  records that no applicable precedent was found instead of inventing one or choosing an
  unrelated exemplar.
- Given the only proposed alternative is a broader refactor that the operator has not authorized,
  when DECIDE attempts to hand work to BUILD, then the handoff remains incomplete until the operator
  either authorizes a bounded departure or selects an in-scope approach.

### Done When

- [ ] Accepted DECIDE output carries either a feature-bounded semantic pattern basis or an explicit
      verified no-fit/operator-authorized-departure result
- [ ] A recorded pattern basis identifies role, traits, rationale, allowed variation, and search
      hints without line-number anchors or a project-wide convention catalog
- [ ] Conflicting existing code cannot outrank approved architecture in the recorded basis
- [ ] An unapproved refactor cannot reach an accepted BUILD handoff

## Story 2: BUILD resolves the precedent on its current checkout

**Requirement:** Technical intent — isolated implementers receive concrete context and reuse the
current equivalent rather than an authoring-time snapshot.

As an operator, I want each isolated implementation task to receive focused pattern context and
resolve it against current HEAD so that rebases and intervening edits do not make the guidance
silently obsolete.

### Acceptance Criteria

#### Happy Path

- Given an accepted plan task depends on an established pattern, when an isolated implementer is
  dispatched, then the task includes the focused semantic traits, applicability rationale, allowed
  variation, and search hints needed to locate the current equivalent.
- Given an exemplar path or symbol moved after DECIDE but a semantically equivalent implementation
  remains discoverable, when BUILD begins the task, then it uses that current equivalent and
  continues without requiring the old coordinate.
- Given the current equivalent is found, when the behavior is implemented, then the result is the
  smallest behavior-complete change that conforms to the applicable semantic traits.

#### Negative Paths

- Given the relevant context is absent from a task that depends on it, when dispatch is attempted,
  then the task is treated as lacking implementation context rather than inviting the isolated
  implementer to choose an unrelated pattern.
- Given the hinted exemplar no longer exists and no semantic equivalent can be verified, when that
  absence would change the implementation approach, then BUILD surfaces stale context and requests
  a decision instead of guessing, copying obsolete code, or widening scope.
- Given a smaller change would pass its immediate test but materially violates the applicable
  pattern, when implementation is evaluated, then it is rejected as incomplete rather than accepted
  as the simplest passing code.

### Done When

- [ ] Every affected implementation dispatch carries the accepted feature-specific pattern context
      through the existing task handoff
- [ ] A moved or renamed exemplar remains usable through semantic rediscovery on current HEAD
- [ ] A load-bearing missing equivalent produces a visible context request/block rather than an
      invented replacement
- [ ] Passing behavior alone does not make a material unapproved pattern departure complete

## Story 3: Review distinguishes material drift from harmless variation

**Requirement:** Technical intent — relevant review surfaces assess intended reuse without enforcing
subjective style preferences.

As an operator, I want implementation review to use the same focused pattern basis so that material
drift is caught while harmless local variation remains allowed.

### Acceptance Criteria

#### Happy Path

- Given a change has an accepted feature-specific pattern basis, when implementation and
  simplification review run, then they compare the change's material structure and behavior with the
  recorded semantic traits.
- Given a change preserves the applicable traits but differs in an explicitly allowed or immaterial
  detail, when review runs, then that variation is accepted without requiring exact textual or
  structural replication.

#### Negative Paths

- Given a change materially departs from the applicable traits without an operator-authorized
  reason, when review runs, then it reports the concrete departure and blocks acceptance of that
  change.
- Given a reviewer merely prefers a different abstraction or naming style that is not part of the
  accepted basis, when review runs, then that preference does not become a blocking conformance
  finding.

### Done When

- [ ] Relevant implementation and simplification reviews can consult the same accepted semantic
      basis used by the implementer
- [ ] A material unapproved departure produces a concrete conformance finding
- [ ] Exact copying, line-coordinate stability, and reviewer style preference are not conditions of
      conformance
- [ ] No `build_review` prompt, rubric, verdict, or runner behavior changes under this story

## Story 4: Tests cover behavior at the lowest sufficient layer

**Requirement:** Technical intent — cover every happy and negative criterion while avoiding
redundant acceptance tests, production-file mirror tests, and tests of skill wording.

As an operator, I want each criterion assigned to the lowest sufficient behavioral test layer so
that failures remain well covered without making the suite larger or more brittle than the behavior
requires.

### Acceptance Criteria

#### Happy Path

- Given an accepted story criterion, when test coverage is planned, then it receives a concrete
  disposition identifying existing sufficient coverage, a lower-layer behavioral test, or an
  acceptance/system test.
- Given a criterion describes one behavior or failure boundary that can be proven sufficiently at a
  unit, request, endpoint, or comparable lower layer, when tests are authored, then coverage remains
  at that lower layer.
- Given a criterion describes a distinct multi-step externally observable flow that cannot be
  proven sufficiently below, when tests are authored, then one acceptance/system test covers that
  flow.
- Given negative variants are sufficiently covered below the acceptance layer, when acceptance
  coverage is authored, then it covers the distinct flow without repeating every lower-layer
  permutation.

#### Negative Paths

- Given a criterion has neither existing proof nor an assigned sufficient test, when coverage is
  reviewed, then the work remains incomplete and names the uncovered behavior.
- Given sufficient lower-layer proof already exists, when acceptance specs are considered, then a
  redundant acceptance test is not generated solely because the criterion appears in a story.
- Given production code changes across one or more files without introducing separate behavioral
  boundaries, when test scope is chosen, then no mirror test is required solely to correspond to
  each production file.
- Given this feature changes natural-language skill guidance without introducing a machine-readable
  or executable contract, when its verification is authored, then no test passes solely by matching
  that guidance's words.

### Done When

- [ ] Every happy and negative criterion has one explicit lowest-sufficient coverage disposition
- [ ] Acceptance/system coverage is reserved for distinct multi-step externally observable flows
- [ ] Existing or lower-layer coverage prevents redundant acceptance-layer permutations
- [ ] Test scope follows changed behavior and failure boundaries rather than production-file count
- [ ] #1552 adds no assertion whose only success condition is specific natural-language skill text

> **Amended 2026-08-13 by #1552:** Story 4 governs ordinary test derivation. A plan carrying a valid
> declared exact-replication contract continues copying its source acceptance specs under
> `adr-2026-08-09-declared-pattern-replication-in-build`, even when those inherited specs would not
> be selected from scratch under the lowest-sufficient-layer rule. This exception does not apply to
> semantic pattern reuse without `Pattern-source` / `Rename-map`.
