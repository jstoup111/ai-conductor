# Track: Annotated `**Stories:**` line makes a merged spec silently undispatchable

Track: product

Operator-facing visibility feature with enumerable functional requirements: a plan-reference
parsing fix plus a new first-class BLOCKED state surfaced in the daemon startup dashboard and
in `conduct-ts daemon status`. The operator explicitly directed that an unbuildable merged
spec must be *blocking and visible*, never skipped — that is a behavioural contract with
users (the operator persona), so it warrants a PRD. Directly parallel to
`.docs/specs/2026-07-03-surface-owner-gated-specs-dashboard-status.md`, which took the same
track for the same reason.

## Discovery notes (ephemeral)

Grounded against `origin/main` in this repository at DECIDE time:

- 82 of 253 plans under `.docs/plans/` carry a `**Stories:**` reference the current resolver
  refuses. Nearly all are the annotated form (`` `path.md` (12 stories, FR-1..FR-12) ``).
  The reported `reporting_app` cases are not an outlier — this is the dominant shape.
- After relaxing the resolver, only **1** of those 82 would newly reach eligibility here;
  the rest are already covered by `.daemon/processed/` markers (228) or `.docs/shipped/`
  records (129). Processed markers are machine-local, so a repo without them can see a
  larger burst — this is why dedup must run *before* the blocked classification.
- `src/conductor/src/engine/engineer/land-spec.ts:260` calls the **same** resolver and fails
  loudly on an unresolvable reference. So authoring and discovery do not disagree about the
  contract (filer hypothesis 3 is disproved): both refuse the annotated form; only discovery
  refuses it in silence.
- The silent `continue` at `daemon-backlog.ts:741` sits *before* `isProcessed`, so routing it
  through `warnOnce` unchanged would emit 82 skip lines in this repo alone.
- `HALTED` is derived from per-worktree `.pipeline/HALT` markers and drives
  `halt-pr-rehabilitation`, `build-failure-escalation`, `episode-halt-tracker`,
  `daemon-rekick`, and `park-reconciliation`. An unbuildable merged spec has no worktree, no
  attempt, and no PR; its remedy is on the default branch. Reusing HALTED would misfire that
  automation and hand the operator the wrong runbook.
