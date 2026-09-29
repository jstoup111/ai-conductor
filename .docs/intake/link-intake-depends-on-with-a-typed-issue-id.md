# Intake origin: link-intake-depends-on-with-a-typed-issue-id

Source-Ref: jstoup111/ai-conductor#2714
Owner: jstoup111

## Desired outcome
- An intake filed with `--depends-on owner/repo#N` shows that issue under its GitHub "blocked by" list immediately after filing.
- Every other caller of the registered dependency-add operation records the link the same way.
- When a dependency link cannot be recorded, the filer's output makes that unmistakable and names the missing link, so it is never discovered later by accident.
