# Track: Guided bootstrap setup for user and project config

Track: product

Scope boundary: Bootstrap-time guided setup of project config — every decidable key asked with a
plain-language explanation, allowed values, default, and consequence — plus the ability to WRITE
operator-chosen non-default values through the deterministic writer (the bootstrap skill may never
hand-author `.ai-conductor/config.yml`). Also in scope: `spec_owner` written to user config
(`~/.ai-conductor/config.yml`) so the fail-closed owner gate can resolve, and an annotated project
config template that explains in place the keys the interview does not ask about. Re-running is safe
and never overwrites operator-set values; auto mode, non-TTY, daemon, and CI behavior are unchanged.
Explicitly excluded: `bin/update` handling config across already-registered projects (separate
intake), and adding prompts to `register`/`create` (collides with adr-003-registry-write-and-integration,
which locks them as thin, non-interactive, single-writer commands).

Operator-facing onboarding capability: the requirements (idempotence, auto-mode parity, fail-closed
owner identity, per-key guidance quality) are product requirements, not an internal refactor.
