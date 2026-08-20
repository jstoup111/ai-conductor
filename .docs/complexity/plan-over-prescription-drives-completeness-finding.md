# Complexity: plan-over-prescription-drives-completeness-finding

Tier: M

Rationale: One engine-side evidence surface (a plan-parsed preservation-clause block threaded
through `BuildReviewInputs` into the v2 projection, additively — the same shape `verifyOnlyContext`
took in #1579/PR #1618), one closed-list exception added to the Completeness rubric contract in
`skills/build-review-completeness/SKILL.md`, and one authoring-form edit to `skills/plan/SKILL.md`.
No new models, integrations, auth, or state machines; moderate story count. Directly mirrors the
M-tier #1579 verify-only sibling and the M-tier #1521 removal-maintenance sibling, both of which
reshaped a build_review rubric contract against engine-derived evidence, and matches the issue's
own `size: M` label.

Not S: multi-surface (engine parser + projection + two skill contracts), and it changes gate
behavior, so conflict-check and architecture review are both load-bearing — a mis-scoped exemption
here silently stops Completeness from failing genuinely incomplete work.

Not L: no new subsystem and no new derivation pipeline — the removal evidence the exception anchors
to (`removalContext`: deleted files, removed exported declarations, removed type members) is already
computed by `deriveBuildReviewRemovals` and already shipped to this rubric; only the plan-clause
parser is new, and it follows an existing parser's shape.
