# Track: kickback-budget inspect --child shows wrong prd_audit/as-built budgets (#3364)

Track: technical

Scope boundary: The desired outcomes of jstoup111/ai-conductor#3364. When `kickback-budget inspect`
renders a child view (an explicit `--child N`, or the execution child it defaults to), the
feature-wide budgets come from the feature's flat ledger, the same record the daemon's cap halt,
`raise`/`reset` and re-kick already use. The feature-wide budgets are the `prd_audit` and
`architecture_review_as_built` gate entries (consumed laps, lap cap, adjustment history, resume
authorization, latest reason, gate unreadability), their pending lap charges, and the plan-growth
line shown under every gate. Child-scoped gates (`build_review`, `restack`) keep reading the child
ledger, unchanged. Pending adjustments in the flat ledger are reconciled at `inspect` entry the
same way the child ledger's already are. The plan-growth line printed after a child-scoped `raise`
or `reset` uses the same feature-wide source.

Excluded:
- Halt text. The `kickback-cap` halt's trailing `for child N` stays as it is. Once the child view
  shows the halt's own numbers, that pointer no longer leads to a view that disagrees with the halt
  (outcome 3).
- Stale copies of feature-wide gates in child ledgers are neither cleaned up nor prevented. Nothing
  reads them for these gates after this change.
- `manual_test`. It is not a `kickback-budget` gate (`KICKBACK_BUDGET_GATES` is `build_review`,
  `prd_audit`, `architecture_review_as_built`, `restack`), so `inspect` has never rendered it and
  `raise` refuses it. Its outcome holds without new behavior.
- `daemon status`'s `KICKBACK BUDGET` lines. They read `prd_audit` and as-built from the active
  child's ledger too (`daemon-observe-cli.ts`). That is a sibling defect, reported for a separate
  intake.

Rationale: this is an internal operator-CLI accounting defect with no product surface. The governing
ADRs (`adr-2026-10-12-routed-whole-feature-repair` D10, `adr-2026-10-07-per-child-build-region` D10)
already place these budgets in the flat ledger. Acceptance criteria live in stories.

Approach: per-gate ledger routing in `inspect`, the filer's first hypothesis. It won on merits.
Rejected alternatives:
- Omit feature-wide gates from child views and point to the childless view. It fails because a
  childless `inspect` on a feature with an execution child defaults back to that child.
- Drop the halt's `for child N` suffix. That leaves `inspect --child` wrong.
- Stop seeding child-ledger copies. An absent child entry still renders the config default (`0/N`)
  instead of the real consumed laps and raises.
