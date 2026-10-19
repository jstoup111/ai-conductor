# Track: Operator acceptance of a build_review finding does not survive a re-raise

Track: technical

Scope boundary: all intake outcomes of jstoup111/ai-conductor#3271 — a re-raised finding the
`remediate` adjudicator binds to an operator-accepted case does not block (no regression or repeat
halt, no new decision stop, no `conflicting-case-id`); the carry is visible in `build-review
findings`, in the PR body's accepted-risk section (finding id, rubric, carried-from original id and
lap only — operator and rationale stay local per #1614), and on the event spine; the adjudicator
sees which prior cases are operator-accepted; an unbound finding still blocks exactly as today;
acceptance stays feature-scoped. Excluded: stabilizing custom-rubric finding identity, and any
operator-facing case-id acceptance CLI.

Selected approach: derive acceptance at read time from the case store's source links into the
operator disposition store (the disposition store remains the sole owner of accepted risk), behind
one shared resolver used by every consumer. Requires an operator-approved amendment of
`adr-2026-08-29-build-review-remediate-case-adjudication` D2 ("a provider cannot ... broaden ...
accepted risk"), which remains adopted under
`adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`: the adjudicator's
`existingCaseId` binding may extend an existing operator acceptance, never create one.

Internal engine gating behavior with no product requirements; acceptance criteria live in stories.
