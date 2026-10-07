# Conflict Check: Sliced plans — story ownership and stack eligibility (#2941)

**Date:** 2026-10-07
**Stories checked:** `.docs/stories/sliced-plans-can-be-landed-whose-stories-span-chil.md` (Stories 1–9)
against all 552 files in `.docs/stories/`.
**ADR corpus:** `repo_wide` (`conflict_check.adr_corpus`).
- Examined: `adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility`,
  `adr-2026-09-29-plan-slice-manifest`, `adr-2026-10-03-stacked-child-plans-identity-and-state`,
  `adr-2026-08-31-coverage-binding-judge-step`, and
  `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal`.
- Narrowed out: every other approved ADR, because none governs plan slices, Story-line parsing, the
  `stacked_prs` block, land gates for sliced plans, or the `coverage_binding` envelope.

Related story files found by subject search (`MAX_PLAN_SLICES`, `## Slices`, `stacked_prs`,
`plan-slices`, `parsePlanTaskStoryIds`, `max_slices`):
- `plans-cannot-declare-ordered-slices-of-one-feature.md`
- `engine-cannot-represent-more-than-one-branch-step-.md`

**Result:** 3 blocking and 1 degrading conflict, all resolved by the operator (2026-10-07) by
replacing superseded assertions in place. A re-check is clean.

## Conflict: `max_slices` was asserted to be an unknown key

**Stories involved:** #2723 Story 1 vs Story 6 (this feature)
**Files:** `.docs/stories/plans-cannot-declare-ordered-slices-of-one-feature.md` vs this feature's stories
**Type:** contradiction
**Severity:** blocking
**Description:** #2723 Story 1 required `stacked_prs.max_slices` to fail as an unknown key. Story 6
makes it a valid key, as required by `adr-2026-10-03-stacked-child-plans-identity-and-state`
decision 5.
**Resolution (applied):** The unknown-key example in #2723 Story 1 now uses `max_parallel`.

## Conflict: Fixed slice bound of 5

**Stories involved:** #2723 Stories 6 and 8 vs Story 6 (this feature)
**Type:** contradiction
**Severity:** blocking
**Description:** #2723 required `MAX_PLAN_SLICES` = 5, not read from config, and a six-slice plan to
be refused. The approved design makes the flag-independent grammar ceiling `MAX_CHILD_ID` (9), with
the configured `max_slices` applying only to stacked delivery.
**Resolution (applied):** #2723 Story 6 now asserts nine slices accepted, ten refused (bound 9), and
the flag-independent ceiling. #2723 Story 8's skill Done When now names the grammar bound 9.

## Conflict: Consumer registry reserved `stacked_prs.enabled` for #2724

**Stories involved:** #2723 Story 1 vs Story 6 (this feature)
**Type:** contradiction
**Severity:** blocking
**Description:** #2723 Story 1 declared `stacked_prs` and `stacked_prs.enabled` with no production
reader. This feature makes land and `coverage_binding` read them, and adds `max_slices`.
**Resolution (applied):** #2723 Story 1 and its Done When now name land and `coverage_binding` as the
readers of all three keys. Story 6 (this feature) gains the matching Done When. An additive amendment
note was placed on `adr-2026-09-29-plan-slice-manifest` decision 8.

## Conflict: "No build step reads the flag" with the flag off

**Stories involved:** #2723 Story 2 vs Story 7 (this feature)
**Type:** overlap
**Severity:** degrading
**Description:** #2723 Story 2 said that with the flag off, no build, finish or publication step reads
the slice manifest or the flag. Story 7 has `coverage_binding` read the flag to decide that its new
layer is inert.
**Resolution (applied):** #2723 Story 2 now states that `coverage_binding` reads the flag only to stay
inert. Flag-off behavior is otherwise unchanged.

## Pairs checked clean

- **Identity stories (#2940) Story 2 vs Story 6:** both require the land slice bound to be no greater
  than 9. They are consistent.
- **Identity stories Story 1 (N=1 golden cells: flag off; flag on and unsliced; flag off and sliced)
  vs Stories 3, 7 and 8:** the new layers are inert in all three cells. They are consistent in both
  directions.
- **Stories 1–2 vs Story 3 (within this feature):** ownership and multi-id refusals engage only for
  stacked candidates, and Story 3 excludes them otherwise. No oscillation.
- **Story 7 vs `adr-2026-09-29-plan-slice-manifest` D6:** grammar invalidity still refuses before the
  new layer. Ordering is consistent.
- **Story 8 vs `adr-2026-08-31-coverage-binding-judge-step` D4 ("nothing else reaches the judge"):**
  ownership is kept out of the judge prompt. Consistent.
