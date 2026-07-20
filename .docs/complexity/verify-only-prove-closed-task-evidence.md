# Complexity: verify-only-prove-closed-task-evidence

Tier: M

Rationale: touches the correctness-critical completion-evidence seam across four existing
subsystems — the plan-task parser (`parsePlanTaskPaths`, autoheal.ts), the gate-miss judged
attribution lane (attribution-lane.ts + its conductor.ts:3030-3105 integration), the generated
commit-msg hook asset (git-hook-assets.ts), and the /plan + /tdd skill contracts — plus
adversarial negative-path tests for forged citations and abstain behavior. No new models,
integrations, auth, or state machines; no new subsystem (the judge lane, stamp sidecar, and
empty-evidence-commit grammar all already exist and are extended, not invented). Moderate
story count (5). Not S because gate-semantics changes require conflict-check + lightweight
architecture review; not L because every change lands inside an existing seam.
