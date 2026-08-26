# Track: as-built invalid-verdict halt diagnostics

Track: technical

Scope boundary: all 4 invalid causes of `classifyAsBuiltReviewOutcome` — no verdict line, unrecognized verdict value, PLAN_GAP missing `Outcome delivered`, and unparseable BLOCKED findings — each with a distinct operator-facing halt reason. Approach A: typed `cause` on the invalid arm plus a parser split so no-line vs unrecognized-value are distinguishable. No product surface.

Engine halt-message wording fix; operator-facing diagnostics only, no user-facing product behavior.
