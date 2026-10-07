# Intake origin: base-inherited-artifact-deletion-deadlocks-both-se

Source-Ref: jstoup111/ai-conductor#1752
Owner: jstoup111

## Desired outcome

- A protected artifact that is absent because the **base branch** deleted it never halts a feature that did not author the deletion; the feature builds through it.
- After a rebase that inherits such a deletion, at least one documented operator command recovers the feature without hand-running engine internals.
- A deletion the **feature itself** authored still halts, and the halt names the artifact.
- When a seal path refuses, the refusal states which artifact and whether it was feature-authored or base-inherited.
