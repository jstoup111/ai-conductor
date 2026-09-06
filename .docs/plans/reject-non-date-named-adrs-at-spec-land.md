# Implementation Plan: Reject non-date-named ADRs at spec land

**Date:** 2026-09-06
**Stories:** .docs/stories/reject-non-date-named-adrs-at-spec-land.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing land-gate contract — the same decision-record enumeration, the same added-or-changed change-set boundary, and the same aggregate-then-refuse error shape the approval and citability rungs already use.

## Summary

Four bounded tasks deliver #705: one exported filename predicate, one new rung on the existing
land-time decision-record gate scoped to records absent at the spec's merge base, its
merge-base-exemption coverage, and realignment of the existing land-reaching fixtures. Repository-wide
filename sweeps, renaming committed records, and daemon backlog discovery are outside this slice.

## Technical Approach

Add one exported predicate beside the existing decision-record helpers in the shared artifact module,
which already hosts the status reader and the decision-id parser for the same record family. The
predicate takes a bare filename and answers whether it is the canonical authoring form: the literal
prefix `adr-`, a four-digit year, a two-digit month, a two-digit day, each separated by a hyphen,
then a non-empty kebab slug of lowercase alphanumeric segments joined by single hyphens, then the
markdown extension. Match the whole string, case-sensitively. Reject a date component that is
shape-valid but not a real calendar day — construct the date from its three parts and require the
round trip to reproduce them — so a four-digit sequential number dressed as a date cannot slip
through the shape check. This predicate is pure and has no filesystem or git dependency.

Apply it as a new rung inside the land primitive's existing decision-record loop. That loop already
walks every record whose name carries the ADR prefix and already intersects them with the set of
record paths this spec added or changed. The naming rung needs a narrower boundary than that set: a
spec that supersedes or corrects an existing record must keep landing, so judge only records that do
not exist at the spec's merge base. Resolve the merge base the same way the idea-file resolver does —
derive the target's default branch from the canonical path, then ask git for the merge base against
the worktree head — and list the committed decision-record paths at that revision with a single tree
listing. A candidate record is new when it is in the added-or-changed set and absent from that
listing. A missing tree at the merge base means the directory did not exist, which yields an empty
listing and therefore treats every candidate as new; that is the correct fail-toward-enforcement
direction for a repository authoring its first record.

Aggregate the offenders across the loop and throw once, after the existing unapproved and uncitable
throws, naming every offending path and restating the required form in the message. Ordering matters
twice over: the approval rung stays the first thing a spec hears about a record it should not have
written, so no previously guarded condition is displaced, and the existing suites that assert those
two refusals keep matching on their own wording. The gate throws through the same error channel as
its sibling rungs; it emits no event, metric, span, log line, or report, and adds no telemetry
channel.

The land-reaching suites currently seed decision records under short mnemonic names. Only fixtures
that introduce a new record and expect the land to succeed are affected by the new rung; fixtures
whose land is expected to fail on approval or citability keep reporting those failures because the
naming throw is last, and fixtures that commit their record to the target before branching sit at the
merge base and are exempt by construction. Realign the affected fixture filenames to the canonical
form and update every in-file reference to them, including obligation and coherence rows that cite a
record stem. Do not weaken an assertion to accommodate the rung.

Follow the local test patterns already in the land primitive's suite: it builds a real temporary git
repository, writes artifacts into a worktree, and drives the primitive directly rather than through a
full orchestration run, and it already carries a case that commits a record to the target before
branching to prove the change-set boundary. Reuse that shape for the merge-base exemption cases; unit
coverage for the predicate belongs beside the other pure artifact helpers. Search hints: the existing
approval-diagnostics and citability describe blocks in the land primitive's suite, and the status and
decision-id helper cases in the artifact module's suite. Variation in fixture builders and assertion
grouping is allowed; the observable boundary — the primitive's resolved or rejected promise and the
message text — must be preserved. No exact-copy pattern declaration applies.

## Preconditions and claim ledger

- Operator approved Small scope, change-set scoping over a grandfather allowlist, the technical track, and both stories on 2026-09-06 (delegated).
- Verified: the architecture-review skill publishes the canonical form and forbids sequential numbers; the conflict-check skill repeats it; no engine, hook, or integrity check enforces it.
- Verified: the land primitive lists every record whose basename matches the ADR prefix, builds an added-or-changed path set from the idea files plus the changed-markdown collector, and throws on unapproved records and then on uncitable added-or-changed records.
- Verified: the shared artifact module exports the record status reader and the decision-id parser, so the new predicate has an established home beside them.
- Verified: the idea-file resolver derives the default branch from the canonical path and computes a merge base against the worktree head, which is the pattern the new exemption lookup reuses.
- Verified: 308 committed records carry the ADR prefix on the base branch and exactly 11 of them use sequential numbers; every one predates this change and therefore sits at any new spec's merge base.
- Verified: the land primitive imports only the path join and relative helpers, so the basename helper is a new import in that module.
- Verified: the land primitive's suite already contains a case that commits a record to the target before branching to prove a legacy record is exempt from the citability rung.
- Scope check: A — consumer-facing land gate; B — n/a, no new skill; C — provider-agnostic. Event spine: no new channel; the refusal rides the existing land error path.
- Verify-claims verdict: CLEAR. No load-bearing assumption remains unconfirmed.

## Tasks

### Task 1: Add the canonical decision-record filename predicate
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/artifacts.ts, src/conductor/test/engine/artifacts.test.ts
**Dependencies:** none

**Steps:**
1. Write table-driven unit cases beside the existing record status and decision-id helper cases: canonical names with one-segment and multi-segment slugs; a sequential three-digit number; a sequential four-digit number; a four-digit number followed by two more numeric groups that is not a real calendar day; month 13 and day 32; a name with an empty slug; a name with uppercase or underscore characters in the slug; a name with a doubled hyphen; a name that is not markdown; and a name that lacks the record prefix entirely.
2. Run the scoped test file and confirm RED before writing the predicate.
3. Implement the exported predicate against a whole-string case-sensitive pattern, then validate the three date parts reproduce themselves when round-tripped through a constructed date so a shape-valid impossible day is rejected.
4. Re-run the scoped test file to GREEN, run the typecheck target that covers test files, and commit the focused change.

**Done when:**
1. The predicate accepts a canonical name with a single-segment slug and one with a multi-segment slug.
2. The predicate rejects a three-digit and a four-digit sequential number, an empty slug, an uppercase or underscore slug character, a doubled hyphen, a non-markdown extension, and a name without the record prefix.
3. The predicate rejects a name whose date component is shape-valid but not a real calendar day, including month 13 and day 32.
4. The scoped unit file passes and the typecheck target that covers test files reports no error.

### Task 2: Refuse a newly introduced record whose filename is not canonical
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/engineer/land-spec.ts, src/conductor/test/engine/engineer/land-spec.test.ts
**Dependencies:** 1

**Steps:**
1. Add land-primitive cases in a new describe block beside the existing approval-diagnostics and citability blocks: an approved citable record with a canonical name that lands; the same record renamed to a sequential number that is refused; a record whose date is shape-valid but impossible that is refused; and two new records where only one is canonical, asserting both offending names appear in one message.
2. Run the scoped test file and confirm RED before touching the primitive.
3. In the existing decision-record loop, collect offenders whose basename fails the predicate and which are new to this spec, determined by intersecting the added-or-changed path set with the complement of the committed record listing at the merge base; resolve that merge base from the canonical path's default branch and the worktree head, and treat a missing tree as an empty listing.
4. Throw once after the existing unapproved and uncitable throws, listing every offending path and restating the required form; add the basename import the primitive does not yet carry.
5. Re-run the scoped test file to GREEN, run the typecheck target that covers test files, and commit.

**Done when:**
1. A land whose spec introduces one approved citable record with a canonical name resolves successfully.
2. A land whose spec introduces a record named with a sequential number rejects, and the message contains that filename and the required canonical form.
3. A land whose spec introduces a record whose date component is not a real calendar day rejects and names that file.
4. A land whose spec introduces one canonical and one non-canonical record names both offending files in a single message.

### Task 3: Prove records present at the merge base are exempt
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/test/engine/engineer/land-spec.test.ts
**Dependencies:** 2

**Steps:**
1. Add a case that commits two sequential-number records to the target repository before the spec worktree branches, then lands a spec that introduces only a canonical-named record, and assert the promise resolves and that neither pre-existing filename appears in any surfaced message.
2. Add a case that commits a sequential-number record to the target before branching, modifies its body in the worktree, and asserts the land resolves rather than rejecting on the filename.
3. Add a case that introduces a record which is both non-canonically named and not approved, and assert the rejection carries the existing approval wording rather than the naming wording.
4. Run the scoped test file, confirm all three pass without changing production code, run the typecheck target that covers test files, and commit.

**Done when:**
1. A land whose target already carries two sequential-number records resolves, and no surfaced message names either of them.
2. A land that modifies a pre-existing sequential-number record resolves rather than rejecting on its filename.
3. A land introducing a record that is both misnamed and unapproved rejects with the approval wording, proving the pre-existing rung still reports first.
4. All three cases pass with no production change beyond Task 2, and the typecheck target that covers test files reports no error.

### Task 4: Realign the existing land-reaching record fixtures
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/test/acceptance/engineer-agent-hosted.test.ts, src/conductor/test/acceptance/decide-artifact-coherence-check.acceptance.test.ts, src/conductor/test/acceptance/adr-approval-gate-before-build.acceptance.test.ts, src/conductor/test/acceptance/contradictory-decide-artifacts-reach-build-and-hal.acceptance.test.ts
**Dependencies:** 2

**Steps:**
1. Run each of the four suites and record which cases now fail because a fixture introduces a new decision record under a non-canonical filename and expects the land to succeed.
2. Rename each such fixture filename to the canonical date-plus-slug form, keeping the slug recognisably derived from the original mnemonic so the case stays readable.
3. Update every reference to a renamed fixture in the same file, including obligation-coverage and coherence rows that cite a record stem, and any assertion that matches on the filename.
4. Re-run the four suites together plus the land primitive's own suite, run the typecheck target that covers test files, and commit.

**Done when:**
1. Every decision-record fixture that a case newly introduces and expects to land successfully carries a canonical date-plus-slug filename.
2. The four named suites pass together with the land primitive's suite, with no assertion weakened or removed to accommodate the new rung.
3. Every in-file reference to a renamed fixture, including record-stem citations in obligation and coherence rows, resolves to the new filename.
4. The typecheck target that covers test files reports no error across the changed suites.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a spec introduces one approved, citable decision record whose filename is the canonical date-plus-slug form, when land runs, then land succeeds and commits the spec branch. | 2 | "A land whose spec introduces one approved citable record with a canonical name resolves successfully." | diff-local |
| Story 1 negative: Given a spec introduces an approved, citable decision record whose filename carries a sequential number in place of the date, when land runs, then land is refused and the refusal names that file and states the required canonical form. | 1, 2 | "A land whose spec introduces a record named with a sequential number rejects, and the message contains that filename and the required canonical form." | diff-local |
| Story 1 negative: Given a spec introduces an approved, citable decision record whose filename matches the canonical shape but encodes a date that is not a real calendar day, when land runs, then land is refused and the refusal names that file. | 1, 2 | "A land whose spec introduces a record whose date component is not a real calendar day rejects and names that file." | diff-local |
| Story 1 negative: Given a spec introduces two approved, citable decision records and only one carries a canonical filename, when land runs, then the refusal names every offending file rather than stopping at the first. | 2 | "A land whose spec introduces one canonical and one non-canonical record names both offending files in a single message." | diff-local |
| Story 2 happy: Given the base branch already carries decision records with sequential-number filenames and the spec introduces only a canonical-named record, when land runs, then land succeeds and no message names any of the pre-existing records. | 3 | "A land whose target already carries two sequential-number records resolves, and no surfaced message names either of them." | diff-local |
| Story 2 negative: Given the spec modifies a decision record with a sequential-number filename that already exists at the spec's merge base, when land runs, then land is not refused on account of that filename and the modification is committed. | 3, 4 | "A land that modifies a pre-existing sequential-number record resolves rather than rejecting on its filename." | diff-local |
| Story 2 negative: Given a spec introduces a decision record that is both misnamed and not approved, when land runs, then the existing approval refusal is what land reports, so the new rung never masks a gate that already guarded the base branch. | 3 | "A land introducing a record that is both misnamed and unapproved rejects with the approval wording, proving the pre-existing rung still reports first." | diff-local |

## Test dispositions and integration ownership

All seven criteria are diff-local: each is decided entirely by the new predicate, the new land rung,
and fixtures the change itself controls. Task 1 owns pure unit coverage of the filename predicate at
the narrowest level, with no filesystem or git dependency. Task 2 owns the integration proof through
the land primitive's own entry point — the changed production boundary is the land gate, and the
observable behavior is the primitive's resolved or rejected promise together with its message text,
exercised against a real temporary git repository with no third-party service in the path. Task 3
extends that same boundary with the merge-base exemption and rung-ordering cases and lands no
production change. Task 4 realigns pre-existing fixtures in four land-reaching suites and adds no new
coverage of its own. No terminal validation task is added; the configured aggregate suite and the
repository's own validation script remain the whole-feature check.

## Task Dependency Graph

Task 1 -> Task 2
Task 2 -> Task 3
Task 2 -> Task 4
