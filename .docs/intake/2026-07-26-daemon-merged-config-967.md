# Intake origin: 2026-07-26-daemon-merged-config-967

Source-Ref: jstoup111/ai-conductor#967
Owner: jstoup111

## Desired outcome

- Starting the daemon with `llm_provider: codex` only in user-scoped configuration dispatches daemon SDLC steps through Codex.
- Project-scoped provider configuration continues to override user-scoped configuration when both are present.
- Other user-scoped daemon settings remain effective unless explicitly overridden by the project.
- Invalid configuration produces an actionable startup error identifying the relevant configuration scope.
