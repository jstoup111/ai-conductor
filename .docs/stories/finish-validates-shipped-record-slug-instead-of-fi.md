**Status:** Accepted

# Stories: FINISH validates shipped-record slug instead of file existence

## Story 1: FINISH locates the shipped record at the writer's canonical path

**Requirement:** Technical (intake #1647)

As the FINISH publication coordinator, I want the shipped-record observation to look where the record writer writes so that a record written under a date-prefixed plan stem is observed rather than re-written on every retry.

### Acceptance Criteria

#### Happy Path
- Given `feature_desc` is `foo` and the only plan file is `2026-09-24-foo.md`, when `.docs/shipped/2026-09-24-foo.md` exists with frontmatter `slug: 2026-09-24-foo`, then the shipped-record observation is `present` and the dimension reads `valid`.
- Given `feature_desc` is `foo` and the plan file is `foo.md`, when `.docs/shipped/foo.md` exists with frontmatter `slug: foo`, then the observation is `present`.

#### Negative Paths
- Given `feature_desc` is `foo` and the plan file is `2026-09-24-foo.md`, when no file exists at `.docs/shipped/2026-09-24-foo.md`, then the observation is `missing` and the coordinator still selects `write_shipped_record`.
- Given two plan files `2026-09-01-foo.md` and `2026-09-24-foo.md` both match `feature_desc` `foo`, when the shipped record is observed, then the observation is `malformed` and FINISH returns `human_required` with reason `invalid_shipped_record` instead of guessing a candidate.

### Done When
- [ ] A test with a date-prefixed plan and a record at the dated stem observes `present`, where the pre-change observer observed `missing`.
- [ ] A test with an ambiguous plan match yields `human_required` / `invalid_shipped_record`.

## Story 2: FINISH rejects a present shipped record whose slug does not match

**Requirement:** Technical (intake #1647)

As the FINISH publication coordinator, I want a shipped record that exists but names a different or no slug to reach the human-required disposition so that FINISH never publishes past evidence belonging to another feature.

### Acceptance Criteria

#### Happy Path
- Given the canonical shipment slug is `foo`, when the record at `.docs/shipped/foo.md` has frontmatter `slug: foo`, then FINISH treats the shipped-record dimension as `valid` and dispatches no additional write.

#### Negative Paths
- Given the canonical shipment slug is `foo`, when the record at `.docs/shipped/foo.md` has frontmatter `slug: bar`, then the observation is `malformed` and FINISH returns `human_required` with reason `invalid_shipped_record` without overwriting the record.
- Given the canonical shipment slug is `foo`, when the record exists but has no frontmatter block or no `slug:` field, then the observation is `malformed` and FINISH returns `human_required` with reason `invalid_shipped_record`.
- Given FINISH has just run `write_shipped_record`, when the post-write re-observation reads a record whose slug does not match, then FINISH returns `human_required` with reason `invalid_shipped_record` rather than retrying the write.
- Given the record file exists but cannot be read, when the shipped record is observed, then the observation is `unavailable` and the dimension reads `indeterminate`, not `valid`.

### Done When
- [ ] A production-observer test with a mismatched `slug:` reaches `human_required` / `invalid_shipped_record`; the pre-change observer returned `present` for the same fixture.
- [ ] A production-observer test with a slug-less record reaches `human_required` / `invalid_shipped_record`.
- [ ] A test with a matching record observes `valid` and records zero `createShippedRecord` calls.
