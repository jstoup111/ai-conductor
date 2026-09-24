# Coherence waiver: offer-ship-or-continue-at-remediation-budget

Waives: outcome-1, outcome-2, outcome-3, outcome-4, outcome-6, outcome-7, outcome-8

Rationale: On 2026-09-24 the operator narrowed #2185 to its "continue" half. At a spent budget the
workflow stays the finisher, and there is no path that ships at budget. The operator's reason:
publishing a draft with open findings and finishing it later by hand takes the finish out of the
workflow, which is the concern already recorded on #2192. The scope boundary is recorded in
`.docs/track/offer-ship-or-continue-at-remediation-budget.md`. The selected approach and the
rejected alternatives are in the explore decision record.

The seven waived bullets all describe that rejected path. `outcome-1` is the draft PR at budget.
`outcome-2` is its findings list. `outcome-3` is the skipped tests named per finding. `outcome-4` is
the shipped-record residuals and at-budget flag. `outcome-6` is the release-PR hold. `outcome-7` is
the engineer resume from the PR list. `outcome-8` is the non-blocking observations list. None of
these is deferred work owed by this feature: each exists only to serve a ship-at-budget outcome that
this spec deliberately does not build. Crediting any of them as covered would claim behavior this
diff does not contain.

What the feature delivers in their place is the "continue" option from the issue's 2026-09-05
amendment. Every `prd_audit` and `architecture_review_as_built` budget halt, including plan-growth
exhaustion, can now be recovered with one `kickback-budget raise`, with no config edit and no commit
on main. adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class D5 records this.
`outcome-5` is covered by Story 3.
