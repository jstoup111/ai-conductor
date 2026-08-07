# Complexity: daemon-autonomous-runs-must-fail-closed-on-any-amb

Tier: L

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | `DecideEntryDisposition` (replaces the two-case `KickbackDisposition`), a structured `needs-human` HALT payload, and a durable operator-direction record |
| External integrations | None |
| Auth / permission surface | **Yes** — this is an authorization boundary: who (daemon vs operator) may enter DECIDE, plus a new explicit operator-direction affordance that grants it |
| State machines | **Yes** — the conductor's step-navigation state machine, guarded at four independent seams (forward walk, verdict-aware resume clamp, `scanKickbackVerdicts`, `planRemediation`) |
| Story count | 7 (four seam invariants, the HALT payload contract, the operator-direction grant, and the healthy fast-forward negative path) |
| Files touched | `engine/kickback-policy.ts`, `engine/conductor.ts` (≥4 seams incl. `deriveGateTopology`, `earliestRemediationTarget`), `daemon-cli.ts` (`PRESEEDED_DONE`), `docs/explanation/gates.md`, `docs/reference/cli.md`, a recovery runbook |
| New runtime code | Substantial — a fail-closed policy module, structured HALT rendering, and an operator-direction reader wired at every navigation seam |

## Rationale

The existing guard (#644, #551/PR #1119) covers **one direction** (backward navigation) and
**fails open by construction**: `decideKickbackDisposition` returns `route` whenever the target's
phase cannot be resolved, `earliestRemediationTarget` silently defaults an unknown disposition to
`'build'`, and `scanKickbackVerdicts` only iterates `topo.kickbackTargets` so a verdict naming an
unknown or custom target is dropped without a trace. The forward walk has no phase guard at all —
its only protection is the daemon's one-time `PRESEEDED_DONE` state stamp, which a reconstructed
or wiped state file erases (the #549/#550 incident).

Inverting a fail-open default to fail-closed across four seams touches an authorization boundary,
requires a new operator-direction affordance so legitimate autonomous DECIDE entry stays possible,
and must not regress the healthy fast-forward path. That combination — permission surface, a
multi-seam state machine, and a new durable grant record — puts this at **Large**.
Architecture-diagram, architecture-review (full), conflict-check, and coherence-check all apply.
