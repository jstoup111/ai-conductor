# Complexity: Restack resolver accepts an operator decision

Tier: M

Rationale: Operator-confirmed 2026-10-31, after #3421 landed as #3522. The work extends seams that #3522 shipped, with no new module layer:

- `stack restack-resolve` (`stack-restack-resolve-cli.ts`) gains `--decision "<answer>"`, mutually exclusive with `--tip`. It reuses the command's lease, its record and live-halt match, and its HALT clear.
- The conflict record (`restack/restack-conflict-record.ts`, `restack-conflict-halt.ts`) is extended from feature-repair to base-refresh conflicts. It also carries the decision, bound to the conflict's identity rather than its per-run `opId`.
- The restack resolver path (`restack-executor.ts` and `restack-recovery.ts` → `restack-resolver.ts` → `ResolutionContext` → the `step-runners.ts` `resolveRebaseConflict` prompt) receives a matching decision.
- A new `restack_decision` event member records the decision and its application, beside the shipped `restack_resolution`.

The CLI change is additive: one new flag on an existing subcommand, with no migration. A decided conflict still lands through the shipped replay, move and transition, which keeps closed-child ancestry, re-validation queueing and task-evidence mapping intact. It is above Small because it crosses the CLI, the event schema, the restack engine and the resolver prompt. It also amends two on-main ADRs: `adr-2026-10-25-operator-recorded-restack-conflict-resolution` (decisions 1, 3, 4, 8 and 9's base-refresh parity) and `adr-2026-10-10-stacked-restack-journaled-replay` decision 6. It is below Large because it introduces no new subsystem, persistence family or cross-feature coordination.
