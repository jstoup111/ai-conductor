# Complexity: tautology-fails-are-unfixable-when-planned-behavio

Tier: M

Rationale: One engine-side evidence surface (verify-only task evidence threaded through
`BuildReviewInputs` into the grader prompt), one closed-list rubric exception in
`build-review-prompt.ts`, and authoring-boundary edits to two skills (`tdd`,
`writing-system-tests`) absorbed from #1529. No new models, integrations, auth, or state
machines; moderate story count. Mirrors the M-tier #1521 removal-maintenance sibling and the
issue's `size: M` label. Not S (multi-surface: engine + prompt + skills, gate-behavior change
needs conflict/architecture review); not L (no new subsystem, evidence parser already exists).
