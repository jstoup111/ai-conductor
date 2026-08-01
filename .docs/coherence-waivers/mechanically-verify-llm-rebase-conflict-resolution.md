# Coherence Waiver: mechanically-verify-llm-rebase-conflict-resolution

Waives: outcome-1

Rationale: Intake #1152 originally required an engine-mechanical comparison of source and replayed patches outside conflicted hunks. During interactive exploration on 2026-08-01, the operator explicitly rejected a mechanical resolver and mechanical edit-surface restrictions because legitimate semantic conflict resolution may require coordinated functional changes in other files. The operator approved the replacement requirement: preserve cross-file freedom, validate the complete replay against source intent in the rebase skill, and HALT on ambiguity. Claiming the original mechanism as covered would be false, so outcome-1 is waived while its underlying corruption-prevention goal is addressed by story-1.
