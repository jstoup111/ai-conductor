# Intake origin: compose-launcher-honors-llm-provider-for-codex

Source-Ref: jstoup111/ai-conductor#1007
Owner: jstoup111

## Desired outcome

- `conduct-ts engineer` launches the host selected by `llm_provider`.
- A Codex-configured project can run the engineer loop end to end.
- If the loop genuinely requires Claude, it fails with an explicit message naming that requirement instead of silently spawning a binary the operator may not have.
