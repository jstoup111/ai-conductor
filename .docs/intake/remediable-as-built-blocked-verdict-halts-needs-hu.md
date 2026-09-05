# Intake origin: remediable-as-built-blocked-verdict-halts-needs-hu

Source-Ref: jstoup111/ai-conductor#2195
Owner: jstoup111

## Desired outcome

- An as-built BLOCKED verdict whose blocking findings are all REMEDIABLE enters the same bounded build-remediation route (caps, laps, dispositions) as other remediable as-built findings, with no operator involvement.
- A BLOCKED verdict with any design-class finding — one the review says requires an ADR change or human choice — still halts needs-human, and the halt reason names which finding(s) made it a decision.
- Remediation of a remediable BLOCKED verdict remains subject to the existing lap/growth budgets, so a non-converging one still surfaces to the operator through the normal cap halts.
