# Coherence waiver: compose-launcher-honors-llm-provider-for-codex

Waives: outcome-2

Rationale: `outcome-2` asks that a Codex-configured project can run the engineer loop end to end.
This feature delivers the part the issue found missing: the `ai-conductor compose` launcher now
starts Codex on `$composer` instead of always spawning `claude`. The operator-confirmed scope
boundary in `.docs/track/compose-launcher-honors-llm-provider-for-codex.md` excludes Codex sandbox and permission tuning, and
`.docs/decisions/architecture-review-2026-09-28-compose-launcher-honors-llm-provider-for-codex.md` records the unresolved risks. A Codex
configuration with network disabled or a read-only sandbox can block `compose handoff` (gh) or
`.docs/` authoring inside the launched session. That behavior belongs to the operator's own Codex
configuration and matches today's in-session `$composer` path. Crediting the row as covered would
claim an end-to-end Codex run that no task asserts.
