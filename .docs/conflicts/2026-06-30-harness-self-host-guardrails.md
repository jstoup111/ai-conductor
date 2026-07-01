# Conflict Check: Harness Daemon Self-Host Guardrails

**Date:** 2026-06-30
**Stories:** `.docs/stories/harness-self-host-guardrails.md` (TR-1..TR-13)
**Verdict:** CLEAN (3 shared-surface adjacencies reviewed; each orthogonal or ordered, no contradiction)

Checked against the specs sharing the daemon **discovery / finish / HALT** surfaces:
`daemon-owner-gate` (merged, PR #175), `daemon-supervised-hosting` (approved),
`rebase-resolution` (branch), plus the existing daemon/finish test suites.

## Reviewed adjacencies

### 1. Owner-gate (discovery/dispatch) — ORTHOGONAL, ordered
Both the owner-gate and `SelfHostDetector` (TR-1..TR-3) attach near daemon discovery/dispatch.
They answer **different questions**: owner-gate = *should I build this spec at all?* (spec-author
identity); self-host = *which mode do I build in?* (repo identity). No shared state; no contradictory
write. **Ordering rule (recorded):** owner-gate eligibility is evaluated first; a spec that clears
owner-gating is then classified by the self-host detector. Neither disables the other. Not a
conflict.

### 2. Supervised-hosting (management plane) — NO OVERLAP
`daemon-supervised-hosting` governs start/stop/attach/restart of the daemon process (tmux supervisor
port). This feature touches only the **build plane** (build step, finish step, preflight). Disjoint
surfaces. Not a conflict.

### 3. Rebase resolution + finish-time HALT — SHARED MARKER, ordered, distinct reasons
`rebase-resolution` and this feature both use `writeHalt()` → the single `.pipeline/HALT` marker.
Risk = two HALT sources colliding at finish time. Resolution:
- **Ordering:** the finish-time rebase step runs *before* the version/release-artifact gates
  ([[project_rebase_step_daemon_gated]]); they are sequential stages, never concurrent writers.
- **Distinct reasons (decided in ADR-halt-based-release-gates):** each gate writes a gate-specific
  HALT reason distinct from a rebase HALT, so an operator always sees which stage parked the build.
- One HALT marker at a time is the existing model; these gates conform to it. Not a conflict.

## State / resource contention
- **`.pipeline/HALT`** — single-writer-at-a-time honored (sequential stages). OK.
- **Global `~/.claude/skills`** — the sandbox (TR-5/6) is explicitly no-mutation of global state, so
  it cannot contend with the operator's concurrent sessions or with the relink preflight (which
  operates on the real install intentionally, before dispatch, not during the sandboxed build). OK.
- **Single-daemon lock (ADR-010)** — one self-build per repo; no shared sandbox clobber (TR-6). OK.
- **`HarnessConfig`** — new `harness_self_host` block is a new key; no collision with `otel`,
  `spec_owner`, or owner-gate keys (TR-11). OK.

## Verdict
**CLEAN.** No contradictions, no overlapping ownership of the same behavior, no unresolved resource
contention. The three adjacencies are orthogonal or explicitly ordered with recorded rules. Proceed
to `/plan`.
