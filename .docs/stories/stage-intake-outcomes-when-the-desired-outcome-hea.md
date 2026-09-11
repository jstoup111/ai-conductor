**Status:** Accepted

# Stories: Stage intake outcomes when the Desired-outcome heading is plural (#1528)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the intake staging extractor's heading recognition and the canonical shape of the file it writes. Resolving a missing issue body and rewording the coherence refusal remain outside this slice.

## Story 1: Plural Desired-outcome headings stage their bullets

As an operator filing an intake issue, I want my Desired-outcome bullets to reach the staged outcomes file whether I wrote the heading in the singular or the plural, so that a one-character wording choice does not silently cost a whole DECIDE phase.

### Acceptance Criteria

#### Happy Path

- Given an intake body whose section heading is the plural form of the Desired-outcome heading, when the intake outcomes are staged into the worktree, then the staged file carries every bullet of that section verbatim and the reader reports the outcome layer required with exactly those bullets.
- Given an intake body whose section heading is the singular form, when the intake outcomes are staged into the worktree, then the staged file carries the same bullets it carries today and the reader still reports the outcome layer required.

#### Negative Paths

- Given an intake body whose plural section heading is followed by no bullets before the next heading, when the intake outcomes are staged, then the staged file is written with zero bullets and the reader reports the outcome layer not required.

### Done When

- [ ] A staging unit case whose body uses the plural heading writes that section's bullets verbatim into the staged file and reads back as required with exactly those bullets.
- [ ] Every pre-existing singular-heading case in the staging unit test file passes unchanged.
- [ ] A plural heading whose section holds no bullets writes a staged file with zero bullets and reads back as not required.

## Story 2: The staged file keeps the shape downstream readers already parse

As the engine reading staged intake outcomes at land, I want the staged file's own heading to stay canonical and its empty case to stay silent, so that widening what is recognized on the way in changes nothing on the way out.

### Acceptance Criteria

#### Happy Path

- Given an intake body written with either heading form, when the intake outcomes are staged, then the staged file's heading line is the canonical singular heading and no plural heading appears anywhere in the file.

#### Negative Paths

- Given an intake body carrying no Desired-outcome section at all, when the intake outcomes are staged, then the staged file is written with the canonical empty heading, no error is raised, and the reader reports the outcome layer not required.
- Given an intake body whose only candidate heading continues past the Desired-outcome phrase with further words, when the intake outcomes are staged, then no section is recognized, zero bullets are staged, and the reader reports the outcome layer not required.

### Done When

- [ ] A staging unit case asserts the file written from a plural-heading body carries the canonical singular heading line and contains no plural heading.
- [ ] A body with no Desired-outcome section stages a file with zero bullets and reads back as not required without throwing.
- [ ] A heading that continues past the Desired-outcome phrase is not treated as the section, stages zero bullets, and reads back as not required.

## Negative-category review

Invalid and ambiguous input is the whole risk surface here: the extractor is a pure string function over untrusted issue text, so the negative paths cover an empty section, an absent section, and a near-miss heading that must not be swallowed by a widened pattern. Timeouts, authentication, permission, concurrency, resource exhaustion, partial failure, dependency unavailability, cascade deletion, and idempotency categories are inapplicable — no process, network, tracker, datastore, queue, or shared mutable state participates, and the writer already overwrites its single gitignored file idempotently. Data integrity is covered by the canonical-heading criterion, which pins the one property every downstream reader depends on. The alternate-branch side-effect category is covered by the absent-section criterion: the fallback branch that writes the empty canonical heading must keep writing the file rather than becoming an error.
