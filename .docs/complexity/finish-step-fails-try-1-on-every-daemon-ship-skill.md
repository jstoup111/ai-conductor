# Complexity: finish-record primitive — first-try finish-choice marker write (issue #281)

Tier: M

## Rationale

- New `conduct-ts` CLI subcommand (`finish-record`) — additive public surface (MINOR),
  which rules out S.
- Sits on the ship-critical path: it performs the finish STOP-gate verification (PR
  exists, HEAD pushed) and writes the completion markers the daemon's finish gate reads.
  Wrong behavior here is a false-ship or a stuck loop — negative paths must be specced
  adversarially (fail-closed on any verification error).
- No new models, no external integrations beyond the existing gh/git seams, no auth
  work, no state machines. Single seam (CLI + SKILL.md wiring). Est. 4–6 stories.
- Not L: no cross-cutting redesign; the completion-gate semantics in artifacts.ts are
  unchanged — the primitive replicates the checks the skill was already instructed to
  perform manually.
