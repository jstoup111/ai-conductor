# Conflict Check: Safe multi-version harness migration

**Date:** 2026-08-03
**Result:** PASS — zero blocking conflicts

## Inventory

- Compared these seven stories against the existing `.docs/stories/` corpus, the approved ADRs, the
  eleven open pull requests, and the active `spec/` branches.
- Evaluated all five conflict classes: contradiction, behavioral overlap, state conflict, resource
  contention, and sequencing.

## Resolved Conflict 1: Ownership of `CHANGELOG.md`

**Involved:** the repository's release rule that implementation branches never write `CHANGELOG.md`
versus Story 6, which corrects block bodies inside the frozen `## [0.99.20]` entry.
**Type:** contradiction
**Severity:** blocking before resolution
**Confidence:** 95%, verified from the release workflow's stated collection contract and commit
`d7756f0d5`.

**Resolution:** The approved ADR records a bounded, one-time exemption limited to block bodies
inside one already-tagged entry. The release PR renderer collects candidates only since the latest
tag, so it never regenerates that entry and cannot clobber the correction. `VERSION`,
`[Unreleased]`, and all release metadata remain untouched and remain the release PR's sole
property. The operator grants the exemption by merging the spec PR.

## Resolved Conflict 2: Duplicated update logic in `bin/conduct`

**Involved:** issue #226's pending removal of `bin/conduct`'s copied update block versus this
feature's rework of `bin/migrate`.
**Type:** resource contention
**Severity:** advisory
**Confidence:** 100%, verified — `bin/conduct:332` and `bin/update:113` both invoke the same
`bin/migrate` binary and neither duplicates its internals.

**Resolution:** No overlap. The duplication is confined to `render_changelog_range`, `semver_lt`,
and the channel-check functions, none of which this feature edits. Both callers inherit the fix
unchanged, and #226 can proceed independently in either order.

## Resolved Conflict 3: Daemon lifecycle authority

**Involved:** the standing operator rule that a daemon is never restarted without explicit
confirmation versus a queued 0.99.20 block that runs `conduct-ts daemon restart`, and two others
that stop a running daemon.
**Type:** contradiction
**Severity:** blocking before resolution
**Confidence:** 100%, verified by reading the block bodies.

**Resolution:** Story 6 corrects those blocks so no queued migration takes daemon lifecycle action
on its own, and Story 7's authoring check prevents a future block from reintroducing it. This
removes a live contradiction rather than creating one.

## Resolved Conflict 4: Worktree deletion safety

**Involved:** the repository's first daemon-operations rule forbidding bulk worktree deletion versus
a queued block that force-removes every worktree matched by a glob.
**Type:** contradiction
**Severity:** blocking before resolution
**Confidence:** 100%, verified by reading the block body.

**Resolution:** Story 6 removes the destructive block and Story 7's check rejects the shape. The
feature retires an existing violation.

## Non-conflicts examined

- **Release-gate and self-host stories.** They govern how a migration block is *authored and
  declared* at release time. This feature governs how a block is *executed* at a consumer. The
  surfaces do not intersect; Story 7's check is additive to the existing gate.
- **Memory-store migration story.** One queued block migrates `.memory/` to the canonical store.
  Story 6 preserves that block's behavior and only makes its execution ledgered and fail-fast.
- **Bootstrap's `harness_version` marker.** A separate per-project notion that never invokes
  `bin/migrate`. No state conflict; this feature introduces a distinct ledger and does not read or
  write the bootstrap marker.
- **Open pull requests.** None of the eleven touches `bin/migrate`, `bin/update`, or the changelog's
  `## [0.99.20]` entry.

## Verify-Claims Ledger

### Claims

- [verified] No open PR or active spec branch edits `bin/migrate` or `bin/update`.
- [verified] `bin/conduct` duplicates the update-check helpers but not `bin/migrate`'s internals.
- [verified] The queued blocks that this feature corrects are the same blocks that violate two
  standing repository safety rules.

### Assumptions

- None pending.

Verdict: CLEAR
