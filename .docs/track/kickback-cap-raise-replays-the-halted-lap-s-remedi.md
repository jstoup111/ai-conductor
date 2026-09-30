# Track: kickback-cap-raise-replays-the-halted-lap-s-remedi

Track: technical

Scope boundary: every remediation kickback-cap halt (prd_audit lap cap, plan-growth cap,
architecture_review_as_built lap cap) moves from inside the audit/remediation step to the
remediation→build transition. /remediate runs and its tasks are appended and committed first; the
cap is enforced at the build dispatch, so a consumed `kickback-budget raise` resumes straight into
build on exactly those pending tasks, with rebase-reopened gates running after that build. This
replaces the #2755 pre-remediate lap-cap check. The lap and growth charges move from append to
dispatch, which is an additive amendment to adr-2026-08-25 D4 and adr-2026-08-22 D5/D6.
Over-scope decisions stay ahead of /remediate, and a raise never clears a halt that carries an open
over-scope decision. A halt with no appended tasks keeps today's behavior.

Excluded: proceeding at the cap without a raise (ship-at-budget, rejected in #2185); a "build once
without charging a lap" option; teaching /remediate about accepted over-scope rows; a rebase
staleness guard (the post-build audit covers stale findings).

## Rationale

Internal engine halt/resume behavior with no new command, flag, config key, or user-facing
surface; acceptance criteria belong in stories, not a PRD. → **technical track** (skip `/prd`).

## Approaches considered

- **Chosen: halt at the remediation→build transition.** No replay record, no freshness or
  run-identity bypass, and one mechanism for all three cap halts. Cost: /remediate (~$1) runs even
  when no raise follows, plus the D4 amendment.
- Rejected: persist the halted lap's report or remediation plan and replay it on raise. It needs a
  new durable record, bypasses of session freshness and run identity, and a rebase staleness guard.
- Rejected: prd_audit lap cap only. Growth-cap and as-built-cap halts would still re-audit.
