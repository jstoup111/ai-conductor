# Intake origin: spec-review-artifacts-still-mix-reviewer-content-w

Source-Ref: jstoup111/ai-conductor#3419
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3419 digest=fb0a8f70936bb6d8ee01b6666c50f62c7a1955bcd0ee204726c5a36393c90817 >>>
## Desired outcome

- A reviewer can read one Medium spec PR and find each acceptance criterion stated in full in one place.
- The artifacts a reviewer must read for a Medium or Large spec are materially shorter than today's on the same spec. For example, #3278's plan plus coherence (64,090 characters) would shrink.
- A new spec's reviewer-facing files and its machine-only files sit in separate, clearly named places, so a reviewer can tell which files to read without opening them.
- The land-time coherence gate still refuses a spec whose criteria are not mapped to a task's `Done when` check, and still names each unmapped criterion.
- Every gate that reads these artifacts today (land coherence gate, plan review, prd_audit, coverage judgement) still receives everything it needs to rule as it does now.
- A spec authored through interactive `conduct` resolves its artifacts the same way as one landed by composer.
- Specs authored before this change keep building, reviewing and shipping unchanged.
<<< END INBOUND >>>
