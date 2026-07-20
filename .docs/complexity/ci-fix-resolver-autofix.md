# Complexity Assessment: ci-fix-resolver-autofix

Tier: M

## Rationale

Scored against the standard conduct signals:

| Signal | Reading |
|---|---|
| New data models | None |
| External integrations | Existing `claude` CLI + `gh`; no new integration, but the spawn **contract** changes (fictional flag → real StepRunner dispatch) |
| Auth / permissions | Touches the daemon's Claude auth/PATH surface via the startup preflight (fail-loud-once) |
| State machines | No new state machine; reuses the existing resolver worktree lifecycle + guard/suite/lease-push pipeline |
| Story count | ~6 (real dispatch happy + no-op, error classification, startup preflight pass/fail, out-of-scope guard) |
| Design forks | One load-bearing, operator-gated: how the resolver invokes a real fix (resolved → StepRunner). Warrants an ADR. |

Not Small: it changes a spawn contract, adds a new startup gate surface, and carries a
genuine architectural decision (ADR-worthy) plus a cross-cutting error-classification concern.
Not Large: no new models, no multi-service orchestration, single cohesive subsystem
(`ci-fix.ts` + `daemon-cli.ts` wiring + one preflight), and the target dispatch mechanism
already exists and is proven in setup-triage.

**Medium → lightweight architecture-review, conflict-check retained, architecture diagram
lightweight, ADR required and APPROVED before land.**
