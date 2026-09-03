# Complexity: A coverage claim can name a task whose Done when does not assert the criterion

Tier: M

Two bounded mechanisms on existing seams. The mechanical half narrows an existing land-time
substring check (`checkCriterionCoverage`) from the whole task body to the task's parsed
`Done when` block and gives the S-tier plan coverage table the same parsed shape — both reuse
`parsePlanTaskDoneWhen` and the shared coherence parser. The judgement half adds one gating daemon
step before `build` that follows the existing engine-native step shape (the `build_review`
adjudicator's schema-constrained verdict pattern), is config-gated, and ships default OFF, so no
existing build path changes behavior until a follow-up flips the default. One ADR amendment
(coherence gate placement) is required; no new external service, credential, or multi-actor state
machine. This matches the `size: M` label on issue #2088. The plan stem must remain
`a-coverage-claim-can-name-a-task-whose-done-when-d`.
