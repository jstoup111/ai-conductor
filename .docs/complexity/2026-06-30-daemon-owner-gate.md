# Complexity Assessment: Daemon Owner-Gating

**Plan stem:** `2026-06-30-daemon-owner-gate`
**Date:** 2026-06-30

**Tier: M**

## Signals

| Signal | Present? | Notes |
|--------|----------|-------|
| New data models | No | No schema/entities; ownership is a value recorded on existing spec artifacts. |
| External integrations | Light | `gh` (owner fallback) and git history (cutover/merge-time) — both already used elsewhere. |
| Auth / security surface | Some | A gating decision with a security *posture* (coordination now, forgery deferred), but no auth system built this iteration. |
| Cross-subsystem span | Yes | Touches the **engineer authoring flow** (stamp owner), the **daemon discovery path** (the gate), and the **daemon config** surface. |
| State machine / complex control flow | No | A per-spec decision (match / other / unowned±cutover); no new lifecycle machine. |
| Architectural seam / abstraction | Yes | The forward-compat requirement (swappable, platform-provided identity for EKS) is a real boundary decision — the one thing that lifts this above Small. |
| Story count (est.) | ~10–13 | Happy + several negative paths (unresolved owner, other owner, unowned pre/post cutover, cosmetic mismatch, rotation). |

## Rationale

Not **Small**: it spans two subsystems plus config, has a meaningful negative-path surface, and
carries a genuine architectural decision (the identity-resolution/provenance seam that must stay
swappable for an isolated EKS deployment).

Not **Large**: no new data models, no sprawling multi-service state machine, and the external
integrations (`gh`, git) are thin and already-established. The scope is bounded — a resolver, a
gate, a stamp, and a config surface.

## DECIDE consequences (Medium)

- `/conflict-check` — **runs** (not skipped).
- `/architecture-diagram` — **runs** (the cross-subsystem flow + identity seam are worth a picture).
- `/architecture-review` — **lightweight but must produce focused ADRs**, specifically for:
  (1) the identity-resolution + provenance seam (forward-compat / EKS trust root),
  (2) how/where ownership is recorded on and read from a spec,
  (3) how a spec's merge/activation time is derived for the grandfather cutover.
  All ADRs must be **APPROVED** before landing.
- `/plan` — **runs**.
