# Complexity: One rubric's rejected contract discards the whole build_review lap and resurrects fixed findings

Tier: M

Rationale: two engine seams (build_review lap join in step-runners.ts and the build_review completion check in artifacts.ts) plus the kickback-ledger/mechanical-fault interaction; no new models, integrations, or auth; state-machine change is bounded to the mechanical-fault lane; expected 4-6 stories.
