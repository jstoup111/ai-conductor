# Complexity: Setup-before-dispatch wedge — deterministic setup-failure triage

Tier: M

Rationale: multi-module engine change (worktree-prepare seam, quarantine state machine,
one new bounded LLM dispatch surface mirroring the /rebase resolver) with heavy
negative-path test requirements (quarantine must never discard legitimate WIP). No new
external integrations, auth, schema, or model changes — not L. Well above a single-file
fix — not S. Signals: 2 interacting mechanisms (mechanical quarantine + gated fix-session),
existing precedents to align with (leak-triage.ts, rebase resolver), expected story count
in the 5–8 range.
