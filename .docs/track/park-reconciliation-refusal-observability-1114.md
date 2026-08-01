# Track: park-reconciliation refusal observability

Track: technical

Internal daemon observability plus a governing-ADR correction: the parked-feature sweep's
refusal vocabulary and summary counters do not distinguish a structurally-unprovable branch
from a genuinely-unmerged one, and `adr-2026-07-27-ancestry-proven-park-reconciliation` §3
still names git ancestry as the ONLY deletion authority although #1185 shipped a second
proof (merged-PR head identity). No new user-facing product capability, so no PRD; acceptance
criteria live directly in the stories.
