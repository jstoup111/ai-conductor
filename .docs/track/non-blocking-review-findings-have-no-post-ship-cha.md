# Track: Operator action inbox for non-blocking review findings

Track: product

Scope boundary: Operator confirmed the full scope of jstoup111/ai-conductor#1810 on 2026-09-30: retain non-blocking findings from build review, requirements audit, and as-built architecture review; list actions per feature and across features; let the operator mark actions acted-on or dismissed; recover historical recorded findings without repeating review; and declare additional issues to close when the implementation merges. The operator selected approach A and product track with "A and product".

Selected approach: Extend the existing cases into an operator action inbox. Filing new intake is an operator choice; existing linked intake is retained. Implementation architecture remains subject to review. Automatic creation of an issue for every finding was rejected in favor of reviewing actions together without mandatory issue volume.

Product rationale: This changes the operator's visible workflow and review-to-shipping behavior. It is not an internal-only refactor.

Excluded: implementing follow-up fixes in the originating feature, re-running historical reviews, weakening the authority of genuinely blocking findings, and automatically choosing unrelated issues to close.
