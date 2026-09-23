# Complexity: finish-fence-rejects-a-fresh-pass-for-a-gate-the-l

Tier: S

Rationale: One predicate change in `src/conductor/src/engine/gate-code-validity.ts` (`rebaseOperationPublicationBlocker`), one optional `appliedAt` field on `RebaseOperationRecord` stamped in `src/conductor/src/engine/rebase-transition.ts`, plus unit tests in `src/conductor/test/engine/gate-code-validity.test.ts`. No schema, CLI, hook, or skill changes; no cross-file writes.
