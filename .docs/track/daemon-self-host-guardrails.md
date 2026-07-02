# Track: Harness daemon self-host guardrails

Track: technical

Internal build-safety tooling that lets the james-stoup-agents harness repo be
daemon-registered without the bootstrap risks of a daemon building its own execution
engine. No user-facing product behavior — the only "users" are the operator and the
daemon itself — so acceptance criteria live directly in stories, no PRD.
