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
- **Drafts.** The in-flight #3271 draft
  (`.worktrees/engineer-operator-acceptance-of-a-build-review-finding-does`) was compared.
- **Not examined.** Open spec PR #2878's stories are not in this worktree, so they were not
  examined. Its ADR amendment (mixed-laps D3/D5 deferral) was compared and does not conflict.
- **ADRs examined:**
  - `adr-2026-10-19-build-review-finding-severity-advisory-threshold`
  - `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`
  - `adr-2026-09-10-portable-build-review-policy`
  - `adr-2026-08-13-stable-build-review-finding-dispositions`
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

## Conflict: The #3271 carry cannot rescue v3 acceptances invalidated at upgrade

**Stories involved:** Story 3 (new) against #3271's draft Story 8 (unlanded)
**Type:** state-conflict, a one-time effect at upgrade
**Severity:** degrading

**Description:** #3271 carries only dispositions that are valid now. A v3 disposition invalidated by
the bump stops binding, so carry cannot restore it. Earlier text in the ADR and the review claimed
the opposite.

**Resolution Options:**
1. Accept the cost and state that every acceptance must be re-recorded.
2. Add a migration that forwards v3 dispositions to v4 ids. This reverses the existing "version
   change never matches silently" rule.

**Recommendation:** Option 1. The operator selected it on 2026-10-19.

**Applied:**
- ADR D2 and the Consequences section corrected.
- The architecture review's risk mitigation corrected.
- A re-accept criterion added to Story 3.

## Noted, not resolved here

**#3271 draft architecture review, Data implications row:** "Both store schemas and versions are
unchanged." That stops being true once this spec adds the suppression-entry kind. It is another
session's unlanded draft, so it is reported to the operator and not edited from here.

## Re-check

A re-scan for remaining `v3`/`custom-v1` pins and for exact disposition or bucket enumerations found
none. The testQuality `projectionVersion: v3` pins are a separate version axis and are unaffected.
