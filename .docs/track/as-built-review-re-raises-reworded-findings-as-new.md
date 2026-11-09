# Track: As-built review re-raises reworded findings as new obligations

Track: technical

Scope boundary: as-built review only (#3127). Add an `as_built` domain to the existing shared remediation case store and reconcile each current as-built finding against prior as-built findings, dispositions and attempted repairs inside the existing remediate `gap-plan` dispatch, supplying the fuller as-built history (dispositions, repair tasks, repair commits) that #2748 left out. Excluded: PRD-audit reconciliation (#3126), cross-gate equivalence (#2441), combined prd_audit/as-built routing (#2060), and missing/corrupt-history recovery (#3128); the build_review case mode and the prd-widening-reconciliation mode stay untouched.

Internal engine behavior of a review gate's remediation loop; no product-facing requirement, matching the technical track of the sibling build_review re-raise specs.
