# Intake: Kickback to build is a no-op when the target task's evidence is still stamped (#647)

Source: jstoup111/ai-conductor#647
Size (filed): M
Labels: bug, priority: high

See the GitHub issue for the full WHAT/impact/desired-outcomes/non-goals. Spec re-scopes the fix to
the deterministic escalation/no-op-guard slice (Outcomes 2 and 3 in full; Outcome 1 via the existing
remediation-append "new gap work-item" path made loud). Literal per-task stamp invalidation is a
non-goal — see `.docs/decisions/adr-2026-07-13-kickback-build-no-op-escalation.md`.
