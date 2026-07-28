# Intake origin: 2026-07-26-rebased-features-stale-protected-artifact-seal-976

Source-Ref: jstoup111/ai-conductor#976
Owner: jstoup111

## Desired outcome

- After a feature is rebased onto a newer base, its next resumed BUILD or SHIP attempt does not fail solely because a protected-artifact seal was created against the pre-rebase base.
- A real mutation to a protected artifact after the applicable rebase baseline still blocks dispatch with an actionable reason.
- The daemon records enough context to distinguish a stale pre-rebase seal from a real protected-artifact mutation.
- A resumed feature can proceed through normal gates without an operator manually deleting or rewriting generated seal state.
