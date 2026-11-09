# Conflict Check: New dependencies enter the tree with no review of necessity, pinning, or license (#2045)

**Date:** 2026-11-07
**Stories checked:** `.docs/stories/new-dependencies-enter-the-tree-with-no-review-of-.md` (Stories 1–5) against all
680 files in `.docs/stories/`, narrowed to build_review, custom rubric, severity, and security-rubric stories.
**Result:** PASS — 0 blocking, 1 degrading resolved.

## ADRs examined

- `adr-2026-09-10-portable-build-review-policy` (D1, D4, D5, D7) — compared with Stories 1–3; consistent.
- `adr-2026-10-19-build-review-finding-severity-advisory-threshold` — compared with Stories 4–5; consistent.
- `adr-2026-09-10-separate-custom-review-coverage-identity` — compared with Story 3; consistent (`paths` is not coverage identity).
- `adr-2026-08-16-closed-build-review-finding-vocabularies` — compared with Story 4; consistent (closed vocabularies bind built-in rubrics only).

## ADRs narrowed out

All other APPROVED ADRs: their subjects (daemon, intake, release, self-host, rebase, remediation laps, as-built) do not
address custom rubric participation, config validation, or review-policy skills.

## Conflict: New build-review-* skill escapes the provider-contract audit

**Stories involved:** Story 4 (dependency-hygiene policy) vs Story 5 of build_review typed structured findings
**Files:** `.docs/stories/new-dependencies-enter-the-tree-with-no-review-of-.md` vs `.docs/stories/build-review-rubric-findings-arrive-as-typed-struc.md`
**Type:** overlap
**Severity:** degrading

**Description:** The existing story asserts that the shipped `skills/build-review-*/SKILL.md` files pass the
provider-contract audit's forbidden output-format patterns, but the audit enumerates only the three built-in skills.
A new `skills/build-review-dependency-hygiene` would match the story's scope while escaping the check.

**Resolution Options:**
1. Add a Story 4 criterion that the new skill carries no output-format prose and is covered by the audit.
2. Rename the skill without the `build-review-` prefix.

**Resolution (operator-selected):** Option 1. Story 4 gained a negative path and a Done When item binding the skill to
`test/test_provider_skill_contracts.sh`'s build_review rule.

## Pairs examined and clean

- `grade-the-diff-for-security-defects-before-ship-vi.md`: the security rubric returns zero findings for manifest-only diffs; dependency hygiene is the separate owner.
- `grade-diffs-for-event-spine-bypasses-in-build-revi.md`: `eventSpine` declares no `paths`, so it still participates in every lap.
- `build-review-findings-carry-a-severity-with-a-per-.md`: `min_severity` semantics match Story 4 (`nit`) and Story 5 (`minor` threshold).
- `projects-cannot-add-portable-non-competing-build-r.md`: unknown built-in keys stay rejected (Story 1); a missing installation still fails a participating member (Story 2).
- Bidirectional (oscillation) check: Story 3's withheld-equals-absent vs the convergence-bound and advisory-case stories — satisfying either leaves the other intact.
