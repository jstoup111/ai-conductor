# Intake origin: step-applicability-is-fixed-repo-wide-decide-canno

Source-Ref: jstoup111/ai-conductor#1789
Owner: jstoup111

## Desired outcome

- DECIDE can record that a specific step does not apply to this feature, with a stated reason, and the pipeline honors that for this feature only.
- A step declared inapplicable is visibly recorded as such, distinguishable from a step that was skipped by tier, that failed, or that never ran.
- Repository-wide configuration continues to work exactly as it does today for repositories that set nothing per-feature.
- The decision cannot be made by an autonomous run alone — declaring a gate inapplicable is an operator judgement, and the record shows who made it.
- A step that a feature genuinely needs cannot be declared away to get past a failing gate.
