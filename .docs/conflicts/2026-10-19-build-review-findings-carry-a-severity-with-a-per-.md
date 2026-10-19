# Conflict Check: build_review findings carry a severity with a per-rubric advisory threshold

**Date:** 2026-10-19
**New stories:** `.docs/stories/build-review-findings-carry-a-severity-with-a-per-.md`, Stories 1–9
**Result:** passed clean after resolution. Zero blocking conflicts remain.

## Scope

- **Existing stories scanned.** 133 accepted story files that mention build_review, remediation or
  adjudication and also touch at least one of these:
  - contract version, identity, suppression or settled recurrence;
  - accepted risk, dispositions or the findings CLI;
  - `min_confidence`, kickback charging, or the PR body.

  Each pair was checked in both directions.
- **#3271.** Its spec landed on main in #3308 after this check first ran. Its stories and its
  amendments to four ADRs were re-compared as landed. Its build worktree was not touched.
- **Not examined.** Open spec PR #2878's stories are not in this worktree, so they were not
  examined. Its ADR amendment (mixed-laps D3/D5 deferral) was compared and does not conflict.
- **ADRs examined:**
  - `adr-2026-10-19-build-review-finding-severity-advisory-threshold`
  - `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`
  - `adr-2026-09-10-portable-build-review-policy`
  - `adr-2026-08-13-stable-build-review-finding-dispositions`
  - `adr-2026-08-29-build-review-remediate-case-adjudication`
  - `adr-2026-08-12-cumulative-build-review-convergence-bound`
  - `adr-2026-08-14-retire-build-review-wiring-rubric`
- **ADRs narrowed out:** every other ADR, none of which addresses rubric contracts, finding
  identity, effective-verdict buckets, adjudication dispositions or build_review PR regions.

## Conflict: Accepted stories pin the built-in contract at v3 and custom at v1

**Stories involved:** Story 1, Story 2, Story 3 (new), against:
- typed-findings Stories 1, 5 and 6;
- clean-rubric Stories 1, 3 and 5;
- infrastructure-exits Story 2;
- medium-tier evaluator.

**Files:**
- `.docs/stories/build-review-rubric-findings-arrive-as-typed-struc.md`
- `.docs/stories/clean-rubric-judgements-rejected-as-invalid-provid.md`
- `.docs/stories/infrastructure-exits-can-masquerade-as-test-sensit.md`
- `.docs/stories/medium-tier-evaluator-policy-enforce-at-the-conduc.md`

**Type:** contradiction
**Severity:** blocking. The typed-findings Story 6 test asserts that a v4 cache entry is rejected.

**Existing (verbatim):** "Given a cache entry declaring `contractVersion: v4`, when parsed, then it
is rejected as invalid, proving the accepted version set did not advance."

**New (verbatim):** "The current built-in contract version is v4 and fresh results declaring an
older version are rejected; persisted v1-v3 results still parse for reads."

**Description:** Earlier migrations stated that they did not change the contract version, but phrased
it as the version being fixed at v3 (or custom-v1). With ADR D2 approved, those criteria and their
tests cannot hold.

**Resolution Options:**
1. Restate each pinned version as "the current contract version", keeping each story's own
   assertion that it did not itself change the version.
2. Supersede the old stories entirely.

**Recommendation:** Option 1. The operator selected it on 2026-10-19.

**Applied:** amended in place in commit `80a4d3067d`. The plan must update the tests that assert the
old pins: the cache-entry parse, the descriptor version, and custom-id parity.

## Conflict: The settled-recurrence list omits advisory cases

**Stories involved:** Story 9 (new) against confidence-floor Story 6
**File:** `.docs/stories/operator-configurable-confidence-floor-for-acting-.md`
**Type:** overlap
**Severity:** degrading

**Description:** The existing Done When lists deferred, rejected and merged cases as settled. ADR D7
adds advisory cases while their threshold admits them.

**Applied:** Done When extended in place in commit `80a4d3067d`.

## Conflict: Portable-policy operator-risk binding vs invalidation at the version bump

**Stories involved:** Story 3 (new) against portable-policy Story 18
**File:** `.docs/stories/projects-cannot-add-portable-non-competing-build-r.md`
**Type:** state-conflict
**Severity:** degrading

**Existing (verbatim):** "changed effective built-in criteria invalidate incompatible reuse without
erasing existing built-in operator-risk binding."

**New (verbatim):** "Given a stored operator disposition recorded against a v3 finding, when the
effective verdict is derived for a v4 lap, then the disposition is reported invalidated through the
existing build_review_disposition_version_invalidated event and does not bind."

**Applied:** a carve-out for contract-version changes was added in place in commit `80a4d3067d`.

## Conflict: The #3271 carry and v3 acceptances invalidated at upgrade

**Stories involved:** Story 3 (new) against #3271's Story 1 and Story 3 (landed in #3308)
**Type:** state-conflict, a one-time effect at upgrade
**Severity:** degrading

**Description:** An earlier pass claimed #3271 carries only dispositions valid at the current
contract version, so carry could never rescue a v3 acceptance. #3271 as landed has no version
condition: a case source is directly accepted when its own exact disposition exists, and a later
finding the judge binds to that case is carried. A re-keyed v4 finding bound to the case holding
the accepted v3 source is therefore carried; one the judge does not bind still needs
`build-review accept`.

**Resolution Options:**
1. State both outcomes: carry when the judge binds, re-accept otherwise.
2. Exclude version-invalidated dispositions from carry origins. That adds a resolver condition
   #3271 does not have.

**Recommendation:** Option 1. It needs no code and keeps the re-accept cost as the worst case the
operator accepted on 2026-10-19.

**Applied:** ADR D2 and Consequences, the architecture review's risk row, and the mixed-laps and
stable-dispositions amendment notes. Story 3's exact-identity criteria stay true: a v3 disposition
never binds a v4 finding directly.

## Conflict: An advisory downgrade proposed for a finding bound to an accepted case

**Stories involved:** Story 8 (new) against #3271's Story 1 (landed in #3308)
**Type:** overlap
**Severity:** degrading
**ADR filename stem:** adr-2026-08-29-build-review-remediate-case-adjudication
**Story ID:** Story 8
**ADR opposing sentence (verbatim):** "It counts as operator-resolved for the effective verdict and settles with no action, deferral, escalation, decision stop, repeat or regression halt, or kickback charge, whatever disposition the judge proposed for that case."
**Story opposing sentence (verbatim):** "Given implementationQuality min_severity major and a live major finding, when the remediate judgement returns an advisory case for it with adjudicated severity minor, a non-empty rationale and effect none, then the case is accepted, the lap routes no BUILD and charges no kickback."

**Description:** Both outcomes are non-blocking, but they record the finding differently: carried
acceptance lists it as accepted risk, while an advisory case lists it as advisory. With no stated
precedence, a builder could record the same finding both ways.

**Resolution Options:**
1. Carry takes precedence, as #3271's D2.1 already says for every proposed disposition.
2. Advisory takes precedence. This contradicts an approved ADR.

**Recommendation:** Option 1.

**Applied:** ADR D6 "Carried acceptance first", a new Story 8 negative criterion, a Task 19 check,
and an amendment note beside remediate-case-adjudication Decision 4.

## Conflict: The v4 bump against stable-dispositions Decision 1

**Stories involved:** Story 3 (new) against the stable-dispositions ADR
**Type:** contradiction
**Severity:** degrading
**ADR filename stem:** adr-2026-08-13-stable-build-review-finding-dispositions
**Story ID:** Story 3
**ADR opposing sentence (verbatim):** "A contract version changes only when identity semantics change; that change intentionally prevents an old disposition from silently matching the new meaning."
**Story opposing sentence (verbatim):** "Given a v3 finding and a v4 finding identical in rubric, concern kind and anchor, when their identities are computed, then the ids differ, because contract version is part of identity."

**Description:** Severity is excluded from identity, so identity semantics do not change, yet the
built-in contract version still moves and re-keys every built-in id.

**Resolution Options:**
1. Amend Decision 1 to record the operator-accepted exception.
2. Decouple the identity version from the result contract version, which the operator declined on
   2026-10-19 in favour of the one-time re-key.

**Recommendation:** Option 1.

**Applied:** an amendment note beside Decision 1, and plan obligation rows for all six decisions.

## Resolved after #3271 landed

**#3271 architecture review, Data implications row:** "Both store schemas and versions are
unchanged." That holds for #3271's own change only. An amendment note now records this spec's
suppression-entry union and `advisory` case disposition beside it.

## Re-check

A re-scan for remaining `v3`/`custom-v1` pins and for exact disposition or bucket enumerations found
none. The testQuality `projectionVersion: v3` pins are a separate version axis and are unaffected.
