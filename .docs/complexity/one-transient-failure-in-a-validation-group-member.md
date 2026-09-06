# Complexity: One transient failure in a validation-group member discards its siblings

Tier: M

## Rationale

Two focused engine changes in `src/conductor/src/engine/conductor.ts`, both inside the
auto-mode validation-group fan-out:

1. The branch retry budget passed to `runGroupBranch` becomes the member's resolved
   `max_retries` instead of the literal `1`.
2. The no-verdict halt block persists the passing members' completions into
   `conduct-state.json` before halting, so the operator's re-dispatch does not re-run
   green siblings.

Not Small: the second change alters halt-path state semantics that two APPROVED ADRs
govern (`adr-2026-07-10-concurrent-group-core.md`,
`adr-2026-07-10-validation-group-join.md`), and it interacts with the single-writer
state invariant, the SIGINT/SIGTERM merge of `inFlightGroupCompletions`, and
`resolveGroupMembership`'s `reverifyDoneMembers` re-verification rule for BUILD repairs.
Getting that interaction wrong would let a stale `done` mask a member that must re-run.

Not Large: no new subsystem, no new seam, no schema or CLI change, and the intended
retry semantics are already specified by an approved ADR rather than open for design.

The source issue carries the operator's own `size: M` label, which agrees.
