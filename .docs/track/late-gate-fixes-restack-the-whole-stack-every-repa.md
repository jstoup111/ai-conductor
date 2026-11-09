# Track: Late-gate fixes restack the whole stack every repair round

Track: technical

Scope boundary: As filed (operator-confirmed 2026-11-08). Whole-feature audit rounds (prd_audit, architecture_review_as_built, manual_test, post-region custom steps) defer fix placement to one fold before publish: one restack and one re-validation per changed child. Restack spend gains per-round attribution on the event spine. Operator rounds (stack land, closed-child rewind) and revalidate rounds are unchanged. Post-publish re-publish folding is out of scope. #3628 is to be closed as superseded.

Internal engine machinery (routed-round execution placement, a publish-time fold restack, re-validation, spine attribution) with no user-facing product surface; acceptance criteria live in stories.
