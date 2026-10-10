# Complexity: Diagnostic surfaces mislead — rejected remediation commands and non-durable episode HALT state

Tier: M

## Rationale

- Two independent fixes in two subsystems: conductor CLI remediation output
  (`src/conductor/src/index.ts` + a new command builder) and daemon rate-limit episode recovery
  (`engine/episode-halt-tracker.ts`, `daemon-cli.ts` sweeps, `engine/daemon.ts` park stamping).
- Introduces a new durable per-worktree state file read at daemon startup — a design decision that
  must be weighed against the event spine (exception C) and the HALT clear/rekick lifecycle,
  warranting a lightweight architecture review and ADR.
- Recovery correctness risk: a stale stamp must never clear a later human HALT, and operator parks
  and operator-action halt classes keep precedence.
- Moderate story count (~5–6); no external integrations, no schema/CLI surface change for consumers.

Per tier rules: architecture-diagram, lightweight architecture-review, conflict-check, and
coherence-check run.
