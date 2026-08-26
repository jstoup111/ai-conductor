# Complexity: hard-delete-the-retired-wiring-check-step-name-fro

Tier: M

Rationale: No new models, integrations, auth, or state machines — but the deletion is wide
(25 engine call sites across 10 files, ~80 test files, 9 doc pages), touches the event union and
BUILD fan-out/join shape, carries a landing precondition on live worktree state, and crosses a
consumer-visible breaking surface (settings.json step keys, step listings) that needs a migration
block. Too broad for S; no L-class design novelty.
