# Complexity: Record task done completion without a current-task stamp

Tier: S

Operator scope: small, confirmed 2026-09-28 (delegated).

The change is bounded to the stampless branch of runTaskDone in one production file: route a plan-gap request as the stamped path does, short-circuit an already-terminal row, and otherwise call the existing completeTaskDoneWhen writer. Contract text in the pipeline skill, the CLI reference, and the command guide string is synced. It reuses the existing evidence writer, repair lookup, and plan binding. It introduces no store, schema, event, CLI flag, or ADR, and amends none. Small-tier architecture, conflict, and coherence artifacts are not required.
