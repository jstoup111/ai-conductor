# Implementation Plan: FINISH validates shipped-record slug instead of file existence

**Date:** 2026-09-24
**Stories:** .docs/stories/finish-validates-shipped-record-slug-instead-of-fi.md
**Conflict check:** Not required (Tier S)

## Summary
Replace FINISH's existence-only shipped-record observer with one that resolves the record at the writer's canonical path and validates its frontmatter `slug`, making the existing `invalid_shipped_record` disposition reachable. Three tasks.

## Technical Approach
- Only the `shippedRecord.observeShippedRecord` closure in `src/conductor/src/engine/finish-publication-production.ts` changes. The coordinator (`finish-publication.ts`) already maps `malformed` to `invalid` and `invalid` to `human_required` / `invalid_shipped_record` on both the pre-write and post-write paths; it is not edited.
- Resolve the path with the local pattern `projectShipmentPlanDeclarationToRetainedPr` already uses in the same file: `readdir(join(deps.projectRoot, '.docs', 'plans'))`, filter `.md`, map each to its `.docs/plans`-relative path, then `resolveShipmentIdentity(state.feature_desc, planPaths)`. Traits to keep: same plan listing, same resolver, no new resolver. Search hint: `resolveShipmentIdentity(` in `finish-publication-production.ts`.
- Resolution outcomes: `resolved` → check `identity.recordPath`; `missing` (no plan) → keep today's `.docs/shipped/<feature_desc>.md` path with expected slug `feature_desc`; `ambiguous` → `malformed`. No `feature_desc` → `missing` (unchanged).
- Validation: the file absent → `missing`; the read throws → `unavailable`; the leading `---` frontmatter block absent or lacking a `slug:` line, or the value (trimmed) differing from the canonical slug → `malformed`; otherwise `present`. Parse only the `slug:` line with a small local regex; no YAML dependency. `specHash`/`pr` are out of scope.
- Tests extend `src/conductor/test/engine/finish-publication-production.test.ts`, following its existing fixture setup for FINISH production deps (temp project root with `.docs/plans` and `.docs/shipped`).

## Tasks

### Task 1: Observe the record at the writer's canonical path
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/finish-publication-production.test.ts` for the dated-plan record, the undated-plan record, and the dated-plan absent record. The dated case must fail against the current observer (it returns `missing`).
2. Verify RED.
3. Implement: in the `shippedRecord` observer, list `.docs/plans` and call `resolveShipmentIdentity(state.feature_desc, planPaths)` exactly as `projectShipmentPlanDeclarationToRetainedPr` does in the same file; use `identity.recordPath` when resolved, fall back to `.docs/shipped/<feature_desc>.md` when the resolution is `missing`.
4. Verify GREEN and commit.

**Done when:**
- production observer test `observes the canonical dated record`: with feature_desc `foo`, only plan fixture `2026-09-24-foo.md`, and `.docs/shipped/2026-09-24-foo.md` carrying `slug: 2026-09-24-foo`, observeShippedRecord returns `present` and the snapshot reads `valid`
- production observer test `observes the undated record`: with plan fixture `foo.md` and `.docs/shipped/foo.md` carrying `slug: foo`, observeShippedRecord returns `present`
- production observer test `dated record absent`: with plan fixture `2026-09-24-foo.md` and no `.docs/shipped/2026-09-24-foo.md`, observeShippedRecord returns `missing` and the coordinator selects the `write_shipped_record` transition

**Files likely touched:**
- src/conductor/src/engine/finish-publication-production.ts
- src/conductor/test/engine/finish-publication-production.test.ts

**Dependencies:** none

### Task 2: Validate the record's frontmatter slug
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/finish-publication-production.test.ts` for a mismatched slug, a record without frontmatter, a record with frontmatter lacking `slug:`, and a matching record. The mismatch and slug-less cases must fail against the Task 1 observer (it returns `present`).
2. Verify RED.
3. Implement: read the resolved record, extract the frontmatter `slug:` value, and return `malformed` when absent or not equal to the canonical slug; `present` when equal.
4. Verify GREEN and commit.

**Done when:**
- production observer test `mismatched slug`: `.docs/shipped/foo.md` carrying `slug: bar` makes observeShippedRecord return `malformed`, FINISH returns `human_required` with reason `invalid_shipped_record`, and the record file bytes are unchanged
- production observer test `slug-less record`: a record with no frontmatter block and a record with frontmatter but no `slug:` field each make observeShippedRecord return `malformed` and FINISH return `human_required` with reason `invalid_shipped_record`
- production observer test `matching record`: a record carrying `slug: foo` yields shippedRecord `valid` and zero `createShippedRecord` calls

**Files likely touched:**
- src/conductor/src/engine/finish-publication-production.ts
- src/conductor/test/engine/finish-publication-production.test.ts

**Dependencies:** 1

### Task 3: Ambiguous plans, unreadable records, and post-write mismatch
**Story:** 1
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/finish-publication-production.test.ts` for two matching dated plans, a record whose read throws (inject the failure through the existing deps seam or an unreadable fixture), and a createShippedRecord effect that writes a mismatched slug.
2. Verify RED.
3. Implement: map an `ambiguous` resolution to `malformed`; wrap the record read so a throw returns `unavailable`.
4. Verify GREEN and commit.

**Done when:**
- production observer test `ambiguous plans`: plan fixture `2026-09-01-foo.md` and plan fixture `2026-09-24-foo.md` for feature_desc `foo` make observeShippedRecord return `malformed` and FINISH return `human_required` with reason `invalid_shipped_record`
- production observer test `unreadable record`: when reading the existing record throws, observeShippedRecord returns `unavailable` and the snapshot reads `indeterminate`, not `valid`
- production test `post-write mismatch`: when createShippedRecord writes a record whose `slug:` does not match, the post-write re-observation returns `malformed` and FINISH returns `human_required` with reason `invalid_shipped_record` with exactly one createShippedRecord call

**Files likely touched:**
- src/conductor/src/engine/finish-publication-production.ts
- src/conductor/test/engine/finish-publication-production.test.ts

**Dependencies:** 2

## Task Dependency Graph
Task 1 → Task 2 → Task 3

## Integration Points
- After Task 2: FINISH reaches `human_required` / `invalid_shipped_record` in production for a mismatched record.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given `feature_desc` is `foo` and the only plan file is `2026-09-24-foo.md`, when `.docs/shipped/2026-09-24-foo.md` exists with frontmatter `slug: 2026-09-24-foo`, then the shipped-record observation is `present` and the dimension reads `valid`. | 1 | "production observer test `observes the canonical dated record`: with feature_desc `foo`, only plan fixture `2026-09-24-foo.md`, and `.docs/shipped/2026-09-24-foo.md` carrying `slug: 2026-09-24-foo`, observeShippedRecord returns `present` and the snapshot reads `valid`" | diff-local |
| Story 1 happy: Given `feature_desc` is `foo` and the plan file is `foo.md`, when `.docs/shipped/foo.md` exists with frontmatter `slug: foo`, then the observation is `present`. | 1 | "production observer test `observes the undated record`: with plan fixture `foo.md` and `.docs/shipped/foo.md` carrying `slug: foo`, observeShippedRecord returns `present`" | diff-local |
| Story 1 negative: Given `feature_desc` is `foo` and the plan file is `2026-09-24-foo.md`, when no file exists at `.docs/shipped/2026-09-24-foo.md`, then the observation is `missing` and the coordinator still selects `write_shipped_record`. | 1 | "production observer test `dated record absent`: with plan fixture `2026-09-24-foo.md` and no `.docs/shipped/2026-09-24-foo.md`, observeShippedRecord returns `missing` and the coordinator selects the `write_shipped_record` transition" | diff-local |
| Story 1 negative: Given two plan files `2026-09-01-foo.md` and `2026-09-24-foo.md` both match `feature_desc` `foo`, when the shipped record is observed, then the observation is `malformed` and FINISH returns `human_required` with reason `invalid_shipped_record` instead of guessing a candidate. | 3 | "production observer test `ambiguous plans`: plan fixture `2026-09-01-foo.md` and plan fixture `2026-09-24-foo.md` for feature_desc `foo` make observeShippedRecord return `malformed` and FINISH return `human_required` with reason `invalid_shipped_record`" | diff-local |
| Story 2 happy: Given the canonical shipment slug is `foo`, when the record at `.docs/shipped/foo.md` has frontmatter `slug: foo`, then FINISH treats the shipped-record dimension as `valid` and dispatches no additional write. | 2 | "production observer test `matching record`: a record carrying `slug: foo` yields shippedRecord `valid` and zero `createShippedRecord` calls" | diff-local |
| Story 2 negative: Given the canonical shipment slug is `foo`, when the record at `.docs/shipped/foo.md` has frontmatter `slug: bar`, then the observation is `malformed` and FINISH returns `human_required` with reason `invalid_shipped_record` without overwriting the record. | 2 | "production observer test `mismatched slug`: `.docs/shipped/foo.md` carrying `slug: bar` makes observeShippedRecord return `malformed`, FINISH returns `human_required` with reason `invalid_shipped_record`, and the record file bytes are unchanged" | diff-local |
| Story 2 negative: Given the canonical shipment slug is `foo`, when the record exists but has no frontmatter block or no `slug:` field, then the observation is `malformed` and FINISH returns `human_required` with reason `invalid_shipped_record`. | 2 | "production observer test `slug-less record`: a record with no frontmatter block and a record with frontmatter but no `slug:` field each make observeShippedRecord return `malformed` and FINISH return `human_required` with reason `invalid_shipped_record`" | diff-local |
| Story 2 negative: Given FINISH has just run `write_shipped_record`, when the post-write re-observation reads a record whose slug does not match, then FINISH returns `human_required` with reason `invalid_shipped_record` rather than retrying the write. | 3 | "production test `post-write mismatch`: when createShippedRecord writes a record whose `slug:` does not match, the post-write re-observation returns `malformed` and FINISH returns `human_required` with reason `invalid_shipped_record` with exactly one createShippedRecord call" | diff-local |
| Story 2 negative: Given the record file exists but cannot be read, when the shipped record is observed, then the observation is `unavailable` and the dimension reads `indeterminate`, not `valid`. | 3 | "production observer test `unreadable record`: when reading the existing record throws, observeShippedRecord returns `unavailable` and the snapshot reads `indeterminate`, not `valid`" | diff-local |

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
