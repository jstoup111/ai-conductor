# Conflict Report: coherence-artifact-passes-engineer-land-then-block (#1881)

**Date:** 2026-08-26
**Scope:** 3 new stories in `.docs/stories/coherence-artifact-passes-engineer-land-then-block.md`
vs all existing stories, plus the change-set ADRs (`adr-2026-08-26-shared-coherence-parser-at-discovery`,
amended `adr-2026-08-23-criterion-layer-is-structural-at-land`, amended review C1). ADR corpus:
`change_set` (default; a repo-wide APPROVED-ADR sweep was already performed at architecture-review
and its constraints are folded into the change-set ADR).

## Conflict: Strict set-equality vs the fix's intended new acceptance (RESOLVED)

**Stories involved:** Story 2 equivalence criterion vs Story 2 #1881 happy path (and ADR decision 4)
**Files:** .docs/stories/coherence-artifact-passes-engineer-land-then-block.md vs .docs/decisions/adr-2026-08-26-shared-coherence-parser-at-discovery.md
**Type:** oscillating
**Severity:** blocking (resolved 2026-08-26)

**Description:** The equivalence obligation (per the `adr-2026-08-05-blocked-classification-after-dedup`
precedent) demanded an identical eligible-items set under old and new predicates, while the
feature's core outcome makes the old-rejected #1881 artifact shape eligible. Satisfying strict
equality forbids the fix; satisfying the fix breaks equality — no implementation satisfies both.

**Resolution (operator-selected: Option 1):** the obligation is one-directional — every fixture
the old predicate accepted stays eligible (no regression); the new predicate may accept strictly
more, and the #1881 shape is asserted eligible as its own test case. Story 2, ADR decision 4, and
review condition C-A were all rephrased in place during this DECIDE pass.

## Clean pairs

- Story 1 vs Story 2 (extraction feeds consumption): compatible both directions.
- Story 2 vs Story 3 (diagnostics never change acceptance; reason ids stable): compatible both
  directions.
- Story 2 vs amended `adr-2026-08-23` zero-criterion invariant: preserved explicitly (happy path +
  Done When).
- Story 3 vs `adr-2026-08-18-content-anchored-finding-reference-schema`: line detail is transient
  diagnostics, outside the persisted-identity coordinate ban (scoping note in the change-set ADR).
- No overlap with existing `.docs/stories/` files: none touch discovery's coherence branch or the
  coherence parser.

**Result: conflict check passed — zero blocking conflicts remain.**
