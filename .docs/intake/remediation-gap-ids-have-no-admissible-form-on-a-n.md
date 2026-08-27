# Intake origin: remediation-gap-ids-have-no-admissible-form-on-a-n

Source-Ref: jstoup111/ai-conductor#1963
Owner: jstoup111

## Desired outcome

- A remediation planner working from a no-PRD `prd_audit` report emits a gap id that admission accepts, without operator intervention.
- The accepted id forms are stated where the planner reads them, including the criterion form and when it applies.
- When admission rejects every gap, the halt names the offending ids and the keys that were available, so the mismatch is readable from the HALT alone.
- A genuinely unadmissible gap (owner-less `PLAN_GAP`, out-of-scope work) still fails closed — this must not become a fuzzy id match that admits plan growth the audit never authorized.
