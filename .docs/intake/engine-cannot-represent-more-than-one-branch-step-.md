# Intake origin: engine-cannot-represent-more-than-one-branch-step-

Source-Ref: jstoup111/ai-conductor#2940
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2940 digest=5f460be2ca28cbec48cec47b899c4591f385fb472f98f28cb03bddc3e70aa2be >>>
## Desired outcome

- **N=1 is unchanged.** With `stacked_prs.enabled` off, or with an unsliced plan, every operator-facing output is byte-for-byte what it is today:
- persisted state files, gate verdict paths and events;
- `daemon status` and the dashboard;
- PR bodies, and the shipped-record Cost and Time blocks.
- **One branch identity everywhere.** A feature's leaf branch keeps today's name. Each earlier child branch is recognized as belonging to the same feature by every consumer: finish-record, worktree reuse, park, reclaim, halt-PR reconciliation, intake overlap and teardown. None of them derives a wrong or colliding slug from a child branch.
- **Per-child state.** The engine can hold independent step status, gate verdicts, test-suite evidence, kickback ledger entries, remediation cases and repair obligations for each child of one feature, and none of them overwrites another's.
- **Leaf owns the feature's records.** The feature's PR record and its retained SHIP draft always resolve to the leaf. Each child's PR is recorded separately, and no second leaf PR is ever opened.
- **Recovery CLIs take a child.** `rewind`, `kickback-budget` and `task` accept a child, and default to the active child when none is given. The stalled-feature runbook recipes work unchanged for single-PR features and document the child form.
- **Halt records** are always written to the leaf, naming the child they concern. Nothing is pushed for a child that has not been published.
- **Consistent base for child-scoped work.** Every consumer that grades or tests "the feature's changes" resolves the same base, and that base can be a parent child's tip rather than the default branch.
- **Child identity on the event spine.** Events can carry a child identity, and the field is absent when N=1.
<<< END INBOUND >>>
