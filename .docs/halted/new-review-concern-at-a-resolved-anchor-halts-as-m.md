# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-10-03T15:52:36.656Z
Slug: new-review-concern-at-a-resolved-anchor-halts-as-m
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-new-review-concern-at-a-resolved-anchor-halts-as-m
Head SHA: cbb232b40ae9b9e6cb1e9d2756f006bf21a3adcd
Halted at: 2026-10-03T13:21:58.463Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 6 happy: Given any store written before this change, when the fixed engine reads it, then it parses unchanged with no migration and no rewrite on read.
Task ids: 1
Done when checks: `parseBuildReviewCases` admits a build_review store where one source id is linked by a resolved case and by at most one unresolved case, as asserted by a store test that reads the resolved-plus-open fixture back with every case field preserved. | A persisted store whose same source id is linked by two unresolved cases fails `RemediationCaseStore.load` with reason `malformed-state`, as asserted by a store test over that fixture. | A source id repeated within one case still fails `RemediationCaseStore.load` with reason `malformed-state`. | Pre-change v1 and v2 store fixtures with globally unique sources load through `RemediationCaseStore.load` with identical parsed state and no write, as asserted by a byte comparison of each file after the read.
Missing assertion: Given any store written before this change
```
