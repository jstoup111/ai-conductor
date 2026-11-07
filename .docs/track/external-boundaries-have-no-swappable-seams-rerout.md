# Track: External-boundary ports, registry, and ratchet

Track: technical

Scope boundary: This spec lands the ports-and-adapters convention (ADR), one enumerable boundary registry covering LLM, git, gh, tmux, process spawn, clock, OTel export, and filesystem, composition-root wiring for the `conduct` CLI and daemon entry points, and a shrink-only ratchet that rejects new direct external calls. Per-boundary call-site migrations are excluded and filed as follow-on intake issues. #3043 (git port) becomes the git migration under this ADR, blocked by #1989.

Internal architecture plus a CI structural check, with no user-facing behavior to specify in a PRD. This is not a maintenance change, because it adds a new mechanical check. Source: intake jstoup111/ai-conductor#1989.
