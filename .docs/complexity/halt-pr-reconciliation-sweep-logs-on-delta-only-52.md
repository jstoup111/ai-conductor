# Complexity: Halt-PR reconciliation sweep logs on delta only

Tier: S

## Rationale

- Single-behavior change to one engine module (`halt-pr-reconciliation.ts`,
  ~98 LOC) plus a two-line wiring change at its single caller
  (`daemon-cli.ts:1216-1218`). No new subsystem, no new external integration,
  no data model, no auth surface, no state machine.
- The mechanism is a small in-memory per-PR outcome cache passed in through the
  existing `ReconcileOpts` seam, with per-PR log lines gated on a state
  delta. Healing/action log lines stay verbatim — no behavioral change to the
  sweep's writes, only to which no-op observation lines it emits.
- In-memory (not disk-persisted) cache is a deliberate, load-bearing choice: it
  makes cache-loss-on-restart naturally re-log the first post-boot observation
  (one full log, then quiet) — satisfying the negative path without extra
  machinery.
- No CLI/hook/settings.json/skill-symlink surface touched → no migration block
  required (CLAUDE.md Release Gate 2). Low story count (~4), all unit-testable
  with the existing `fakeGh` pattern and an injected `log` collector. Clearly
  Small: not cross-cutting, not architectural.
