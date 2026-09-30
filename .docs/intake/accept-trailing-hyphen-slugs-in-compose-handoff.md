# Intake origin: accept-trailing-hyphen-slugs-in-compose-handoff

Source-Ref: jstoup111/ai-conductor#2697
Owner: jstoup111

## Desired outcome
- A spec branch created by `compose worktree` and accepted by `compose land` is always accepted by `compose handoff`, whatever its generated slug.
- A branch that is genuinely not a `spec/<slug>` branch (another prefix, an empty slug, or a slug that `compose worktree` could never produce) is still refused before any remote mutation, with the current message.
