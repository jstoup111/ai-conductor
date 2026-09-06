**Status:** Accepted

# Stories: Anchor marker-scoped changed tests outside conventional test paths (#2165)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the changed-test title snapshot the build_review grader anchors against. Covers-marker resolution, the coordinator's in-scope filter, the anchor grammar, and rubric judgement remain outside this slice.

## Story 1: Capture titles for every in-scope changed file

As a build_review grader, I want a title entry for every changed file the scope machinery admits so that a concern I find on one of them can be expressed as an anchor.

### Acceptance Criteria

#### Happy Path

- Given a changed file outside conventional test paths carries a Covers marker that resolves against the active plan or its selected stories, when build_review assembles its inputs, then the snapshot's changed-test titles include an entry whose selector is that file.
- Given a changed file at a conventional test path carries no resolvable Covers marker, when build_review assembles its inputs, then the snapshot's changed-test titles still include an entry whose selector is that file.

#### Negative Paths

- Given an in-scope changed file declares no static test title or its source cannot be read at the graded head, when build_review assembles its inputs, then that file contributes exactly one title entry carrying the static-extraction fallback flag.

### Done When

- [ ] A real-git fixture whose in-scope set contains a non-test path shows an entry for that path in the assembled changed-test titles.
- [ ] The existing conventional-path extraction fixtures keep their current expected entries unchanged.
- [ ] A fixture whose in-scope source is unreadable or declares no test yields exactly one fallback entry for it.

## Story 2: Keep in-scope findings representable without widening review scope

As an operator, I want an in-scope file to be anchorable and an out-of-scope file to stay unanchorable so that review neither burns mechanical faults on a location nor grades tests the scope machinery excluded.

### Acceptance Criteria

#### Happy Path

- Given the assembled snapshot carries a title entry for an in-scope file outside conventional test paths, when the coordinator derives the test-quality projection, then the dispatched projection carries a content region for that file and a finding anchored to it is accepted.

#### Negative Paths

- Given a changed file at a conventional test path is absent from the marker-derived in-scope set, when the coordinator derives the test-quality projection, then that file contributes no content region and a finding anchored to it is rejected.

### Done When

- [ ] A coordinator fixture built from assembled inputs dispatches a projection containing the non-conventional in-scope selector.
- [ ] A judged result anchored to that selector's content region reaches a judged FAIL verdict rather than a rejection.
- [ ] A judged result anchored to a changed but out-of-scope conventional test path is refused as an invalid provider result.

## Negative-category review

Invalid input is covered by the unresolvable-marker and no-static-declaration cases, and by the out-of-scope anchor refusal. Dependency unavailability is covered by the unreadable-source case, where the graded head cannot supply a selector's content. Data integrity is covered by the requirement that the marker-derived scope alone decides what the grader sees, so the wider candidate set can never widen review. Idempotency is covered by the deduplicated, deterministically ordered selector union: assembling twice over the same head yields the same entries. Auth and permission failures, concurrent access, resource exhaustion, partial failure and rollback, cascade deletion, and model-level immutability are inapplicable: input assembly is a read-only, single-pass projection over one immutable commit and performs no write, no deletion, and no privileged access.
