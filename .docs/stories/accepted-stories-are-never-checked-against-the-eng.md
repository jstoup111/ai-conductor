**Status:** Accepted

# Stories: One owner for accepted-story readability (#1744)

Technical track — criteria derive from issue #1744's desired outcomes and
adr-2026-09-23-one-owner-for-accepted-story-readability.

## Story 1: Land refuses an accepted stories file the engine cannot read

As an operator, I want a stories file whose criteria the engine cannot read to be refused at land so
that the failure surfaces while the artifact is still cheap to fix rather than as a terminal
`acceptance_specs` halt after the artifact is merged and sealed.

### Acceptance Criteria

#### Happy Path
- Given a spec worktree whose stories file states every story's criteria as single-line Given/When/Then bullets under headed Happy Path and Negative Paths sections, when land runs, then the spec commits and no readability refusal is raised
- Given a spec worktree whose stories file has five stories all stating readable criteria, when land runs, then land reaches its existing approval and plan-reference checks unchanged

#### Negative Paths
- Given a spec worktree whose Story 3 states its criteria as bold lines followed by one clause per bullet, when land runs, then land refuses and the refusal names Story 3
- Given the refusal raised for Story 3, when the operator reads the message, then it states that each criterion must be one single-line Given/When/Then bullet under a headed Happy Path or Negative Paths section
- Given a Small-tier spec worktree that authors no coherence artifact and whose only story yields zero readable criteria, when land runs, then land refuses rather than committing the spec
- Given a spec worktree whose Story 2 states four readable criteria and one bullet carrying only a Given clause, when land runs, then land refuses and the refusal names Story 2

### Done When
- [ ] `landSpec` raises a distinct land-gate refusal code for an unreadable stories artifact, alongside the existing `stories-not-approved` and `plan-stories-reference` codes
- [ ] A test asserts the refusal message contains the failing story's id and the required-shape sentence
- [ ] A test asserts a Small-tier spec with no coherence artifact is refused when its only story yields zero readable criteria
- [ ] A test asserts a spec whose stories are all readable lands unchanged

## Story 2: Land and the DECIDE stories gate reach one verdict

As the engine, I want land and the `stories` step gate to answer "is this a valid accepted story"
from one place so that a file one accepts is never a file the other refuses.

### Acceptance Criteria

#### Happy Path
- Given any stories file, when land and the `stories` step gate each evaluate it, then both obtain their verdict from the single predicate exported by `story-criteria.ts`
- Given a stories file the `stories` step gate accepts, when land evaluates that same file, then land accepts it

#### Negative Paths
- Given a stories file in which Story 2 carries a Happy Path section and no Negative Paths section, when land evaluates it, then land refuses naming Story 2, matching the `stories` step gate's refusal on the same file
- Given a stories file the `stories` step gate refuses, when land evaluates that same file, then land refuses it as well
- Given a corpus of stories files spanning readable, zero-criteria, and missing-section shapes, when both consumers evaluate every file, then no file is accepted by one consumer and refused by the other

### Done When
- [ ] A single readability predicate is exported from `src/conductor/src/engine/story-criteria.ts`
- [ ] `GATE_ONLY_PREDICATES.stories` obtains its per-story verdict from that predicate rather than from its own section check
- [ ] `landSpec` obtains its verdict from the same predicate
- [ ] A test evaluates a set of stories fixtures through both consumers and asserts their verdicts agree on every fixture

## Story 3: A hard-wrapped criterion bullet reads the same to both derivations

As the engine, I want the authoritative criterion list and the criterion id list to be derived from
one bullet primitive so that an `S<story>.<n>` id resolved by position lands on the criterion it
names.

### Acceptance Criteria

#### Happy Path
- Given a story whose Given/When/Then bullet is hard-wrapped across two lines with the continuation indented, when the authoritative criterion list and the criterion id list are derived from it, then both contain the same number of entries
- Given a story stating three criteria of which the first is hard-wrapped, when the id for the third criterion is resolved to its happy or negative section, then the section returned is the one that bullet was authored under

#### Negative Paths
- Given a bullet carrying its Given clause on the first line and its Then clause on an indented continuation line, when the authoritative criterion list is derived, then that bullet appears as one criterion rather than being dropped
- Given a story containing one hard-wrapped bullet, when the id for its last criterion is resolved, then a happy or negative section is returned rather than no section
- Given a stories file in which every story contains at least one hard-wrapped bullet, when the authoritative criterion list and the criterion id list are derived, then their entry counts are equal for every story in the file

### Done When
- [ ] `extractAuthoritativeStoryCriteria` derives its bullets from `listItems`, the same primitive `extractStoryCriterionIds` uses
- [ ] A test asserts both derivations return equal counts for a story containing a hard-wrapped Given/When/Then bullet, and fails if either drops it
- [ ] A test asserts `criterionStorySection` returns the authored section for the last criterion of a story containing a hard-wrapped bullet
- [ ] Existing fixtures asserting line-by-line extraction are updated to the joined behavior with their intent preserved

## Story 4: A merged spec keeps building regardless of its stories shape

As an operator, I want the new readability requirement confined to land and the DECIDE `stories`
gate so that merged specs already in the backlog continue to build exactly as they do today.

### Acceptance Criteria

#### Happy Path
- Given a merged spec whose stories file the readability predicate would refuse, when the daemon discovers and dispatches it, then discovery admits it and the build proceeds
- Given that merged spec reaching `acceptance_specs`, when the step derives its required evidence, then the readability predicate adds no requirement the step did not already impose

#### Negative Paths
- Given a merged spec whose stories file yields zero readable criteria, when the feature runs through BUILD and SHIP, then no BUILD or SHIP step refuses it on readability grounds
- Given a merged spec whose stories file is missing a Negative Paths section, when the daemon evaluates it for dispatch, then it is dispatched rather than skipped
- Given this feature's own change set, when the diff is inspected, then no other feature's stories artifact is added, modified, or deleted

### Done When
- [ ] A test asserts a stories artifact the readability predicate refuses is still admitted by discovery and still builds
- [ ] A test asserts no BUILD or SHIP consumer calls the readability predicate
- [ ] The change set modifies no other feature's stories artifact
