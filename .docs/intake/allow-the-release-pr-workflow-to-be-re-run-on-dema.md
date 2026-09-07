# Intake origin: allow-the-release-pr-workflow-to-be-re-run-on-dema

Source-Ref: jstoup111/ai-conductor#1274
Owner: jstoup111

## Desired outcome
An operator can regenerate the bot-owned release PR on demand, without merging anything, and get the same result the merge-triggered path produces.

A failed run can be retried against corrected repository state as soon as that state exists.
