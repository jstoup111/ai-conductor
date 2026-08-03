# One-time release backlog transition audit

**Status:** proposed — not approved and not consumed

**Prepared from:** `v0.99.17..a8efea389854322808abf56af41923ef468f76a1`
**Authority:** the first bot-owned release PR may seed this proposal only after the operator replaces this status with `approved` and resolves every item below.

## Decision rule

This is the one permitted semantic-curation pass.  The recurring release-PR
maintainer must not interpret, consolidate, or discard legacy prose.  It can
only copy an operator-approved audit into the first generated release PR.

An item is *included* only when it has a final reader-facing outcome; it is
*consolidated* only when the target included outcome is named; and it is
*excluded* only with a reader-facing reason.  Anything else is *unresolved*.
The current checkout has no authoritative offline mapping from changelog prose
or commit-message references to merged GitHub PR metadata, so this audit
deliberately records every item as unresolved rather than silently inventing a
disposition.

## Exhaustive inventory

| Input | Count | Disposition | Evidence |
| --- | ---: | --- | --- |
| Legacy `[Unreleased]` bullet entries | 552 | unresolved | `CHANGELOG.md` lines 18–4805 at the recorded source revision; extracted bullet-list SHA-256 `f23e1e190f4f18a4540221ee4afe7761774a05f90fe8f341d9baf463459673d4` |
| Post-tag commits | 1,588 | unresolved | `git rev-list v0.99.17..a8efea389854322808abf56af41923ef468f76a1` |
| Distinct `#NNN` references found in those commit subjects/bodies | 877 | unresolved | sorted-reference SHA-256 `4da8489451ca69debece154ab107080e99b3e176b23fe729b9e55f6f587226a7` |

The first row is a per-entry disposition: every one of the 552 source bullets
is unresolved pending review.  The last two rows are a per-reference
disposition: every candidate-looking post-tag reference is unresolved pending
the authoritative merged-PR collection required by the release maintainer.
Duplicates are intentionally retained by the source inventories; no text or
reference is treated as proof of a merge or a release note.

## Proposed cleaned pending set

No cleaned reader-facing entries are proposed yet.  This is intentional: the
legacy queue is too large and its PR identities are not locally authoritative.
Replacing it before a reviewer identifies final outcomes would turn uncertainty
into an exclusion.  The first release PR must therefore remain blocked until
the operator supplies an approved list of included/consolidated/excluded
dispositions and the unresolved count reaches zero.

## Operator approval record

Before the transition is seeded, the operator must:

1. Replace every `unresolved` disposition with `included`, `consolidated`, or
   `excluded` and record its reason (and consolidation target where applicable).
2. Replace **Status: proposed** with **Status: approved** in the version that
   the first release PR copies.
3. Review and merge that first release PR.  Once its audit is on the base
   branch with **Status: consumed**, the maintainer refuses all later transition
   requests and uses only deterministic structured PR metadata.

No approval has been recorded by this artifact.
