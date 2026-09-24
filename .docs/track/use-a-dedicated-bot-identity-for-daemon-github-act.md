# Track: use-a-dedicated-bot-identity-for-daemon-github-act

Track: technical

Scope boundary: An optional, machine-scoped (user-config only, never committed) GitHub bot identity backed by a machine-user token. When configured, every harness remote write — all guarded GitHub `*-write` operations (PR open/comment/label/ready, issue comment/edit/close/label/dependency, intake write-back) and remote git pushes — runs as the bot, for both daemon-driven and operator-run CLIs (compose handoff, intake file). All GitHub reads, including `gh api user` identity resolution and `--assignee @me` intake capture, stay on the operator's ambient auth. When no bot is configured, behavior is byte-for-byte unchanged. When a configured bot write fails with an unambiguous auth refusal (missing token, 401/403), the write retries once as the operator and emits a warning through the canonical ConductorEvent spine; ambiguous failures (timeouts) do not retry. Includes operator setup documentation. Excluded: GitHub App installation tokens, per-repo token overrides, a doctor check or status line, a setup/provisioning command, dashboard surfacing, and any change to read-path identity.

Rationale: harness credential/transport plumbing at the existing guarded GitHub boundary with operator-only visible effects (authorship attribution) — acceptance criteria belong in stories, no PRD.
