**Status:** Accepted

# Stories: Operator-Controlled DECIDE Scope

**Track:** Technical
**Complexity:** Medium

## Story 1: Ask and preserve fix comprehensiveness

As an operator, I want DECIDE to ask how comprehensive a fix should be before selecting an approach, so that the specification neither narrows nor expands my intended outcome without consent.

### Acceptance Criteria

#### Happy Path

- Given a change can reasonably be solved at different breadths, when `explore` clarifies intent, then it explicitly asks how comprehensive the fix should be before recommending or confirming an approach.
- Given the operator answers the comprehensiveness question, when architecture review, stories, and planning run, then each remains within the confirmed breadth and stated in/out boundaries.
- Given a downstream DECIDE step discovers that a materially broader solution would add value, when it presents that expansion, then the operator must confirm it before the expansion enters an accepted artifact.

#### Negative Paths

- Given the operator has not answered the comprehensiveness question, when `explore` is ready to finalize an approach, then it blocks rather than silently defaulting to minimal, balanced, or comprehensive scope.
- Given the operator selected a narrow repair, when a downstream step identifies adjacent improvements, then those improvements remain out of scope unless the operator explicitly widens the boundary.
- Given the operator selected a comprehensive repair, when planning decomposes the work, then it does not silently narrow the accepted outcomes merely to reduce effort.

### Done When

- [ ] The shipped `explore` contract requires one explicit comprehensiveness question before approach confirmation.
- [ ] The shipped architecture-review, stories, and plan contracts preserve the confirmed boundary and require re-confirmation before material expansion.
- [ ] The planner persona no longer treats usefulness expansion as an unconditional responsibility.
- [ ] Contract tests fail if the mandatory question or downstream preservation rules are removed.

## Story 2: Create ADRs only for structural change

As an operator, I want architecture review to create ADRs only for real structural changes, so that ordinary workflow policy and implementation choices do not acquire unnecessary architectural ceremony.

### Acceptance Criteria

#### Happy Path

- Given an accepted solution changes a system boundary, component or service decomposition, integration, state/data architecture, or foundational technology, when architecture review finds no existing decision that governs it, then it requires an ADR.
- Given an accepted solution changes only workflow policy, prompt wording, or an ordinary implementation detail without changing system structure, when architecture review runs, then it records any needed review finding without creating an ADR.

#### Negative Paths

- Given a change is important or broadly applicable but not structural, when architecture review evaluates it, then importance alone does not trigger an ADR.
- Given a structural change appears small in line count, when architecture review evaluates it, then size alone does not waive the ADR requirement.
- Given an existing ADR already governs the structural choice, when architecture review confirms alignment, then it references the existing decision instead of creating a duplicate ADR.

### Done When

- [ ] The shipped architecture-review contract makes real structural change a necessary condition for new ADR creation.
- [ ] The contract defines structural change with the accepted boundary, component/service, integration, state/data, and foundational-technology categories.
- [ ] The contract rejects importance, breadth, and implementation detail as independent ADR triggers.
- [ ] Contract tests distinguish a non-structural policy change, a small structural change, and a structural choice already governed by an ADR.
