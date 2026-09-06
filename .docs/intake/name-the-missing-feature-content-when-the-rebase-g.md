# Intake origin: name-the-missing-feature-content-when-the-rebase-g

Source-Ref: jstoup111/ai-conductor#1497
Owner: jstoup111

## Desired outcome
- A rebase whose resulting tree preserves all feature content completes without a HALT,
  even when git eliminates a commit whose patch had already landed on the base.
- When the guard does reject a rebase, the rejection identifies which feature content is
  missing, not merely that a commit subject disappeared.
- A rebase that genuinely loses feature content still HALTs `needs-human` — the guard does
  not become permissive.
- A HALT raised by this guard describes a resume procedure that matches the actual repo
  state (the one raised here instructed the operator to resolve conflicts and run
  `git rebase --continue`, with no rebase in progress and a clean working tree).
