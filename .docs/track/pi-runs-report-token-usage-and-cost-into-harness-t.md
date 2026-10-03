# Track: Pi runs report token usage and cost into harness telemetry

Track: technical

Scope boundary: Balanced — fix the Pi JSONL usage parser (read per-message `message.usage`, sum across assistant turns, never fabricate zero usage), price each step from Pi's own `usage.cost.total` when positive, fall back to the committed rate card keyed by the model that actually ran (`message.provider`/`message.model`), and record that attributed model. Excluded: a distinct cost-source label for Pi-computed estimates, rate-card coverage enforcement for every Pi-wrapped model, RPC/session-file usage sources.

Internal operator-facing cost telemetry for an existing provider adapter; no product requirements, acceptance criteria live in stories.
