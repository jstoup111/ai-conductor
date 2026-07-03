# Complexity: Configurable push/PR timing (daemon build + engineer spec flows)

Tier: M

## Rationale

- Touches two flows: the daemon build tail (push/PR currently inside the auto-mode
  `/finish` prompt) and the engineer spec flow (`land`/`handoff` single-commit contract).
- Adds one new top-level config key to `.ai-conductor/config.yml` with fail-closed
  validation and a defaulting resolver (established pattern: `rebase_resolution_attempts`).
- One history-rewrite edge: early-pushed build branches diverge after the finish-time
  rebase step → post-rebase push must be `--force-with-lease`.
- No new external integrations, auth surfaces, data models, or long-lived state machines;
  reuses the existing draft-PR seam (`findOrCreatePr({draft})`, `markReadyForReview`).
- Estimated stories: 5–8.

Not S: multi-flow behavior change + config schema addition requires architecture review
and conflict-check. Not L: no new subsystem, no cross-repo coordination, single config key.
