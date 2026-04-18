# Story: User Story Generation

**Status:** ACCEPTED
**Epic:** EP-001 Conductor Core Engine
**Skill:** stories/SKILL.md

As a developer, I want the stories skill to translate an approved design document into
structured user stories with mandatory happy and negative paths so that every requirement
has testable acceptance criteria before implementation.

## Acceptance Criteria

### Happy Path
- Given an approved design doc exists in `.docs/specs/`, when the stories skill runs, then
  it generates a story for each requirement with Given/When/Then acceptance criteria
- Given a story is generated, when it includes negative paths, then each path is concrete
  (specific error codes, specific messages) — not vague ("handle errors gracefully")
- Given all stories are generated, when they are saved, then they go to
  `.docs/stories/<feature-name>.md` (one file per feature area)
- Given each story, when it includes a "Done When" section, then the checkboxes are concrete,
  independently verifiable outputs — not restatements of acceptance criteria

### Negative Paths
- Given a story has only happy paths (no negative paths), when the quality gate runs, then
  it BLOCKS: the story is rejected until at least one negative path per criterion is added
- Given negative paths use vague language ("return appropriate error"), when the quality gate
  runs, then it BLOCKS: concrete Given/When/Then with specific values is required
- Given DRAFT stories from bootstrap exist, when the stories skill runs, then it reviews
  and completes them rather than generating duplicates from scratch
- Given the design doc has requirements that don't map to user-observable behavior, when
  stories are generated, then implementation details are excluded — stories describe what,
  not how

### Done When
- [ ] Every requirement in the design doc has at least one story
- [ ] Every story has both happy AND negative paths
- [ ] At least one negative path per acceptance criterion
- [ ] All negative paths are concrete Given/When/Then (not vague)
- [ ] Every story has a "Done When" section with verifiable outputs
- [ ] Stories saved to .docs/stories/<feature-name>.md
