**Status:** Accepted

# Stories: Fail land when a non-Small architecture artifact has no mermaid diagram (#729)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is one presence check at the engineer land seam over the spec's own architecture artifact, plus the documentation and skill text that describe it. Auditing merged architecture documents, new flags or config, and changes to diagram rendering remain outside this slice.

## Story 1: Refuse a non-Small spec whose architecture artifact carries no diagram

### Acceptance Criteria

#### Happy Path

- Given a non-Small spec whose architecture artifact contains at least one fenced mermaid block, when the spec is landed, then land proceeds past the architecture checks and completes normally.

#### Negative Paths

- Given a non-Small spec whose architecture artifact contains no fenced mermaid block, when the spec is landed, then land is refused with an error naming that architecture file and directing the author to regenerate its diagram.
- Given a non-Small spec whose architecture artifact only mentions a mermaid fence mid-sentence in prose rather than opening a block at the start of a line, when the spec is landed, then land is refused for the same missing-diagram reason.

### Done When

- [ ] A land fixture whose non-Small architecture artifact holds one fenced mermaid block lands and returns a slug.
- [ ] A land fixture whose non-Small architecture artifact holds only prose is rejected, and the rejection text contains that artifact path.
- [ ] A land fixture whose architecture artifact mentions a fence only mid-sentence is rejected for the missing-diagram reason rather than a render or tool-missing reason.

## Story 2: Keep the presence check scoped to this spec's own non-Small artifact

### Acceptance Criteria

#### Happy Path

- Given a Small-tier spec that authors no architecture artifact at all, when the spec is landed, then land completes without any diagram-presence refusal.

#### Negative Paths

- Given a non-Small spec whose worktree inherits a committed, diagram-free architecture document under a stem this spec did not author, when the spec is landed, then the inherited document is never examined and land is refused only if the spec's own architecture artifact lacks a diagram.
- Given a non-Small spec whose complexity artifact is absent so no tier can be read, when the spec is landed, then the existing legacy behavior is preserved and no diagram-presence refusal is raised.

### Done When

- [ ] A Small-tier land fixture with no architecture directory lands and returns a slug.
- [ ] A land fixture whose base branch commit holds a diagram-free architecture document under an unrelated stem lands when the spec's own architecture artifact carries a fence.
- [ ] A land fixture with no complexity artifact lands unchanged, proving the check never fires when the tier is unknown.

## Negative-category review

Input-integrity cases are the fence-less artifact and the prose-only near-miss, which together cover the two authoring mistakes the issue reports. Scoping cases are the Small tier, the inherited base-branch document, and the unreadable tier, which cover the ways an over-broad check would false-fail work it has no business judging. The check performs a single read of a file the surrounding code has already resolved and proven present, so there is no new external call, permission, network, dependency, deletion, queue, datastore, upload, or transaction category to cover; an unreadable-file case is not introduced because the immediately preceding tier check already refuses when that artifact is absent. Idempotency is inapplicable: the check is a pure read with no effect. Rendering failures of a fence that IS present remain owned by the existing mermaid render gate and its existing tests.
