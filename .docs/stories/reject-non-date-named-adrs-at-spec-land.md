**Status:** Accepted

# Stories: Reject non-date-named ADRs at spec land (#705)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the composer land gate's treatment of
decision records the landing spec introduces. Records already present at the spec's merge base, a
repository-wide filename sweep, and daemon backlog discovery remain outside this slice.

## Story 1: Refuse a newly authored decision record that abandons the canonical name

As a harness operator, I want land to refuse a decision record whose filename is not the canonical
date-plus-slug form, so that a sequential number cannot reach the base branch and collide with a
parallel worktree's next number.

### Acceptance Criteria

#### Happy Path
- Given a spec introduces one approved, citable decision record whose filename is the canonical date-plus-slug form, when land runs, then land succeeds and commits the spec branch.

#### Negative Paths
- Given a spec introduces an approved, citable decision record whose filename carries a sequential number in place of the date, when land runs, then land is refused and the refusal names that file and states the required canonical form.
- Given a spec introduces an approved, citable decision record whose filename matches the canonical shape but encodes a date that is not a real calendar day, when land runs, then land is refused and the refusal names that file.
- Given a spec introduces two approved, citable decision records and only one carries a canonical filename, when land runs, then the refusal names every offending file rather than stopping at the first.

### Done When
- [ ] A canonical-named new decision record lands, and a sequential-number one is refused with a message carrying both the offending filename and the required form.
- [ ] A filename whose date component is shape-valid but not a real calendar day is refused.
- [ ] A refusal covering two new records names both offending filenames in one message.

## Story 2: Leave decision records that predate the spec exactly as they are

As a harness operator, I want the naming rung to judge only what this spec introduces, so that the
eleven legacy sequential-number records already on the base branch keep landing and stay editable.

### Acceptance Criteria

#### Happy Path
- Given the base branch already carries decision records with sequential-number filenames and the spec introduces only a canonical-named record, when land runs, then land succeeds and no message names any of the pre-existing records.

#### Negative Paths
- Given the spec modifies a decision record with a sequential-number filename that already exists at the spec's merge base, when land runs, then land is not refused on account of that filename and the modification is committed.
- Given a spec introduces a decision record that is both misnamed and not approved, when land runs, then the existing approval refusal is what land reports, so the new rung never masks a gate that already guarded the base branch.

### Done When
- [ ] A land whose worktree carries pre-existing sequential-number records succeeds, and the success path emits no message naming them.
- [ ] Modifying a pre-existing sequential-number record commits without a filename refusal.
- [ ] A record that is simultaneously misnamed and unapproved is refused by the approval rung, with the approval wording in the message.

## Negative-category review

Invalid input is covered directly: sequential numbers, impossible calendar dates, and mixed
conforming/non-conforming batches are the whole input surface of a filename check. Data integrity is
covered by the merge-base scoping criteria, which prove the rung cannot retroactively invalidate
committed records. Partial-failure ordering is covered by the criterion proving the pre-existing
approval rung still reports first, so no previously guarded condition is displaced. The check is a
pure in-process string and git-tree comparison performed before the land commit: it opens no network
connection, acquires no lock, spawns no queue or upload, writes no datastore, and deletes nothing, so
the timeout, auth, concurrency, resource-exhaustion, cascade-deletion, and dependency-unavailability
categories do not apply. Git failures on the surrounding merge-base resolution are already fatal to
land through the existing idea-file resolution path, and that behavior is unchanged here.
