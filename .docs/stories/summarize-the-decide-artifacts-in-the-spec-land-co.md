**Status:** Accepted

# Stories: Summarize the DECIDE artifacts in the spec land commit body (#1779)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the message the land primitive commits,
composed from artifact content it already reads. The operator-attested rationale outcome and the
commit subject line remain outside this slice.

## Story 1: The spec land commit carries a summary of the artifacts it lands

As an operator reviewing a spec pull request, I want its body to describe what the spec decided so that I can review it without opening every landed artifact.

### Acceptance Criteria

#### Happy Path

- Given a worktree whose plan artifact carries a Summary section and whose stories artifact carries two story headings, when the spec is landed, then the landed commit message keeps its existing subject line and its body carries the plan's summary text.
- Given that same worktree declares a technical track and tier S, when the spec is landed, then the landed commit message body names the track, the tier, each story heading, and the plan's task count.

#### Negative Paths

- Given a worktree whose plan artifact has no Summary section and whose stories artifact has no story heading, when the spec is landed, then the commit is still created and its body carries no heading for the missing sections.

### Done When

- [ ] A real-temporary-repository land fixture shows the committed subject line unchanged from its current form.
- [ ] That fixture's committed body contains the plan summary sentence, both story headings, the track, the tier, and the plan task count.
- [ ] A degraded fixture with no plan summary and no story heading lands successfully and its body carries no heading followed by an empty section.

## Story 2: The composed body never forges build evidence and never blocks the land

As a maintainer of the build evidence reader, I want the composed message to stay inert prose so that it cannot be mistaken for task evidence or abort a land.

### Acceptance Criteria

#### Happy Path

- Given a plan whose tasks are numbered, when the commit body renders those tasks, then no rendered line matches the commit trailer grammar the build evidence reader uses.

#### Negative Paths

- Given artifact text that itself contains a line in that trailer grammar, when the body is composed, then that line does not appear in the composed message.
- Given empty or unparseable plan and stories text, when the body is composed, then the composer returns the subject line alone and raises no error.

### Done When

- [ ] Unit cases assert that every rendered task line fails the exported task-trailer pattern the evidence reader applies.
- [ ] A unit case with a trailer-shaped line inside the plan summary shows that line absent from the composed message.
- [ ] A unit case with empty plan and stories text returns a message equal to the subject line and throws nothing.

## Negative-category review

Invalid and missing input is covered by the absent-Summary, absent-story-heading, and empty-text
criteria — the composer's whole input surface is text already in memory, so malformed input is the
only input failure mode available. Data integrity is covered by the trailer-grammar criteria: the
one way this text can corrupt state is by being re-read as a commit trailer by the build evidence
reader, and both a rendered line and a copied artifact line are asserted against that grammar.
Partial failure is covered by requiring the land to commit regardless of what the composition could
not derive. Auth, permission, timeout, network, dependency-unavailability, concurrency, resource
exhaustion, cascade-deletion, and immutability categories are inapplicable: the composer is a pure
in-memory function with no I/O, no external call, no shared mutable state, and no deletion, and the
land primitive's existing identity, dirty-tree, and artifact gates are unchanged by this slice.
