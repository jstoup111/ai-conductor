# Complexity: judged-attribution-verdict-persistence

Tier: M

## Rationale

A narrow but correctness-critical fix concentrated in the build-completion gate, but
tier-Medium because it interacts across several attribution subsystems and sits on a
false-ship-critical path with adversarial no-whitewash requirements.

### Signals

| Signal | Present | Notes |
|---|---|---|
| New external models/APIs | No | Reuses the existing verifier dispatch |
| New integrations | No | No new services or adapters |
| Auth / permissions | No | — |
| New state machine | No | Re-uses the existing gate/lane control flow |
| Story count | ~5-7 | Happy-path advance + several negative/no-whitewash paths |
| Cross-module blast radius | **Yes** | conductor.ts gate ordering, attribution-lane, task-evidence, autoheal/deriveCompletion sidecar-clobber interaction |
| Correctness/false-ship risk | **High** | A wrong fix whitewashes uncovered builds |
| Concurrent work in same files | **Yes** | Active attribution cluster (#570 isZeroWork, #576 trailers, #530/#529 finish) touches these exact files → conflict-check required |

### Why not Small

Small would skip conflict-check and architecture artifacts. Both are genuinely needed
here: the fix must be reconciled against the parallel attribution/finish work in the
same functions (conflict-check), and the halt/proceed re-derivation ordering plus the
no-whitewash invariant warrant an ADR (architecture-review).

### Why not Large

No new models, integrations, auth, or state machine; the change is a contained
re-ordering + read fix plus targeted tests, not a subsystem redesign.

## Tier-driven DECIDE scope

- `/prd` — SKIPPED (technical track)
- `/architecture-diagram` — INCLUDED (Medium)
- `/architecture-review` — INCLUDED, lightweight (Medium); ADR APPROVED before land
- `/conflict-check` — INCLUDED (Medium)
