# Complexity: Zero-work BUILD re-raises a cleared halt from events.jsonl, looping needs-human

Tier: M

## Rationale

- Three engine seams change: the BUILD dispatch boundary for every round kind, the build-stall
  remediation verdict handling, and the operator CLI surface (a new settle command).
- Reuses existing machinery: the BUILD completion check and the audit-round
  `derived-already-complete` exit. No new module, service, dependency, or persisted format.
- Expected to amend an APPROVED stall-remediation ADR, so architecture review is required.
- Not Small: more than two production files and a contract surface (CLI) change.
- Not Large: no new subsystem and no cross-repository or data-migration work.

Operator confirmed Tier M on 2026-11-15. Source: intake jstoup111/ai-conductor#3659.
