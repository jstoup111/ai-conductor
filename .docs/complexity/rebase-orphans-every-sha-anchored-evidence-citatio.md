# Complexity: rebase-orphans-every-sha-anchored-evidence-citatio

Tier: L

## Rationale

A new deterministic translation subsystem that sits on the false-ship-critical attribution
hot path, spans **four** sha-anchored stores and **two** rebase call sites, introduces a
git-rewrite-map primitive with a residue lifecycle, and must hold an adversarial
no-laundering negative path at every store. That combination — new mechanism + broad blast
radius + high correctness risk + active concurrent work in the same files — is Large.

### Signals

| Signal | Present | Notes |
|---|---|---|
| New external models/APIs | No | Pure git plumbing (`patch-id`, `rev-list`, `merge-base`) via the existing `GitRunner` seam |
| New integrations | No | No new services |
| Auth / permissions | No | — |
| New state machine / lifecycle | **Yes** | A rewrite-map + residue lifecycle: capture at rebase → persist (transitive) → resolve-at-read → surface residue |
| Story count | ~9 | Happy translation per store, both sites, residue surfacing, and a no-laundering negative path per store |
| Cross-module blast radius | **Yes** | `rebase.ts`, `conductor.ts`, `daemon-rekick.ts`, `task-evidence.ts`, `task-status`/`task-seed.ts`, `attribution-lane.ts`, `attribution-validate.ts`, `autoheal.ts` |
| Correctness/false-ship risk | **High** | A wrong map or a laundering hole either strands real work (halt) or advances forged evidence |
| Concurrent work in same files | **Yes** | #520/#581 (memo, sidecar), #532 (rebase resume), #576 (trailers) touch these exact functions → conflict-check required |

### Why not Small or Medium

Small/Medium would skip architecture + (for S) conflict-check. Both are mandatory here: a new
capture-map lifecycle with a persisted store and a resolve-at-read consumer contract warrants an
ADR, and the change must be reconciled against the active attribution/rebase cluster
(#520/#581/#532/#576) in the very same functions. The scope is a subsystem addition, not a
contained read fix — four stores, two sites, a new primitive, and a negative path per store.

## Tier-driven DECIDE scope

- `/prd` — SKIPPED (technical track)
- `/architecture-diagram` — INCLUDED (Large)
- `/architecture-review` — INCLUDED, full (Large); every ADR APPROVED before land
- `/conflict-check` — INCLUDED (Large)
- `/plan` — INCLUDED with a task dependency graph
