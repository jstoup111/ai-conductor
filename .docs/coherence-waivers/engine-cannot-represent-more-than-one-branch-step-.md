Waives: outcome-5, outcome-6, outcome-7, outcome-8, outcome-9, outcome-10

Rationale: jstoup111/ai-conductor#2940 is ticket 1 of the six critical-path tickets for stacked child
plans (#2940–#2945). Several of its desired outcomes are also stated, more concretely, by later
tickets in that chain. During DECIDE the operator trimmed this ticket to the foundation that later
tickets consume. The trim is recorded in the scope boundary
(`.docs/track/engine-cannot-represent-more-than-one-branch-step-.md`) and in
`adr-2026-10-03-stacked-child-plans-identity-and-state`. The operator also chose that this ticket
ships only what a real production entry point reaches, rather than code fed by a value that can
never be set. Each waived gap is deferred work with a named home, and none is dropped:

- **outcome-5 (one branch identity everywhere).** Delivered for finish-record, park and reclaim,
  halt-PR reconciliation, intake overlap and the GitHub-operations scope check (stories 2–5).
  Teardown removing child branches, and worktree reuse across child branches, belong to #2945
  (stack teardown) and #2942 (child switching). This ticket recognizes children nowhere they could
  be acted on: park refuses them, and finish-record refuses them.
- **outcome-6 (per-child state).** Per-child step status, gate verdicts and kickback-ledger entries
  are delivered (story 6). Child-capable test-suite evidence and remediation cases go to #2942,
  because no recovery CLI in this ticket reads or writes them. The ADR fixes their storage contract
  (decision 8). Repair obligations stay feature-wide by design, consistent with #2944.
- **outcome-7 (leaf owns the feature's records).** This goes to #2945, which creates child PRs. With
  no child PR, today's single `pr_url` and retained draft already resolve to the leaf.
- **outcome-8 (recovery CLIs take a child).** `rewind`, `task` and `kickback-budget inspect` accept
  `--child` (stories 7–9). Defaulting to the active child needs active-child resolution, which goes
  to #2942. Its contract is fixed in ADR decision 10. Runbook documentation of the child form ships
  through this project's `maintain-documentation` step, not as plan tasks.
- **outcome-9 (halt records at the leaf).** The operator re-homed this to #2942 on 2026-10-03. It
  requires committing to a branch that is not checked out, which can be exercised only once child
  switching exists.
- **outcome-10 (consistent base for child-scoped work).** This goes to #2942, where the first child
  base exists. The contract is fixed in ADR decision 11: one producer, the parent is the previous
  declared position, each site keeps its own failure policy, and a missing parent fails closed.

Follow-up for the operator: add the deferred items to the outcomes of #2942 and #2945 so each is
tracked there.
