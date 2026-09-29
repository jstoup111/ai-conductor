**Status:** Accepted

# Stories: Accept trailing-hyphen slugs in compose handoff (#2697)

Track: technical

Tier: S

Approved by the operator on 2026-09-28 (delegated). Scope is the spec-branch slug grammar shared by the engineer slug generator and the `compose handoff` branch check. Generator output and existing stems are unchanged.

## Story 1: Hand off every generated spec branch

### Acceptance Criteria

#### Happy Path

- Given an idea whose generated slug is truncated to end in a hyphen, when `compose handoff` runs for the `spec/` branch built from that slug, then the branch is accepted and the publication reads the intake marker named by that exact slug.
- Given an idea whose generated slug does not end in a hyphen, when `compose handoff` runs for its `spec/` branch, then the branch is accepted exactly as before.

#### Negative Paths

- Given a generated slug that ends in a hyphen, when the initial publication pushes and opens the PR, then the guarded push, PR create, and PR edit all run with the unmodified branch name and no hyphen is trimmed or added.

### Done When

- [ ] A unit test proves every generator output in a fixed idea set, including a trailing-hyphen truncation and a 50-character exact fit, satisfies the shared slug grammar.
- [ ] A handoff test builds the branch from the generator for the #1354 idea text and observes the guarded publication reaching push, PR create, and PR edit with that branch and its intake marker.

## Story 2: Keep refusing branches the generator cannot produce

### Acceptance Criteria

#### Happy Path

- Given the shared slug grammar, when it is checked against a slug with a single trailing hyphen, then it is accepted while the same slug with a leading hyphen is rejected.

#### Negative Paths

- Given a branch with another prefix, an empty slug, an uppercase character, a leading hyphen, a double hyphen, two trailing hyphens, a nested path segment, or a slug longer than 50 characters, when `compose handoff` builds its initial publication, then it throws the current not-a-canonical-spec-branch message naming the branch before any git or GitHub call is made.

### Done When

- [ ] A handoff test enumerates every listed non-canonical branch and asserts the exact current message and zero recorded git and GitHub calls.
- [ ] A unit test rejects each listed malformed slug through the shared grammar predicate.

## Negative-category review

Input integrity is the whole subject: every malformed slug shape the generator cannot produce is enumerated and refused before any remote mutation. Idempotency is preserved because the branch name and marker path are passed through byte-for-byte. The change adds no permission, network, concurrency, storage, deletion, upload, or transaction surface; those categories are inapplicable, and the existing guarded-publication refusal tests stay authoritative for owner and credential failures.
