# Intake origin: remediation-dispositions-honor-the-engine-owned-in

Source-Ref: jstoup111/ai-conductor#2522
Owner: jstoup111

## Desired outcome

- Remediation receives a bounded versioned engine-owned input projection containing the authoritative source findings, applicable prior decisions/history, plan ownership, and allowed disposition context.
- Its answer reaches the engine as a schema-constrained, validated typed disposition collection; no skill prose defines the engine's accepted vocabulary or wire format.
- Every required source finding is accounted for using structural references; missing, duplicate, foreign, or malformed references and unknown dispositions receive field-specific mechanical rejection rather than silent omission or a substantive BLOCKED verdict.
- Valid dispositions preserve the applicable routing, budget, operator authority, concrete-work, and idempotence rules; changing those rules is outside this migration.
- Restart/replay and all downstream consumers agree on the validated result. Existing #2187 diagnostic coverage remains accounted for; native schema-invalid responses cannot be treated as successful partial judgments.
- Migrated remediation format instructions cannot be reintroduced unnoticed, and the skill remains usable interactively.
- Claude and Codex deliver the same behavior, including missing/invalid output and unsupported capability handling.
