# Track: Daemon auto-restart on stale engine code

Track: technical

Daemon infrastructure (self-host lifecycle trigger) — no user-facing product requirements; acceptance criteria live in stories. Operator confirmed 2026-07-03. Chosen approach: exit-to-respawn at the idle boundary (restart-intent marker + clean exit; respawn via the #215 restart primitive / ensureRunning). Source: jstoup111/ai-conductor#256 (blocked_by #215).
