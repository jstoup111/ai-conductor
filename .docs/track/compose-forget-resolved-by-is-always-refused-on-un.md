# Track: compose forget --resolved-by on unassigned issues

Track: technical

Scope boundary: Narrow (operator-settled 2026-10-09). `compose forget` supplies the existing interactive
GitHub-operation confirmation — the same `Authorize <operation> on <target>? [y/N]` terminal prompt the
`github-operation` command uses — to its guarded intake writes (audit comment, close, label removal), so an
operator at an interactive terminal can approve each write on an issue the machine owner is not the sole
assignee of. Non-TTY invocations (agent shells) stay refused, and the refusal names why and how to approve.
`--resolved-by` also works when the issue has no intake ledger entry: it comments and closes under the same
per-write authorization and leaves the ledger untouched. The composer skill's §3a drop path and the `forget`
help text are corrected to match. Excluded: any bypass/override flag, any change to the approval seam
(`github-operation-approval.ts`) or the assignment rule in `createGithubIntakeAuthorization`, prompting in any
other `compose` subcommand, batching several writes under one approval, and automatic "already fixed"
detection.

Internal operator CLI behavior on an existing guarded seam, with no product requirements; acceptance criteria
live in stories (intake jstoup111/ai-conductor#2786).

## Approach decision

- **Chosen — interactive TTY confirmation (operator decision).** `forget` passes an
  `InteractiveGithubOperationConfirmation` into `createGithubIntakeAuthorization`. The guard's design is
  preserved: approval is a one-request capability minted only by an affirmative interactive answer
  (`src/conductor/src/engine/github-operation-approval.ts:160-194`), and a non-TTY confirmer answers `false`.
- **Rejected — explicit operator flag.** A flag that stands in for approval is exactly the "ignore flag" the
  approval seam rules out (`github-operation-approval.ts:3-5`, `:196-199`); any agent could pass it.
- **Rejected — rewrite §3a to prescribe a manual `gh issue close`.** Fixes the docs, leaves the primitive dead
  for the common (unassigned) case, and pushes operators to raw unguarded writes.

## No-ledger-entry decision

`forget --resolved-by` on a GitHub issue with no intake ledger entry now comments and closes instead of refusing
(`src/conductor/src/engine/engineer-cli.ts:1631-1637` today). Rationale:

- The authority for an intake write is the per-request guard — sole assignee, or exact interactive approval
  (`src/conductor/src/engine/engineer/intake/github-issues.ts:131-150`) — re-checked on every write. The ledger
  entry is dedup bookkeeping; using it as a second authorization gate added no safety the guard does not
  already give, and it blocks the real case: spec agents that start from `compose worktree --source-ref`
  without a `claim` (and issues whose entry was already dropped) never have an entry.
- The existing refusal's own guidance is wrong: "rerun without --resolved-by to remove only the source label"
  reports `found:false` and removes nothing when no entry exists (`engineer-cli.ts:1638-1639`).
- With no entry there is nothing to forget, so the ledger is left byte-identical and no label removal is
  attempted (a closed issue is not re-polled; skipping it also avoids an extra approval prompt).
- The superseded criterion in `.docs/stories/close-already-fixed-intake-issues-from-compose-for.md` (#830
  Story 2) was replaced in place in a prior `spec: amend` commit on this branch.
